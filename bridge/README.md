# 本地桥接服务（可选）

零第三方依赖的 Node 服务，只监听 `127.0.0.1:8765`。用于补足浏览器无法完成的三件事：

> **Node.js 20+**：Node.js 用于运行插件安装器及本地桥接服务。使用 Zotero 代理、本地文件保存等桥接能力时，需要保留 Node.js 运行环境并启动后台桥接服务。后台启动成功后，可以关闭启动窗口。

1. 代理 Zotero 7+ 本地 API（CORS）；
2. 原子写项目数据文件与备份；
3. 可选的大模型问答（密钥只从进程环境变量读取）。

本服务优先调用随 Windows x64 客户包提供的 `tools/biomcp.exe` 0.9.3，失败时保留原因并回退 PubMed / ClinicalTrials.gov / MyChem.info / openFDA。没有桥接时，页面也支持直连公开上游。程序可运行和上游网络可用是不同状态。

BioMCP 官方二进制可能需要安装 Microsoft Visual C++ x64 / UCRT；`/health` 会区分未找到文件和启动失败，启动失败不再返回 `installed:true`。完整许可与来源哈希在 `tools/`。首次页面初始化为空库，桥接不注入演示数据。

## 启动

```powershell
cd /d "<项目目录>"
node bridge\server.mjs
```

工作台首次打开时，宿主插件会自动检测并启动本服务；也可以双击项目根目录 `启动医学工作台服务（后台）.cmd`。后台启动成功后，可以关闭启动窗口；服务继续在后台运行。Zotero 未安装/未运行时，文件导入、保存、模型问答仍可用。

数据目录固定为项目 `data/`：

```
data/workbench-data.json   主数据
data/backups/              自动（最多 30 个）/手动/恢复前备份
data/uploads/              页面“选择 PDF 并上传”的文件
```

## HTTP 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 服务版本、数据路径、Zotero 探测、模型是否配置、检索来源与 BioMCP 检测（不含任何密钥） |
| GET | `/status` | 轻量连接状态 |
| POST | `/search/pubmed` | `{query,mindate,maxdate,limit,sort}` → PubMed esearch + efetch |
| POST | `/search/trials` | `{condition,intervention,phase,status,limit}` → ClinicalTrials.gov v2 |
| POST | `/search/drug` | `{query}` → MyChem.info + openFDA（10 条候选里选最匹配的说明书） |
| POST | `/ai/ask` | `{question,itemTitle,chunks,mode}`；`mode=case` 用于病例整理；无密钥返回 `configured:false` |
| GET | `/zotero/status` | 本地 API 探测（3 秒超时） |
| GET | `/zotero/search` | `q,limit,start,itemType,tag,collection,mode` → 条目列表 |
| GET | `/zotero/item?key=` | 条目 + 子项（笔记/批注/附件） |
| GET | `/zotero/fulltext?key=` | 附件索引全文；未索引返回 `available:false` |
| GET | `/zotero/file?key=` | 附件 PDF 流（`file/view/url` 解析；链接附件 302） |
| GET | `/data/load` | 读取主数据文件 |
| POST | `/data/save` | `{data}`；校验 id/数组/版本后原子写，必要时自动备份 |
| POST | `/data/backup` | `{label}` → `data/backups/<label>-<ts>.json` |
| GET | `/data/backups` | 列出备份 |
| POST | `/data/restore` | `{data,confirm:true}`；先备份当前文件再替换 |
| POST | `/files/upload` | `{name,mime,base64}`（≤60 MB）→ `data/uploads/`，返回相对路径并记录文件身份 |

统一错误：`{"error":{"code","message"}}`。数据和上传接口要求 `x-medresearch-project-root: encodeURIComponent(项目根目录)`，缺失或不匹配返回403；`/health` 不要求该头。此头用于项目隔离，不替代用户身份认证。

## 环境变量

见根目录 README。所有密钥只存在于桥接进程环境；`/health` 只返回布尔值和模型名，不返回密钥。

## 安全边界

- 只绑定 `127.0.0.1`，CORS 精确允许桌面 `dsh-app://app` 及受支持的本机来源；
- 数据写入路径固定为项目 `data/`，不接受任意写路径；
- 日志只记录方法、路径、状态码、耗时，不记录请求体、查询词内容、文献正文或密钥；
- Zotero 只读；不执行 Zotero 写操作；
- 模型调用只发送页面选定的片段，不自动发送病例全文；
- 本服务不是文件系统沙箱，运行它的用户可读写自己有权访问的文件。

## Zotero mock（仅验收）

```powershell
node bridge\test\mock-zotero.mjs 23119

# 另一个桥接实例指向 mock（不污染 8765 实例）
$env:MEDWB_PORT=8766
$env:ZOTERO_BASE_URL="http://127.0.0.1:23119/api"
node bridge\server.mjs
```

mock 提供 1 个条目、1 个 PDF 附件、1 条笔记、1 条批注、1 条全文索引，用于验证映射/去重/PDF 代理；它**不是**真实 Zotero。

## 已验证

- 真实 PubMed / ClinicalTrials.gov / MyChem + openFDA 调用；
- 数据保存、自动备份、恢复校验；
- Zotero 协议 mock 的条目/笔记/批注/附件/PDF 路径；
- 模型未配置时的显式降级；
- 断网/429/超时映射到页面可读错误。

## 未验证

- 真实 Zotero 7 安装环境（本机未安装）；
- 真实模型密钥与供应商端到端；
- BioMCP 二进制 / MCP HTTP 通路。

