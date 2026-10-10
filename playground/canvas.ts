import { useCallback, useEffect, useRef } from 'react'
import type { LiveSpring } from './physics'

export interface Frame {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  /** Read a CSS custom property, e.g. color('--accent'). Follows light/dark mode. */
  color: (name: string) => string
}

/** Size the backing store for the device pixel ratio and clear it. */
export function prepare(canvas: HTMLCanvasElement): Frame {
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const pixelWidth = Math.round(width * dpr)
  const pixelHeight = Math.round(height * dpr)
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  const css = getComputedStyle(canvas)
  return { ctx, width, height, color: (name) => css.getPropertyValue(name).trim() }
}

/**
 * A canvas that redraws after every render, on resize and on a light/dark
 * switch. Returns the ref plus `redraw` for per-frame updates.
 */
export function useCanvas(draw: (frame: Frame) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw

  const redraw = useCallback(() => {
    const canvas = ref.current
    if (canvas && canvas.clientWidth > 0) drawRef.current(prepare(canvas))
  }, [])

  useEffect(() => redraw())

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const observer = new ResizeObserver(redraw)
    observer.observe(canvas)
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', redraw)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', redraw)
    }
  }, [redraw])

  return { ref, redraw }
}

/** Call `callback` whenever the live experiment changes (every frame while it moves). */
export function useLive(sim: LiveSpring, callback: () => void) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  useEffect(() => sim.subscribe(() => callbackRef.current()), [sim])
}

export function polyline(ctx: CanvasRenderingContext2D, points: Iterable<[number, number]>) {
  ctx.beginPath()
  let first = true
  for (const [x, y] of points) {
    if (first) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
    first = false
  }
  ctx.stroke()
}

export function arrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width = 3,
) {
  const length = Math.hypot(x2 - x1, y2 - y1)
  if (length < 2) return
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = Math.min(10, length * 0.6)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2 - Math.cos(angle) * head * 0.8, y2 - Math.sin(angle) * head * 0.8)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - Math.cos(angle - 0.45) * head, y2 - Math.sin(angle - 0.45) * head)
  ctx.lineTo(x2 - Math.cos(angle + 0.45) * head, y2 - Math.sin(angle + 0.45) * head)
  ctx.closePath()
  ctx.fill()
  ctx.lineCap = 'butt'
}

/** A "nice" grid step (1, 2 or 5 × 10ⁿ) giving roughly `count` divisions of `span`. */
export function niceStep(span: number, count = 5): number {
  const raw = span / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / magnitude
  return (normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10) * magnitude
}

export interface Plot {
  left: number
  top: number
  width: number
  height: number
  x: (value: number) => number
  y: (value: number) => number
}

/** Map data ranges onto a padded plot area. */
export function plotArea(
  frame: Frame,
  xRange: [number, number],
  yRange: [number, number],
  pad = { left: 44, right: 12, top: 12, bottom: 26 },
): Plot {
  const width = frame.width - pad.left - pad.right
  const height = frame.height - pad.top - pad.bottom
  const [x0, x1] = xRange
  const [y0, y1] = yRange
  return {
    left: pad.left,
    top: pad.top,
    width,
    height,
    x: (value) => pad.left + ((value - x0) / (x1 - x0 || 1)) * width,
    y: (value) => pad.top + (1 - (value - y0) / (y1 - y0 || 1)) * height,
  }
}

/** Grid lines with labels along both axes. */
export function grid(
  frame: Frame,
  plot: Plot,
  xRange: [number, number],
  yRange: [number, number],
  format: { x?: (v: number) => string; y?: (v: number) => string } = {},
) {
  const { ctx, color } = frame
  const fx = format.x ?? ((v) => `${+v.toFixed(2)}`)
  const fy = format.y ?? ((v) => `${+v.toFixed(2)}`)
  ctx.lineWidth = 1
  ctx.strokeStyle = color('--grid')
  ctx.fillStyle = color('--muted')

  const xStep = niceStep(xRange[1] - xRange[0], Math.max(2, Math.floor(plot.width / 90)))
  ctx.textAlign = 'center'
  for (const v of ticks(xRange, xStep)) {
    ctx.beginPath()
    ctx.moveTo(plot.x(v), plot.top)
    ctx.lineTo(plot.x(v), plot.top + plot.height)
    ctx.stroke()
    ctx.fillText(fx(v), plot.x(v), plot.top + plot.height + 16)
  }

  const yStep = niceStep(yRange[1] - yRange[0], Math.max(2, Math.floor(plot.height / 50)))
  ctx.textAlign = 'right'
  for (const v of ticks(yRange, yStep)) {
    ctx.beginPath()
    ctx.moveTo(plot.left, plot.y(v))
    ctx.lineTo(plot.left + plot.width, plot.y(v))
    ctx.stroke()
    ctx.fillText(fy(v), plot.left - 6, plot.y(v) + 4)
  }
}

/** Tick values as whole multiples of `step`, so 0.1 + 0.2 never shows up as 0.30000000000000004. */
function ticks([from, to]: [number, number], step: number): number[] {
  const result: number[] = []
  for (let i = Math.ceil(from / step - 1e-9); i * step <= to + 1e-9; i++) {
    result.push(Number((i * step).toPrecision(12)))
  }
  return result
}

export function clip(ctx: CanvasRenderingContext2D, plot: Plot) {
  ctx.beginPath()
  ctx.rect(plot.left, plot.top, plot.width, plot.height)
  ctx.clip()
}

/** Compact number formatting for the equation readouts. */
export function fmt(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits))
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}
