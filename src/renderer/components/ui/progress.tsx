import * as React from "react"
import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "@/lib/utils"

const indicatorToneClasses = {
  default: "bg-primary",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/45",
} as const

function Progress({
  className,
  children,
  value,
  tone = "default",
  indicatorClassName,
  trackClassName,
  ...props
}: ProgressPrimitive.Root.Props & {
  tone?: keyof typeof indicatorToneClasses
  indicatorClassName?: string
  trackClassName?: string
}) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      data-tone={tone}
      className={cn("flex w-full flex-wrap items-center gap-2", className)}
      {...props}
    >
      {children}
      <ProgressTrack className={trackClassName}>
        <ProgressIndicator
          className={cn(indicatorToneClasses[tone], indicatorClassName)}
        />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        "relative flex h-1.5 w-full items-center overflow-hidden rounded-full bg-muted",
        className
      )}
      data-slot="progress-track"
      {...props}
    />
  )
}

function ProgressIndicator({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn(
        "h-full rounded-full bg-primary transition-all duration-(--duration-normal)",
        className
      )}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn("text-xs font-medium text-foreground", className)}
      data-slot="progress-label"
      {...props}
    />
  )
}

function ProgressValue({
  className,
  children,
  ...props
}: Omit<ProgressPrimitive.Value.Props, "children"> & {
  children?:
    | React.ReactNode
    | ((formattedValue: string | null, value: number | null) => React.ReactNode)
}) {
  return (
    <ProgressPrimitive.Value
      className={cn(
        "ml-auto text-xs font-semibold text-foreground tabular-nums",
        className
      )}
      data-slot="progress-value"
      {...props}
    >
      {typeof children === "function"
        ? children
        : children !== undefined
          ? () => children
          : undefined}
    </ProgressPrimitive.Value>
  )
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
}
