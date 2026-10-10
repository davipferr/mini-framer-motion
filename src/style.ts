import type { MotionValue } from './motion-value'

/**
 * Anything you can put in `initial`, `animate` or `exit`. The transform
 * shorthands are composed into a single `transform`; every other key is
 * written to the matching style property (in px unless it's unitless).
 */
export interface Target {
  x?: number
  y?: number
  scale?: number
  scaleX?: number
  scaleY?: number
  /** degrees */
  rotate?: number
  opacity?: number
  [cssProperty: string]: number | undefined
}

export const transformKeys = new Set(['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'])

const unitless = new Set(['opacity', 'zIndex', 'flexGrow', 'flexShrink', 'fontWeight', 'lineHeight'])

const defaults: Record<string, number> = { opacity: 1, scale: 1, scaleX: 1, scaleY: 1 }

export function defaultValue(key: string): number {
  return defaults[key] ?? 0
}

/** The FLIP offset of a `layout` element. Origin is the top-left corner. */
export interface LayoutTransform {
  x: MotionValue
  y: MotionValue
  scaleX: MotionValue
  scaleY: MotionValue
}

export interface StyleInputs {
  values: Map<string, MotionValue>
  /** This element's own FLIP transform, if it has `layout`. */
  layout: LayoutTransform | null
  /** The nearest `layout` ancestor's FLIP transform, whose scale we cancel out. */
  parentLayout: LayoutTransform | null
}

const read = (values: Map<string, MotionValue>, key: string) =>
  values.get(key)?.get() ?? defaultValue(key)

export function buildStyle({ values, layout, parentLayout }: StyleInputs): Record<string, string> {
  const style: Record<string, string> = {}

  let translateX = read(values, 'x')
  let translateY = read(values, 'y')
  const scale = read(values, 'scale')
  let scaleX = scale * read(values, 'scaleX')
  let scaleY = scale * read(values, 'scaleY')
  const rotate = read(values, 'rotate')

  if (layout) {
    translateX += layout.x.get()
    translateY += layout.y.get()
    scaleX *= layout.scaleX.get()
    scaleY *= layout.scaleY.get()
  }

  if (parentLayout) {
    // The parent is drawn at scale (sx, sy) to fake its new size, which squashes
    // us too. Apply the inverse so we end up at 1·(1/1) = our real size.
    scaleX /= parentLayout.scaleX.get() || 1
    scaleY /= parentLayout.scaleY.get() || 1
  }

  const isIdentity =
    translateX === 0 && translateY === 0 && scaleX === 1 && scaleY === 1 && rotate === 0
  const hasTransform = values.has('x') || values.has('y') || values.has('scale') ||
    values.has('scaleX') || values.has('scaleY') || values.has('rotate')

  if (!isIdentity) {
    style.transform =
      `translate3d(${translateX}px, ${translateY}px, 0) ` +
      `scale(${scaleX}, ${scaleY}) rotate(${rotate}deg)`
  } else if (hasTransform || layout || parentLayout) {
    style.transform = 'none'
  }

  if (layout || parentLayout) style.transformOrigin = '0 0'

  for (const [key, value] of values) {
    if (transformKeys.has(key)) continue
    const v = value.get()
    if (key === 'opacity') {
      // Underdamped springs overshoot; opacity outside [0, 1] is meaningless.
      style.opacity = String(Math.min(1, Math.max(0, v)))
    } else {
      style[key] = unitless.has(key) ? String(v) : `${v}px`
    }
  }

  return style
}
