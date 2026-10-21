# 医学文献与证据工作台

适用于 DeepSeek Harness 的本地医学研究工作区，当前版本 **0.2.3**，客户包面向 **Windows x64**。

检索文献、临床试验与药物资料，导入 PDF，阅读与批注，保存笔记、关联专题和任务；也可通过可选的 Zotero 本地 API 只读导入文献。

[下载最新完整客户包](https://github.com/jdjjhdhd/dsh-medresearch-workbench/releases/latest)

## 安装前提

- DeepSeek Harness **>= 0.2.1-rc.2**。
- 已安装并启用 [dsh-worktable **>= 0.4.0**（作者 Aisland-SJL）](https://github.com/Aisland-SJL/dsh-worktable)。本项目是它的自定义窗口。
- **Node.js 20+**，这是本插件安装器和本机文件服务的运行要求，请保留 Node.js 环境。
- Zotero 7+ 为可选来源；未安装 Zotero 也可导入 PDF、阅读、问答和保存。
- 完整客户包包含 BioMCP 0.9.3 Windows x64 程序。实时检索需要联网，程序运行需要兼容的 Windows VC++ / UCRT 环境；许可与来源见 `tools/`。

## 安装与使用

1. 下载并解压**完整客户包**，保留全部目录和文件。
2. 双击根目录的 **安装或升级医学工作台.cmd**。
3. 重启 DeepSeek Harness，在「工作台」或「控制室」打开「医学文献与证据工作台」。插件会初始化项目和默认窗口。
4. 点击「导入 PDF」开始阅读、批注、记录笔记与保存。

不能仅复制或安装 `plugin/` 子目录。安装器需要完整目录中的 HTML、桥接、PDF.js 和工具文件；目录移动后，请从新位置重新运行安装入口。升级时保留原有 `data/` 和上传附件，安装器不会自动迁移或清空业务数据。

首次使用默认**空资料库**，不自动加入演示记录；已有记录在升级时保留。需要示例时，可主动载入演示数据。

本机文件服务由插件自动检测和启动。首选端口 8765 被旧目录或其他程序占用时，会为当前项目选择空闲端口并记录实际地址；复用服务前核对项目归属，不结束占用者。后台服务启动成功后可以关闭启动窗口；失败时可在页面点击「启动 / 重试服务」。

## 模型与数据

- 默认使用 **DSH 模型**，跟随当前工作台明确绑定的会话；无法唯一确定绑定时，界面会说明并回退到 DSH 默认模型。
- 也可在顶栏「模型」中配置**自定义 OpenAI 兼容 Chat Completions API**。
- 模型设置中填写的密钥仅由 **DSH 宿主凭据库**保存，不写入项目业务数据、页面 localStorage 或导出备份。
- 模型调用按你配置的提供商规则计费，本项目不包含模型额度。
- 业务数据保存在本机项目的 `data/`，本仓库与客户包不包含开发者业务数据或账号密钥。

详细安装、模型设置和错误处理见 [客户安装与模型配置](docs/客户安装与模型配置.md)。

## 开发

源码仓库不包含 `tools/biomcp.exe`，仅保留其许可证和来源清单。开发或生成客户包前，请先从**同版本完整客户 ZIP** 中复制 `tools/biomcp.exe` 到源码的 `tools/` 目录；也可按 [BioMCP 来源清单](tools/biomcp-manifest.json) 中的官方地址下载指定版本，并核对文件大小与 SHA-256。

完整客户包已经包含该程序，下载完整客户包后直接安装使用不受影响。

在项目根目录执行，使用 Node.js 20+：

```powershell
# 从 src/ 构建工作台 HTML
node scripts/build-single.mjs

# 运行回归测试
node --test tests/*.test.mjs

# 生成 dist/ 完整客户交付目录
node scripts/package-dist.mjs
```

`src/` 是页面源码，`plugin/` 是宿主与客户端插件，`bridge/` 是本机文件、Zotero 与检索桥接。打包需要保留 `tools/biomcp.exe`、对应许可证/来源清单，以及 `vendor/pdfjs/`。

## 许可

本项目原创代码采用 [MIT 许可](LICENSE)。PDF.js、BioMCP、字体及示例论文分别适用各自许可，见 [第三方许可与来源声明](THIRD-PARTY-NOTICES.md)。
