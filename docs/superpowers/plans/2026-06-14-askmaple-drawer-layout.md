# AskMaple drawer layout cleanup

## Goal

把 AskMaple 抽屉从“消息流 + 当前 Session 信息混排”改成清晰两层: 对话优先, Session 基本信息和事件线索作为独立上下文区。

## Files

- `apps/admin-web/src/pages/sessions/AskMapleDrawer.tsx`
- `apps/admin-web/src/config/i18n.ts`
- `apps/admin-web/src/styles/part-6.css`
- `tests/contracts/maple_ui_interaction_contract.ts`

## Tasks

- [x] 把建议按钮、错误、transcript 放入独立 Conversation section。
- [x] 把当前 Session 的 status/agent/environment/events/tools 放入独立 Context section。
- [x] 把事件分布、工具调用、引用聚合到 Secondary signals section, 降低视觉权重。
- [x] 加 source-level contract 防止对话与上下文重新混排。
- [x] 跑 `bun run typecheck`、`bun run lint`。
- [x] 本地打开页面并保存最终截图。

## Expected result

打开 AskMaple 后, 用户先看到提问和对话结果; 当前 Session 的基本信息不再插入消息流中, 而是在下方独立区域供排障参考。
