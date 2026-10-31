import { approvalCatalog } from '../approval/approval.catalog';
import { WorkspaceService } from '../workspace/workspace.service';
import { ApprovalService } from '../approval/approval.service';
import { resources } from '../workspace/registry';
import { Controller, Post, Get, Delete, Req, Res, Body, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { CapabilityService } from './capability.service';
@Controller('mcp')
export class McpController {
  constructor(
    private readonly capabilities: CapabilityService,
    private readonly workspace: WorkspaceService,
    private readonly approvals: ApprovalService,
  ) {}
  @Post()
  async handle(@CurrentUser() actor: Actor, @Req() req: Request, @Res() res: Response, @Body() body: unknown) {
    const server = new McpServer({ name: 'tb-crm', version: '0.2.0' });
    const definitions = this.capabilities.list(actor);
    const invoke = async (name: string, args: unknown) => {
      try {
        const result = await this.capabilities.invoke(actor, name, args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: error instanceof HttpException ? JSON.stringify(error.getResponse()) : '业务调用失败',
            },
          ],
        };
      }
    };
    for (const def of definitions) {
      if (def.id === 'customer.search')
        server.registerTool(
          'customer.search',
          {
            description: def.description,
            inputSchema: {
              keyword: z.string().max(200).optional(),
              page: z.number().int().min(1).max(1000000).optional(),
              pageSize: z.number().int().min(1).max(100).optional(),
            },
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
          (args) => invoke(def.id, args),
        );
      if (def.id === 'customer.get')
        server.registerTool(
          'customer.get',
          {
            description: def.description,
            inputSchema: { customerId: z.number().int().positive() },
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
          (args) => invoke(def.id, args),
        );
    }
    const read = async (work: () => Promise<unknown>) => {
      try {
        return { content: [{ type: 'text' as const, text: JSON.stringify(await work()) }] };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: error instanceof HttpException ? JSON.stringify(error.getResponse()) : '业务查询失败',
            },
          ],
        };
      }
    };
    const kinds = Object.keys(resources) as [string, ...string[]];
    server.registerTool(
      'workspace.list',
      {
        description: '分页查询当前身份可见的客户、联系人、线索、商机、合同、订单、项目、任务与演示财务数据。',
        inputSchema: z
          .object({
            kind: z.enum(kinds),
            keyword: z.string().max(100).optional(),
            page: z.number().int().min(1).max(1000000).optional(),
            pageSize: z.number().int().min(1).max(100).optional(),
          })
          .strict(),
        annotations: { readOnlyHint: true },
      },
      (args) =>
        read(() =>
          this.workspace.list(actor, args.kind, {
            ...(args.keyword ? { keyword: args.keyword } : {}),
            page: String(args.page ?? 1),
            pageSize: String(args.pageSize ?? 20),
          }),
        ),
    );
    server.registerTool(
      'workspace.get',
      {
        description: '读取当前身份有权访问的业务对象详情及关联记录。',
        inputSchema: z.object({ kind: z.enum(kinds), recordId: z.number().int().positive() }).strict(),
        annotations: { readOnlyHint: true },
      },
      (args) => read(() => this.workspace.detail(actor, args.kind, args.recordId)),
    );
    server.registerTool(
      'workspace.overview',
      {
        description: '查询当前角色个人、团队或全公司的经营指标与漏斗。',
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true },
      },
      () => read(() => this.workspace.overview(actor)),
    );
    server.registerTool(
      'workspace.schema',
      {
        description: '读取版本化对象、字段、权限与操作契约。',
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true },
      },
      () => read(() => this.workspace.schema(actor)),
    );
    server.registerTool(
      'approval.pending',
      {
        description: '读取当前身份需要处理的审批节点与表单证据。',
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true },
      },
      () => read(() => this.approvals.pending(actor)),
    );
    server.registerResource(
      'business-capabilities',
      'crm://capabilities',
      { description: '当前身份可用业务能力目录', mimeType: 'application/json' },
      async (uri) => ({
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await this.workspace.schema(actor)) },
        ],
      }),
    );
    server.registerResource(
      'approval-capabilities',
      'crm://approval-capabilities',
      { description: 'Versioned approval form, flow and decision contracts', mimeType: 'application/json' },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(approvalCatalog(actor)) }],
      }),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`localhost:${process.env.PORT || 4000}`, `127.0.0.1:${process.env.PORT || 4000}`],
      allowedOrigins: [process.env.APP_URL || 'http://localhost:3000', 'http://127.0.0.1:3000'],
    });
    // Every request authenticates independently; no shared tenant/session state survives this request.
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
  @Get() unsupported(@Res() res: Response) {
    res.status(405).set('Allow', 'POST').end();
  }
  @Delete() deleteSession(@Res() res: Response) {
    res.status(405).set('Allow', 'POST').end();
  }
}
