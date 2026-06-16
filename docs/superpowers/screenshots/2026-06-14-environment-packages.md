# Environment packages 端到端 — 截图验证记录(2026-06-14)

本次前端改动经 Playwright 真实浏览器 + dev-login(`MAPLE_DEV_LOGIN=true`)在 localhost:5173 验证,结论:

## 验证通过项

1. **环境编辑表单 + Packages hint**(`EnvironmentDetailView`)
   - 进入"编辑 Python 数据分析"全页表单(`view=environment, edit=true`)。
   - Packages 区显示 3 个 pip 包(pandas==2.2.3 / openpyxl==3.1.5 / matplotlib==3.10.0),各带 manager 下拉 + 包名输入 + 删除 + "添加包"。
   - **新增 hint 正确渲染**:"包会在该环境的会话首次运行时安装,期间显示安装进度;安装失败不会阻断会话。"
   - DOM 断言:`hintVisible=true`、`addPkgBtn=true`、`h1="编辑 Python 数据分析"`。

2. **packages 落库 + 详情展示链路**
   - 经新建环境(Python 数据分析模板)写入 → `GET /v1/environments` 返回 `config.packages=[{manager:"pip",name:"pandas==2.2.3"},…]`,形态正确,正是 `normalizeEnvironmentPackages` 消费、透传进 vefaas sandbox 的数据。
   - 环境详情 drawer "包"区展示 3 个 chip(`pip pandas==2.2.3` 等)。

3. **环境列表删除列**(`EnvironmentsView`):每行垃圾桶按钮渲染正常。

## 验证边界(诚实标注)

- **装包进度面板**(`SessionPackageInstall`)+ **installing_packages 闸门**:依赖 `session.status="installing_packages"` + 真实 `package.install_*` 事件,需 veFaaS AK/SK + 真实 sandbox 装包才能造出。本地无凭证,未截真实运行态。
  - 该组件正确性由以下保证:`bun run typecheck`(props/类型)+ `environment_packages_contract`(数据形态)+ 纯展示逻辑(`aggregate` 无副作用,直白事件聚合)+ css class 就位。
  - 真实端到端(配 `pip cowsay` → session 首跑显示装包进度 → 闸门放行 → `import cowsay` 成功)需在有 veFaaS 凭证的环境验证。

## 复现方式

非沙箱终端:`bun run dev`(API 27951 + web 5173),设 `MAPLE_DEV_LOGIN=true` 后浏览器 POST `/v1/auth/login {provider:"local", email:"local-managed-agent@example.com"}` 取 cookie 登录。
