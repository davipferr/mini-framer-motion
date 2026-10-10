import { onFrame } from 'mini-framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fmt, grid, plotArea, polyline, useCanvas, type Frame } from '../canvas'

/**
 * Two sources each send out circular waves:
 *
 *     yᵢ(point, t) = sin(k·rᵢ − ω·t + φᵢ),   k = 2π/λ,  ω = 2π·f
 *
 * Waves simply add (superposition). Where they arrive in step they reinforce
 * (constructive), where one is up while the other is down they cancel
 * (destructive). Which one happens depends only on the path difference
 * r₁ − r₂ measured in wavelengths, plus any phase offset between the sources.
 */

type Mode = 'wave' | 'intensity'
type Handle = 'a' | 'b' | 'probe'

interface Point {
  x: number
  y: number
}

/** Field resolution: one computed cell per CELL × CELL CSS pixels. */
const CELL = 4
const HISTORY = 2

function parseColor(value: string): [number, number, number] {
  const hex = value.trim().replace('#', '')
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
  }
  const rgb = value.match(/\d+/g)
  return rgb && rgb.length >= 3 ? [Number(rgb[0]), Number(rgb[1]), Number(rgb[2])] : [128, 128, 128]
}

function Slider(props: {
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <label className="slider">
      <span className="slider-label">
        <span>{props.label}</span>
        <output>
          {props.value}
          {props.unit}
        </output>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function Waves() {
  const [wavelength, setWavelength] = useState(48)
  const [frequency, setFrequency] = useState(0.8)
  const [phase, setPhase] = useState(0)
  const [mode, setMode] = useState<Mode>('wave')
  const [twoSources, setTwoSources] = useState(true)
  const [playing, setPlaying] = useState(true)

  const settings = useRef({ wavelength, frequency, phase, mode, twoSources })
  settings.current = { wavelength, frequency, phase, mode, twoSources }

  // Positions as fractions of the canvas so they survive resizing.
  const handles = useRef<Record<Handle, Point>>({
    a: { x: 0.12, y: 0.4 },
    b: { x: 0.12, y: 0.6 },
    probe: { x: 0.75, y: 0.5 },
  })
  const dragging = useRef<Handle | null>(null)
  const time = useRef(0)
  const offscreen = useRef<HTMLCanvasElement | null>(null)
  const panel = useRef<HTMLDListElement>(null)

  /** Distances from both sources to a point, in CSS pixels. */
  const distances = (px: number, py: number, width: number, height: number) => {
    const { a, b } = handles.current
    return {
      r1: Math.hypot(px - a.x * width, py - a.y * height),
      r2: Math.hypot(px - b.x * width, py - b.y * height),
    }
  }

  const drawField = ({ ctx, width, height, color }: Frame) => {
    const { wavelength: lambda, frequency: f, phase: phi, mode: m, twoSources: both } = settings.current
    const k = (2 * Math.PI) / lambda
    const wt = 2 * Math.PI * f * time.current
    const dphi = (phi * Math.PI) / 180
    const cols = Math.ceil(width / CELL)
    const rows = Math.ceil(height / CELL)

    const buffer = (offscreen.current ??= document.createElement('canvas'))
    if (buffer.width !== cols || buffer.height !== rows) {
      buffer.width = cols
      buffer.height = rows
    }
    const bctx = buffer.getContext('2d')!
    const image = bctx.createImageData(cols, rows)
    const data = image.data

    const bg = parseColor(color('--surface'))
    const pos = parseColor(color('--accent'))
    const neg = parseColor(color('--live'))
    const bright = parseColor(color('--exact'))
    const { a, b } = handles.current
    const ax = a.x * width
    const ay = a.y * height
    const bx = b.x * width
    const by = b.y * height

    for (let j = 0; j < rows; j++) {
      const py = (j + 0.5) * CELL
      for (let i = 0; i < cols; i++) {
        const px = (i + 0.5) * CELL
        const r1 = Math.hypot(px - ax, py - ay)
        const r2 = Math.hypot(px - bx, py - by)
        let value: number // −1 … 1
        let target: [number, number, number]
        if (m === 'wave') {
          const sum = Math.sin(k * r1 - wt) + (both ? Math.sin(k * r2 - wt + dphi) : 0)
          value = both ? sum / 2 : sum
          target = value >= 0 ? pos : neg
        } else {
          // Time-averaged energy: 1 + cos(k·(r1 − r2) − Δφ), from 0 (silent) to 2 (loud).
          value = both ? (1 + Math.cos(k * (r1 - r2) - dphi)) / 2 : 0.5
          target = bright
        }
        const w = Math.min(1, Math.abs(value))
        const o = (j * cols + i) * 4
        data[o] = bg[0] + (target[0] - bg[0]) * w
        data[o + 1] = bg[1] + (target[1] - bg[1]) * w
        data[o + 2] = bg[2] + (target[2] - bg[2]) * w
        data[o + 3] = 255
      }
    }
    bctx.putImageData(image, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(buffer, 0, 0, cols * CELL, rows * CELL)

    // Sources, probe and the two paths to it
    const probe = handles.current.probe
    const prx = probe.x * width
    const pry = probe.y * height
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1.5
    ctx.strokeStyle = color('--text')
    ctx.globalAlpha = 0.6
    polyline(ctx, [[ax, ay], [prx, pry]])
    if (both) polyline(ctx, [[bx, by], [prx, pry]])
    ctx.globalAlpha = 1
    ctx.setLineDash([])

    const dot = (x: number, y: number, fill: string, label: string) => {
      ctx.fillStyle = fill
      ctx.strokeStyle = color('--surface')
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = color('--text')
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(label, x + 12, y + 4)
    }
    dot(ax, ay, color('--text'), 'S₁')
    if (both) dot(bx, by, color('--text'), 'S₂')
    ctx.fillStyle = color('--text')
    ctx.beginPath()
    ctx.moveTo(prx, pry - 9)
    ctx.lineTo(prx + 9, pry)
    ctx.lineTo(prx, pry + 9)
    ctx.lineTo(prx - 9, pry)
    ctx.closePath()
    ctx.fill()
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText('P', prx + 13, pry + 4)

    // Wavelength scale bar
    ctx.fillStyle = color('--text')
    ctx.fillRect(width - 16 - lambda, height - 18, lambda, 2)
    ctx.textAlign = 'right'
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText('λ', width - 16 - lambda / 2 + 3, height - 24)
  }

  const drawProbe = (frame: Frame) => {
    const { ctx, color } = frame
    const { wavelength: lambda, frequency: f, phase: phi, twoSources: both } = settings.current
    const field = fieldCanvas.ref.current
    if (!field) return
    const fw = field.clientWidth
    const fh = field.clientHeight
    const probe = handles.current.probe
    const { r1, r2 } = distances(probe.x * fw, probe.y * fh, fw, fh)
    const k = (2 * Math.PI) / lambda
    const dphi = (phi * Math.PI) / 180
    const now = time.current
    const xRange: [number, number] = [now - HISTORY, now]
    const yRange: [number, number] = [-2.2, 2.2]
    const plot = plotArea(frame, xRange, yRange, { left: 36, right: 12, top: 10, bottom: 24 })
    grid(frame, plot, xRange, yRange, { x: (v) => `${fmt(v - now, 1)}s`, y: (v) => `${v}` })

    const series = (fn: (t: number) => number) =>
      Array.from({ length: 241 }, (_, i) => {
        const t = now - HISTORY + (i / 240) * HISTORY
        return [plot.x(t), plot.y(fn(t))] as [number, number]
      })
    const w = 2 * Math.PI * f
    const y1 = (t: number) => Math.sin(k * r1 - w * t)
    const y2 = (t: number) => (both ? Math.sin(k * r2 - w * t + dphi) : 0)

    ctx.lineWidth = 1.5
    ctx.globalAlpha = 0.7
    ctx.strokeStyle = color('--velocity')
    polyline(ctx, series(y1))
    if (both) {
      ctx.strokeStyle = color('--force')
      polyline(ctx, series(y2))
    }
    ctx.globalAlpha = 1
    ctx.lineWidth = 2.5
    ctx.strokeStyle = color('--text')
    polyline(ctx, series((t) => y1(t) + y2(t)))
  }

  const fieldCanvas = useCanvas(drawField)
  const probeCanvas = useCanvas(drawProbe)

  const updatePanel = () => {
    const el = panel.current
    const field = fieldCanvas.ref.current
    if (!el || !field) return
    const { wavelength: lambda, phase: phi, twoSources: both } = settings.current
    const fw = field.clientWidth
    const fh = field.clientHeight
    const probe = handles.current.probe
    const { r1, r2 } = distances(probe.x * fw, probe.y * fh, fw, fh)
    const set = (slot: string, text: string) => {
      const node = el.querySelector<HTMLElement>(`[data-slot="${slot}"]`)
      if (node) node.textContent = text
    }
    set('r1', `${fmt(r1 / lambda, 2)} λ`)
    set('r2', both ? `${fmt(r2 / lambda, 2)} λ` : '–')
    if (!both) {
      set('diff', '–')
      set('result', 'one source: no interference')
      set('amplitude', '1.00')
      return
    }
    const diff = (r1 - r2) / lambda
    set('diff', `${fmt(diff, 2)} λ`)
    // Phase gap between the two arrivals: δ = k·(r₁ − r₂) − Δφ. The sum of two
    // equal sine waves offset by δ is a sine wave of amplitude 2·|cos(δ/2)|.
    const delta = 2 * Math.PI * diff - (phi * Math.PI) / 180
    const amplitude = 2 * Math.abs(Math.cos(delta / 2))
    set('amplitude', fmt(amplitude, 2))
    set(
      'result',
      amplitude > 1.8 ? 'constructive: in step, waves add up' : amplitude < 0.3 ? 'destructive: out of step, waves cancel' : 'partly in step',
    )
  }

  const redrawAll = () => {
    fieldCanvas.redraw()
    probeCanvas.redraw()
    updatePanel()
  }

  // Only animate while playing and on screen: the field is recomputed every frame.
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = fieldCanvas.ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!playing || !visible) return
    return onFrame((seconds) => {
      time.current += Math.min(seconds, 1 / 15)
      redrawAll()
    })
  }, [playing, visible])

  useEffect(redrawAll)

  // Drag the sources or the probe.
  const pick = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) / canvas.clientWidth,
      y: (event.clientY - rect.top) / canvas.clientHeight,
      px: event.clientX - rect.left,
      py: event.clientY - rect.top,
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const p = pick(event)
    const candidates: Handle[] = settings.current.twoSources ? ['probe', 'a', 'b'] : ['probe', 'a']
    let best: Handle | null = null
    let bestDistance = 24
    for (const name of candidates) {
      const h = handles.current[name]
      const d = Math.hypot(h.x * canvas.clientWidth - p.px, h.y * canvas.clientHeight - p.py)
      if (d < bestDistance) {
        best = name
        bestDistance = d
      }
    }
    // Clicking empty space moves the probe there.
    const target = best ?? 'probe'
    canvas.setPointerCapture(event.pointerId)
    dragging.current = target
    handles.current[target] = { x: p.x, y: p.y }
    redrawAll()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const name = dragging.current
    if (!name) return
    const p = pick(event)
    handles.current[name] = { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }
    redrawAll()
  }

  const setSeparation = (wavelengths: number) => {
    const field = fieldCanvas.ref.current
    if (!field) return
    const gap = (wavelengths * wavelength) / field.clientHeight
    handles.current.a = { x: 0.12, y: 0.5 - gap / 2 }
    handles.current.b = { x: 0.12, y: 0.5 + gap / 2 }
    redrawAll()
  }

  return (
    <section className="card">
      <div className="section-head">
        <span className="step">11</span>
        <div>
          <h2>Wave interference</h2>
          <p>
            Each source sends out ripples, <var>y</var> = sin(<var>k</var>·<var>r</var> − <var>ω</var>·<var>t</var>).
            Where two ripples meet, they simply add. If they arrive in step they make a bigger wave; if
            one is at a peak while the other is at a trough, they cancel. <strong>Drag S₁, S₂ or the
            probe P</strong>, or click anywhere to move P.
          </p>
        </div>
      </div>

      <div className="projectile-grid">
        <div className="pendulum-controls">
          <Slider label={<>Wavelength <var>λ</var></>} value={wavelength} min={16} max={120} step={2} unit=" px" onChange={setWavelength} />
          <Slider label={<>Frequency <var>f</var></>} value={frequency} min={0.1} max={2} step={0.1} unit=" Hz" onChange={setFrequency} />
          <Slider label={<>Phase of S₂ <var>Δφ</var></>} value={phase} min={0} max={360} step={15} unit="°" onChange={setPhase} />
          <div className="row">
            <label className="select">
              Show
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                <option value="wave">Wave right now</option>
                <option value="intensity">Loudness (time average)</option>
              </select>
            </label>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={twoSources} onChange={(e) => setTwoSources(e.target.checked)} />
            Two sources
          </label>
          <div className="presets">
            <button className="chip" onClick={() => setSeparation(1)}>1 λ apart</button>
            <button className="chip" onClick={() => setSeparation(3)}>3 λ apart</button>
            <button className="chip" onClick={() => setSeparation(6)}>6 λ apart</button>
            <button className="chip" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
          </div>
          <dl className="stats" ref={panel}>
            <div>
              <dt>Distance S₁ → P</dt>
              <dd data-slot="r1">–</dd>
            </div>
            <div>
              <dt>Distance S₂ → P</dt>
              <dd data-slot="r2">–</dd>
            </div>
            <div>
              <dt>Path difference</dt>
              <dd data-slot="diff">–</dd>
            </div>
            <div>
              <dt>Amplitude at P (max 2)</dt>
              <dd data-slot="amplitude">–</dd>
            </div>
            <div className="wide">
              <dt>At P</dt>
              <dd data-slot="result">–</dd>
            </div>
          </dl>
        </div>

        <canvas
          ref={fieldCanvas.ref}
          className="canvas canvas-waves draggable"
          aria-label="Wave interference field, drag the sources and the probe"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (dragging.current = null)}
          onPointerCancel={() => (dragging.current = null)}
        />
      </div>

      <canvas ref={probeCanvas.ref} className="canvas canvas-probe" aria-label="Waves arriving at the probe over time" />
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--velocity)' }} /> wave from S₁ at P</span>
        {twoSources && <span><i className="swatch" style={{ background: 'var(--force)' }} /> wave from S₂ at P</span>}
        <span><i className="swatch" style={{ background: 'var(--text)' }} /> their sum (what P feels)</span>
      </div>
      <p className="hint">
        Path difference a whole number of wavelengths (0, 1λ, 2λ…): the waves arrive in step and
        double. Half-way between (½λ, 1½λ…): they cancel. Switch to "Loudness" to see the dark
        lines where the two sources always cancel. Changing <var>Δφ</var> shifts those lines sideways,
        which is how phased-array antennas steer a beam without moving.
      </p>
    </section>
  )
}
