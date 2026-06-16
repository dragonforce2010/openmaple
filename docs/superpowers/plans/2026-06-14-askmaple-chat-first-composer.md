# AskMaple 聊天交互对齐 Session(底部 composer + 快捷短语)

日期:2026-06-14
状态:已实现

## 背景

Ask Maple 抽屉的输入框原本在**顶部**(`.ask-input`,`border-bottom`),对话流在下、快捷短语贴在对话流顶端——与 Session 聊天(消息流在上、composer 固定**底部**)交互方向相反,体验不一致。

上一个 commit `e5abdecb`(Fix AskMaple chat-first layout)只把右侧 context 改成浮层抽屉,没动输入框位置。本次把 AskMaple 改成与 Session 一致的 chat-first 布局:对话流占满中间可滚动,输入框固定底部,快捷短语放输入框正上方。按需求 **不加文件上传**(AskMaple 本就没有)。

## 约束

- `.ask-drawer` 的 base grid(`auto auto minmax(0,1fr)`)被 `MetricDrawer`(Agent 指标抽屉)共用。新增 `.ask-chat-drawer` modifier 隔离行序,不动 base。
- 契约 `tests/contracts/maple_ui_interaction_contract.ts` 要求保留 `ask-chat-body` / `ask-info-toggle` / `ask-session-panel` / `ask-signals-panel`,且 `ask-chat-body` 早于 `ask-session-panel`。新结构满足,并新增 `ask-composer-wrap` 须晚于 `ask-chat-body` 的断言。

## 改动

1. `apps/admin-web/src/pages/sessions/AskMapleDrawer.tsx`
   - 根 `<aside>` → `ask-drawer ask-chat-drawer`。
   - 删顶部 `ask-input` 与冗余 `ask-state`;`ask-chat-body` 内只保留 `ask-chat-stream`。
   - 底部新增 `ask-composer-wrap`:`askError` → `ask-actions`(3 个快捷短语,点击即发送)→ `ask-input`(输入框 + 发送,回车发送不变)。
   - `ask-session-panel` 浮层、`ask()`、SSE 流、context 列表均不变。

2. `apps/admin-web/src/styles/part-6.css`
   - `.ask-chat-drawer{grid-template-rows:auto minmax(0,1fr) auto;}`
   - `.ask-chat-body` 改 `display:block;overflow:auto`(对话流占满中间并滚动)。
   - `.ask-composer-wrap`(底部 `border-top`)+ `.ask-composer-wrap .ask-input{padding:0;border-bottom:0}`。
   - 移动端 media 补 `.ask-composer-wrap` padding。

3. `tests/contracts/maple_ui_interaction_contract.ts`:追加 `ask-composer-wrap` 存在 + 位置断言。

## 验证

- `bun run typecheck` / `bun run lint` / `bun run test:maple-ui-interaction` 全过。
- Preview 截图:输入框在底部、快捷短语在其上、对话流占满中间可滚动、"当前 Session" 浮层正常;MetricDrawer 布局无回归。
- 部署:`bun run deploy:vefaas:stable`(需非沙箱终端 + veFaaS AK/SK)。
