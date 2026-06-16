# OpenClaw 子 Agent 迁移到 Hermes(路线 B:每 agent 一个独立 profile)

- 日期:2026-06-14
- **决策:路线 B**(每个保留的 agent = 一个独立 Hermes profile,接管它原有的独立飞书机器人)
- 决策依据:用户要求「办办/小记依然是独立飞书机器人,仅后端换 Hermes」。已查证 Hermes personality 切换**只有 `/personality <名>` 显式命令、不支持自然语言切换**(`gateway/run.py:7245` 唯一入口,无 LLM 意图路由、无 tool 暴露),故路线 A 不满足需求 → 改 B。
- 保留范围:**真人格三件套** → 小记 / 办办 / 深研
- 退役范围:main(小枢)、claude/codex/cursor/agency(CLI 派发壳)随 OpenClaw 退役;hermes-watch-dog(赫巡)已是 `~/.hermes/profiles/watch-dog/`,无需处理

---

## 0. 调查已确认的事实(写计划前已查证,勿重复查)

| 事实 | 证据 |
|---|---|
| 三件套各有**独立飞书自建应用**(独立 app_id+secret) | `~/.agents/channels/feishu.yaml` → `openclaw.agents.*` |
| 三个 app_id | 小记 `cli_a9720c5409f85cc4` / 办办 `cli_a9720c6c3ff81cb5` / 深研 `cli_a9720c867bb8dcba` |
| 每个 app 的用途文案(可直接做 description/SOUL 素材) | feishu.yaml 各 agent 的 `description` 字段 |
| 人格灵魂文本(风格/用途/意图识别三段) | `~/.openclaw/openclaw.json` → `agents.list[*].identity.theme`(已 dump) |
| Hermes:一个 profile = 一个独立 gateway + 独立 config/SOUL/.env/state + 独立飞书 app | `hermes profile show watch-dog`:Gateway running, Alias `watch-dog → hermes -p watch-dog` |
| **watch-dog 就是 B 的活模板**(hermes 侧 app `cli_a973d749ce341cd4` 与 feishu.yaml `hermes.agents.openclaw-watch-dog` 对应) | 已确认 |
| `hermes profile create --clone-from watch-dog` 可直接克隆已验证模板 | `hermes profile create --help` |
| personality 仅 `/personality` 命令切、无自然语言切换 | `gateway/run.py:7245`,grep 路由/tool 均空 |
| Hermes 主 agent 用 `cli_a9727036bfb89cbd`,与三件套 app 互不冲突 | feishu.yaml `hermes.agents.hermes-agent` |
| `hermes` CLI v0.16.0 可用 | `hermes --version` exit=0 |

**形态结论**:删 OpenClaw 后,办办/小记/深研三个飞书机器人在飞书侧实体不变(联系人/群/历史不动)。给每个建一个 Hermes profile,把对应 app_id+secret 填进 `platforms.feishu`,飞书消息即被该 profile 的 gateway 接管。用户跟"办办"聊还是办办,**无需 `/personality` 切换**——这正是 B 自动满足心智模型之处。代价:3 个常驻 gateway 进程(内存待非沙箱终端实测,`ps` 在沙箱被禁)。

---

## 1. 目标产物

三个新 Hermes profile,各自独立常驻、各接一个飞书机器人:

| profile 名 | 飞书 app | SOUL(人格) | 启动入口 |
|---|---|---|---|
| `personal`(小记) | `cli_a9720c5409f85cc4` | 小记 identity.theme | `hermes -p personal` / alias `personal` |
| `work`(办办) | `cli_a9720c6c3ff81cb5` | 办办 identity.theme | `hermes -p work` |
| `research`(深研) | `cli_a9720c867bb8dcba` | 深研 identity.theme | `hermes -p research` |

三者 skills 均 **symlink 共享 `~/.agents/skills`**(用户已定),不各自拷贝。

---

## 2. 前置检查 / 安全

- [ ] **任务在非沙箱终端执行**(需 `hermes` CLI、读 secret、起 gateway、`ps` 测内存;sandbox 全拦)
- [ ] 备份:`hermes profile export watch-dog`(留一份已知能跑的模板归档);备份 `~/.agents/channels/feishu.yaml`
- [ ] 取三个 app 的 **app_secret 明文**:从 `~/.agents/channels/feishu.yaml` 读(secret 在 `openclaw.agents.<id>.appSecret`,32 位)
- [ ] 确认三件套飞书 app 的**连接模式**:OpenClaw 用 websocket 长连;Hermes watch-dog `platforms.feishu.extra.connection_mode: websocket` 同款 → 直接沿用。**注意:同一个 app 的 websocket 长连同一时刻只能被一个进程持有**,所以迁移某 agent 时,必须先停 OpenClaw 对该 app 的占用,否则两边抢连接

---

## 3. 步骤(三件套逐个迁,先迁一个验证通过再批量)

### Step 0 — 先迁「小记」做试点(全流程跑通再复制到办办/深研)

### Step 1 — clone 模板建 profile
- [ ] `hermes profile create personal --clone-from watch-dog --description "个人事务:logseq笔记/想法/todo/计划/个人查询/图音视频生成"`
  - `--clone-from watch-dog`:复制 config.yaml/.env/SOUL/skills,拿到已验证能跑的骨架
- [ ] 确认生成 `~/.hermes/profiles/personal/` 且 alias `personal → hermes -p personal`

### Step 2 — 换飞书 app 凭证(接管小记机器人)
- [ ] 编辑 `~/.hermes/profiles/personal/config.yaml`,把 `platforms.feishu` 段的 `app_id`/`app_secret`(含 `extra.app_id`/`extra.app_secret`)改成小记的 `cli_a9720c5409f85cc4` + 其 secret
- [ ] 同步改 profile 的 `.env` 里飞书相关 env(若 watch-dog 模板把凭证放 .env)
- [ ] `home_channel` 改成小记常用的对话/群(或留空让其自动学习 channel_directory)

### Step 3 — 写人格 SOUL
- [ ] 把小记的 `identity.theme`(温暖细心的私人助理 + logseq 沉淀职责 + 意图识别)写进 `~/.hermes/profiles/personal/SOUL.md`
- [ ] theme 原文从 `openclaw.json` 取:
  ```bash
  python3 -c "import json;d=json.load(open('/Users/bytedance/.openclaw/openclaw.json'));print([a['identity']['theme'] for a in d['agents']['list'] if a.get('id')=='personal-agent'][0])"
  ```

### Step 4 — skills 共享 symlink
- [ ] 确认 `~/.hermes/profiles/personal/skills` 指向(或 symlink 到)`~/.agents/skills`;若 clone 拷了实体,删掉换 symlink:`ln -sfn ~/.agents/skills ~/.hermes/profiles/personal/skills`
- [ ] (注意:`--clone` 默认带 skills,共享需手动改 symlink;或建时用 `--no-skills` 再手动 link)

### Step 5 — 停 OpenClaw 对小记 app 的占用,启 profile
- [ ] **先**停 OpenClaw(至少停它对小记 app 的 websocket):整体停 OpenClaw gateway 最稳
- [ ] 启:`hermes -p personal`(或 alias `personal`),确认 `hermes profile show personal` → Gateway running
- [ ] `ps` 测该 gateway 内存(非沙箱),记录单进程开销 × 3 的总成本

### Step 6 — 验证(必须真实执行,截图)
- [ ] 飞书里找到**小记机器人**(原来的联系人,不是 Hermes 主机器人),发一条"帮我记一下:xxx 想法"
- [ ] 确认:① 是小记机器人回的(不是 Hermes 主) ② 回复风格符合小记人格 ③ logseq skill 可触发
- [ ] 截图保存,绝对路径写进完成报告
- [ ] e2e 通过 → **复制 Step1-6 到办办(work / `cli_a9720c6c3ff81cb5`)、深研(research / `cli_a9720c867bb8dcba`)**

---

## 4. 收尾 — 删除 OpenClaw(仅在三件套全绿后)

- [ ] 三个 profile 全部 `Gateway running` + 飞书 e2e 截图齐全
- [ ] 停 OpenClaw 常驻:确认 `~/.openclaw/disable-launchagent` 生效 / `pm2 delete openclaw`(若用 pm2)
- [ ] **归档而非裸删**:`tar czf ~/openclaw-final-$(date +%Y%m%d).tar.gz -C ~ .openclaw`(含 credentials/identity/devices secrets,归档包权限 600 或存安全位置)后再删 `~/.openclaw`
- [ ] 退役 agent 的飞书 app(main/claude/codex/cursor/agency)——飞书开放平台后台手动处理,本计划只提示不代操作
- [ ] `~/.agents/channels/feishu.yaml` 里 `openclaw.agents.*` 段可保留作凭证存档(三件套已被 Hermes profile 接管,但记录留着无害)

---

## 5. 不做 / 边界

- 不迁 sessions 历史(运行数据,Hermes schema 不同)
- 不迁 CLI 派发壳(克劳/小码/光标/团长)——Hermes 有 delegation/codex_runtime,派发能力原生具备
- 不走路线 A(已否决:personality 不支持自然语言切换)
- 主入口小枢(main)不迁(通用兜底,用 Hermes 主 agent 即可)

---

## 6. 回滚

- profile 回滚:`hermes profile delete personal`(删单个 profile)
- OpenClaw 回滚:§4 归档包 `tar xzf ~/openclaw-final-*.tar.gz -C ~`
- 飞书 app 凭证未改动飞书侧,任何时候可把 app 重新指回 OpenClaw

---

## 7. 开销补测结论(2026-06-14 已在非沙箱终端实测)

| 问题 | 结论 | 证据 |
|---|---|---|
| 单 gateway 内存 | **~34MB RSS** | `--profile watch-dog gateway run` pid=15018 RSS=34MB;default pid=15012 RSS=33MB |
| 3 个常驻总开销 | **~100MB / 48GB = 0.2%,可忽略,三个一起上无压力** | 34×3 |
| 必须常驻? | **是**,`connection_mode: websocket`,进程停=收不到飞书消息 | watch-dog config extra.connection_mode=websocket |
| 能否随用随停 / 后台化 | 可。`hermes gateway {run,start,stop,restart,status,install,uninstall,list}` 齐全;`install` 装 launchd 自启自拉;`--profile X gateway start/stop` 单独控制 | `hermes gateway --help` |
| webhook 按需唤醒 | 有 `hermes webhook` 子命令,但 34MB 常驻成本远低于折腾 webhook,**不做** | — |

**实测踩到的两个坑(已纳入动手步骤):**
1. **OpenClaw gateway 此刻仍活着**(pid 90553, up 57h, openclaw-gateway),正握着三件套 app 的 websocket。迁移每个 agent 前必须先停 OpenClaw 对该 app 的占用(最稳:整体停 openclaw-gateway),否则抢连接。
2. **`--clone-from watch-dog` 会拷 1.0GB 历史**(state.db 139MB)。改用 `--clone-from default`(干净),或 clone 后清 state.db,避免把 watch-dog 的会话历史带进新 profile。
