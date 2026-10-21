"use client"

import * as React from "react"
import { Toaster as Sonner, toast, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react"
import { getActiveTheme } from "@/lib/utils"

const Toaster = ({ theme: propTheme, ...props }: ToasterProps) => {
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">(
    () => getActiveTheme()
  )

  React.useEffect(() => {
    if (propTheme && propTheme !== "system") return
    const update = () => setResolvedTheme(getActiveTheme())
    update()

    if (typeof MutationObserver === "undefined") return
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    })
    return () => observer.disconnect()
  }, [propTheme])

  const activeTheme =
    propTheme && propTheme !== "system" ? propTheme : resolvedTheme

  return (
    <Sonner
      theme={activeTheme}
      className="toaster group z-(--z-toast,80)"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-primary" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin text-muted-foreground" />,
        close: <XIcon className="size-4" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-lg)",
          "--width": "min(20rem, calc(100vw - 2rem))",
          zIndex: "var(--z-toast)",
        } as React.CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: "关闭通知",
        style: { background: "var(--popover)", color: "var(--popover-foreground)", borderColor: "var(--border)", borderRadius: "var(--radius-lg)", fontSize: "var(--font-size-sm)" },
        actionButtonStyle: { minHeight: "var(--control-height)", borderRadius: "var(--radius-md)", background: "var(--primary)", color: "var(--primary-foreground)", fontSize: "var(--font-size-control)" },
        classNames: {
          toast:
            "cn-toast border border-border bg-popover text-popover-foreground shadow-(--shadow-popover) text-sm",
          actionButton:
            "bg-primary text-primary-foreground font-medium text-xs px-2.5 py-1 rounded-md",
          cancelButton:
            "bg-muted text-secondary-foreground font-medium text-xs px-2.5 py-1 rounded-md",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
