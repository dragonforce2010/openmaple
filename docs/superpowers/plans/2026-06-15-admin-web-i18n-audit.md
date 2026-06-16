# Admin Web I18n Audit

日期: 2026-06-15

## 目标

- 扫描 `apps/admin-web/src` 页面、弹窗、shell、共享 UI 中的用户可见交互文案。
- 修复中文界面下仍显示英文的问题，优先覆盖截图中的 `CredentialModal` / `VaultModal` 共享凭据流程。
- 新增静态合约测试，新增页面或弹窗时如果写入未国际化的英文交互文案，测试失败。

## 范围

- `apps/admin-web/src/App.tsx`
- `apps/admin-web/src/AppFrame.tsx`
- `apps/admin-web/src/ui.tsx`
- `apps/admin-web/src/pages/**`
- `apps/admin-web/src/shell/**`
- `tests/contracts/admin_web_i18n_contract.ts`
- `package.json`

不翻译品牌、协议、API、代码示例、环境变量、HTTP 方法、provider 名称、模型名、状态枚举原值和用户/后端返回内容。

## 任务

- [ ] 修复弹窗/抽屉/按钮/表格头/占位符/aria-label 中的硬编码英文。
- [ ] 保持 `Vault`/MCP 凭据共享风险文案与 ADR-0005 一致。
- [ ] 新增 i18n 合约测试：校验 `translations` 双语 key 对齐；扫描 TSX 中的可见英文硬编码；要求新增页面走 `L(...)` / `useL()` / `useI18n()`。
- [ ] 将测试加入 `package.json` scripts 和 `test:all`。
- [ ] 运行 `bun run typecheck`、`bun run lint`、`bun run test:admin-web-i18n`。
- [ ] 启动本地前端，切换语言并截图验证弹窗中文。

## 验证命令

```bash
rtk bun run test:admin-web-i18n
rtk bun run typecheck
rtk bun run lint
rtk bun run dev
```

浏览器验收:

- 打开 `http://127.0.0.1:5173`
- 切到中文
- 打开凭证库新增凭据弹窗
- 确认标题、说明、label、风险提示、确认勾选和按钮随语言切换

