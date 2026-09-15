# 来源与第三方声明

MinerU Desk 是基于他人已有工作的非官方桌面封装，不是 OpenDataLab 或 MinerU 官方客户端，也不代表上述项目对本软件的认可或支持。

## 核心解析能力

[OpenDataLab MinerU](https://github.com/opendatalab/MinerU) 提供文档解析、版面分析、OCR、公式与表格处理等核心能力。0.3.1 安装版使用 MinerU 3.4.5，原代码及许可保留在随包运行环境内。请阅读安装包中的 `licenses/MinerU-LICENSE.md`；[上游许可文件](https://github.com/opendatalab/MinerU/blob/master/LICENSE.md)可能随版本变化，以所用版本为准。

官方云端调用使用 [MinerU Ecosystem](https://github.com/opendatalab/MinerU-Ecosystem) 中的 `mineru-open-api`。使用官方云端还需遵守该服务的账号、额度和数据处理条款。

本项目新增的是 Electron 界面、本地任务服务、任务记录与结果编辑、缓存与存储管理、模型操作入口、安装器，以及 Codex 接入脚本。上述界面调用上游解析功能，不将其作为本项目独立研发的算法或模型。

## 其他组件与修改

| 组件 | 用途与许可位置 |
| --- | --- |
| Electron / Chromium | 桌面运行环境；许可随 Electron 发行文件保留 |
| Python | 随包 CPython 3.12.10；`licenses/Python-LICENSE.txt` |
| PyTorch | 随包 2.8.0+cpu；许可保留在运行时包目录 |
| FastText | MinerU 依赖；保留原 MIT 许可，并做下述兼容性修改 |
| marked、DOMPurify、KaTeX、Lucide | Markdown 渲染、HTML 清理、公式显示和界面图标；各包保留自身许可 |

0.3.1 为 FastText 的 `load_model` 增加 Windows 中文路径兼容处理：原路径加载失败后，通过 ASCII 相对路径临时副本尝试加载，并清理临时副本。修改模板位于 `packaging/fasttext-load-model.py.txt`，由打包脚本应用。这是 MinerU Desk 的修改，不属于 FastText 上游原版行为。

Python 依赖版本与许可元数据随安装包保存于 `dependency-inventory.json`，完整许可保留在各包和 `*.dist-info/licenses` 中。其他分发结构说明见 [随包第三方说明](packaging/第三方组件说明.md)。

## 模型与再分发

本安装包不附带 Pipeline/VLM 大模型。用户下载或导入的模型仍遵循其发布者的独立许可，不能直接套用 MinerU 或本客户端的许可。运行依赖自带的小型辅助资源保留原有来源与许可。

请保留上游版权、许可和署名文件。仓库公开不改变任何第三方条款；涉及商业分发或对外提供在线服务时，应核查所用组件、模型和服务的具体授权。本仓库尚未为新增的客户端代码选择独立开源许可证。
