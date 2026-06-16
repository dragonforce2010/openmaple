# Session 文件/图片上传 → TOS → Sandbox 预挂载 → Agent 解析

> 状态:**计划待评审**(未动代码)· 作者:michael.zhang · 日期:2026-06-14
> 范围裁决(用户多轮拍板):
> - ✅ 范式 = **平台编排预挂载**(平台传 TOS → turn 前在 Sandbox 内 presigned curl 下载到 `/mnt/session/uploads/` → prompt 自动注入路径)。**不走** "agent 主动自取下载工具"。
> - ✅ URL 形态 = **presigned 预签名**(现签现用,不持久化、不进 prompt、不进 DB)。
> - ✅ 过期处理 = **用时现签 + 每 turn 幂等对账 + curl 失败重签重试一次**(详见 §4)。
> - ✅ 旧 base64 路径 = **直接改成 presigned**,不留小文件 base64 兼容分支(代码尚未真跑生产)。
> - ✅ 图片 = **统一当资源**;能否理解取决于客户 agent 模型是否多模态 **且** loop 是否把图片转成 multimodal block(列为已知限制 + 待验证)。
> - ✅ key 规则 = 每 agent / 每 session 独立子目录。
> - 🚦 本次交付物 = **本计划文档**;代码实现待评审后再启动。

## 背景 / 现状盘点

会话页 composer 当前只有纯文本 `<input>`([SessionsView.tsx:350](../../../apps/admin-web/src/pages/sessions/SessionsView.tsx))。但 **TOS 全套基建 + session 文件关联机制都已存在**,这次是"复用 + 补链路 + 改一处大文件坑",不是从零搭建。

已有拼图(改前必知):

| 能力 | 位置 | 状态 |
|---|---|---|
| TOS 客户端(put/read/delete/presign/objectKey) | [files/objectStorage.ts](../../../apps/control-plane-api/src/files/objectStorage.ts) | ✅ 完整。`presignedObjectUrl(key, 1800)` 本地 HMAC 签名,不发网络。 |
| 文件上传 `POST /v1/files`(multipart) | [routes/artifactFileRoutes.ts:38](../../../apps/control-plane-api/src/routes/artifactFileRoutes.ts) + [files/files.ts](../../../apps/control-plane-api/src/files/files.ts) | ✅ 已上传到 TOS key `managed-files/<file_id>/<name>`。 |
| `managed_files` 表(多租字段齐全) | [storage/storeSchema.ts:213](../../../apps/control-plane-api/src/storage/storeSchema.ts) + ensureColumn 补 `workspace_id`/`tenant_id`/`created_by_user_id` | ✅ `createManagedFileRecord` 已支持传 scope;按 workspace 删除已挂 FK 清理链([storeWorkspace.ts:231](../../../apps/control-plane-api/src/storage/storeWorkspace.ts))。 |
| session 关联文件 `resources` | 建 session 时 [routes/sessionRoutes.ts:68](../../../apps/control-plane-api/src/routes/sessionRoutes.ts) 接收 `resources:[]` → 落 `metadata.resources` | ✅ 形态 `{type:"file", file_id, mount_path}`。 |
| 文件注入 Sandbox(**待改的坑**) | [runtime/runtimeResources.ts](../../../apps/control-plane-api/src/runtime/runtimeResources.ts) `sessionResourceManifest` | ⚠️ **base64 全量塞进 bootstrap payload**。 |
| Sandbox 端落盘 | [runtime-app/app.py:57](../../../infra/vefaas/runtime-app/app.py) `bootstrap()` 解 base64 写盘;[runtime/vefaasSandboxRuntime.ts:191](../../../apps/control-plane-api/src/runtime/vefaasSandboxRuntime.ts) `syncSessionMountsToVefaasSandbox` host 读字节再 write | ✅ 两条 runtime 都铺到 `/mnt/session/uploads/`。 |

### 现状致命缺陷(本计划的核心驱动)

[runtimeResources.ts](../../../apps/control-plane-api/src/runtime/runtimeResources.ts) `sessionResourceManifest` 把每个文件 `readFile().toString("base64")` 塞进 **bootstrap** payload。bootstrap 是 control action,[vefaasAgentRuntime.ts:114](../../../apps/control-plane-api/src/runtime/vefaasAgentRuntime.ts) 给它的超时只有 **20s**(`MAPLE_VEFAAS_CONTROL_TIMEOUT_MS`)。几 MB 图片 → base64 膨胀 33% → HTTP body 撑爆 + 20s 超时。**图片/大文件场景必须绕开 base64-in-bootstrap。**

## 架构定位(先对齐术语再动手 —— 按 [CONTEXT.md](../../../CONTEXT.md))

- **AgentRuntime**="跑脑子"(读 snapshot、调模型、agent loop)。
- **Sandbox**(SandboxRuntime)="跑手"(隔离命令、文件、包安装)→ **文件下载/落盘归这里**。
- 默认 agent 走 **provider loop**(`shouldUseExternalAgentLoop` 默认 false):脑子在控制面本地循环,不起 vefaas agent runtime;工具执行才 `ensureSessionSandboxRuntime` → **vefaas sandbox**。
- → **唯一对所有 loop 都成立的"文件就位点" = vefaas Sandbox 的 prepare 阶段**(`prepareVefaasSandboxRuntime` 里已经在调 `syncSessionMountsToVefaasSandbox`)。把"下载 + 落盘"挂在这里,无论脑子在本地还是 vefaas,工具(bash/read)都能读到文件。

**关键设计判断:`presigned curl` 在 Sandbox 内执行(跑手),由 Control Plane 编排(决定签谁、何时拉),不靠 Agent 决策。** 这同时满足用户"工具执行在沙箱"诉求,又不赌 agent 主动下载。

## 设计

### D1. 上传:session 级上传 API + session 隔离 key

新增 `POST /v1/sessions/:sessionId/files`(multipart),复用 `createManagedFileFromRequest` 主体,但:

1. **鉴权**:`canReadSessionRecord(user.id, session)`,403 拦截。
2. **key 规则**:改用 `objectKey("session-uploads", workspace_id, agent_id, session_id, file_id, filename)` → TOS 落点形如
   `session-uploads/<ws>/<agent>/<sess>/<file_id>/<name>`,满足"每 agent 每 session 独立子目录"。
   - 现有 `POST /v1/files` 的 `managed-files/<file_id>/<name>` 保留(通用上传仍可用),session 上传走新 key 前缀。
3. **落库**:`createManagedFileRecord` 带上 `workspace_id`/`tenant_id`/`created_by_user_id`(从 session scope 取),`public_url` 存 `null`(不依赖公开 url)。
4. **关联 session**:上传成功即把 `{type:"file", file_id, mount_path:<filename>, media_type, bytes}` 追加进 `session.metadata.resources`(`updateSessionMetadata`,合并而非覆盖)。
5. **响应**:返回 `managedFileResponse(file)` + 该 resource 条目,前端拿 `file_id` 做 chip。

> `files/files.ts` 的 `writeManagedFile` 需要参数化 key 前缀 + 接收 scope 字段(现在硬编码 `managed-files`)。改成可传 `keyParts` + `scope`,默认行为不变。

### D2. manifest 改 presigned(根治 base64 坑)

[runtimeResources.ts](../../../apps/control-plane-api/src/runtime/runtimeResources.ts) `sessionResourceManifest`:**不再 readFile→base64**,改为对每个 resource 用 `object_key` 现签:

```
{ type:"file", mount_path:"/mnt/session/uploads/<name>", presigned_url:<presignedObjectUrl(object_key, 1800)>, media_type, sha256 }
```

- 数据源从"host `.session/uploads/` 目录扫文件"改为"读 `session.metadata.resources` → 查 `managed_files` 拿 `object_key` → 现签"。
- `prepareSessionResources`(把字节写 host `.session/uploads/`)的存在价值下降——预挂载范式下 host 不再需要中转字节。**保留但仅用于本地非 TOS 兜底**(`objectStorageEnabled()===false` 时回退原 base64 行为,本地开发无 AK/SK 也能跑)。

### D3. Sandbox 端:base64 解码 → presigned curl 下载

两个落盘点都改:

1. **`app.py bootstrap()`**([runtime-app/app.py:57](../../../infra/vefaas/runtime-app/app.py)):resource 处理从"`base64.b64decode` 写盘"改为"若有 `presigned_url` → `urllib.request` 下载写盘;否则回退 `content_base64`(本地兜底)"。下载失败记入返回的 `mount_failed` 列表。
2. **`syncSessionMountsToVefaasSandbox`**([vefaasSandboxRuntime.ts:191](../../../apps/control-plane-api/src/runtime/vefaasSandboxRuntime.ts)):从"host 读字节 → `writeVefaasSandboxFile`"改为"在 sandbox 内 `curl -fsSL <presigned_url> -o /mnt/session/uploads/<name>`"(经 `runVefaasSandboxCommand`)。逐文件先判存在(幂等对账,见 §4),缺了才拉。

### D4. prompt 注入(URL/路径不暴露在前端/transcript)

在 [runner.ts runUserMessage](../../../apps/control-plane-api/src/runtime/runner.ts:101) 把 `text` 交给 agent 前,前置一段**本轮可用文件清单**:

```
[附件] 用户在本会话上传了以下文件,已就位于 sandbox:
- /mnt/session/uploads/<name>  (image/png, 1.2MB)
- /mnt/session/uploads/<doc>.pdf  (application/pdf, 800KB)
请在需要时用 Read/Bash 读取这些路径。
```

- 前端**只发纯 prompt**,文件清单由后端从 `metadata.resources` 拼。presigned url **不进 prompt**(只在 D3 的 curl 命令里一次性使用)。
- 注入点对 provider loop 和 vefaas loop 都要覆盖(`runProviderTurn` 和 `runAgentLoopOnVefaas` 的 text 入口)。

### D5. 前端 composer 上传 UI

[SessionsView.tsx:350](../../../apps/admin-web/src/pages/sessions/SessionsView.tsx) composer 增强:

- 附件按钮(`i-paperclip` 或现有 sprite 里的 icon)→ `<input type=file multiple hidden>`。
- 选文件 → `POST /v1/sessions/:id/files`(FormData)→ 上传中 spinner → 成功后渲染已选附件 chip(文件名 + 大小 + 移除按钮)。
- `sendMessage`(在 [App.tsx:365](../../../apps/admin-web/src/App.tsx))保持只发文本;附件已在上传时关联进 session resources,无需随消息再带。
- 边界:上传大小上限(前端校验,比如 ≤50MB,与 `listHostFiles` 的 `maxFileSize` 对齐)、类型提示、上传失败 toast。

> 注意 [SessionsView.tsx](../../../apps/admin-web/src/pages/sessions/SessionsView.tsx) 文件行数,**400 行硬顶**。附件 UI 若超行,拆 `SessionComposer.tsx`。

## §4 presigned url 过期处理(用户追问,核心)

**原则:object_key 是唯一持久真相;presigned url 用完即弃。**

1. **挂载时现签**:turn 前 D2 现签 → D3 立即 curl。签发→使用窗口仅几秒,1800s 绰绰有余。文件落盘后整 turn 读本地,与 url 无关。
2. **sandbox 恢复后对账**:vefaas sandbox timeout 暂停 + `ResumeSandbox` 后 `/mnt/session/uploads/` 可能不保盘。**每 turn 前跑幂等对账**:`syncSessionMountsToVefaasSandbox` 逐文件 `test -f` 判存在,缺了重新现签 + curl。永远新鲜 url。
3. **下载失败兜底**:curl 失败 → 重签一次重试一次;再败 → 标 `mount_failed`,在 D4 prompt 注入里如实写"文件 X 下载失败",**不静默假装文件在**。
4. **成本**:`presignedObjectUrl` 是本地 HMAC,无网络开销,"每次现签"零负担。

## §5 图片多模态(用户追问,已知限制)

- 平台职责止于"图片字节进 sandbox + 路径进 prompt"。
- **能否理解图片需两条同时成立**:①客户 agent 用多模态模型;②agent loop 的工具链把图片文件转成 multimodal image block 喂给模型。
- 第②条当前 main 的 SDK loop([claude_agent_sdk_runner.py](../../../infra/vefaas/runtime-app/claude_agent_sdk_runner.py))的 `Read` 是否对图片做多模态转换 —— **未验证,列为待验证项**。
- 第一版**不做图片专用通道**,图片当普通资源。文档明确标注:纯文本模型/不转 block 的 loop 看不懂图,属预期限制。

## 验证步骤

> 沙箱环境拦截 MySQL/veFaaS/TOS 出网,以下需在**非沙箱终端**跑。

1. `bun run typecheck` + `bun run lint` 全绿(含 400 行硬顶)。
2. **上传 API**:`curl -F file=@test.pdf .../v1/sessions/<id>/files` → 200,TOS 控制台见 `session-uploads/<ws>/<agent>/<sess>/<file_id>/test.pdf`,`managed_files` 有行,`session.metadata.resources` 多一条。
3. **现签**:单测/脚本验 `sessionResourceManifest` 返回 `presigned_url` 且无 `content_base64`(`objectStorageEnabled()` 为真时)。
4. **端到端(真实 veFaaS + TOS)**:建 session → 上传 pdf → 发"总结这个文件" → Debug 事件流见文件清单注入 → agent `Read /mnt/session/uploads/test.pdf` 成功 → 回答含 pdf 内容。
5. **前端**:Playwright 真实浏览器 —— composer 选文件 → chip 出现 → 发消息 → 截图存 `docs/superpowers/screenshots/2026-06-14-session-file-upload.md`。
6. **过期对账**:sandbox 强制 timeout/kill 后续 turn,验证文件被重新拉取(看 `vefaas_sandbox.command` curl 日志)。

## 🚦 待真实环境验证的风险(无法在沙箱替你验)

1. ~~veFaaS sandbox 出网到 TOS(原列为命门)~~ —— **已确认可出网,命门解除**。证据:① 产品控制台 sandbox 网络配置项「默认网卡访问公网 = 启用」(走函数服务多租户共享公网 NAT/EIP 访问互联网);② **该开关由 provision 部署链路代码保证开启**(非手动配置)→ 客户侧每个自动开通的 sandbox 函数都继承公网出网,**不存在"本地能出网、客户新 workspace 出不了网"的配置漂移坑**;③ 代码侧 [objectStorage.ts:87](../../../apps/control-plane-api/src/files/objectStorage.ts) TOS 用的就是**公网 endpoint** `*.tos-cn-beijing.volces.com`(非内网 `ivolces`),与 sandbox 公网出网能力自洽;④ [CreateSandbox](../../../apps/control-plane-api/src/runtime/vefaasSandboxRuntime.ts) 不传 VPC 参数 → 网络是**函数级配置**(部署时写死),不在建 sandbox 时动态指定;⑤ 同款出网早已现网运行:agent 在 sandbox 内调 ARK `https://ark.cn-beijing.volces.com/api/coding`([agentLoopDriverUtils.ts:44](../../../apps/control-plane-api/src/runtime/agentLoopDriverUtils.ts))已是 sandbox 出公网访问火山域名的既有行为,同域 TOS 同理可达。
   - **剩余真正关注点 = 共享公网 NAT 带宽波动**(产品提示明示"共享公网 NAT 可能存在带宽波动"):大文件/高并发下载可能慢或抖 → 实现时 curl 必须带超时 + 重试 + 文件大小上限,不能假设秒下。
   - **优化路径(非必需,后续)**:给 sandbox 绑 VPC 私有网络 + 改用 TOS **内网 endpoint** `tos-cn-beijing.ivolces.com` → 免公网带宽波动 + 免公网流量费 + 更快。但内网 endpoint 要求 sandbox 在同 region VPC 内(当前「私有网络=关闭」走不通),且 presigned 签名 endpoint 要同步改。第一版走公网即可。
2. **presigned 时效**:1800s 对最慢 turn 是否够;`isCustomDomain:true` 下签名是否在 sandbox 侧校验通过。
3. **图片多模态通道**(§5 第②条):SDK loop 的 `Read` 对图片行为。
4. ~~工具执行位置对齐~~ —— **由并行任务「Tool execution performance optimization」负责,本计划不重复处理,但必须在其基础上兼容**(详见 §6)。

## §6 与并行任务「Tool execution performance optimization」的兼容(强约束)

该任务(用户告知,稍后交主干)落地"工具必须在独立 sandbox 执行 + 凭证零落容器 + 状态外置 TOS"。**本计划实现时必须在它合入后的基础上兼容,以它为准。** 计划=`~/.claude/plans/linear-jumping-beaver.md`,决策=[ADR-0004](../../../docs/adr/0004-agent-tools-execute-in-sandbox-not-runtime.md)。

### 它已落地(A+B,当前工作树已有,稍后交主干)
- 新增 [sandbox_tools.py](../../../infra/vefaas/runtime-app/sandbox_tools.py):`create_sdk_mcp_server("maple_sandbox")` 5 工具(bash/read_file/write_file/grep/list_files),工具体只持 bridge token POST `/v1/runtime/sessions/:id/tools`。
- [app.py](../../../infra/vefaas/runtime-app/app.py) 改:`disallowed_tools` 禁内置 Bash/Read/Write/Edit/Glob/Grep,逼模型走 `mcp__maple_sandbox__*`;`run_claude_sdk_loop` 起 turn 前 `configure_tool_bridge`。
- [runtimeManager.ts runAgentLoopOnVefaas](../../../apps/control-plane-api/src/runtime/runtimeManager.ts):发 run 前 `await ensureSessionSandboxRuntime`(原 void 后台预热)。
- **结果:vefaas agent loop 与 provider loop 现在都经同一出口 `executeTool`([runtimeTools.ts:37](../../../apps/control-plane-api/src/runtime/runtimeTools.ts))在 sandbox 执行工具。**

### 兼容判断:本计划与它**高度对齐,主路径零冲突**
- 本计划文件就位点 = `prepareVefaasSandboxRuntime` 的 `syncSessionMountsToVefaasSandbox`,**就是它强化的那个 sandbox**。agent(两条 loop)读 `/mnt/session/uploads/` 都经 sandbox 工具 → 文件在 sandbox 内即可见,**与它的工具转发机制天然契合**。
- 它的 A+B 改的是 `app.py`/`sandbox_tools.py`/`runtimeManager.ts`;本计划改 `objectStorage.ts`/`files.ts`/`runtimeResources.ts`/`vefaasSandboxRuntime.ts(sync 函数)`/`runner.ts(prompt 注入)`/前端 —— **文件级几乎不重叠**(唯一共改 `app.py`,但它改 init/disallowed,我改 `bootstrap()` 的 resource 落盘,函数不同)。

### ⚠️ 真实重叠面 = 它的 **C 阶段(状态外置 TOS),当前暂停未做**
这是唯一会打架的地方,实现时按它合入后的 C 状态分两种情况:

| 它的 C 状态 | 本计划 D3 怎么改 |
|---|---|
| **C 未做**(sandbox 仍 host↔sandbox 双向同步,workspace 在容器本地盘) | 本计划照原样:Sandbox 内 `curl presigned → /mnt/session/uploads/`,`syncSessionMountsToVefaasSandbox` 仍是落盘点。 |
| **C 已做**(sandbox workspace 挂载 TOS,删 `syncVefaasSandboxWorkspaceToHost` 回灌) | **复用而非新建**:上传的文件本就在 TOS,挂载后 sandbox 直接能 `ls` 到 → 可能**连 curl 都省了**,只需把 object_key 对齐到它的 TOS 挂载 prefix 约定(`<mount>/<workspace_id>/<session_id>/`)。本计划的 D1 key 规则 `session-uploads/<ws>/<agent>/<sess>/` 要与它的 prefix 约定**对齐或协商统一**,避免两套 TOS 布局。 |

→ **实现前置检查**:动 D3/D5 前先确认它的 C 是否已合入、TOS 挂载 prefix 约定是什么。若 C 已落地,本计划的"sandbox 内 curl 下载"应退化为"对齐 TOS prefix + 让挂载自动可见",更简单。

### 不可触碰
- **别改 `executeTool` 工具分发逻辑 / `disallowed_tools` / `sandbox_tools.py`** —— 那是它的地盘。本计划只新增 resource 落盘 + prompt 注入,不碰工具桥。
- **共用工作树警告**:它的 A+B 改动(`app.py`、`sandbox_tools.py`、`runtimeManager.ts` 等)就在**当前工作树未提交**。本计划实现时若它还没交主干,**先确认这些文件状态,别覆盖/误提交它的改动**;最稳是等它交主干后从干净 main 起分支。

## 任务拆解(实现阶段用)

- [ ] T1. `files/files.ts` `writeManagedFile` 参数化 key 前缀 + scope 字段(默认行为不变)。
- [ ] T2. `POST /v1/sessions/:sessionId/files` 路由(鉴权 + session key + 落库带 scope + 追加 resources)。
- [ ] T3. `runtimeResources.ts` `sessionResourceManifest` 改 presigned(查 managed_files 现签;`objectStorageEnabled` 为假时回退 base64)。
- [ ] T4. `app.py bootstrap()` resource 处理:presigned_url → urllib 下载;失败入 mount_failed。
- [ ] T5. `vefaasSandboxRuntime.ts` `syncSessionMountsToVefaasSandbox` 改 sandbox 内 curl + 幂等 `test -f` 对账 + 重签重试。
- [ ] T6. `runner.ts` prompt 注入文件清单(provider + vefaas 两路;url 不进 prompt)。
- [ ] T7. 前端 composer 上传 UI(附件按钮 + chip + 上传态;超行拆 `SessionComposer.tsx`)。
- [ ] T8. `test:session-file-upload` 契约脚本(上传→关联→manifest 现签形态)。
- [ ] T9. 验证 §"验证步骤" 全过 + 截图 + 命门 §1 真实 curl 验通后再宣布完成。

---

## §7 per-tenant TOS bucket + 凭证复用(2026-06-14 追加,用户拍板)

**背景修正**:第一版 `objectStorage.ts` 从全局 env `VOLCENGINE_ACCESS_KEY` 读凭证 + 单一平台 bucket。**错。** 用户拍板:TOS 与 veFaaS 同属火山、**用同一套 AK/SK**,且这套 AK/SK 开通租户时已存在 `workspace.config.provider_credentials.vefaas.{VOLCENGINE_ACCESS_KEY,VOLCENGINE_SECRET_KEY,VEFAAS_REGION}`(`withWorkspaceRuntimeCredentials` 已在用)。**TOS 凭证必须从这里按 workspace 读,不走全局 env。**

**bucket 归属**:每租户自己的 bucket(在租户自己的火山账号下,用租户 AK/SK 访问→权限自洽,无跨账号问题)。**平台自动生成名字,不让用户填。**

### 命名规则
`maple-<tenantSlug>-<workspaceIdShort>-<random6>`,**净化以满足 TOS 约束**(3–63 字符、小写字母数字与短横线、不以横线开头/结尾):
- tenantSlug:取 tenant slug,小写、非法字符→`-`、截断
- workspaceIdShort:`ws_3hryHMACWY` → 去 `ws_` 前缀取后段小写(下划线非法)
- random6:6 位小写字母数字(不能用 `Math.random`,workflow 约束;用 nanoid 自定义字母表)
- 总长超 63 时优先压缩 tenantSlug 段
- **bucket 名一旦生成即落库**(`workspace.config.tos_bucket`),后续只读不重算(名字带 random,不可重新推导)

### bucket 生命周期(谁建)— 用户拍板:**开通时建 + 上传前兜底**
- `ensureWorkspaceBucket(workspaceId)`(独立幂等函数):读 `config.tos_bucket`→无则生成名+`doesBucketExist`→不存在则 `createBucket`→落库。
- **挂两处,同一幂等函数**:① 开通 provision 链路(新租户开通即建);② `POST /v1/sessions/:id/files` 上传前兜底(已开通老租户 `tos_bucket` 为空时惰性补建,不需回填迁移)。幂等保证两处不重复建。
- SDK 已支持:`createBucket(PutBucketInput)` / `doesBucketExist(): Promise<boolean>`。
- ⚠️ **与并行 onboarding 任务的交集**:`storeWorkspaceCreate.ts`/`storeWorkspaceProvisioning.ts` 可能正被其它任务改 → ensureWorkspaceBucket 做成独立函数、在 provision 链路单点调用,最小化行重叠。

### objectStorage.ts 改造(从全局单例 → per-workspace client)
- `storageConfig()` 不再读全局 env,改为入参 `{accessKeyId, accessKeySecret, region, bucket, endpoint}`。
- `client(creds)` 按凭证构造(缓存 key = ak+region,不再单例)。
- `putObject`/`readObject`/`presignedObjectUrl`/`deleteObject` 全部加 `creds`/`bucket` 入参。
- endpoint 由 region 拼:`tos-<region>.volces.com`(bucket-level：`<bucket>.tos-<region>.volces.com`)。
- 新增 `workspaceObjectStorage(workspaceId)`:查 workspace→取 vefaas 凭证 + ensureWorkspaceBucket→返回一个绑定凭证的 storage handle(put/read/presign/url)。调用方都走它。

### 调用面改造(全部传 workspace 凭证)
- `files.ts` `writeManagedFile`/`readManagedFile`:加 workspaceId(上传路由已有 session→workspace);put/read 走 workspace handle。
- `artifacts.ts` `syncSessionArtifacts`/`downloadArtifact`:session 已知 workspace,put/presign 走 workspace handle。
- `runtimeResources.ts` `presignedResourceManifest`:已有 session→workspace,presign 走 workspace handle。
- `objectStorageEnabled()`:从"全局有无 env"改为"该 workspace vefaas 凭证齐不齐"。

### endpoint/region 来源
region = `provider_credentials.vefaas.VEFAAS_REGION`(开通已填,默认 cn-beijing)。不再用 `MAPLE_TOS_ENDPOINT` 全局 env。

### 风险/待确认
- **跨账号**:每租户用自己 AK/SK 建+访问自己 bucket，无跨账号权限问题（这是选 per-tenant bucket 而非平台统一 bucket 的关键收益）。
- **createBucket 配额/重名**:bucket 名全局唯一（TOS 跨租户共享命名空间），random6 降低撞名；撞名重试一次换 random。
- **已开通租户**:`config.tos_bucket` 为空 → 首次上传惰性补建，不需要回填迁移。
- **region 一致性**:bucket region 必须 = 凭证 region = sandbox region，否则 sandbox 内网/公网拉取可能跨区慢。已用同一 VEFAAS_REGION，自洽。
