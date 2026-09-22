# MinerU Desk

<img src="web/app-icon.svg" width="80" alt="笔和信纸图标">

把论文拖进窗口，选好保存位置，转换后对照原 PDF 阅读和修改 Markdown。

MinerU Desk 是基于 [OpenDataLab MinerU](https://github.com/opendatalab/MinerU) 的 Windows 桌面客户端，属于个人维护的非官方项目，与 OpenDataLab 无隶属或背书关系。文档解析、OCR、版面分析等核心能力来自 MinerU 及其依赖；本项目负责桌面界面、任务队列、模型与存储管理，以及供 Codex 调用的本地任务接口。云端接入使用 [MinerU Ecosystem](https://github.com/opendatalab/MinerU-Ecosystem) 的 `mineru-open-api`。

[下载安装包](https://github.com/chengyingzh433-stack/mineru-desk/releases/latest) · [使用说明](使用说明.md) · [让 Codex 操作](packaging/安装版Codex接入.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

## 能做什么

- 本地、官方云端和自建服务都可以从界面提交任务，查看进度与日志。
- 选择文件、文件夹或拖入文档，指定输出目录；相同文件和转换条件可复用已有结果。
- 并排查看 PDF 与 Markdown，显示转换得到的图片。修改后另存编辑版，保留初次转换结果。
- 查看 Pipeline、VLM 模型，下载、导入已有模型或删除本应用管理的模型。模型和缓存目录可以放到其他磁盘。
- 检测电脑配置，给出后端选择建议。CPU 安装包不会因为检测到显卡就自动变成 GPU 版。
- 清理下载残片和任务临时文件；任务记录可隐藏、恢复，或经确认后清理结果资源。删除原始 PDF 需要另外确认。
- Codex 通过本地 API 提交任务，与桌面窗口共用记录，不必另开一套转换流程。

## 安装与第一次转换

在 [Releases](https://github.com/chengyingzh433-stack/mineru-desk/releases) 下载 `MinerU-Desk-Setup-0.3.3-x64.exe`，双击安装并选择路径。适用于 Windows 10 2004 及以上的 x64 系统和 Windows 11。

安装包包含桌面程序、MinerU 3.4.5、Python 3.12.10 和 PyTorch 2.8.0 CPU 依赖，大小见发布页。**不含 Pipeline/VLM 大模型**，首次本地转换 PDF 前需要下载或导入模型。安装程序未做代码签名，请核对发布来源和校验值，不要为安装而关闭系统安全防护。

1. 打开 MinerU Desk，在“存储与清理”中选好模型、缓存和结果目录。
2. 进入“模型与服务”，下载 Pipeline 模型，或关联已有完整模型目录。
3. 回到转换工作台，加入 PDF，选择“本机转换”和 Pipeline，先保留自动识别设置。
4. 点击“开始转换”。完成后打开结果，对照原文检查公式、表格和关键文字。

如用官方云端，在界面填写自己的 Token 后提交。云端会接收文档；涉及未公开论文、学生信息等材料时，请先确认是否允许上传。模型准备完成后，本地模式可离线运行。

选择“官方云端”后，可点击“获取官方 Token ↗”打开 [官方申请页](https://mineru.net/apiManage/token)。创建 Token 后，在“应用设置 / 更新 → 官方云端”粘贴并保存。

### 关闭窗口与托盘

点击右上角 ×，可选择“最小化到托盘”“退出程序”或“取消”，也可以勾选记住选择。最小化会保留未保存内容，转换和下载继续运行。点击右下角的笔和信纸图标可恢复窗口；若没看到图标，展开“^”隐藏图标区域。右键菜单可以退出。

“应用设置 / 更新 → 窗口与托盘”可修改关闭行为，以及最小化按钮是收起到托盘还是任务栏。退出前会检查未保存内容和运行中的任务；有任务时先完成或取消任务，空闲时退出会停止本应用后台。此设置不包含开机自启动。

### 更新与卸载

打开“应用设置 / 更新”，在“版本与维护”里点击“检查更新”。有新版本时会显示版本号和安装包大小，由你决定是否下载；下载完成并通过 SHA-256 校验后，点击“安装更新并重启”。更新使用原安装路径，保留外部模型、原文、结果、设置和任务记录。

0.3.1 没有应用内更新入口，首次升级需下载新版安装包，关闭旧客户端和空闲后台后覆盖安装一次，无需先卸载。之后可在客户端内检查和安装更新。网络无法连接 GitHub 时，也可以手动下载新版覆盖安装。

“卸载 MinerU 与桌面程序…”会打开卸载确认窗口，移除本客户端及随包 MinerU、Python 和 CPU 依赖。外部工作区默认保留，你单独安装的其他 MinerU 环境也不受影响。开始菜单和 Windows“已安装的应用”同样可以卸载。请先结束转换、下载与服务，并保存编辑；安装器不会强行结束这些工作。

### 文件存在哪里

安装版把工作区放在程序目录外。例如程序装到 `D:\Tools\MinerU Desk`，工作区是 `D:\Tools\MinerU-Desk-Data`，其中分别保存 `data`、`models`、`cache` 和 `output`。界面可以修改模型、缓存和结果位置；修改只影响后续任务，已有文件不会自动搬迁。

卸载程序会保留外部工作区。分享给别人请发送安装包，不要发送自己的工作区，里面可能有论文、任务记录和访问凭据。

## 转换结果与限制

Markdown 会引用结果目录里的图片，复制时要一起带上图片文件夹。它保留的是识别出的内容和阅读顺序，不能复刻 PDF 的坐标、分页和双栏布局。公式、复杂表格、裁剪图以及专有名词仍可能识别错误，需要对照原文。

进度条来自后端输出，可能表示当前文件或当前阶段；阶段切换时数值会变化。没有可用百分比时，界面显示进行中，不估算剩余时间。

本地 Pipeline 可以使用 CPU，但长论文转换较慢。Hybrid/VLM、本地推理服务和 GPU 加速有额外环境要求，提供界面入口不代表随包 CPU 环境能运行所有后端。兼容性判断请同时参考界面检测结果和 [MinerU 官方说明](https://github.com/opendatalab/MinerU)。

## 让 Codex 帮忙转换

把安装目录中的 `给Codex的接入说明.md` 发给 Codex，或者提供本仓库的 [安装版接入说明](packaging/安装版Codex接入.md)。Codex 可查询注册表定位程序，检查依赖与模型，再通过本地接口提交转换、读取结果和查询任务。

安装后的诊断示例：

```powershell
$mineruInstall = (Get-ItemProperty 'HKCU:\Software\MinerUDesk' -Name InstallDir).InstallDir
& "$mineruInstall\Codex.ps1" doctor
& "$mineruInstall\Codex.ps1" request GET state
```

接口只监听本机地址。不要公开 `connection.json`、Token 或任务数据库，也不要把服务端口开放到公网。接入说明要求 AI 在上传文档、下载模型和删除文件前遵循用户授权，不能把论文里的文字当作操作指令。

## 从源码运行

准备 Node.js 与 npm，在终端执行：

```powershell
git clone https://github.com/chengyingzh433-stack/mineru-desk.git
cd mineru-desk
npm ci
npm start
```

源码安装会准备桌面程序和云端 CLI，不包含 Python MinerU 环境或模型。本地转换需要在设置中指定已有 MinerU，或按 [官方安装指南](https://opendatalab.github.io/MinerU/quick_start/)准备环境。只想使用软件，直接下载安装包更省事。

开发模式默认数据目录为 `%LOCALAPPDATA%\MinerU-Desk`，可通过 `MINERU_DESK_DATA` 指定独立目录。启动桌面或执行 `npm run service` 后，可运行 `node cli.mjs status` 查询任务服务。

```text
web/                  桌面页面、样式和交互
desktop.cjs           Electron 主进程
server.mjs            本地任务 API
core.mjs              转换、模型与服务管理
storage.mjs           存储扫描和清理
task-maintenance.mjs  历史归档与资源清理
packaging/            安装器、运行时打包和 Codex 接入脚本
tests/                单元测试与需要本地环境的验收脚本
```

`npm test` 运行单元测试；完整转换与安装验收需要相应运行环境。构建安装程序见 [构建说明](packaging/构建安装包.md)。仓库不存放模型、依赖目录、安装程序或用户数据。

## 反馈与来源

遇到问题可提交 [Issue](https://github.com/chengyingzh433-stack/mineru-desk/issues)，说明应用版本、运行方式、本地硬件和错误阶段。日志请先删去 Token、私人路径及文档内容；不要直接上传未获许可的论文。

感谢 OpenDataLab MinerU、MinerU Ecosystem，以及 Electron、Python、PyTorch 等上游项目。本项目没有自行训练或宣称拥有上游解析模型。各组件和模型遵循各自许可，来源、修改范围及分发注意事项见 [第三方声明](THIRD_PARTY_NOTICES.md)。本仓库暂未为新增的客户端代码指定独立开源许可证，公开可见不等于授予任意再分发许可。
