import * as React from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"
import {
  AlertTriangleIcon,
  BarChart3Icon,
  CheckCircle2Icon,
  LayersIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { LUCIDE_ICON_SM } from "@/lib/utils"

export interface ComponentPreviewProps {
  className?: string
}

const SAMPLE_CHART_DATA = [
  { period: "05月(示例)", subscription: 38, quotaWindow: 24 },
  { period: "06月(示例)", subscription: 42, quotaWindow: 31 },
  { period: "07月(示例)", subscription: 42, quotaWindow: 28 },
  { period: "08月(示例)", subscription: 56, quotaWindow: 39 },
  { period: "09月(示例)", subscription: 48, quotaWindow: 35 },
  { period: "10月(示例)", subscription: 52, quotaWindow: 41 },
] as const

const SAMPLE_CHART_CONFIG = {
  subscription: {
    label: "固定周期指标 (组件示例)",
    color: "var(--chart-1)",
  },
  quotaWindow: {
    label: "滚动窗口指标 (组件示例)",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export function ComponentPreview({ className }: ComponentPreviewProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogCycle, setDialogCycle] = React.useState("monthly")
  const [dialogRule, setDialogRule] = React.useState("end_of_month")
  const [inlineSelectVal, setInlineSelectVal] = React.useState("rolling_5h")
  const [switchChecked, setSwitchChecked] = React.useState(true)
  const [chartEmpty, setChartEmpty] = React.useState(false)
  const [sampleInput, setSampleInput] = React.useState("Claude Pro (示例)")
  const [invalidInput, setInvalidInput] = React.useState("-15")

  const activeChartData = chartEmpty ? [] : [...SAMPLE_CHART_DATA]

  return (
    <TooltipProvider delay={120}>
      <section
        data-slot="component-preview"
        aria-label="FE-012 公共视觉基础与组件基线预览"
        className={`flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-3 text-sm text-foreground ${className ?? ""}`}
      >
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">
              <LayersIcon {...LUCIDE_ICON_SM} />
              Mira + Base UI 组件基线
            </Badge>
            <Badge variant="warning">组件示例 · 非实际消费</Badge>
            <span className="text-xs text-muted-foreground">
              根字号 16px · 正文 14px · 字重 400/500/600 · 控件 32px · 卡片圆角 12px
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="open-preview-dialog-btn"
                  />
                }
              >
                <SlidersHorizontalIcon {...LUCIDE_ICON_SM} />
                Dialog 内嵌 Select 验证
              </DialogTrigger>
              <DialogContent data-testid="preview-dialog-content">
                <DialogHeader>
                  <DialogTitle>弹窗与嵌套 Select 层级验证（组件示例）</DialogTitle>
                  <DialogDescription>
                    验证 Base UI Dialog Portal (z-50) 与 Select Portal (z-60) 主题同步、焦点管理及弹层不遮挡。
                  </DialogDescription>
                </DialogHeader>

                <FieldGroup className="py-1">
                  <Field>
                    <FieldLabel>续费周期策略（Dialog 内 Select）</FieldLabel>
                    <Select
                      value={dialogCycle}
                      onValueChange={(val) => val && setDialogCycle(val)}
                    >
                      <SelectTrigger
                        className="w-full"
                        data-testid="dialog-select-trigger"
                      >
                        <SelectValue placeholder="请选择续费周期" />
                      </SelectTrigger>
                      <SelectContent data-testid="dialog-select-content">
                        <SelectItem value="monthly">按月续费（组件示例）</SelectItem>
                        <SelectItem value="quarterly">按季续费（组件示例）</SelectItem>
                        <SelectItem value="yearly">按年续费（组件示例）</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      展开下拉项时位于 Dialog 之上，深浅色变量与页面一致。
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel>月末推算规则</FieldLabel>
                    <Select
                      value={dialogRule}
                      onValueChange={(val) => val && setDialogRule(val)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="请选择推算规则" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="end_of_month">
                          月末粘性对齐（如 1/31 → 2/28）
                        </SelectItem>
                        <SelectItem value="fixed_day">固定账单日顺延</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>

                <DialogFooter showCloseButton>
                  <Button
                    variant="default"
                    onClick={() => setDialogOpen(false)}
                  >
                    确认示例选择
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Sheet>
              <SheetTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="open-preview-sheet-btn"
                  />
                }
              >
                Sheet 抽屉示例
              </SheetTrigger>
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>详情抽屉容器（组件示例）</SheetTitle>
                  <SheetDescription>
                    右侧滑出抽屉基准宽度 460px，窄窗口自动收缩留出边距。
                  </SheetDescription>
                </SheetHeader>
                <div className="flex flex-col gap-3 p-4 text-xs text-muted-foreground">
                  <p className="text-sm text-foreground">
                    此区域用于验证 Sheet Portal 在浅色与深色模式下的背景、边框与关闭焦点恢复。
                  </p>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span>示例配额进度</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      72%
                    </span>
                  </div>
                  <Progress value={72} />
                </div>
                <SheetFooter>
                  <Button variant="outline" size="sm">
                    示例辅操作
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="open-preview-alert-btn"
                  />
                }
              >
                AlertDialog 确认
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>放弃未保存的示例修改？</AlertDialogTitle>
                  <AlertDialogDescription>
                    此弹窗用于验证受控确认语义（AlertDialog），按下取消可安全返回原表单。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>继续编辑</AlertDialogCancel>
                  <AlertDialogAction variant="destructive">
                    放弃修改（示例）
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <Separator />

        {/* Two-Column Compact Inspection Grid */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Left Column: Controls, States, Inputs, Progress */}
          <Card size="sm">
            <CardHeader>
              <CardTitle>基础控件与交互状态（Mira 紧凑风格）</CardTitle>
              <CardDescription>
                覆盖 default / hover / focus-visible / disabled / loading / error 状态与语义色阶
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {/* Button Variants */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                Button 变体与状态（点击高度均至少 32px）
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="default">
                    <SparklesIcon {...LUCIDE_ICON_SM} />
                    主要操作
                  </Button>
                  <Button variant="outline">次要描边</Button>
                  <Button variant="secondary">中性底色</Button>
                  <Button variant="ghost">轻量幽灵</Button>
                  <Button variant="destructive">危险操作</Button>
                  <Button variant="link">链接按钮</Button>
                  <Button variant="outline" disabled>
                    禁用状态
                  </Button>
                  <Button variant="secondary" disabled>
                    <Loader2Icon {...LUCIDE_ICON_SM} className="animate-spin" />
                    加载中…
                  </Button>
                </div>
              </div>

              {/* Badges & Overlay Triggers */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="default">主徽标</Badge>
                  <Badge variant="secondary">中性示例</Badge>
                  <Badge variant="outline">描边说明</Badge>
                  <Badge variant="success">
                    <CheckCircle2Icon />
                    额度正常
                  </Badge>
                  <Badge variant="warning">
                    <AlertTriangleIcon />
                    旧观察
                  </Badge>
                  <Badge variant="destructive">连接异常</Badge>
                </div>

                <div className="flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger
                      render={<Button variant="outline" size="xs" />}
                    >
                      Tooltip 提示
                    </TooltipTrigger>
                    <TooltipContent>
                      辅助说明：重要状态仍在字段附近可见，不隐藏关键信息。
                    </TooltipContent>
                  </Tooltip>

                  <Popover>
                    <PopoverTrigger
                      render={<Button variant="outline" size="xs" />}
                    >
                      Popover 说明
                    </PopoverTrigger>
                    <PopoverContent>
                      <PopoverHeader>
                        <PopoverTitle>共用付款关系说明（组件示例）</PopoverTitle>
                        <PopoverDescription>
                          多个产品共享同一笔订阅账单时，汇总仅计入主付款卡一次。
                        </PopoverDescription>
                      </PopoverHeader>
                    </PopoverContent>
                  </Popover>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="更多组件示例操作"
                        />
                      }
                    >
                      <MoreHorizontalIcon {...LUCIDE_ICON_SM} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>卡片操作（组件示例）</DropdownMenuLabel>
                        <DropdownMenuItem>
                          <RefreshCwIcon {...LUCIDE_ICON_SM} />
                          模拟刷新此连接
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive">
                          归档示例订阅
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Fields & Inputs (Normal / Error / Select / Switch) */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="preview-input-normal">
                    常规输入字段
                  </FieldLabel>
                  <Input
                    id="preview-input-normal"
                    value={sampleInput}
                    onChange={(e) => setSampleInput(e.target.value)}
                    placeholder="输入产品名称"
                  />
                  <FieldDescription>边界对比度 ≥ 3:1，正文 14px</FieldDescription>
                </Field>

                <Field data-invalid="true">
                  <FieldLabel htmlFor="preview-input-error">
                    错误态输入字段
                  </FieldLabel>
                  <Input
                    id="preview-input-error"
                    value={invalidInput}
                    aria-invalid="true"
                    onChange={(e) => setInvalidInput(e.target.value)}
                  />
                  <FieldError>
                    示例校验提示：配额上限不能为负数
                  </FieldError>
                </Field>
              </div>

              {/* Inline Select + Switch + Progress */}
              <div className="grid grid-cols-1 items-center gap-2.5 sm:grid-cols-2">
                <Field>
                  <FieldLabel>配额窗口类型（Select）</FieldLabel>
                  <Select
                    value={inlineSelectVal}
                    onValueChange={(val) => val && setInlineSelectVal(val)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择窗口类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rolling_5h">
                        5小时滚动窗口（示例）
                      </SelectItem>
                      <SelectItem value="monthly_reset">
                        月度配额重置（示例）
                      </SelectItem>
                      <SelectItem value="wallet_balance">
                        API 钱包余额（示例）
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <div className="flex flex-col gap-2 pt-1">
                  <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
                    <span className="text-xs font-medium text-foreground">
                      到期提醒开关（Switch 示例）
                    </span>
                    <Switch
                      checked={switchChecked}
                      onCheckedChange={setSwitchChecked}
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">骨架屏：</span>
                    <Skeleton className="h-3 flex-1" />
                  </div>
                </div>
              </div>

              {/* Semantic Progress Bars */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Progress value={64} tone="default">
                  <ProgressLabel>常规额度</ProgressLabel>
                  <ProgressValue>64%</ProgressValue>
                </Progress>
                <Progress value={85} tone="warning">
                  <ProgressLabel>接近上限</ProgressLabel>
                  <ProgressValue>85%</ProgressValue>
                </Progress>
                <Progress value={96} tone="destructive">
                  <ProgressLabel>低额度告警</ProgressLabel>
                  <ProgressValue>96%</ProgressValue>
                </Progress>
              </div>
            </CardContent>
          </Card>

          {/* Right Column: Recharts 3 + shadcn Chart Container */}
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <BarChart3Icon {...LUCIDE_ICON_SM} className="text-primary" />
                Recharts 3 统计图表示例
              </CardTitle>
              <CardDescription>
                显式标记：<strong>组件示例 · 非实际消费</strong>（仅用于验证主题序列色、Tooltip、Legend 与空状态）
              </CardDescription>
              <CardAction>
                <Button
                  variant="outline"
                  size="xs"
                  data-testid="toggle-chart-empty-btn"
                  onClick={() => setChartEmpty((prev) => !prev)}
                >
                  {chartEmpty ? "恢复示例数据" : "切换空数据状态"}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground">
                  数据来源声明：<strong>固定组件演示数据（非实际消费历史）</strong>
                </span>
                <span className="font-mono font-medium text-foreground tabular-nums">
                  {chartEmpty ? "0 条记录" : `${activeChartData.length} 个周期点`}
                </span>
              </div>

              {chartEmpty ? (
                <div
                  data-testid="chart-empty-state"
                  className="flex h-[200px] w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 p-4 text-center"
                >
                  <span className="text-sm font-medium text-foreground">
                    当前图表处于空数据状态（组件示例 · 非实际消费）
                  </span>
                  <span className="max-w-sm text-xs text-muted-foreground">
                    此开关仅清空固定示例数据，用于检查空状态；不读取当前订阅或实际消费记录。
                  </span>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => setChartEmpty(false)}
                  >
                    恢复固定示例数据
                  </Button>
                </div>
              ) : (
                <ChartContainer
                  config={SAMPLE_CHART_CONFIG}
                  className="h-[200px] w-full aspect-auto"
                  data-testid="preview-recharts-container"
                >
                  <BarChart
                    accessibilityLayer
                    data={activeChartData}
                    margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="period"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={6}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickMargin={4}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(label) =>
                            `${String(label)} · 组件示例 · 非实际消费`
                          }
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar
                      dataKey="subscription"
                      fill="var(--color-subscription)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={24}
                    />
                    <Bar
                      dataKey="quotaWindow"
                      fill="var(--color-quotaWindow)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={24}
                    />
                  </BarChart>
                </ChartContainer>
              )}

              {/* Compact Tabs verification inside right card */}
              <Tabs defaultValue="tokens" className="pt-1">
                <TabsList>
                  <TabsTrigger value="tokens">Token 映射校验</TabsTrigger>
                  <TabsTrigger value="a11y">对比度与层级</TabsTrigger>
                </TabsList>
                <TabsContent
                  value="tokens"
                  className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground"
                >
                  <code>--muted</code> 为控件浅底色（#F0F0F3 / #2C2C31），
                  <code>--muted-foreground</code> 为辅助文字（#686873 / #A1A1AA），避免底色与文字混用。
                </TabsContent>
                <TabsContent
                  value="a11y"
                  className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground"
                >
                  Portal 继承根节点主题。实际文字、输入边界及焦点对比度记录于 docs/evidence/visual-v2/checks.md。
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </section>
    </TooltipProvider>
  )
}

export default ComponentPreview
