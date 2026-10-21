# dsh-medresearch-model

医学文献与证据工作台的**模型接入宿主插件**。它通过 DSH 宿主鉴权的同源 HTTP 路由，把工作台静态窗口连接到：

- **DSH 模型（默认）**：读取当前工作台绑定会话的 `modelSelection`（provider / model / reasoningEffort），每次请求重新读取；取不到会话时回退到 `ctx.agentDefaultModel.currentSelection()`，界面明确显示“使用 DSH 默认模型”。
- **自定义 OpenAI 兼容 API**：`/chat/completions`，可修改 Base URL、模型名与服务商预设；密钥写入 DSH 宿主凭据库，不进入工作台 localStorage、数据文件、日志或导出备份。

## 版本与权限

- 目标 DSH：`>= 0.2.1-rc.2`（本机核实版本 `0.2.1-rc.2`）。
- 依赖宿主已注册的服务：`webServer`、`connection`、`llm`、`sessions`、`sessionProjections`、`agentDefaultModel`、`credentials`。
- 插件不 import 任何 SDK 包实现，也不读取/复制 DSH 账号密钥；DSH 模式完全走现有 provider adapter。
- 插件同时带一个小型客户端初始化器（`lib/client.js`）：首次启动时在 dsh-worktable 中创建/更新“医学文献与证据工作台”项目、窗口1 和全新会话/工作区；不复制开发者的 sessionId 或浏览器状态。
- 宿主额外提供 `worktable-info`、`service/status`、`service/ensure` 路由，用于自动启动本地文件桥接服务。

## 安装

把本 `plugin/` 目录随项目一起交付。客户机器上执行：

```powershell
node scripts\install-model-plugin.mjs
```

脚本会：

1. 备份 profile 的 `package.json` 与 `pnpm-lock.yaml`；
2. 在 `~/.dsh/profiles/desktop/node_modules/dsh-medresearch-model` 创建 junction；
3. 在 profile `dependencies` 增加 `file:<交付目录>/plugin`；
4. 在 `dsh.profile.bundles` 末尾追加 `dsh-medresearch-model`；
5. 校验 JSON、bundle 增量与 junction。
6. 在当前profile写入 `.medresearch-workbench-installation.json`，记录完整交付目录并核对运行代码；实体模块副本从该登记定位资源，绝不从node_modules父目录猜业务根。

随后重启 DSH；运行中的实例通常也会热加载宿主半，但**以重启后自检为准**。

完整客户包也可双击根目录的“安装或升级医学工作台.cmd”。首选服务端口被旧目录占用时，为当前项目另选空闲端口并保存到runtime/bridge-service.json，保留旧服务；所有复用仍核对服务身份和项目根。

自检（不调用付费模型）：

```text
GET /api/medresearch/model/health
```

应返回 `ok: true` 与插件版本。工作台里的模型设置通过以下同源路由访问：

- `GET  /api/medresearch/model/settings?sessionId=...&binding=unique|none|ambiguous`
- `POST /api/medresearch/model/save`
- `POST /api/medresearch/model/test`
- `POST /api/medresearch/model/ask`
- `POST /api/medresearch/model/clear`
- `POST /api/medresearch/model/clear-key`

除 `health` 外均经过宿主 `connection.requestRejection` 鉴权。

## 存储

- 非密钥设置：`$DSH_HOME/medresearch-model/settings.json`（默认 `~/.dsh/medresearch-model/settings.json`），权限尽量设为仅当前用户。
- 自定义密钥：按 **provider + 规范化 Base URL** 生成 slot，存入 DSH 凭据记录 `medresearch-model/custom-<hash>`（`~/.dsh/.credentials.yaml`，由 DSH 凭据库管理）。
- 换服务商或 Base URL 后，空密钥不会沿用旧 slot；需要重新填写。模型名变更不改变 slot。
- 旧版本单记录 `medresearch-model/custom-api` **不迁移、不使用**；升级后请重新填写一次密钥。
- 工作台数据：仍在项目 `data/workbench-data.json`，**不含密钥**。
- 删除密钥使用设置页的独立“删除已保存密钥”按钮；“清除配置”只清本插件 scope 的记录。

## 协议范围

当前只实现 **OpenAI 兼容 Chat Completions**。Anthropic、Gemini 原生协议未实现；界面会明确标注。

## 失败语义

`/test` 只有在真实取得非空模型回答时才返回 `status: "success"`。HTTP 200、密钥存在、模型列表可读都不算生成通过。错误会映射为：

`unconfigured` / `auth-failed` / `quota` / `rate-limited` / `model-not-found` / `network` / `timeout` / `host-unavailable` / `empty` / `upstream-failed`。

修改地址、模型、服务商或密钥会清除旧的测试成功状态。`GET /settings` 与定时状态检查不调用付费模型。

**截断/超时**：DSH `finish=max-tokens` 或自定义 API `finish_reason=length/max_tokens` 返回 `truncated:true` 和 `finishReason`，界面明确显示“回答被截断”；`content_filter` 返回 `filtered`，超时返回 `timeout`，都不当作完整成功。

## 会话绑定

工作台只把一个同目录的**唯一启用绑定**作为会话来源。存在多个匹配绑定时返回 `binding=ambiguous`，宿主明确使用 DSH 默认模型，不任取一个。会话 ID 不可用时同样回退默认模型并显示原因。

## 换目录升级

交付目录移动后，在新位置的 `scripts/install-model-plugin.mjs` 重新执行即可：安装器核对 profile dependency、junction 实际目标、插件 `package.json` name，并更新到新位置。`--verify` 打印实际加载位置；`--rollback` 只撤销本插件的 dependency/bundle/junction，不覆盖其他插件配置。

## 兼容性提示

插件使用以下宿主能力；缺少任一能力时 `/health` 仍可访问，但对应模式会返回 `host-unavailable`：

| 能力 | 用途 |
|---|---|
| `ctx.llm.stream` | DSH 模式真实生成 |
| `ctx.sessions.get` + `ctx.sessionProjections.stateOf(...,'modelSelection')` | 跟随绑定会话 |
| `ctx.agentDefaultModel.currentSelection` | 会话不可用时的默认模型 |
| `ctx.credentials` record API | 记住自定义密钥 |
| `ctx.webServer.register` | 同源路由 |
| `ctx.connection.requestRejection` | 宿主鉴权 fence |
