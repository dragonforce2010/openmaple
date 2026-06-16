# Managed Agents Platform E2E 测试报告

**日期：** 2026-05-28 17:48 CST  
**范围：** 创建 agent、按钮点击、点击后报错、慢响应反馈、主要控制台导航、Docker/E2B runtime、模板/技能/模型/Artifact 操作。  
**结论：** PASS。已修复创建 agent 依赖 provider 时的报错/慢响应问题，并补齐回归用例。

## 本次发现

| 分类 | 问题 | 影响 | 修复 |
|---|---|---|---|
| 功能问题 | `POST /v1/agent_drafts` 在 provider 无凭证、配置错误或超时时直接返回 502 | Quickstart 用户无法继续创建 agent | `server/agentBuilder.ts` 增加规则草稿降级，返回可用 `schema-fallback` draft |
| 体验问题 | agent 草稿生成依赖真实 provider，慢时用户只能等待 | 用户误以为按钮无效或系统卡住 | `server/provider.ts` 增加可配置超时，默认 8s；UI 保留即时 `Generating agent definition...` |
| 体验问题 | `Create this agent` 点击后缺少可见 busy 文案 | 无法判断是否提交成功，容易重复点击 | `src/App.tsx` 显示 `Creating agent...` 并禁用按钮 |
| 功能问题 | 部分 modal 写操作异常时只会抛 Promise error | 用户看不到错误原因，modal 可能处于未知状态 | Environment/Vault/Credential/Session modal 增加 inline error 和 saving 状态 |
| 可维护性问题 | E2E 没有覆盖 provider 失败降级、创建 agent busy、modal API error | 回归容易漏掉同类问题 | `scripts/e2e.mjs` 新增 E2E-028/029/030 |

## 新增 E2E 覆盖

| ID | 场景 | 结果 |
|---|---|---|
| E2E-028 | broken model config 下 `POST /v1/agent_drafts` 快速降级 | PASS，耗时 3ms，`provider_fallback: true` |
| E2E-029 | Quickstart 点击 `Create this agent` | PASS，出现 `Creating agent...`，按钮请求中 disabled |
| E2E-030 | 强制 `POST /v1/environments` 失败 | PASS，modal 保持打开并显示 inline error |

## 自动化结果

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run typecheck` | PASS | `tsc --noEmit` 通过 |
| `npm run build` | PASS | Vite build 成功，输出 `dist/assets/index-CuZHHltP.js` |
| `npm run test:e2e` | PASS | `ok: true`, `stamp: 1779960927895`, `session_id: sess_5-s6xfN4l0` |

## E2E 运行摘要

- API health、登录保护、local 登录、Lark SSO start 行为：PASS
- provider invalid fallback：PASS，`schema-fallback` 在 5s 门限内返回
- Agent create、Environment/Vault/Credential/Memory/Template/Skill CRUD：PASS
- Skill symlink：PASS，7 个 client skills 目录均存在 symlink
- E2B runtime：PASS，`sandbox_id: iydgv34ymnx0dj6io0r8r`
- Docker runtime：PASS，session idle 且 provider/tool loop 写入真实文件
- Artifact 下载：PASS，`qa/e2e-1779960927895.txt`
- UI button audit：PASS，覆盖 34 个按钮/动作
- Desktop screenshot：`/tmp/managed-agents-e2e-1779960927895.png`
- Mobile screenshot：`/tmp/managed-agents-e2e-mobile-1779960927895.png`

## Browser / Computer Use 复测

Codex 内置 Browser 在本轮返回浏览器列表为空，因此改用 Computer Use 驱动本机 Arc 浏览器。

| 操作 | 观察 | 结果 |
|---|---|---|
| 打开 `http://127.0.0.1:5173/` | 已登录 Quickstart，模板、prompt、config preview 可见 | PASS |
| 输入 prompt 并点击生成 | 按钮 disabled，显示 `Generating agent definition...` | PASS |
| 等待草稿生成 | 出现 `Create this agent` 和 YAML preview | PASS |
| 点击 `Create this agent` | 页面出现 `Agent created`，进入环境选择步骤 | PASS |
| 点击 Environments/Templates/Skills/Sessions | 页面均可切换，主要表格、详情区和操作按钮可见 | PASS |

## 修改文件

- `server/provider.ts`
- `server/agentBuilder.ts`
- `src/api.ts`
- `src/App.tsx`
- `src/styles.css`
- `scripts/e2e.mjs`
- `docs/acceptance/e2e-test-suite.md`
- `docs/superpowers/plans/2026-05-28-e2e-agent-creation-hardening.md`

## 残余风险

- 当前默认 agent draft provider 超时为 8s，可通过 `LMAP_AGENT_DRAFT_TIMEOUT_MS` 调整。
- 本次不清理 E2E 产生的真实本地数据和 skill 目录，因为历史 E2E 也保留这些验证工件；没有执行批量删除。
