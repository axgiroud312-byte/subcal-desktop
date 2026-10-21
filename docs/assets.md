# SubCal 品牌与图标资源记录

状态：前端预览阶段有效。日期：2026 年 10 月 20 日。

## 原则

- 应用标识为项目自有。视觉重做已接入下表的本地品牌素材，未匹配品牌仍用文字后备，不运行时拉取图标。
- 缺少合法来源的图标一律使用**文字后备**（品牌名称文本），文字后备由渲染层 BrandIcon 组件负责，无第三方权利问题。
- Magpie 图片仅为设计参考，不是运行时资源，不随应用分发。
- 新批次用 lucide-react 统一操作图标；Lucide 不代替供应商品牌标识。具体组件版本和使用点见 `docs/design/component-adoption.md`。

## 第一版资源（保留历史）

| 资源 | 来源 | 许可 / 权利 | 用途 |
| --- | --- | --- | --- |
| SubCal 托盘与窗口图标（靛蓝圆角方块 + 日历图形） | 本仓库运行时代码生成：`src/main/tray-icon.ts`（16/32/48px PNG，仅依赖 Node 内置 zlib，无网络素材） | 项目自有，无第三方素材 | 系统托盘图标、窗口图标 |
| 品牌文字后备 | 渲染层组件以品牌名文本渲染 | 项目自有 | 订阅卡片等品牌位置 |
| `docs/references/magpie-usage-reference.png` | Magpie 应用界面截图，**仅作设计方向参考**，不作为应用资源、不进入构建产物 | 见 `docs/references/Magpie-LICENSE.txt` | 设计参考 |

## 新增第三方素材的规则

1. 确认许可允许本项目使用，记录来源 URL、许可条款与获取日期到本表。
2. 素材保存为本地文件进入仓库，禁止运行时热链。
3. 许可不明或有疑问时，退回文字后备，不得“先用了再说”。

## 本地品牌图标（2026-10-20 接入）

存放：`src/renderer/assets/brands/`。全部为单色 SVG，供渲染层 BrandIcon 内联使用；未匹配品牌继续使用文字后备。

| 文件 | 品牌 | 上游来源（固定版本） | 上游许可 | 商标限制 |
| --- | --- | --- | --- | --- |
| `openai.svg` | OpenAI（含 ChatGPT 产品） | jsDelivr：`@lobehub/icons-static-svg@1.95.1/icons/openai.svg`（仓库 lobehub/lobe-icons） | MIT（包声明） | OpenAI 商标归 OpenAI 所有，仅作产品指示 |
| `codex.svg` | OpenAI Codex | 同上包 `@1.95.1/icons/codex.svg` | MIT（包声明） | 同上 |
| `deepseek.svg` | DeepSeek | `simple-icons/simple-icons@16.35.0/icons/deepseek.svg` | CC0-1.0 | DeepSeek 商标归其公司所有 |
| `kimi.svg` | Kimi | `simple-icons@16.35.0/icons/kimi.svg` | CC0-1.0 | 月之暗面商标 |
| `moonshot.svg` | Moonshot AI（上游 slug `moonshotai`） | `simple-icons@16.35.0/icons/moonshotai.svg` | CC0-1.0 | 月之暗面商标 |
| `openrouter.svg` | OpenRouter | `simple-icons@16.35.0/icons/openrouter.svg` | CC0-1.0 | OpenRouter 商标 |
| `claude.svg` | Claude | `simple-icons@16.35.0/icons/claude.svg` | CC0-1.0 | Anthropic 商标 |
| `anthropic.svg` | Anthropic | `simple-icons@16.35.0/icons/anthropic.svg` | CC0-1.0 | Anthropic 商标 |
| `github-copilot.svg` | GitHub Copilot（上游 slug `githubcopilot`） | `simple-icons@16.35.0/icons/githubcopilot.svg` | CC0-1.0 | GitHub 商标，受 GitHub 标识使用条款约束 |
| `cursor.svg` | Cursor | `simple-icons@16.35.0/icons/cursor.svg` | CC0-1.0 | Cursor（Anysphere）商标 |

来源与许可说明：

- Simple Icons 仓库许可为 [CC0-1.0](https://github.com/simple-icons/simple-icons/blob/16.35.0/LICENSE.md)；该许可只覆盖图标文件的版权贡献，**不覆盖品牌商标**。本次固定版本没有所需的 OpenAI / Codex 文件，因此这两个从 lobehub/icons 获取。
- lobehub/lobe-icons 为 MIT 许可的 AI 品牌图标集（`@lobehub/icons-static-svg` package.json 声明 `license: MIT`）；同样不覆盖各品牌商标。
- OpenAI / Codex 原始文件地址分别为 [openai.svg](https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.95.1/icons/openai.svg)、[codex.svg](https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.95.1/icons/codex.svg)。版权声明随素材保存在 `src/renderer/assets/brands/LOBEHUB-LICENSE.txt`，文本来自上游 [master/LICENSE](https://raw.githubusercontent.com/lobehub/lobe-icons/master/LICENSE) 的 2026-10-20 快照；npm 包固定为 1.95.1，本次未找到同名 Git tag 的许可证文件，不将 master 文本伪称固定 tag 文件。
- Simple Icons 原文件可按 `https://raw.githubusercontent.com/simple-icons/simple-icons/16.35.0/icons/{上游slug}.svg` 核对；如本地 `github-copilot.svg` 对应上游 slug `githubcopilot`，`moonshot.svg` 对应 `moonshotai`。
- 所有商标仅作“该订阅属于该产品”的指示性使用，不修改图形、不暗示官方背书。若任何品牌方提出异议，对应文件退回文字后备。
- 下载日期 2026-10-20；版本固定为 simple-icons `16.35.0`（2026-10-11 发布）、`@lobehub/icons-static-svg@1.95.1`，复核时按同一 URL 重新下载比对。

主题适配约定：

- Simple Icons 文件无 `fill` 属性，BrandIcon **内联**后通过 `.brand-icon svg { fill: currentColor; }` 跟随文字颜色和主题；不以黑色 `<img>` 固定显示。
- lobehub 的 `openai.svg`、`codex.svg` 已带 `fill="currentColor"` 且宽高 `1em`，内联后同样跟随文字颜色。
- 统一按 `viewBox="0 0 24 24"` 渲染，显示尺寸遵循 16/20px 图标约定。

ChatGPT Plus 卡本次使用所属 OpenAI 品牌的 `openai.svg`；不声称本地文件是单独取得的 ChatGPT 产品标识。

实际匹配规则（`src/renderer/components/ui.tsx` 的 BrandIcon，按 `brand`/`product` 小写包含匹配，顺序优先）：

1. product 含 `codex` → `codex.svg`
2. product 含 `github copilot` 或 `copilot` → `github-copilot.svg`
3. product 含 `claude` → `claude.svg`；brand 为 `Anthropic` 的其他产品 → `anthropic.svg`
4. brand/product 含 `kimi` → `kimi.svg`；含 `moonshot` → `moonshot.svg`
5. 含 `deepseek` → `deepseek.svg`；含 `openrouter` → `openrouter.svg`；含 `cursor` → `cursor.svg`
6. brand 为 `OpenAI` 的其余产品（ChatGPT Plus、OpenAI API 等）→ `openai.svg`
7. 手动/其他 → 文字后备，不留空。
