# AI OpenSCAD 产品文档

[English](PRODUCT.md)

## 产品定位

AI OpenSCAD 是一个 Agent 风格的 CAD 工作台，面向希望获得可打印或可检查 3D
模型、但更愿意先用自然语言描述结果的用户。产品会将用户需求转换成
OpenSCAD 代码，在浏览器中渲染草稿模型，通过视觉评审发现建模问题，并帮助
用户持续迭代，直到模型可以导出。

核心承诺是：

> 文本到 OpenSCAD，OpenSCAD 到模型，模型到视觉评审，评审到更好的下一版草稿。

## 项目元信息

- 生产环境：`https://ai.openscad.tech`
- 仓库：`https://github.com/lich-wang/ai-openscad`
- 许可证：GNU Affero General Public License v3.0 only (`AGPL-3.0-only`)
- README：`README.md` 和 `README.zh-CN.md`

README 文件只保留基础入口信息：项目身份、GitHub 活跃度、贡献者图、产品文档
链接、快速开始命令和许可证摘要。产品行为、实现细节、开发流程、部署说明、测试
要求和约束都放在本产品文档里维护。

## 目标用户

- 能描述所需物体，但不想手写全部 CSG 代码的 maker。
- 想快速得到第一版草稿，同时保留代码编辑出口的 OpenSCAD 用户。
- 需要快速生成 STL 进行检查的产品或硬件原型设计者。
- 中文和英文用户；应用跟随浏览器 locale，并在模型反馈和注释中沿用用户语言。

## 当前产品界面

### 工作台布局

首屏是可直接工作的应用，而不是落地页。整体分为三列：

- 左侧控制面板：模型 Key、模型选择、token 估算、项目导入导出和本地模型历史。
- 中间 Agent 面板：运行时间线、需求输入、工作流操作和高级 OpenSCAD 代码编辑。
- 右侧结果面板：正视图/俯视图/右视图、资产下载、编译输出、视觉评审输出和近期历史。

### 主流程

1. 用户写下需求，例如六格收纳盒或 30 ml 杯子。
2. 用户点击 **Generate**。
3. 代码模型将 OpenSCAD 流式写入工作台。
4. 渲染适配器在浏览器中编译生成的 OpenSCAD。
5. 应用从 STL 捕获正视图、俯视图和右视图 PNG。
6. 用户点击 **Review**。
7. 视觉模型检查三视图是否满足原始需求，并返回总结、问题列表、置信度和修正提示词。
8. 修正提示词进入输入框，用户可以编辑。
9. 用户点击 **Iterate Again**，生成并渲染下一版草稿。
10. 用户满意后点击 **Final Export**。
11. 应用将模型标准化为最终精度，并下载 `.scad` 和 `.stl` 文件。

### 用户控制规则

- 视觉评审只做评审，不能自动调用文本 LLM。
- 用户可以在再次生成前编辑修正提示词。
- 待确认修订必须先接受并渲染，才能导出项目。
- 接受修订会清除旧评审，强制新渲染模型重新评审。
- OpenSCAD 代码始终可以通过高级代码面板编辑。

## 功能清单

### 生成

- 使用代码导向系统提示词，要求输出合法、确定、完整的 OpenSCAD。
- 以毫米为建模单位。
- 要求命名参数、稳定 CSG、清晰模块边界和可打印几何。
- 检测中文或英文输入，并要求模型使用同一自然语言输出反馈和注释。
- 将 OpenAI 兼容的流式响应片段写入代码面板。

### 渲染

- 在浏览器中使用 `openscad-wasm`。
- 可用时在 Web Worker 中执行编译任务。
- 默认渲染超时时间为 45 秒。
- 常规迭代使用草稿精度，将 `$fn` 标准化为 32。
- 从生成的 STL 捕获三张正交视图：
  - 正视图
  - 俯视图
  - 右视图
- 使用 Three.js 光照和 STL 解析生成 PNG data URL。

### 评审和迭代

- 将原始需求、当前 OpenSCAD 和三张渲染图片发送给视觉端点。
- 期望返回 JSON：
  - `summary`
  - `issues`
  - `correctionPrompt`
  - `confidence`
- 当模型返回格式错误或非 JSON 评审文本时，会进行兜底处理。
- 保存生成、编译、评审、修订和最终导出的提示词记录。

### 导出

- 草稿输出：
  - 正视图 PNG
  - 俯视图 PNG
  - 右视图 PNG
  - STL
- 最终输出：
  - 高精度 SCAD
  - 高精度 STL
- 最终导出前会要求用户确认，因为它可能比草稿渲染更慢。

### 项目

- 在浏览器 `localStorage` 中保存当前项目和模型列表。
- 支持旧版单项目存储和当前多模型列表。
- 支持 JSON 项目导入和导出。
- 项目中保留迭代历史和提示词记录。

### 国际化

- 当任意浏览器首选 locale 以 `zh` 开头时，界面使用中文。
- 其他 locale 使用英文。
- UI 文案维护在 `src/lib/i18n.ts`。

## 系统架构

- 前端：React、Vite 和 TypeScript。
- 渲染：`openscad-wasm` 在浏览器中编译 OpenSCAD，优先放在 Web Worker 中执行。
  Three.js 解析 STL 输出并捕获正交 PNG 视图。
- 模型网关：Cloudflare Pages Functions，位于 `functions/api`。
- 持久化：浏览器 `localStorage`；没有服务端项目数据库。
- 部署：Cloudflare Pages 项目 `ai-openscad`。

重要源码位置：

- `src/App.tsx`：主工作台 UI 和用户工作流状态。
- `src/lib/apiClient.ts`：LLM、视觉评审、修订和 token 估算客户端。
- `src/lib/models.ts`：支持的模型预设和 provider 路由。
- `src/lib/render.ts`：浏览器 OpenSCAD 编译和渲染适配器。
- `src/lib/renderWorker.ts`：worker 编译路径。
- `src/lib/capture.ts`：STL 到正视图/俯视图/右视图 PNG 捕获。
- `src/lib/project.ts`：项目持久化、导入和导出。
- `src/lib/i18n.ts`：英文和中文 UI 文案。
- `functions/_shared/modelGateway.ts`：MiMo 和 DeepSeek provider 代理。
- `tests/`：Playwright 工作流和截图覆盖。

## 数据模型

核心项目状态包含：

- 项目身份：`id`、`title`、`updatedAt`
- 用户输入：`requirement`
- 模型设置：`codeModelId`、`visionModelId`
- 模型资产：`currentCode`、`proposedCode`、`stl`、`views`
- 运行输出：`compilerOutput`、`review`
- 审计轨迹：`iterations`、`promptTrace`

除非用户显式导出项目 JSON，或通过网关调用外部模型 provider，否则数据都保留
在浏览器本地。

## API 和 Provider 行为

前端调用：

- `POST /api/llm` 用于代码生成和修订。
- `POST /api/vision` 用于视觉评审。

两个端点都是 Cloudflare Pages Functions，会把 OpenAI 兼容的 chat completion
请求代理到配置的 provider。

支持的 provider：

- MiMo：`https://api.xiaomimimo.com/v1`
- DeepSeek：`https://api.deepseek.com`

认证行为：

- 如果浏览器提供 API Key，网关会将其转发给 provider。
- MiMo 可以回退使用 Pages 环境中的 `MiMo_KEY` 或 `MIMO_KEY`。
- DeepSeek 在当前应用中没有托管回退 Key。

当前模型预设：

- 代码模型：
  - MiMo V2.5 (`mimo-v2.5-pro`)
  - DeepSeek V4 Pro (`deepseek-v4-pro`)
- 视觉模型：
  - MiMo V2.5 (`mimo-v2.5`)

浏览器中填写的 API Key 会保存在 `localStorage`，并作为 bearer token 发送给
Pages Function 网关。

## 质量标准

应用应保持这些保证：

- 桌面端主工作流不应隐藏关键操作。
- 草稿生成和评审过程要展示进度。
- 无效 OpenSCAD 会显示错误，并保持页面可继续使用。
- 只有成功编译后才可下载 STL。
- 评审请求必须包含渲染图片。
- 评审不会触发文本生成。
- 新迭代会清除过期评审状态。
- 截图测试保护桌面工作台布局。

## 本地开发

安装依赖：

```bash
npm install
```

启动 Vite 开发服务器：

```bash
npm run dev
```

运行单元测试：

```bash
npm test
```

运行 Playwright 测试：

```bash
npm run test:e2e
```

构建生产资产：

```bash
npm run build
```

预览生产构建：

```bash
npm run preview
```

## 测试覆盖

当前测试套件覆盖：

- 根据浏览器 locale 在中文和英文 UI 间切换。
- 流式代码生成和自动草稿渲染。
- 携带渲染图片的视觉评审请求。
- 评审驱动迭代，且评审期间不会自动调用文本 LLM。
- 修订接受/拒绝行为。
- 无效 OpenSCAD 错误处理。
- 桌面工作台截图覆盖。
- 模型网关行为。

## 当前非目标

- 服务端账号、共享工作区或团队协作。
- 持久化云端项目存储。
- 从 OpenSCAD 变量自动生成参数化 UI 控件。
- 直接导出 3MF/STEP。
- 完整 OpenSCAD language server。
- 自动化可打印性认证。

## 发布检查

生产部署前：

```bash
npm test
npm run test:e2e
npm run build
```

部署目标：

- Cloudflare Pages 项目：`ai-openscad`
- 生产域名：`https://ai.openscad.tech`
- 必需的 Cloudflare 设置：`MiMo_KEY` 或 `MIMO_KEY` 是可选托管 Key，仅在用户没
  有提供浏览器 Key 时使用。

部署后：

- 确认生产页面返回 HTTP 200。
- 在 provider 凭证可用时，对生成、草稿渲染、评审和导出流程做 smoke test。

## 许可证策略

AI OpenSCAD 使用 AGPL-3.0-only，因为项目需要在“作为网络服务提供给用户”时仍
然保持强 copyleft。任何修改后通过网络提供交互服务的部署，都必须以同一许可证
开放对应源代码。
