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

- 左侧控制面板：基础设置和项目导入导出在前，新建模型操作和本地模型列表在后。
- 中间 Agent 面板：流水线箭头阶段、类似 Codex 桌面版的对话式运行流、需求输入、
  工作流操作和高级 OpenSCAD 代码编辑。
- 右侧结果面板：更大的正视图/俯视图/右视图和资产下载。

### 主流程

1. 用户写下需求，例如六格收纳盒或 30 ml 杯子。
2. 用户点击 **生成**。
3. 代码模型将 OpenSCAD 实时流式写入中间对话运行流。
4. 完整代码输出后，运行流默认折叠代码预览，渲染适配器在浏览器中编译生成的
   OpenSCAD。
5. 应用从 STL 捕获正视图、俯视图和右视图 PNG。
6. 用户点击 **评审**。
7. 视觉模型检查三视图是否满足原始需求，并返回总结、问题列表、置信度和修正提示词。
8. 修正提示词进入输入框，用户可以编辑；提示词需要具体说明应该修改哪些
   OpenSCAD 区域或几何关系。
9. 用户点击 **再次迭代**，将最新已接受/已渲染的 OpenSCAD、原始需求、
   评审发现和可编辑迭代意见一起发送给 LLM，生成并渲染下一版草稿。
10. 用户满意后点击 **最终导出**。
11. 应用将模型标准化为最终精度，并下载 `.scad` 和 `.stl` 文件。

### 用户控制规则

- 视觉评审只做评审，不能自动调用文本 LLM。
- 用户可以在再次生成前编辑修正提示词。
- 待确认修订必须先接受并渲染，才能导出项目。
- 接受修订会清除旧评审，强制新渲染模型重新评审。
- OpenSCAD 代码始终可以通过高级代码面板编辑。
- Agent 面板顶部以循环流水线箭头展示当前工作流阶段：代码生成 -> 模型渲染 ->
  模型评审 -> 下一轮迭代。
- 视觉评审输出显示在中间 Agent 运行流里，修正提示词会复制到可编辑输入框；
  右侧结果面板不重复展示评审文本、编译日志或历史。
- 中间运行流使用类似 Codex 桌面版的对话记录，在每次 LLM 交互前后展示记录。
  用户指令、流式 AI 输出、渲染工具进度、渲染完成、评审输出和迭代事件都作为
  独立记录展示。
- 需求输入区的主按钮随项目状态变化：渲染前是生成，渲染后是评审，评审后是再次迭代。
- token 估算和重复的就绪状态不在常规工作台界面显示，为模型列表和三视图留出更多空间。
- AI 提示词记录不属于常规工作台界面。

工作台验收标准：

- 桌面端左侧和窄屏堆叠布局中的顺序都保持稳定：基础设置、项目导入导出、新建模型按钮、本地模型导航列表。
  本地模型列表过长时在列表内部滚动，并且它不同于运行历史。
- “没有 Key？”邀请提示中的邀请图片按源图比例和原始分辨率展示，只受可用视口宽度约束；
  不应被裁切成正方形，也不应被放大到导致模糊。
- token 估算从常规工作台界面移除。处理中进度、待确认修订警告和错误仍通过 Agent
  阶段条与中间 Agent 运行流展示。
- 阶段条只用于展示信息，不可点击。它固定包含三个箭头阶段：代码生成、模型渲染和模型评审。
  每个阶段可以展示等待、处理中、已完成或阻塞/错误状态；生成后自动渲染期间，模型渲染阶段应显示为处理中。
  视觉样式应暗示评审反馈可以回到代码生成，进入下一轮迭代。
- 开始再次迭代时，当前轮次的阶段状态会重置：代码生成重新进入处理中，模型渲染等到代码完成后开始，
  模型评审等到新的渲染视图完成后再开始。
- 输入区主按钮在生成、渲染、评审或导出期间禁用。没有渲染视图时显示“生成”，已有视图且没有当前评审时显示“评审”，
  已评审且没有待接受修订时显示“再次迭代”。缺少输入、provider key 失败、编译失败和评审失败都显示在中间运行流，
  不改变右侧结果面板的职责。存在待确认修订时，输入区显示接受提示，不显示“生成”“评审”或“再次迭代”主按钮；
  用户必须先接受或拒绝修订，才能继续主流程。
- 中间 Agent 运行流持续承载用户请求记录、流式生成代码、折叠后的完整代码、编译输出、渲染开始、
  渲染进度、渲染完成、渲染错误、评审总结、问题列表、置信度、修正提示词和迭代事件。
  完成后的代码默认折叠，避免占据中间面板空间；高级 OpenSCAD 编辑器仍保留在输入区下方。
- 新任务或空任务状态下，中间运行流仍然把“Agent 运行”标题文案放在面板最上方，并使用与已有对话运行流一致的容器、
  基础间距和结构，但不显示单独的“AI 思考”占位卡。首次运行时应在同一界面结构里追加记录，避免出现明显的布局跳变。
- 对话运行记录包括用户请求、AI 生成/修订、渲染工具开始/进度/完成、评审开始/结果、修正提示词就绪、
  迭代开始和错误记录。渲染记录内部可以由 MCP/渲染适配器驱动，但用户界面文案应使用“渲染”或
  “渲染工具”，不暴露未解释的内部术语。
- 右侧结果面板只包含三张正交视图和资产下载控件，不包含编译日志、评审文本、提示词记录或迭代历史。
  桌面端正视图是最大视图，俯视图和右视图位于其下且保持可见，面板高度主要留给图片而不是文本。
  在 1440 px 桌面视口下，视图网格应至少占右侧面板可见高度的一半。
- 只要存在 OpenSCAD 代码，用户就可以通过次要的重新渲染操作编译手动编辑后的代码。
  重新渲染失败显示在中间运行流里，并保持工作台可继续操作。
- 阶段条和操作状态同时使用文字标签与视觉样式，不只依赖颜色；键盘焦点顺序保持为左侧面板、
  Agent 面板、结果面板。对话记录通过标签和布局区分用户、AI、渲染器/工具和评审角色，而不是只依赖颜色。
- 流式输出和阶段状态更新应使用 polite live-region 或等效的可访问状态文本。折叠代码控件需要可访问名称，
  并暴露当前展开/折叠状态。
- 自动化 E2E 覆盖应通过结构、可访问性、几何和状态断言验证箭头流水线阶段条、再次迭代后的当前轮次状态重置、Codex 式对话记录、
  完成代码默认折叠且可展开、渲染开始/完成提示、常规界面不显示提示词记录、评审到修正提示词的交接、
  迭代请求包含原始需求、最新已接受代码和可编辑意见、桌面端和窄屏堆叠布局中的左侧排序、隐藏 token/重复就绪 UI、
  右侧职责、更大的三视图，以及生成、渲染、评审、待确认修订、重新渲染失败、再次迭代状态下的主按钮切换，
  包含非纯颜色状态标签和键盘焦点顺序。Playwright 像素截图检查只在本地视觉回归检查中执行，CI 必须跳过。

## 功能清单

### 生成

- 使用代码导向系统提示词，要求输出合法、确定、完整的 OpenSCAD。
- 以毫米为建模单位。
- 要求命名参数、稳定 CSG、清晰模块边界和可打印几何。
- 检测中文或英文输入，并要求模型使用同一自然语言输出反馈和注释。
- 将 OpenAI 兼容的流式响应片段同时写入对话运行流和可编辑代码状态。

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
- `correctionPrompt` 需要具体到文本 LLM 可以执行：它应引用原始需求、可见视图或受影响模型区域、
  观察到的不匹配、必须保留的约束、可推断的 OpenSCAD 模块或几何关系，以及可用的尺寸、位置或比例指导。
  它不能直接返回修订后的代码。
- 迭代请求会把最新已接受/已渲染的 OpenSCAD、原始需求、评审总结、问题列表和可编辑评审意见一起发送给
  文本 LLM，让下一版草稿是针对性修改，而不是无关的重新生成。
- 本地项目数据中仍保存生成、编译、评审、修订和最终导出的提示词记录，用于导出/调试；
  但普通用户在工作台常规界面中看不到提示词记录面板。

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
- `tests/`：Playwright 工作流覆盖，包含结构、状态、几何和可访问性断言。

## 数据模型

核心项目状态包含：

- 项目身份：`id`、`title`、`updatedAt`
- 用户输入：`requirement`、`originalRequirement`
- 模型设置：`codeModelId`、`visionModelId`
- 模型资产：`currentCode`、`proposedCode`、`stl`、`views`
- 运行输出：`compilerOutput`、`review`、`runEvents`
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
- CI E2E 测试通过结构和几何断言保护桌面工作台布局，以及窄屏堆叠布局中的左侧排序；Playwright 截图断言只在本地执行。

## 本地开发

本地开发和发布检查使用 Node.js 24 或更高版本。

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
- 桌面工作台布局覆盖，以及窄屏堆叠布局中的左侧排序覆盖。
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
- GitHub Actions workflow：`.github/workflows/deploy.yml`
  - Pull request 会运行 `npm test`、`npm run test:e2e` 和 `npm run build`。
    clean runner 会使用 `npm ci` 安装依赖、设置 Node 24，并通过
    `npx playwright install --with-deps chromium` 安装 Chromium。
    `node-version` 设置控制项目命令使用的 Node；每个 `uses:` action 也应保持在
    其 action metadata 运行于 Node 24 runtime 的版本，避免废弃的 Node 20
    runtime 警告。
  - 推送到 `main` 时会执行同样检查，然后使用
    `npx wrangler pages deploy dist --project-name ai-openscad --branch main` 部署。
  - 手动 `workflow_dispatch` 生产部署只允许 `main` 分支，并使用同一部署命令；
    从其他 ref 手动运行时只执行检查并跳过生产部署。
  - Cloudflare Pages 项目 `ai-openscad` 的生产分支必须是 `main`。
  - `deploy / checks` job 应配置为合并到 `main` 前的必需 branch-protection 状态检查。
  - 必需的 GitHub 仓库 Secrets：
    - `CLOUDFLARE_API_TOKEN`
    - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN` 必须具备编辑/部署目标 Cloudflare Pages 项目的权限，
    账号由 `CLOUDFLARE_ACCOUNT_ID` 指定。
- 可选 Cloudflare Pages 环境变量：`MiMo_KEY` 或 `MIMO_KEY` 仅在用户没有提供
  浏览器 Key 时使用。它在 Cloudflare Pages 中配置，不是 GitHub Actions secret。

部署后：

- 确认生产页面返回 HTTP 200。
- 在 provider 凭证可用时，对生成、草稿渲染、评审和导出流程做 smoke test。

## 许可证策略

AI OpenSCAD 使用 AGPL-3.0-only，因为项目需要在“作为网络服务提供给用户”时仍
然保持强 copyleft。任何修改后通过网络提供交互服务的部署，都必须以同一许可证
开放对应源代码。
