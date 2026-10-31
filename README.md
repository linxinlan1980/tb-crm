# tb-crm · 伴圆 CRM

面向 B2B 销售与交付的 CRM，沿用 PartnerOS 原型的业务设计。目标是让网页和智能体使用同一套可验证的业务能力。

**当前阶段：v0.2本地演示与数据测试版，尚未生产验收。**

- admin、销售主管、销售、老板四角色及按人/团队/租户过滤的数据。
- 客户、联系人、公私海、线索转化、跟进、行动、商机报价、合同、订单、项目任务和验收主线。
- 通用审批设计器：表单、顺序节点、条件、版本、发布/预演；合同/订单/立项审批回调，驳回与撤回，站内通知。
- 财务前端展示与合成数据，明确标记“演示系统，暂无功能”。
- 7个只读MCP工具、业务HTTP契约，关键写入事务/幂等/并发校验/审计。
- 钉钉、飞书真实鉴权和通讯录预览接口，企业凭证与实际联调待提供。

[演示操作手册](docs/DEMO_GUIDE.md) · [验证与限制](docs/PROGRESS.md) · [钉钉/飞书配置](docs/INTEGRATIONS.md)

接收方部署优先阅读[交付与Docker启动说明](docs/DELIVERY.md)。总包提供9张功能截图、Demo PPT和完整操作/演示/AI接入/部署手册。首次安装需要联网，不是通用离线首装包。

## 本地开发

需要 Node.js 24、pnpm 11.25.0、MySQL 8（可通过 Docker Compose 启动）。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# 设置随机 JWT_SECRET、ENCRYPTION_KEY、SEED_ADMIN_PASSWORD；填写 DATABASE_URL。
# 演示环境设置 DEMO_MODE=true；Docker还需设置MYSQL_ROOT_PASSWORD与MYSQL_PASSWORD。
docker compose up -d mysql redis
pnpm --filter @partneros/database generate
pnpm --filter @partneros/database migrate:deploy
pnpm demo:seed
pnpm build
pnpm demo:start
```

本机也可双击 `启动演示.command`。Web：`http://localhost:3000`；API文档：`http://localhost:4000/api/docs`。
演示账号：`admin`、`manager`、`sales`、`boss`，密码为本机配置的 `SEED_ADMIN_PASSWORD`；租户编码默认 `TINGMENG`。本机账号说明保存在Git忽略的 `.local/演示账号.md`。

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

## 开源许可

本项目采用 [MIT License](LICENSE)。工作区包的 `private: true` 用于防止误发布到 npm，不影响 GitHub 仓库的公开状态。
