# 第三方许可与来源声明

本窗口的应用代码为本项目原创（MIT 许可，见 `LICENSE`）。以下第三方组件/数据/参考项目分别适用其自身许可。

## 运行时组件

### PDF.js 3.11.174

- 文件：`vendor/pdfjs/pdf.min.js`、`pdf.worker.min.js`、`cmaps/*`、`standard_fonts/*`
- 许可：Apache License 2.0
- 来源：https://github.com/mozilla/pdf.js
- 未修改源码；通过 CDN/npm 分发的原始构建文件引入。

### dsh-worktable 原生皮肤

- 文件：不随本项目分发；窗口在 `<head>` 引用 `/api/worktable/template/dshell.css`
- 许可：MIT（dsh-worktable 0.4.0）
- 来源：https://github.com/Aisland-SJL/dsh-worktable

### BioMCP 0.9.3（Windows x86_64）

- 文件：`tools/biomcp.exe`（由本项目桥接以 CLI JSON 方式真实调用）
- 许可：MIT
- 来源：https://github.com/genomoncology/biomcp/releases/tag/v0.9.3
- 完整原始版权及许可证：`tools/BioMCP-LICENSE.txt`；来源/大小/哈希清单：`tools/biomcp-manifest.json`。
- 说明：0.2.2 Windows x64 客户包包含官方二进制，SHA-256 为 `2e7a82c7e1a3c7bd056cb22d858c477f6f7f285d5f2dcacdc54324f4e5710d9b`；未修改其源码。运行需要兼容的 Windows VC++ / UCRT，实时检索需要联网。其上游数据源仍分别适用各自条款。

### Zotero 10.0.6（本机安装，不随项目分发）

- 位置：`C:\Program Files\Zotero\zotero.exe`（用户本机安装）
- 许可：AGPL-3.0
- 来源：https://www.zotero.org/
- 说明：本项目只通过 Zotero 官方本地 API `127.0.0.1:23119/api` 只读访问用户自己的文献库，不复制其代码、不随项目分发其二进制。

## 数据来源

- PubMed / NCBI E-utilities：NCBI 使用条款
- ClinicalTrials.gov API v2：ClinicalTrials.gov 条款
- MyChem.info：其数据来源与许可（ChEMBL、DrugBank、PubChem 等）见 https://mychem.info
- openFDA：https://open.fda.gov 条款；说明书为美国 FDA 数据，不覆盖中国 NMPA
- Zotero 本地 API：由用户本机 Zotero 提供，仅读取用户自己的文献库

## 参考项目（未复制代码）

| 项目 | 许可 | 用途 |
|---|---|---|
| [Open Paper](https://github.com/khoj-ai/openpaper) | AGPL-3.0 | 仅参考阅读、批注、引用回跳交互；未复制/分发其代码 |
| [dsh-zotero](https://github.com/Vncntvx/dsh-zotero) | MIT | 参考 Zotero 本地 API 读取协议 |
| [BioMCP](https://github.com/genomoncology/biomcp) | MIT | 项目内 `tools/biomcp.exe` 0.9.3 真实调用文献/试验/药物通道；未复制其源码 |
| [DSH Medical](https://github.com/Proton1917/dsh-harness-plugin) | BSD-3-Clause | 参考结构化病例字段、隐私边界与会话交接方式 |

## 示例论文

`fixtures/sample-paper.pdf`

- Boussageon R, et al. *Reappraisal of metformin efficacy in the treatment of type 2 diabetes: a meta-analysis of randomised controlled trials.* PLoS Medicine, 2012.
- DOI: 10.1371/journal.pmed.1001204
- PMID: 22509138
- 许可：PLOS 采用 CC BY 4.0；文件来自 PLOS 公开下载链接，用于演示真实 PDF 阅读与批注。
