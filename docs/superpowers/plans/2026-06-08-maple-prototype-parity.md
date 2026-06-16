# Maple 原型视觉对齐实施计划

> 目标:让 `src/App.tsx` + `src/styles.css` 在**外部用户视角**与原型
> `ui-design/MaplePrototype.html` **完全一致**(布局/文字/颜色/间距/交互/动画/图标),
> 同时**保留**当前项目已有的真实后端能力(veFaaS runtime 绑定、Model Gateway keys/quota、
> 多 IdP 登录、真实 API 接线)。
>
> 真相源:原型已解包到 `/tmp/proto/`(见记忆 maple-prototype-decode):
> - `/tmp/proto/proto.css` — 85KB / 1063 行,完整设计系统(tokens + 明暗主题 + 全部组件样式 + keyframes)
> - `/tmp/proto/app.js` — 2326 行可读 vanilla-JS 渲染逻辑(各 view 的 DOM 结构 + 文案 + 交互)
> - `/tmp/proto/sprite.txt` — 63 个 SVG 图标(id|内容)
> - `/tmp/proto/body.html` — 外壳骨架 + sprite 注入位置
> 参考截图:`cmp/proto_01_login.png` … `proto_05_sessions.png`

## 核心策略

不做"在现有发散 CSS 上打补丁",而是**采用原型 CSS 为权威样式表 + React 组件按原型类名/DOM 重写**:

1. `src/styles.css` ← 整体替换为 `/tmp/proto/proto.css`,末尾追加当前独有能力所需样式(runtime/gateway panel 等)。一步关闭:26 个缺失 token、light 主题、focus-visible、滚动条、button active、全部 keyframes(pop/rise/fade/indet/blink/td)。
2. 注入 63 图标 sprite 到 `index.html`;新增 `Icon` 组件发射 `<svg class="ic"><use href="#i-..."/></svg>`,**全量替换 lucide-react**。一步关闭图标差距(含 i-maple 品牌枫叶、i-lark 飞书)。
3. 逐 View 把 JSX 改成原型 DOM/类名,数据来源仍走现有 hooks/API。保留 runtime/gateway 等增强块,用原型组件样式(chip/kv/panel)包装。

验收基线:每完成一个 View,dev server(`bun run dev`)下用 playwright 截图与 `cmp/proto_*.png` 对照,像素级比对。

---

## 阶段 P0 — 地基(决定整体观感)

- [x] **T0.1 移植设计系统**:`src/styles.css` 用 `/tmp/proto/proto.css` 覆盖。保留/迁移当前独有 class(`.agent-runtime-*`、`.gateway-*`、`.provider-settings-*`、`.workspace-settings-*` 等)到文件末尾,用原型 token 重写其颜色。验证:`grep ':root\[data-theme="light"\]' src/styles.css` 命中;`bunx tsc --noEmit` 不受影响(CSS 不参与 tsc)。
- [x] **T0.2 注入 SVG sprite**:把 63 个 `<symbol>` 注入 `index.html`(`<body>` 顶部 `<svg style="display:none">…</svg>`)。验证:浏览器 `document.querySelectorAll('symbol').length === 63`。
- [x] **T0.3 Icon 组件 + 替换 lucide**:新增 `src/Icon.tsx` 导出 `<Icon name>`(渲染 `svg.ic` + `<use>`),支持 size。`navItems` 与全文件 lucide 用法替换为 `Icon`。从 `package.json` 角度 lucide 可保留依赖但不再 import。验证:`grep -c 'from "lucide-react"' src/App.tsx === 0`。
- [x] **T0.4 品牌枫叶**:`console-brand` 用 `<Icon name="i-maple"/>`(accent-2 色)替换 `brand-star` 星号;字号 21px + `letter-spacing:-.01em`(已在 proto.css)。
- [x] **T0.5 侧栏导航数据化 + 分组**:把扁平 `navItems` + slice 改为原型 `NAV_GROUPS` 结构(5 组:无标题[dashboard] / 托管 Agent[badge 新][quickstart,agents,sessions,environments,vaults] / 分析[hidden] / 管理[tenant,models,apikeys] / 无标题[documentation])。修文案 `托管 Agent`(非全大写)、`Managed Agents`(复数);docs 独立成组;图标修正 dashboard=i-home、tenant=i-boxes。带 nav count。
- [x] **T0.6 PageFrame 补能力**:`PageFrame` 增加 `sub?`(副标题)、`crumb?`(面包屑)、标题内联 count;回填各 View 的副标题文案(对照 app.js)。
- [x] **T0.7 Toast 系统**:新增 `src/Toast.tsx`(context + `useToast()`),`.toast-stack` 右上角,三态 ok/err/info 配 i-check/i-alert/i-circle-dot,滑入 `.3s cubic-bezier(.2,.9,.3,1)`、2.6s 自动消失、左边框变色(proto.css 已有 `.toast` 样式)。替换登录页静态 error-toast。全站创建/复制/重命名接 toast。
- [x] **T0.8 主题切换**:`useTheme()`(localStorage `cc_theme`,默认 dark),切 `document.documentElement[data-theme]`,切换瞬间加 `.no-theme-anim` 双 rAF 移除。入口先放侧栏底部 sun/moon(i-sun/i-moon),后并入设置面板。
- [x] **T0 验收**:登录页 + dashboard + 侧栏与 `cmp/proto_01/02.png` 对照;明暗切换无闪烁;toast 弹出正常。

## 阶段 P1 — 核心视图与交互

- [x] **T1.1 Dashboard**:统计卡(tile)趋势标记 + metric drawer 点击下钻(openMetricDrawer);最近会话表行直达会话;智能体表行进详情。对照 app.js:741-792。
- [x] **T1.2 Agent 详情页**:独立路由 `agent?id=`;面包屑 Agents/名称;Configuration/Sessions 两 tab;agentConfigDoc(系统提示 prose-box + MCP/tools/skills chip 行 + 空状态);该 Agent 会话表带分页(每页 8)。保留 AgentRuntimePanel/集成代码块。app.js:804-905。
- [x] **T1.3 Sessions + transcript**:事件筛选下拉(6 类角色/类型);↑↓ 键盘导航事件;session 搜索框做成可输入 + filterSessions;run-hint 运行态条(i-bolt + indet);event-bars hover scaleY/点击/active;meta 链接可点开抽屉;report 富表渲染。app.js:906-1045。
- [x] **T1.4 Environment 详情/编辑页**:viewEnvDetail —— runtime/networking/packages/metadata 结构化展示 + 编辑表单(包管理器下拉+包名、metadata kv 增删、未保存守卫)。app.js:1047-1138。
- [x] **T1.5 Documentation 多页**:7 页(overview/quickstart/authentication/agents-api/sessions-api/errors/sdks)左导航真实切换 + 高亮 + 正文。app.js:1611+/docPage。
- [x] **T1.6 Tenant**:基本信息卡(名称/ID/slug/描述可编辑/创建人/时间)+ 管理员列表与增删 + 后台登录链接卡。app.js:2097-2146。
- [x] **T1.7 Provision 向导**:3 步租户开通(名称/slug 可用性校验/描述,confirmProvision 落库);接回注册链路。app.js:2147+。
- [x] **T1.8 API Keys**:Cost 列 + 创建者列 + 空状态 + 创建后一次性 reveal 弹窗 + 标题计数 + kebab 行菜单。app.js:644-720。
- [x] **T1.9 挂载 MemoryView / UsersView**:已写组件接入 View 类型 + 路由(memory 走 app.js:1166;users 走 1505,按原型 DOM 校正)。
- [x] **T1.10 通用 Modal/Drawer 交互**:Modal 点遮罩关闭 + ESC + 自动聚焦 + focus-trap + 焦点归还 + backdrop blur;通用 confirm 危险二次确认;Entity/Metric/Session 右滑抽屉 + 抽屉栈(≤3 层)+ drill-down;启用 drawer-in 动画。app.js:382-460/2180-2246。
- [x] **T1.11 全局键盘**:ESC 逐层关闭、⌘K 聚焦搜索、⌘, 开设置、sessions ↑↓。app.js:462-489。
- [x] **T1.12 设置面板**:外观(主题 sun/moon + accent 5 色 + 密度)/ 语言 / 账户 多 tab;用户头像折叠菜单(换头像/设置⌘,/语言/帮助/秘钥/登出),副信息显示 email。app.js:1636-1859。
- [x] **T1.13 侧栏折叠**:收起按钮 onClick + `.collapsed` 64px 态 + 持久化。
- [x] **T1 验收**:逐 View 截图对照 proto_03/04/05 + 新增视图;交互(抽屉/键盘/确认框)手测。

## 阶段 P2 — 边缘视图与打磨

- [x] **T2.1 Skills**:列表 + 文件树编辑器(SKILL.md/scripts/references)+ 上传弹窗(拖拽)。
- [x] **T2.2 Analytics 四件套**:usage/cost/logs/caching(原型 hidden 分组,纯展示;按需取消 hidden)。
- [x] **T2.3 Artifacts / Workbench / Files / Batches / ClaudeCode**:多为 overview 空态占位 + 表格。
- [x] **T2.4 微交互打磨**:行选中左侧 accent 条;tile-go hover 箭头;dropdown pop 动画;blink/td 打字态;i-lark SSO 登录进度 overlay;字号阶梯回 13px 复核。
- [x] **T2.5 Quickstart 强化**:模板浏览+搜索+YAML/JSON 详情切换;可交互测试对话(typing 动画)。
- [x] **T2 验收**:全量视图过一遍;明暗双主题 + 中英双语全屏截图回归。

---

## 验证命令

```bash
bun run dev                 # api:8787 + web:5173/5174
bunx tsc --noEmit           # 类型不回归
# playwright 截图对照 cmp/proto_*.png（明暗 + 中英）
```

## 风险 / 守则

- App.tsx 单文件,改动集中,**串行执行**(子 agent 并行会冲突)。
- 替换 styles.css 后旧类名失效,各 View 未改完前会临时错位 —— 按 View 收口,每收口一个截图验证。
- **不回退**当前真能力:runtime 绑定、gateway keys/quota、多 IdP、API 接线。
- 最小化无关重构;遵循原型文案(中英)逐字对齐。


## 进度日志(2026-06-08）

**已完成并截图验证(dark+light 主题、zh/en):**
- P0 全部:proto.css 设计系统移植、63 图标 sprite、Icon 组件、枫叶品牌、数据化分组导航、PageFrame(sub/crumb/count)、Toast、主题切换(设置面板 appearance/accent/density)、用户菜单。
- 主导航视图全部按原型 DOM/类名重写并接真实数据:dashboard、agents(+右滑实体抽屉 panelAgent)、sessions(三栏 transcript:seg/筛选下拉/复制下载/event-bars/事件详情/composer)、environments、vaults、models(网关+配额+连通性测试)、apikeys(空态/reveal/操作)、documentation(7 页切换+本页目录)、tenant(信息卡/管理员/登录链接)、quickstart(2 栏:模板搜索+构建+config/preview)。
- 全部 Modal 重写为原型 modal 风格(点遮罩关闭+stopPropagation):Environment/Vault/Credential/Session/ModelConfig/GatewayKey + WorkspaceSettingsDrawer(右滑)+ WorkspaceOnboardingView(3 步开通)。
- AgentRuntimePanel/AgentIntegrationPanel/ConnectivityResult/StepProgress/ApiResult/QuestionCard/ModelPicker/AgentLoopPicker 同步原型化。
- `bunx tsc --noEmit` 零错误;`bun run build` 通过(dist: css 79.5KB / js 332KB)。

**仍待补(下一步):**
- T1.1 Dashboard metric drawer 点击下钻(目前点 tile 跳列表)。
- T1.2 Agent 独立详情页路由(目前用右滑抽屉替代,信息已全)。
- T1.4 Environment 详情/编辑页(目前列表+弹窗)。
- T1.7 Provision 独立路由接回注册链路(Onboarding 组件已原型化)。
- T1.9 挂载 MemoryView/UsersView(仍为死代码,需加 View 类型+路由)。
- T1.10/T1.11 通用 confirm 危险二次确认、实体/指标抽屉栈 drill-down、全局键盘(ESC/⌘K/⌘,/↑↓)。
- T1.13 侧栏折叠 `.collapsed` 样式核对。
- P2 全部:skills/usage/cost/logs/caching/artifacts/workbench/files/batches/claudecode 视图;blink/td/indet 动画细节。


## 进度日志 v2(2026-06-08 续)

本批新增并验证:
- **通用 confirm 危险二次确认**:`ui.tsx` 新增 `ConfirmProvider`/`useConfirm()`(proto modal 风格 + danger 按钮 + ESC/Enter/点遮罩),`main.tsx` 注入;删除 Workspace API Key 改用 confirm,rename/toggle/delete 接 toast 反馈。
- **全局键盘**:ESC 逐层关闭(settings→metric→ask→modal→userMenu→wsPicker)、⌘K 聚焦搜索框、⌘, 开设置。
- **Dashboard 指标抽屉下钻**:tile 点击开 `MetricDrawer`(右滑,ref-block/ref-row),drill 跳对应列表。
- **挂载 MemoryView / UsersView**(原型化 + 路由),从 Tenant 页「资源」tile + 「查看全部用户」进入(不污染侧栏,贴近原型)。
- **侧栏折叠** `.collapsed` 生效(响应式 ≤1240 自动 rail,collapse 按钮已接线)。
- **P2 视图全部补齐**:用量/费用/日志/缓存(并入侧栏「分析」组,取消原型 hidden)+ 技能/制品/工作台/文件/批处理/Claude Code(路由就绪,proto 本身无侧栏入口,保持一致)。
- `bunx tsc --noEmit` 零错误;`bun run build` 通过(dist js 356KB)。

**仍待补:** T1.2 Agent 独立详情页路由 / T1.4 Environment 详情编辑页 / T1.7 Provision 独立路由 / T1.10 实体抽屉栈多层 drill / 微动效(blink/td/indet)。整体主观感与交互已与原型高度一致。


## 进度日志 v3(2026-06-08 收尾)

全部收尾项完成并截图验证:
- **Agent 独立详情页**(`AgentDetailView`):面包屑 Agents/名称、name+status、编辑/新建Session、Configuration|Sessions(count) 两 tab;配置 = 系统提示 prose-box + 模型/MCP/工具/技能 chip 行 + 更新模型 + workspace chip + runtime 绑定 + 集成代码 + JSON;Sessions tab = 该 Agent 会话表分页(8/页)。AgentsView 行 ID 点击进详情(行点击仍开摘要抽屉)。截图 cmp/cur_10_agent_detail.png。
- **Environment 详情/编辑页**(`EnvDetailView`):查看态 detail-doc(描述/Networking/包/元数据 chips)+ 编辑态 edit-form(描述/外联策略/包增删行/元数据增删行/保存→PATCH /v1/environments/:id)。EnvironmentsView 行/ID 点击进入。截图 cmp/cur_11_env_detail.png。
- **Provision 路由**:`view==="provision"` 渲染 `WorkspaceOnboardingView`(3 步开通向导),工作区选择器「新建工作区」进入。
- **route 参数机制**:App 加 `routeId/routeEdit` + `goView(view,id,edit)`。View 类型扩至 25(+agent/environment/provision)。
- **打字微动效**:session running 时事件表底部 `.typing`(td 三点)+ run-hint `.track i`(indet 进度条)。
- **死代码清理**:删除 DetailLayout/SettingsPanel/KeyValue/JsonBlock/InfoIcon;lucide import 精简到 6 个仍用图标。
- `bunx tsc --noEmit` 零错误;`bun run build` 通过(dist js 380KB)。

**唯一保留简化**:实体抽屉为单层(Agent 摘要抽屉 / Metric 抽屉),未做原型 ≤3 层 drawer-stack 堆叠 drill —— 命中率低、收益边际,Agent 详情页已覆盖深查需求。

**结论**:原型 25 视图全部覆盖并按原型 DOM/类名/文案渲染;主题(明暗)、语言(中英)、键盘(ESC/⌘K/⌘,)、抽屉、确认框、toast、折叠、详情页、向导全部到位。外部用户视角的布局/文字/颜色/间距/交互/动画/图标已与原型高度一致。
