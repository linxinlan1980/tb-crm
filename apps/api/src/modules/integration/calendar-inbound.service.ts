import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../../common/types/actor';
import { PrismaService } from '../../database/prisma.service';
import { runCommand, validateActor, json } from '../workspace/command-runner';
import { hasPermission } from '../workspace/access';
import { activityBinding } from './activity-binding';
import { bindingHash, dwsReader, record, type DwsBinding } from './dws-directory';
import { DwsActivities } from './dws-activities';
import { businessDay } from '../workspace/analytics-policy';

export interface InboundCalendarEvent { list: Record<string, unknown>; detail: Record<string, unknown> }
function eventDate(value: unknown) {
  const v = record(value), text = typeof v.dateTime === 'string' ? v.dateTime : typeof v.date === 'string' ? v.date+'T00:00:00+08:00' : '';
  const d = new Date(text);
  if (!Number.isFinite(d.getTime())) throw new BadRequestException('钉钉日程时间无效');
  return d;
}
function stable(value: unknown): unknown {
  if(Array.isArray(value)) return value.map(stable);
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  return value;
}
@Injectable()
export class CalendarInboundService {
  constructor(private readonly prisma: PrismaService) {}
  private async binding(a: Actor): Promise<DwsBinding> {
    if (!hasPermission(a,'action:read') || !hasPermission(a,'action:update')) throw new ForbiddenException('同步日程需要本人日程查看和编辑权限');
    return this.prisma.system.$transaction(async tx => {
      await validateActor(tx,a); const binding = await activityBinding(tx,a.tenantId,a.userId);
      if (!binding) throw new ForbiddenException('当前人员未绑定本人钉钉授权');
      return binding;
    });
  }
  async refresh(a: Actor) {
    const binding = await this.binding(a), read = dwsReader(binding);
    await new DwsActivities(binding,read).verifyIdentity();
    const from = businessDay(new Date()), end = new Date(new Date(from+'T00:00:00+08:00').getTime()+31*86400000);
    const events: InboundCalendarEvent[] = [];
    let cursor: string | undefined;
    for (let page=0; page<50; page++) {
      const response = record(await read(['calendar','+agenda','--calendar-id','primary','--start',from+'T00:00:00+08:00','--end',end.toISOString(),'--limit','100',...(cursor?['--cursor',cursor]:[])]));
      const data = record(response.data), meta = record(response.meta ?? {}), pagination = record(meta.pagination ?? {});
      if (response.ok !== true || !Array.isArray(data.events)) throw new BadRequestException('钉钉日程读取未成功');
      for (const value of data.events) {
        const item = record(value); if (typeof item.eventId !== 'string') throw new BadRequestException('钉钉日程缺少唯一编号');
        if (eventDate(item.start) < new Date(from+'T00:00:00+08:00')) continue;
        const detail = record(await read(['calendar','event','get','--id',item.eventId]));
        if (detail.success !== true) throw new BadRequestException('钉钉日程详情未完整读取');
        events.push({list:item,detail:record(detail.result)});
      }
      if (data.complete === true && pagination.endpoint_exhausted === true) return this.applyVerifiedSnapshot(a,binding,events,from,businessDay(new Date(end.getTime()-1)));
      const next = data.nextCursor ?? response.nextCursor ?? pagination.nextCursor;
      if (typeof next !== 'string' || !next || next === cursor) throw new BadRequestException('钉钉日程分页未读取完整，本次未导入');
      cursor = next;
    }
    throw new BadRequestException('日程分页超过50页，本次未导入');
  }
  /** Operator import also uses this after an exact-profile, complete primary-calendar read. Not an HTTP payload. */
  async applyVerifiedSnapshot(a: Actor, binding: DwsBinding, events: InboundCalendarEvent[], from: string, until: string) {
    const current = await this.binding(a);
    if (bindingHash(current)!==bindingHash(binding)) throw new ForbiddenException('钉钉授权已变更');
    const earliest = process.env.CRM_ACTIVITY_SYNC_FROM ?? businessDay(new Date());
    if (from < earliest || until < from || until > '2060-12-31' || events.length>5000) throw new BadRequestException('只同步生效日起至2060年的本人日程，每批最多5000条');
    const cutoff = new Date(earliest+'T00:00:00+08:00'), ending = new Date(until+'T23:59:59+08:00');
    const normalized = events.map(e => {
      const d=e.detail, id=e.list.eventId;
      if (typeof id!=='string' || id.length>200 || d.id!==id || typeof d.summary!=='string' || !d.summary || d.summary.length>200) throw new BadRequestException('日程唯一编号或主题无效');
      const startsAt=eventDate(d.start), endsAt=eventDate(d.end);
      if (startsAt.getTime()!==eventDate(e.list.start).getTime() || endsAt < startsAt || startsAt<cutoff || startsAt>ending) throw new BadRequestException('日程范围或实例日期与来源不一致');
      const freeBusy=String(d.freeBusy).toLowerCase(); if (!['busy','free'].includes(freeBusy)) throw new BadRequestException('钉钉日程忙闲字段无效');
      const snapshotHash=createHash('sha256').update(JSON.stringify(stable(d))).digest('hex');
      return {externalId:id,title:d.summary,description:typeof d.description==='string'?d.description:'',location:typeof d.location==='string'?d.location:'',startsAt,endsAt,freeBusy,status:d.status==='cancelled'?'cancelled':'scheduled',externalSnapshot:json({hash:snapshotHash,original:d})};
    }).sort((a,b)=>a.externalId.localeCompare(b.externalId));
    if (new Set(normalized.map(e=>e.externalId)).size!==normalized.length) throw new BadRequestException('同批日程重复，本次未写入');
    const digest=createHash('sha256').update(JSON.stringify({binding:bindingHash(binding),from,until,normalized})).digest('hex');
    return runCommand(this.prisma,a,'calendar.remote.import@1.0',{requestKey:'calendar-pull:'+digest,manifestHash:digest},async tx=>{
      const live=await activityBinding(tx,a.tenantId,a.userId); if (!live || bindingHash(live)!==bindingHash(binding)) throw new ForbiddenException('人员钉钉对应已变更');
      let created=0,updated=0,unchanged=0;
      for(const row of normalized) {
        const where={tenantId_ownerId_externalId:{tenantId:a.tenantId,ownerId:a.userId,externalId:row.externalId}};
        const prior=await tx.calendarEntry.findUnique({where});
        if (prior && prior.origin!=='dingtalk') throw new BadRequestException('日程来源冲突，本次未写入');
        const before=prior?.externalSnapshot,after=row.externalSnapshot;
        if (before && typeof before==='object' && !Array.isArray(before) && after && typeof after==='object' && !Array.isArray(after) && before.hash===(after as Record<string,unknown>).hash) { unchanged++; continue; }
        if(prior) {await tx.calendarEntry.update({where:{id:prior.id},data:{...row,revision:{increment:1}}});updated++;}
        else {await tx.calendarEntry.create({data:{tenantId:a.tenantId,ownerId:a.userId,origin:'dingtalk',...row}});created++;}
      }
      const summary={created,updated,unchanged,from,until,sourceHash:digest,primaryOnly:true};
      await tx.integrationRun.create({data:{id:randomUUID(),tenantId:a.tenantId,provider:'dws-calendar',kind:'pull',status:'completed',actorId:a.userId,bindingHash:bindingHash(binding),summary:json(summary)}});
      return summary;
    });
  }
}
