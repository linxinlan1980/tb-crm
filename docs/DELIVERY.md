# 本地演示交付

本次演示包版本为0.2.0-demo.2。源代码MIT开源，交付不代表生产验收。

## Docker部署

安装官方Docker Desktop或Docker Engine及Compose v2。首次需要联网下载镜像和依赖。

1. 在本机终端设置`SEED_ADMIN_PASSWORD`作为演示种子账号口令（至少5位）；不要把企业凭证提交仓库。
2. macOS/Linux运行`sh deploy/start.sh`，Windows运行`./deploy/start.ps1`。
3. 脚本随机生成独立数据库/JWT/加密密钥到忽略文件`deploy/.env`，再构建、迁移并初始化。
4. 打开`http://localhost:3000`，使用admin、manager、sales、boss四角色账号。
5. 后续重启保留命名卷数据，种子只在首次初始化未完成时运行。停机使用`docker compose --env-file deploy/.env -f deploy/compose.yml down`，不附加删除卷选项。

只读验收：`node --env-file=deploy/.env deploy/verify.mjs`，或在app容器中运行`node deploy/verify.mjs`。

3000端口占用时修改`deploy/.env`中的`WEB_PORT`，然后重新启动。只映射127.0.0.1网页端口，MySQL不映射宿主机端口。需要干净副本时保留旧卷，使用独立Compose项目名及端口启动新实例。

## 智能体实调示例

原生安装依赖后，在配置好本机`.env`的源码目录执行：

```sh
node --env-file=.env examples/mcp-client.mjs
```

默认使用sales身份。可通过`CRM_USERNAME`、`CRM_PASSWORD`、`CRM_URL`、`CRM_KEYWORD`调整。示例使用官方MCP SDK完成协议连接、列举7个只读工具和资源，实际调用customer.search，不打印访问令牌。Docker中可在app容器运行同一示例。

摘要为规则生成，未接大模型。当前MCP不提供写入或独立OAuth委托身份。真实平台凭证和企业联调另见[集成说明](INTEGRATIONS.md)。

## 总包内容与验证

完整交付总包包括安装源码与预构建静态文件、迁移/种子/锁文件、启动入口、9张真实功能截图及讲解、17页可编辑Demo PPT、26页功能操作手册、6页演示手册、5页AI接入说明、6页部署手册及HTML阅读版、版本记录、验收和依赖审计结果。账号卡仅在交付文件中提供。

以包内MANIFEST.json的源码提交、SHA256SUMS.txt及当次验收记录为准。不得打包原机.env、数据库、访问令牌、node_modules、.git、内部原始设计资料或私人运行日志。最终ZIP重新解压到独立目录，用新测试库执行安装验证，保留原演示库。

已验证Linux Docker构建、初始化、四角色登录及重启后读取；Windows和macOS Docker尚未实机验收。Node24/MySQL本机模式另有独立验证。当前生产依赖审计仍有公告，详见交付验收记录，不能称为生产安全验收通过。
