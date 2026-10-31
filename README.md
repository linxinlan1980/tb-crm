# tb-crm · 伴圆 CRM

面向 B2B 销售与交付的 CRM，沿用 PartnerOS 原型的业务设计。目标是让网页和智能体使用同一套可验证的业务能力。

**当前阶段：开发基线，尚未生产验收。** 原型各模块的文件存在，不代表功能完成。

已实现本轮基础能力：

- NestJS / React / Prisma 工程可构建；初始 MySQL migration。
- 全局 JWT 认证、实时角色权限加载、统一响应与错误处理。
- 租户查询上下文校验及按模型处理软删除。
- 客户列表与详情的可见范围；工作台使用同一客户能力查询真实数据。
- 两个只读业务工具：`customer.search`、`customer.get`，含能力目录、参数约束、结果投影与调用审计。
- 自动化 HTTP 边界测试及状态前置条件测试；CI含独立 MySQL 冒烟流程。

智能体委托凭证、MCP适配、写入动作的幂等与事务、业务事件、完整财务链路仍在建设中。现有其他 REST 模块属于待加固原型。

## 本地开发

需要 Node.js 24、pnpm 11.25.0、MySQL 8（可通过 Docker Compose 启动）。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# 设置随机 JWT_SECRET、ENCRYPTION_KEY、SEED_ADMIN_PASSWORD；填写 DATABASE_URL。
docker compose up -d mysql redis
pnpm --filter @partneros/database generate
pnpm --filter @partneros/database migrate:deploy
pnpm db:seed
pnpm dev
```

Web：`http://localhost:3000`；API文档：`http://localhost:4000/api/docs`。
初始账号 `admin` / 本地设置的 `SEED_ADMIN_PASSWORD`，租户编码默认 `TINGMENG`。种子数据仅使用演示身份。

```sh
pnpm check   # 类型检查、lint、测试、构建
```

真实数据库冒烟测试仅允许写入名称含 `test` 的临时数据库：完成 migration/seed/build 后，设置 `SMOKE_ALLOW_WRITES=true`，运行 `node --env-file=.env scripts/smoke.mjs`。

## 开发与接续

- [工程规则](AGENTS.md)
- [架构基线](docs/architecture.md)
- [当前进度与验证记录](docs/PROGRESS.md)
- [建设路线](docs/ROADMAP.md)

内部需求资料保留在本机 `docs/reference/`，由 Git 忽略；公开仓库不包含真实客户资料、个人联系信息或运行密钥。
