# 应用内 Claude / Grok CLI 登录

## 接入契约

`src/main/login/cli-login.ts` 导出 `CLI_LOGIN_PROVIDERS` 与 `createCliLogin(providerId, options)`。主进程后台启动官方 CLI，用户只点击应用按钮、完成浏览器授权，不需要打开终端登录。未安装返回 `CliLoginError.code = RUNTIME_MISSING`，不会下载软件。

- Claude：`claude auth login --claudeai`，独立 `CLAUDE_CONFIG_DIR`，通过临时 `BROWSER` 捕获浏览器 URL；优先带 loopback `redirect_uri` 的真实浏览器地址。等待 3 秒再采用 stdout 的 paste 地址。
- Grok：`grok login --device-auth`，独立 `GROK_HOME`；清除 `GROK_AUTH_PATH`、auth-provider-command 等继承覆盖项。识别设备页面及 `ABCD-EFGH` 形式用户码。
- `poll()` 只有在 CLI 成功退出并留下有效凭据后返回 `AccountCredential`；有 URL、已写文件、CLI 输出“成功”都不单独视为完成。
- Claude paste 回退返回 `CliLoginFlow.submit(code)`。**父任务需给共享 `LoginFlow` 增加可选 submit，并接入 UI 输入框及 IPC**；本模块只新增文件，不修改 shared/service/main。IPC 只传授权码，不传 CLI 路径、环境、测试注入对象。令牌仅留 main，禁止把 `poll()` 的 credential 直接发送 renderer。
- 返回 `management: 'static'`，Claude `source: 'claude'`，Grok `source: 'grok-build'`，与现有 adapter/service 静态凭据通路匹配。不保留刷新令牌、不声称自动续期；访问令牌过期后通过同一应用按钮重新登录。Claude 没有稳定身份声明时使用令牌指纹。

## 生命周期及隔离

每次使用随机临时目录，POSIX 目录仅当前用户可访问；删除继承的 Claude/Anthropic/Grok 身份覆盖。不会读写用户默认 CLI 登录目录。凭据从本次 Claude `.credentials.json` 的 `claudeAiOauth` 或 Grok `auth.json` 的 keyed entry 读取。macOS 先读取 `Claude Code-credentials-<SHA256(NFC(configDir))[0:8]>` 系统钥匙串条目，成功后删除该独立条目；没有条目才回退文件。

取消、AbortSignal、十分钟过期、启动/授权失败均停止进程并清理目录；成功复制静态令牌后也清理。POSIX 使用独立进程组，Windows 使用隐藏 `taskkill /T /F`。清理系统钥匙串及文件为尽力执行（系统拒绝访问时不能保证删除）。错误消息固定且不携带 CLI 原始输出、令牌或授权 URL。

## 平台与版本限制

- Windows 发现原生 `claude.exe` / `grok.exe`，使用 `windowsHide: true`。不通过 cmd shell 执行登录命令，不支持仅安装 npm `.cmd` shim 或仅 WSL 安装的环境；这类情况提示安装官方运行组件，不要求终端登录。
- Windows 的 BROWSER helper 是临时 `.cmd` + 非交互 PowerShell，仅捕获 URL。某些 CLI/open-library 版本可能不执行 BROWSER；Claude 会明确回退到应用内授权码输入，不伪造自动回调。此路径尚未用真实 CLI/浏览器完成端到端授权。
- Grok Windows/macOS 可能由 CLI 自己使用 ShellExecute/NSWorkspace 打开系统浏览器，BROWSER 无法禁止；instructions 提示页面可能已打开，UI 应避免自动重复打开。Linux 的 helper 可截获打开请求。
- macOS 使用系统 `security` 访问仅此次登录的独立钥匙串项。Linux/Windows 读取官方 CLI 的文件凭据；不猜测未知系统存储格式。
- Grok 仅接受官方安装目录（`GROK_BIN_DIR`、GROK_HOME/bin、~/.grok/bin）或真实路径位于 `.grok` 的 PATH 程序，避免把其他同名软件当作 Grok Build。
- 授权地址限定已知官方 HTTPS 主机，未来 CLI 更改域名/凭据结构时会失败并提示更新，不猜测协议。

## 依据

协议参考，未复制原项目文件：

1. 固定审查 checkout `C:/Users/niilo/AppData/Local/Temp/opencode/magpie-onboarding-review/internal/provider/claude_signin.go:151`：隔离目录、官方命令、BROWSER 拦截、3 秒 paste 回退；同文件 `claudeCallbackPort` 判断回调能力。
2. 同 checkout `internal/provider/claude_dirs.go:40–80`：独立钥匙串服务名、文件及清理规则。
3. 社区 checkout `C:/Users/niilo/AppData/Local/Temp/opencode/subcal-catalog-plugins/packages/grok/index.mjs:75–150,472–525`：官方程序发现、GROK_HOME/auth.json、环境隔离、`login --device-auth`、平台浏览器限制。

## 验证

`npx tsx --test tests/cli-login.test.ts`：8 项通过。全部使用注入 fake child process、stdout、临时凭据文件或 fake keychain，不启动用户 CLI、不发起真实授权。

覆盖：loopback 优先、paste stdin 提交、完成前凭据不出 main、Grok 分块 stdout/设备码/凭据、取消与无轮询过期、超时错误脱敏、缺失运行组件、独立 macOS 钥匙串读取删除、Windows helper 生成与隐藏 spawn。
