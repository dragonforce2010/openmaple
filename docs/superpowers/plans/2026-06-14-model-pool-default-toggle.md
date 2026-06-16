# 工作区模型池 — 一键切换默认模型

## 背景与裁决

「模型管理」抽屉 tab(`WorkspaceModelsTab`)的「工作区模型池」表里,`Default` 列目前是
`defaultToggle(config.is_default)` —— 一个**纯展示的只读指示灯**(`<span class="tgl">`,
[labels.tsx:70](apps/admin-web/src/components/shared/labels.tsx#L70)),点不动。

需求:让这个 toggle 可点击 —— 选中某模型即设为默认,其余模型的开关自动关闭(互斥)。

**后端零改动**(已完整):
- `updateModelConfig`([storeModelsDeployments.ts:96](apps/control-plane-api/src/storage/storeModelsDeployments.ts#L96))
  在事务里:`is_default:true` 时先 `UPDATE ... SET is_default=0 WHERE workspace_id=?` 清零,
  再设当前为默认。互斥是原子的。
- PATCH `/v1/model_configs/:id`([modelConfigRoutes.ts:63](apps/control-plane-api/src/routes/modelConfigRoutes.ts#L63))
  已就绪,含 `canAdminWorkspace` 权限校验。

**参照实现**:`ModelGatewayView.setDefaultModel`([ModelGatewayView.tsx:54](apps/admin-web/src/pages/admin/ModelGatewayView.tsx#L54))
已有一键切默认(`apiPatch + onChanged + toast + per-row busy 锁`)。

**交互形态裁决**:可点 toggle,保持截图现状外观(用户已选定)。

**只读行处理**:`listModelConfigs` 会 union `GLOBAL_SCOPE_ID` 的内置模型
([storeModelsDeployments.ts:66](apps/control-plane-api/src/storage/storeModelsDeployments.ts#L66))。
内置行(`workspace_id` 为空/`-1`)PATCH 会 403,其 toggle 必须禁用——复用
`ModelGatewayView` 的 `isReadonly` 判定。

## 改动文件

仅前端 3 文件 + 1 css。

### 1. `apps/admin-web/src/components/shared/labels.tsx`

`defaultToggle` 增加可选 `onClick`/`disabled`/`busy` 参数:
- 无 `onClick` → 维持现状,渲染只读 `<span class="tgl">`(其它调用方不受影响)。
- 有 `onClick` → 渲染 `<button class="tgl">`,`disabled` 时不可点,`busy` 时显示 in-flight。
- 已默认(`on=true`)的行:`disabled`(已是默认,无需再点),但保持绿色亮起。

签名:`defaultToggle(on: boolean, opts?: { onClick?: () => void; disabled?: boolean; busy?: boolean })`

### 2. `apps/admin-web/src/pages/workspaces/WorkspaceSettingsTabs.tsx`

`WorkspaceModelsTab`:
- props 增加 `onSetDefault: (config: ModelConfig) => void | Promise<void>`。
- 增加 per-row busy state(`useState`,仿 `WorkspaceKeysTab` 的 `busyKeyId` 模式)。
- `isReadonly(config)` 判定(`!config.workspace_id || config.workspace_id === "-1"`)。
- 第 131 行 `defaultToggle(config.is_default)` 改为带 `onClick`(非默认且非只读时设默认)、
  `disabled`(只读 / 已默认 / 有 busy 行时)、`busy` 的版本。

### 3. `apps/admin-web/src/pages/workspaces/WorkspaceSettingsDrawer.tsx`

- props 增加 `onModelsChanged?: () => Promise<void> | void`。
- 实现 `setDefaultModel(config)`(仿 `ModelGatewayView.setDefaultModel`):
  `apiPatch('/v1/model_configs/${config.id}', { is_default: true })` → `await onModelsChanged?.()`
  → `toast(L('已设为默认模型','Default model updated'),'ok')`,catch 走 `toast(errorMessage,'err')`。
- 把 `onSetDefault={setDefaultModel}` 透传给 `WorkspaceModelsTab`(第 310 行)。
- `apiPatch` 已 import? 否则补 import(当前只 import 了 `apiDelete/apiGet/apiPost`)。

### 4. `apps/admin-web/src/AppFrame.tsx`

`WorkspaceSettingsDrawer` 调用(第 346 行)增加:
`onModelsChanged={() => refresh(selectedWorkspaceId)}`。
`refresh` 重拉 `modelConfigs`,互斥后的新状态自动回填所有行的 toggle。

### 5. `apps/admin-web/src/styles/part-4.css`

`.tgl` 当前注释写死 "read-only"。为可点版补:
- `button.tgl`:`padding:0; cursor:pointer; appearance:none;`(button reset,避免默认边距/字体)。
- `.tgl:disabled`:`cursor:default; opacity 维持`(已默认行仍亮绿,不要灰掉)。
- `.tgl:not(:disabled):hover`:轻微 border 高亮(可选,克制)。
- 更新注释:不再是纯 read-only。

## 验证

1. `bun run typecheck` —— 必过。
2. `bun run lint` —— 必过(注意 labels.tsx / WorkspaceSettingsTabs.tsx 不超 400 行;
   两文件当前 81 / 260 行,余量足)。
3. 截图验证(前端可见改动,用户偏好硬要求):
   - 起 `bun run dev`(非沙箱终端),登录到有多个工作区模型的工作区。
   - 打开工作区设置 → 模型管理 tab。
   - 点击非默认模型的 toggle → 它变绿、原默认变灰、toast 提示。
   - 截图存档,附最终响应。
   - 若服务/截图被沙箱拦,说明 blocker + 给出确切 URL/操作。

## 任务清单

- [ ] labels.tsx:`defaultToggle` 加可点变体(向后兼容只读调用)
- [ ] WorkspaceSettingsTabs.tsx:`WorkspaceModelsTab` 接 `onSetDefault` + busy + isReadonly + 可点 toggle
- [ ] WorkspaceSettingsDrawer.tsx:`setDefaultModel` 实现 + 透传 + 补 apiPatch import
- [ ] AppFrame.tsx:drawer 加 `onModelsChanged`
- [ ] part-4.css:`button.tgl` reset + disabled/hover 态
- [ ] `bun run typecheck` + `bun run lint`
- [ ] 截图端到端验证
