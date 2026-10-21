import type { Transition } from "motion/react"

/**
 * Shared Motion & dnd-kit tokens and helpers for FE-014 & page transitions
 * Source: docs/design/visual-foundation.md Section 2 & 3.3 (fast 120ms / normal 180ms)
 */
export const MOTION_DURATION_FAST = 0.12
export const MOTION_DURATION_NORMAL = 0.18
export const MOTION_EASE_STANDARD: [number, number, number, number] = [0.2, 0, 0, 1]

function cssMotionToken(name: string): string {
  return typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function isReducedMotionActive(explicitReducedMotion?: boolean): boolean {
  if (explicitReducedMotion === true) return true
  if (typeof document !== "undefined") {
    if (document.documentElement.dataset.reducedMotion === "true") return true
    const appEl = document.querySelector<HTMLElement>(".app[data-reduced-motion]")
    if (appEl?.dataset.reducedMotion === "true") return true
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  }
  return false
}

export function getMotionTransition(
  speed: "fast" | "normal" = "normal",
  reducedMotion?: boolean
): Transition {
  if (isReducedMotionActive(reducedMotion)) {
    return { duration: 0 }
  }
  const token = cssMotionToken(`--duration-${speed}`)
  const parsed = Number.parseFloat(token)
  const duration = Number.isFinite(parsed) ? parsed / (token.endsWith("ms") ? 1000 : 1) : speed === "fast" ? MOTION_DURATION_FAST : MOTION_DURATION_NORMAL
  const curve = cssMotionToken('--ease-standard').match(/^cubic-bezier\(([^)]+)\)$/)?.[1].split(',').map(Number)
  const ease = curve?.length === 4 && curve.every(Number.isFinite) ? curve as [number, number, number, number] : MOTION_EASE_STANDARD
  return {
    duration,
    ease,
  }
}

export function getSortableTransition(reducedMotion?: boolean) {
  if (isReducedMotionActive(reducedMotion)) return null
  return { duration: (getMotionTransition('normal').duration ?? MOTION_DURATION_NORMAL) * 1000, easing: cssMotionToken('--ease-standard') || 'cubic-bezier(0.2, 0, 0, 1)' }
}

/**
 * Standard pointer activation constraint for dnd-kit sortable cards in FE-014
 * Prevents accidental drag when clicking buttons or links inside a card.
 */
export const DND_POINTER_ACTIVATION_CONSTRAINT = {
  distance: 6,
} as const
