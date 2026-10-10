import { createContext, useMemo, type ReactNode } from 'react'
import type { SpringConfig } from './spring'
import type { LayoutTransform } from './style'

/**
 * FLIP layout animations.
 *
 *   First  – where was the element on screen before this commit?
 *   Last   – where did React's new layout put it? (getBoundingClientRect)
 *   Invert – apply a transform that puts it back where it was
 *   Play   – spring that transform back to identity
 *
 * Only `transform` is animated, never width/height/top/left, so the browser
 * never has to re-run layout during the animation.
 *
 * The "First" box is the box we measured at the end of the previous commit,
 * plus whatever FLIP transform is currently applied. That way an interrupted
 * layout animation starts from where the element *visually* is, and the spring
 * keeps its velocity.
 */

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutNode {
  element: HTMLElement | null
  /** Layout box (no transforms) measured after the last commit, in page coordinates. */
  box: Box | null
  /** 'size' animates position and size; 'position' only animates position. */
  mode: 'size' | 'position'
  transform: LayoutTransform
  transition: Partial<SpringConfig>
  /** Write the element's full style from its current motion values. */
  render(): void
}

export function measure(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect()
  // Page coordinates, so scrolling between two commits isn't mistaken for movement.
  const scrollX = typeof window === 'undefined' ? 0 : window.scrollX
  const scrollY = typeof window === 'undefined' ? 0 : window.scrollY
  return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height }
}

/** Where the element is drawn right now: its layout box with the FLIP transform applied. */
export function visualBox(box: Box, t: LayoutTransform): Box {
  return {
    x: box.x + t.x.get(),
    y: box.y + t.y.get(),
    width: box.width * t.scaleX.get(),
    height: box.height * t.scaleY.get(),
  }
}

/** The transform that makes `last` look like `first` (transform-origin: 0 0). */
export function invert(first: Box, last: Box, mode: 'size' | 'position') {
  return {
    x: first.x - last.x,
    y: first.y - last.y,
    scaleX: mode === 'size' && last.width > 0 ? first.width / last.width : 1,
    scaleY: mode === 'size' && last.height > 0 ? first.height / last.height : 1,
  }
}

const EPSILON = 0.5
const sameBox = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) < EPSILON &&
  Math.abs(a.y - b.y) < EPSILON &&
  Math.abs(a.width - b.width) < EPSILON &&
  Math.abs(a.height - b.height) < EPSILON

/**
 * A set of layout nodes that are measured together. When anything in the group
 * commits, *every* node is re-measured, because one element changing size can
 * move all of its siblings, even ones that didn't re-render.
 */
export class LayoutGroupController {
  private nodes = new Set<LayoutNode>()
  private flippedThisCommit = false

  register(node: LayoutNode): () => void {
    this.nodes.add(node)
    const element = node.element
    if (element) {
      // Measure the layout box, not wherever a transform currently draws it.
      const transform = element.style.transform
      element.style.transform = 'none'
      node.box = measure(element)
      element.style.transform = transform
    }
    return () => {
      this.nodes.delete(node)
      this.didCommit()
    }
  }

  /**
   * Call from useLayoutEffect. All DOM mutations of the commit are done by the
   * time any layout effect runs, so the first call does the work and the rest
   * of the commit's calls are no-ops. The microtask resets the flag before the
   * browser gets a chance to paint.
   */
  didCommit(): void {
    if (this.flippedThisCommit) return
    this.flippedThisCommit = true
    queueMicrotask(() => {
      this.flippedThisCommit = false
    })
    this.flip()
  }

  flip(): void {
    const nodes = [...this.nodes].filter((n) => n.element?.isConnected)

    // First: where is everything drawn right now? (Read before any write.)
    const first = nodes.map((n) => (n.box ? visualBox(n.box, n.transform) : null))

    // Strip FLIP transforms so we measure the real layout, then read all boxes
    // in one go: interleaving reads and writes would force a layout per node.
    for (const n of nodes) n.element!.style.transform = 'none'
    const last = nodes.map((n) => measure(n.element!))

    // Invert + Play.
    nodes.forEach((node, i) => {
      const previous = node.box
      const from = first[i]
      const to = last[i]
      node.box = to

      if (previous && from && !sameBox(previous, to)) {
        const delta = invert(from, to, node.mode)
        const { transform, transition } = node
        for (const key of ['x', 'y', 'scaleX', 'scaleY'] as const) {
          const value = transform[key]
          // keepVelocity: an interrupted layout animation continues smoothly.
          value.set(delta[key], { keepVelocity: true })
          void value.start(key.startsWith('scale') ? 1 : 0, transition)
        }
      }
      node.render()
    })
  }
}

export const globalLayoutGroup = new LayoutGroupController()

export const LayoutGroupContext = createContext<LayoutGroupController>(globalLayoutGroup)

/** The FLIP transform of the nearest `layout` ancestor, for scale correction. */
export const ParentLayoutContext = createContext<LayoutTransform | null>(null)

/** Scope layout measurement to a subtree (e.g. one list among many on a page). */
export function LayoutGroup({ children }: { children: ReactNode }) {
  const controller = useMemo(() => new LayoutGroupController(), [])
  return <LayoutGroupContext.Provider value={controller}>{children}</LayoutGroupContext.Provider>
}
