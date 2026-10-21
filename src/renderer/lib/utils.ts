import * as React from "react"
import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// `text-control` is a font-size token, not a text color. Register it so merging
// a foreground color never silently removes the 13px control typography.
const mergeClasses = extendTailwindMerge({ extend: { theme: { text: ["control"] } } })

export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs))
}

/**
 * Bridges optional `asChild` prop to Base UI's native `render` prop so components
 * support both `<Trigger render={<Button />}>Label</Trigger>` (Base UI native)
 * and `<Trigger asChild><Button>Label</Button></Trigger>` (shadcn convention).
 */
export function resolveTriggerRender<
  P extends { render?: unknown; children?: React.ReactNode },
>(props: P & { asChild?: boolean }): P {
  const { asChild, children, render, ...rest } = props
  if (asChild && !render && React.isValidElement(children)) {
    const childProps = children.props as { children?: React.ReactNode }
    return {
      ...(rest as unknown as P),
      render: children,
      children: childProps.children,
    }
  }
  return { ...(rest as unknown as P), render, children }
}

export interface DocumentThemeOptions {
  theme: "light" | "dark"
  density?: "comfortable" | "compact"
  reducedMotion?: boolean
}

/**
 * Synchronizes resolved theme, density, and reduced-motion attributes to `document.documentElement` (<html>),
 * ensuring body-mounted Portals (Dialog, Sheet, AlertDialog, Select, Popover, DropdownMenu, Tooltip, Sonner)
 * inherit the exact same Design Tokens as the main application shell.
 */
export function syncDocumentTheme({
  theme,
  density,
  reducedMotion,
}: DocumentThemeOptions): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
  try {
    // First paint of the next launch reads this before React mounts.
    localStorage.setItem("subcal:resolved-theme", theme)
  } catch {
    /* storage can be unavailable; theme still applies for this session */
  }

  if (density !== undefined) {
    root.dataset.density = density
  }
  if (reducedMotion !== undefined) {
    root.dataset.reducedMotion = reducedMotion ? "true" : "false"
  }
}

/**
 * Reads the currently active theme ("light" | "dark") from <html> or `.app`.
 */
export function getActiveTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light"
  const root = document.documentElement
  if (
    root.classList.contains("dark") ||
    root.dataset.theme === "dark"
  ) {
    return "dark"
  }
  const appEl = document.querySelector<HTMLElement>(".app[data-theme]")
  if (appEl?.dataset.theme === "dark") {
    return "dark"
  }
  return "light"
}

/**
 * Standard Lucide icon props per `docs/design/visual-foundation.md` Section 2 & 3.3:
 * 16px (sm) / 20px (md) with strokeWidth 1.75.
 */
export const LUCIDE_ICON_SM = {
  size: 16,
  strokeWidth: 1.75,
} as const

export const LUCIDE_ICON_MD = {
  size: 20,
  strokeWidth: 1.75,
} as const
