import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { archiveReader, SourceArchiveService, sourceArchiveCapabilities } from './source-archive.service';
@Controller('source-archives')
export class SourceArchiveController {
  constructor(private readonly service: SourceArchiveService) {}
  @Get('schema') schema(@CurrentUser() a: Actor) { archiveReader(a); return sourceArchiveCapabilities; }
  @Get() @Header('Cache-Control', 'no-store') list(@CurrentUser() a: Actor) { return this.service.list(a); }
  @Get(':id/rows') @Header('Cache-Control', 'no-store') rows(@CurrentUser() a: Actor, @Param('id') id: string, @Query() q: Record<string, string>) { return this.service.rows(a, id, q); }
  @Get(':id/content') @Header('Cache-Control', 'no-store') @Header('X-Content-Type-Options', 'nosniff') content(@CurrentUser() a: Actor, @Param('id') id: string) { return this.service.download(a, id); }
}
