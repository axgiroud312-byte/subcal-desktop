import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn, resolveTriggerRender } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-clip-padding text-control font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform] duration-(--duration-fast) outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        tactile:
          "rounded-(--sc-radius) border-2 border-(--sc-accent-edge) bg-primary font-extrabold text-primary-foreground shadow-[0_4px_0_var(--sc-accent-edge)] hover:bg-(--sc-accent-hover) active:translate-y-[3px] active:shadow-[0_1px_0_var(--sc-accent-edge)]",
        "tactile-soft":
          "rounded-(--sc-radius) border-2 border-(--sc-border) bg-card font-extrabold text-(--sc-fg-2) shadow-[0_3px_0_var(--sc-border-soft)] hover:bg-(--sc-neutral-soft) active:translate-y-[2px] active:shadow-none",
        outline:
          "border-border bg-card text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "bg-transparent text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive focus-visible:ring-destructive/30",
        link: "border-transparent bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-(--control-height) gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-4",
        xs: "h-(--control-height-sm) gap-1 rounded-sm px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-4",
        sm: "h-(--control-height-sm) gap-1 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-(--control-height-lg) gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-(--control-height) p-0 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-(--control-height) rounded-sm p-0 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-(--control-height) p-0 [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-(--control-height-lg) p-0 [&_svg:not([class*='size-'])]:size-5",
        tactile: "h-12 gap-2 px-5 text-base font-extrabold",
        "tactile-sm": "h-9 gap-1.5 px-3.5 text-sm font-extrabold",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const resolvedProps = resolveTriggerRender(props)
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...resolvedProps}
    />
  )
}

export { Button, buttonVariants }
