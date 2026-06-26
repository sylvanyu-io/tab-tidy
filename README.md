# Tab Tidy

<p align="center">
  <img src="docs/assets/logo.svg" width="560" alt="Tab Tidy" />
</p>

<h3 align="center">攒了数不清的标签页、乱成一锅粥？点一下按钮，自动归类整理好。</h3>

<p align="center">
  <a href="manifest.json"><img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome-MV3-1f55ff" /></a>
  <a href="package.json"><img alt="Tests" src="https://img.shields.io/badge/tests-node%20%2B%20playwright-c9ff4a" /></a>
  <a href="worker/README.md"><img alt="Gateway" src="https://img.shields.io/badge/AI-gateway-d94a32" /></a>
</p>

Tab Tidy 是一个 Chrome MV3 扩展。它把打开的标签页交给 LLM 按语义整理，而不是只按域名、标题关键词或手写规则分组。

它支持当前窗口整理、所有窗口合并到一个窗口、整理前预览、应用后回退，以及可选的页面短摘要辅助。

<p align="center">
  <img src="docs/assets/readme-hero-cn.png" width="920" alt="Tab Tidy 中文产品截图" />
</p>

## 为什么做

现有标签页整理工具通常会走两条路：按域名分组，或者套规则。遇到冷门站点、项目内工具、论文、仪表盘、Issue、PR、本地服务和杂乱资料混在一起时，这两种方式都很容易失效。

Tab Tidy 会把紧凑的标签页信息发给 AI 规划器：

- 标题、域名、精简 URL 信号、窗口、原始顺序；
- 已有浏览器分组、固定标签页、无痕或受限标签页状态；
- 用户显式允许时，附加少量页面可见文字摘要。

AI 只负责给出分组意图。真正移动和分组前，扩展会在本地校验方案，避免漏标签、重复分配、超大兜底组或越权操作。

## 功能

- **语义分组**：按任务、主题、项目、研究线索或自定义要求整理。
- **跨窗口模式**：可选择把所有符合条件的标签页移动到一个目标窗口后再分组。
- **先预览再整理**：应用前能看到即将创建的分组和待分类标签页。
- **可回退**：保存操作快照，尽量恢复标签页顺序、分组、固定状态和窗口位置。
- **大规模任务规划**：100+ 标签页先粗分，再对过大或不确定分组二次精分。
- **时间回顾**：开启长期积累后，可以按最近 1 天、7 天或 30 天回顾自己在看什么。
- **清理助手**：按时间、分组和页面线索找出可能不再需要的标签页，由你决定是否关闭。
- **按窗口隔离**：每个浏览器窗口都有自己的整理进度、预览和回退状态，不会互相覆盖。
- **自定义 AI 网关**：默认使用内置免费网关；也支持 OpenAI 兼容网关、密钥、自定义模型名和思考强度。
- **多语言结果**：分组名和说明支持自动判断、简体中文或 English。

## 页面内容权限

核心整理能力默认不读取页面正文，只依赖标签页元数据。

需要更准时，可以手动打开两个增强选项：

- **需要时补读页面摘要**：整理前只补读拿不准的可访问页面；高级选项里可以改成尽量读取已授权页面。
- **持续积累页面摘要**：开启后请求网页读取权限，在后台给打开过、未休眠、非无痕页面保存短摘要，之后整理更快、更准，也能用于时间段回顾。

这两个功能都不会读取密码、表单内容、Cookie、本地存储或完整 HTML。休眠标签页不会被唤醒。

时间回顾不是浏览器历史记录替代品。Chrome MV3 后台会被浏览器挂起，Tab Tidy 会在被唤醒、标签页更新、窗口切换和定时任务时尽力记录；未授权、休眠、无痕或浏览器限制的页面只能使用标题和网址线索，或者完全跳过。

## 本地安装

```bash
npm install
npm run assets:icons
npm run build:extension
```

然后在 Chrome 中加载：

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 点击 **Load unpacked**。
4. 选择 `dist/extension`。
5. 点击扩展图标打开右侧侧边栏。

默认只整理当前窗口。“所有窗口”是显式开关，且只有在预览和确认之后才会移动标签页。

## AI 网关

AI 网关地址和密钥默认留空，表示使用内置服务。高级设置里可以改成任何兼容 Chat Completions 的网关。

默认模型是 `gpt-5.5`。也可以在高级设置里切换预设模型：

- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-mini`
- `claude-opus-4-8`
- `claude-sonnet-4-6`

也支持自定义模型名。内置服务会放行已验证的文本规划模型；如果使用自己的兼容网关，也可以填写 GLM、DeepSeek 等模型，例如 GLM 可填写 `https://open.bigmodel.cn/api/paas/v4` 和 `glm-5.2`。

不要提交自定义网关密钥。任何出现在聊天、日志、截图、shell history 或测试输出里的密钥都应该轮换。

## 开发

运行单元测试和 Worker 测试：

```bash
npm test
```

运行侧边栏 UI smoke 测试：

```bash
npm run test:ui
```

运行完整发布检查，会清理旧产物、重新生成图标、跑测试、扫描密钥痕迹，并构建本地包和商店包：

```bash
npm run release:check
```

生成 README 图片资源：

```bash
npm run assets:readme
```

构建 Chrome Web Store 风格的安装包：

```bash
npm run build:extension:store
```

输出文件为 `dist/tab-tidy-<version>-store.zip`，未打包目录为 `dist/extension-store`；本地调试继续使用 `dist/extension`。

## 压力测试

```bash
npm run build:extension
npm run stress:extension
```

压力测试会启动隔离 Chromium profile，跨多个普通窗口打开数百个生成页面，然后验证：

- 当前窗口整理；
- 所有窗口合并到一个窗口；
- 应用和回退；
- 页面摘要权限边界；
- 对可访问 live 页面读取短摘要。

可选真实网关压力测试：

```bash
GATEWAY_BASE_URL=http://127.0.0.1:8317/v1 STRESS_GATEWAY_TABS=60 npm run stress:extension
```

## 架构

```text
Chrome tabs/windows
        |
        v
标签页清单 + URL 脱敏 + 原始顺序
        |
        v
可选缓存/页面短摘要信号
        |
        v
本机活动记录和时间回顾
        |
        v
AI 网关规划器
        |
        v
本地校验 + 预览
        |
        v
Chrome 执行器 + 回退快照
```

## 设计文档

- [Agent contract](docs/agent-contract.md)
- [Evaluation harness](docs/harness.md)
- [Multi-window feasibility](docs/multi-window-feasibility.md)
- [Permissions research](docs/permissions-research.md)
- [Release readiness](docs/release-readiness.md)
- [Gateway Worker](worker/README.md)
