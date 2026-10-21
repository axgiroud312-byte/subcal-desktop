# SubCal FE-012 组件接入与公共视觉基线说明

状态：公共组件及四页已实际落地并完成真实 Electron 检查（verified），用户验收 pending。完整结果与截图见 [visual-v2/checks.md](../evidence/visual-v2/checks.md)。  
日期：2026-10-20  
关联任务：[FE-012](../issues/FE-012.md)、[视觉基础说明](visual-foundation.md)

---

## 1. CLI / Registry 来源与实际安装版本

### 1.1 官方 CLI 与 Registry 来源记录

- **CLI 工具版本**：`shadcn@4.22.1`（通过 `npx shadcn@4.22.1 init --help`、`view`、`add` 核对）
- **组件风格与基础**：`style: "base-mira"`（shadcn/ui Mira 紧凑风格 + `@base-ui/react` 基础），**零 Radix UI primitives 混用**。
- **`components.json` 关键配置**：
  - `"style": "base-mira"`
  - `"tailwind.css": "src/renderer/styles/base.css"`
  - `"tailwind.baseColor": "zinc"`
  - `"tailwind.cssVariables": true`
  - `"iconLibrary": "lucide"`
  - `"aliases"`: `{"components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks"}`
- **实际拉取命令**：
  ```bash
  npx shadcn@4.22.1 add button input textarea label field badge card separator progress skeleton dialog sheet alert-dialog select popover dropdown-menu tooltip tabs collapsible switch table sonner chart --yes
  ```
- **依赖安装方式**：标准 `npm install`（未使用 `--force` 或 `--legacy-peer-deps`，0 peer dependency 冲突，0 漏洞）。

### 1.2 Lockfile 实际锁定版本核对（React 19 环境）

| 类别 | 包名 | `package.json` 范围 | `package-lock.json` 实际版本 | 用途说明 |
| --- | --- | --- | --- | --- |
| React 基础 | `react` / `react-dom` | `^19.2.0` | `19.3.1` | 渲染核心 |
| 交互 Primitives | `@base-ui/react` | `^1.9.0` | `1.9.0` | Dialog / Sheet / AlertDialog / Select / Popover / DropdownMenu / Tooltip / Tabs / Collapsible / Switch / Progress / Button / Input / Separator |
| 样式引擎 | `tailwindcss` / `@tailwindcss/vite` | `^4.3.3` | `4.3.3` | Tailwind CSS 4 + Vite 插件 |
| 动画 CSS 辅助 | `tw-animate-css` | `^1.4.0` | `1.4.0` | 弹层开合过渡辅助 |
| 变体与类名合并 | `class-variance-authority` / `clsx` / `tailwind-merge` | `^0.7.1` / `^2.1.1` / `^3.7.0` | `0.7.1` / `2.1.1` / `3.7.0` | `cva` 组件变体与 `@/lib/utils` 的 `cn()` |
| 应用图标 | `lucide-react` | `^1.60.0` | `1.60.0` | 统一 16px / 20px、`strokeWidth: 1.75` 应用操作与状态图标 |
| 布局与展开动效 | `motion` | `^14.4.0` | `14.4.0` | SubscriptionCard 的 AnimatePresence / motion.div，读取共享时长/缓动，支持减少动效 |
| 拖拽排序 | `@dnd-kit/core` / `@dnd-kit/sortable` / `@dnd-kit/utilities` | `^6.3.1` / `^10.0.0` / `^3.2.2` | `6.3.1` / `10.0.0` / `3.2.2` | OverviewPage 与 SubscriptionCard 的真实指针/键盘排序、取消及持久化 |
| 统计图表 | `recharts` | `^3.8.0` | `3.8.0` | 配合 `@/components/ui/chart` 提供主题化统计图与预览工具示例 |
| 通知反馈 | `sonner` | `^2.0.8` | `2.0.8` | 统一通知气泡 `@/components/ui/sonner` |

---

## 2. Design Tokens 与对比度核对

### 2.1 单一数值来源：`src/renderer/styles/tokens.css` & `base.css`

- **排版与字重**：
  - 根字号：`--font-size-root: 16px`（`html`），正文默认 `--font-size-sm: 0.875rem`（`14px / 20px`）。
  - 控件与标签：`--font-size-control: 0.8125rem`（`13px / 18px`），辅助说明：`--font-size-xs: 0.75rem`（`12px / 18px`），主要余额/页面标题：`18px / 26px`，页面汇总：`24px / 30px`。
  - 字重仅使用 `400` / `500` / `600`（`--font-weight-bold` 也显式映射为 `600`，防止出现默认 `700` 粗体）。
- **尺寸、间距与圆角**：
  - 间距比例：`2 / 4 / 8 / 12 / 16 / 20 / 24 / 32px`（`--space-0-5` 至 `--space-8`）。
  - 页面内边距：`--page-padding: 1.5rem`（24px），窄窗口 `--page-padding-compact: 1rem`（16px）。
   - 控件高度：常规及紧凑均为 32px（紧凑只缩横向留白），宽松 `--control-height-lg: 2.25rem`（36px）。所有独立图标按钮至少 32×32px；不沿用 registry 的 24/28px 点击区。
  - 圆角映射：`--radius-sm: 6px`、`--radius-md: 8px`（控件）、`--radius-lg: 12px`（卡片）、`--radius-xl: 16px`（弹窗）。
  - 浮层层级：`--z-content: 1`、`--z-sticky: 20`、`--z-overlay: 40`、`--z-dialog: 50`、`--z-popover: 60`、`--z-tooltip: 70`、`--z-toast: 80`（确保 Dialog/Sheet 内的 Select/Popover/Tooltip 永不被遮挡）。
- **`--muted` 与 `--muted-foreground` 职责区分**：
  - `--muted` 是**控件与次级区域底色**（浅色 `#F0F0F3` / 深色 `#2C2C31`）。
  - `--muted-foreground` 是**辅助文字颜色**（浅色 `#686873` / 深色 `#A1A1AA`）。
   - 迁移结束后已移除旧颜色别名、旧全局控件桥和无引用共享 `calendar-connections.css`；页面与 body Portal 共用 html 根 Token。

### 2.2 按 Token 颜色值计算的背景组合（实际 DOM 核对另记录）

| 文本或边界 Token | 背景 Token | 浅色组合 | 浅色对比度 | 深色组合 | 深色对比度 | 目标要求 |
| --- | --- | --- | --- | --- | --- | --- |
| `--foreground` | `--background` | `#202025` / `#F5F5F7` | **14.90 : 1** | `#F4F4F5` / `#18181B` | **16.12 : 1** | ≥ 4.5 : 1 |
| `--foreground` | `--card` | `#202025` / `#FFFFFF` | **16.22 : 1** | `#F4F4F5` / `#222226` | **14.42 : 1** | ≥ 4.5 : 1 |
| `--secondary-foreground` | `--secondary` (`--muted`) | `#52525B` / `#F0F0F3` | **6.80 : 1** | `#D4D4D8` / `#2C2C31` | **9.40 : 1** | ≥ 4.5 : 1 |
| `--muted-foreground` | `--card` | `#686873` / `#FFFFFF` | **5.50 : 1** | `#A1A1AA` / `#222226` | **6.18 : 1** | ≥ 4.5 : 1 |
| `--muted-foreground` | `--background` | `#686873` / `#F5F5F7` | **5.05 : 1** | `#A1A1AA` / `#18181B` | **6.91 : 1** | ≥ 4.5 : 1 |
| `--muted-foreground` | `--muted` | `#686873` / `#F0F0F3` | **4.84 : 1** | `#A1A1AA` / `#2C2C31` | **5.42 : 1** | ≥ 4.5 : 1 |
| `--primary-foreground` | `--primary` | `#FFFFFF` / `#4F46E5` | **6.29 : 1** | `#18181B` / `#818CF8` | **5.94 : 1** | ≥ 4.5 : 1 |
| `--success` | `--success-soft` | `#166534` / `#F0FDF4` | **6.81 : 1** | `#86EFAC` / `#173124` | **9.96 : 1** | ≥ 4.5 : 1 |
| `--warning` | `--warning-soft` | `#9A3412` / `#FFF7ED` | **6.88 : 1** | `#FDBA74` / `#382718` | **8.46 : 1** | ≥ 4.5 : 1 |
| `--destructive` | `--destructive-soft` | `#B91C1C` / `#FEF2F2` | **5.91 : 1** | `#FCA5A5` / `#3A1D23` | **8.02 : 1** | ≥ 4.5 : 1 |
| `--input`（输入边界） | `--card` | `#8A8A94` / `#FFFFFF` | **3.42 : 1** | `#71717A` / `#222226` | **3.28 : 1** | ≥ 3.0 : 1 |
| `--input`（输入边界） | `--background` | `#8A8A94` / `#F5F5F7` | **3.14 : 1** | `#71717A` / `#18181B` | **3.67 : 1** | ≥ 3.0 : 1 |
| `--ring`（焦点环） | `--background` | `#4F46E5` / `#F5F5F7` | **5.77 : 1** | `#A5B4FC` / `#18181B` | **8.89 : 1** | ≥ 3.0 : 1 |

---

## 3. 公共组件 API 与页面引用约定

> **重要导入约定**：  
> `src/renderer/components/ui/` 目录下**不设 `index.ts`**，以保证现有业务代码中 `from './components/ui'` / `from '../components/ui'` 继续无歧义地解析到业务辅助模块 `src/renderer/components/ui.tsx`。  
> 所有新增公共 UI 组件均通过别名路径 `@/components/ui/<name>` 导入。

| 组件模块路径 | 导出组件 / 函数 | 关键 Props 与使用说明 |
| --- | --- | --- |
| `@/components/ui/button` | `Button`, `buttonVariants` | `variant`: `'default' \| 'outline' \| 'secondary' \| 'ghost' \| 'destructive' \| 'link'`；`default/sm/xs` 高 32px，区别为留白；`lg` 高 36px；所有 `icon*` 点击区至少 32px |
| `@/components/ui/input` | `Input` | 标准 `<input>` 属性，默认 32px 高（`h-8`），支持 `aria-invalid="true"` 错误环 |
| `@/components/ui/textarea` | `Textarea` | 标准 `<textarea>` 属性，支持 `aria-invalid="true"` |
| `@/components/ui/label` | `Label` | 13px/18px、`font-medium` (500) 字段标签 |
| `@/components/ui/field` | `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldLegend`, `FieldSeparator`, `FieldSet`, `FieldContent`, `FieldTitle` | 表单字段组合容器；`Field` 支持 `orientation="vertical" \| "horizontal" \| "responsive"` 及 `data-invalid="true"` |
| `@/components/ui/badge` | `Badge`, `badgeVariants` | `variant`: `'default' \| 'secondary' \| 'outline' \| 'success' \| 'warning' \| 'destructive' \| 'ghost' \| 'link'` |
| `@/components/ui/card` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter` | `size`: `'default'` (16px 内边距) \| `'sm'` (12px 紧凑内边距)；`rounded-lg` (12px)，1px 边框，无阴影 |
| `@/components/ui/separator` | `Separator` | `orientation`: `'horizontal' \| 'vertical'` |
| `@/components/ui/progress` | `Progress`, `ProgressTrack`, `ProgressIndicator`, `ProgressLabel`, `ProgressValue` | `value`: `0..100`；扩展 `tone`: `'default' \| 'warning' \| 'destructive' \| 'muted'` 供额度条语义映射 |
| `@/components/ui/skeleton` | `Skeleton` | 加载占位块 |
| `@/components/ui/dialog` | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`, `DialogPortal`, `DialogOverlay` | 基于 `@base-ui/react/dialog`，默认最大宽 `560px`（`--dialog-max-width`），`rounded-xl` (16px)。Trigger 同时支持 `render={<Button />}` 与 `asChild` |
| `@/components/ui/sheet` | `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`, `SheetClose`, `SheetPortal`, `SheetOverlay` | 抽屉容器，`side`: `'right' \| 'left' \| 'top' \| 'bottom'`，右侧/左侧默认最大宽 `460px`（`--sheet-max-width`） |
| `@/components/ui/alert-dialog` | `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogMedia`, `AlertDialogPortal`, `AlertDialogOverlay` | 受控确认弹窗（如放弃未保存修改、危险删除） |
| `@/components/ui/select` | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton` | 基于 `@base-ui/react/select`。自动收集 `<SelectItem value="...">标签</SelectItem>` 映射，Portal 位于 `z-60`（高于 Dialog `z-50`）；`onValueChange` 直接回调非空 `value` |
| `@/components/ui/popover` | `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverHeader`, `PopoverTitle`, `PopoverDescription` | 轻量说明浮层，Portal 位于 `z-60` |
| `@/components/ui/dropdown-menu` | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuLabel`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent`, `DropdownMenuPortal` | 操作菜单，Portal 位于 `z-60`；`DropdownMenuItem` 支持 `variant="default" \| "destructive"` |
| `@/components/ui/tooltip` | `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent` | 辅助悬停/焦点提示，Portal 位于 `z-70` |
| `@/components/ui/tabs` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `tabsListVariants` | 分段标签页，`TabsList` 支持 `variant="default" \| "line"` |
| `@/components/ui/collapsible` | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` | 折叠面板基础 |
| `@/components/ui/switch` | `Switch` | 开关控件，`checked` / `onCheckedChange`，支持 `size="default" \| "sm"` |
| `@/components/ui/table` | `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption` | 自带横向滚动容器的紧凑数据表格（供 FE-015 使用） |
| `@/components/ui/sonner` | `Toaster`, `toast` | 通知气泡组件，自动监听 `<html>` 深浅色变化，位于 `z-80` |
| `@/components/ui/chart` | `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartStyle`, `type ChartConfig` | Recharts 3 统计图容器，支持浅色與 `.dark` / `[data-theme="dark"]` 主题序列色 |
| `@/lib/utils` | `cn`, `syncDocumentTheme`, `getActiveTheme`, `resolveTriggerRender`, `LUCIDE_ICON_SM`, `LUCIDE_ICON_MD` | 类名合并、根节点主题同步桥接、Lucide 标准图标参数（16px/20px, strokeWidth 1.75） |
| `@/lib/motion` | `MOTION_DURATION_FAST`, `MOTION_DURATION_NORMAL`, `MOTION_EASE_STANDARD`, `isReducedMotionActive`, `getMotionTransition`, `getSortableTransition`, `DND_POINTER_ACTIVATION_CONSTRAINT` | Motion 与 dnd-kit 共用 CSS 时长/缓动；应用或系统减少动效时即时完成 |
| `@/components/ComponentPreview` | `ComponentPreview` | 预览工具内嵌的真实组件与 Recharts 3 示例面板（显式标记“组件示例 · 非实际消费”并含切换空数据按钮） |

---

## 4. 已完成的主代理整合

- `main.tsx` 首先导入 `base.css`，再导入 layered `styles.css`；旧全局布局已替换为领域助手，FE-018 已移除迁移桥与无消费者的旧变量。
- App 的现有偏好是唯一主题来源：layout effect 调用 `syncDocumentTheme`，Token 仅定义于 html 根节点。移除临时自动 `.app` observer，不在应用内容区再定义一份同名颜色；因此 body Portal 和内容区共享同一个可修改 Token。
- `PreviewTools.tsx` 用真实 Collapsible 默认收起，包含 FormSelect 十二场景、时钟、重置 AlertDialog 与 `ComponentPreview`。没有独立组件站点。
- 业务 `ui.tsx` 的 Modal/StatusBadge/QuotaMeter 实际使用 Sheet/Dialog、Badge variants、Progress；FormSelect 在 `components/form-controls.tsx` 适配旧事件形状，但渲染、键盘、焦点、Portal 由 Base UI 处理，不复制业务规则。BrandIcon 只内联已审查本地 SVG，来源见 [assets.md](../assets.md)。
- Motion helper 从 CSS `--duration-fast/normal` 读取运行值，同时尊重系统与应用减少动效；CSS/Tailwind 间距共用 `--space-1` 基准，控件统一 `text-control` 与高度 Token。独立图标点击区收敛到 32px。
- Sonner 共用 Notify，单一 Toast id，保留真实 8 秒撤销。无模态窗口时显示左下 Toast；模态窗口内同一事件显示在顶层 Modal 的正常流通知区，隐藏全局 Toast，避免盖住保存或冲突操作。不新建第二个通知来源。
- `cn()` 注册 `text-control` 为字号类型，避免 tailwind-merge 把它误作颜色删除；Tabs 显式映射方向状态；FieldError 真正渲染错误内容。它们均已通过真实界面检查，而非只依赖 TypeScript。

实际 Electron 基础检查：`node scripts/desktop-check.mjs --foundation-only`，两主题嵌套 Select、子菜单 Escape、焦点返回、Chart Tooltip/Legend/空状态/窄宽度及修改根圆角传播通过；阶段记录见 [foundation-check.json](../evidence/visual-v2/foundation-check.json)。整体 `npm run test:desktop` **16 分组通过**，最终测量与局部修正复查见 [检查记录](../evidence/visual-v2/checks.md)。用户验收仍 pending。

## 5. 实际使用位置与怎么操作

| 能力 | 实际导入 / 使用文件 | 在桌面怎么试 |
| --- | --- | --- |
| Mira / Base UI | `components/ui/*`；App、四页、DetailDrawer、SubscriptionForm、Settings、SyncPreview | 切四页；打开详情/编辑/设置；Dialog 内打开下拉并按 Escape；列表每行“更多操作” |
| Tailwind 4 + Tokens | `vite.config.ts`、`styles/base.css`、`styles/tokens.css`、`main.tsx`、`lib/utils.ts` | 切换深浅色/密度；组件检查实际修改根 `--radius-md`，按钮、输入、Select 一起变化 |
| Motion 14.4.0 | `components/SubscriptionCard.tsx` 的 `AnimatePresence` / `motion.div`；`lib/motion.ts` | 切“多账号与独立共享关系”，逐个或批量展开；设置“减少动态效果”后即时开合 |
| dnd-kit 6.3.1 / Sortable 10.0.0 | `pages/OverviewPage.tsx` 的 DndContext、Sensors、SortableContext；SubscriptionCard 的 useSortable | 自定义顺序下拖左上手柄；或空格、方向键、空格；Esc 取消；重开后顺序保留 |
| shadcn Chart + Recharts 3.8.0 | `components/ui/chart.tsx`；`components/ComponentPreview.tsx` 的 ChartContainer、ChartTooltip / Content、ChartLegend / Content、BarChart | 底部“预览工具”中查看“组件示例 · 非实际消费”；悬停柱形、查看图例、切空数据；两主题均可操作 |
| Lucide 1.60.0 / 本地 Logo | App、页面及业务组件按需导入；ui.tsx 的 BrandIcon 内联固定本地 SVG | 导航/刷新/排序/设置图标；品牌与操作图标不混用，未收录品牌用文字后备 |

业务月历保留事件投影与日期规则，未安装无必要的日期选择库。图表固定尺寸/业务网格断点属于各视图几何约束，不是第二套颜色/字号；shadcn Chart 中的 `#ccc` / `#fff` 是匹配 Recharts 默认 SVG 的兼容选择器，输出使用语义 Token。其余新界面颜色集中于 tokens.css，本地 SVG 是独立品牌素材例外。
