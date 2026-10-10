import { onFrame } from 'mini-framer-motion'
import { useEffect, useRef, useState } from 'react'
import { clip, fmt, grid, plotArea, polyline, useCanvas, type Frame } from '../canvas'

/**
 * A pendulum obeys  θ'' = −(g/L)·sin θ − b·θ'.
 *
 * For small angles sin θ ≈ θ, and the equation becomes θ'' = −(g/L)·θ − b·θ':
 * exactly the spring equation with k/m = g/L. We run both side by side to show
 * where that approximation holds and where it breaks.
 */

interface State {
  theta: number
  omega: number
}

interface Params {
  length: number
  gravity: number
  damping: number
}

const DT = 1 / 1000
const HISTORY = 10
const MAX_LENGTH = 3

const planets = [
  { name: 'Moon', g: 1.62 },
  { name: 'Mars', g: 3.71 },
  { name: 'Earth', g: 9.81 },
  { name: 'Jupiter', g: 24.79 },
]

const deg = (radians: number) => (radians * 180) / Math.PI
const rad = (degrees: number) => (degrees * Math.PI) / 180

function acceleration(s: State, p: Params, linear: boolean) {
  const restoring = linear ? s.theta : Math.sin(s.theta)
  return -(p.gravity / p.length) * restoring - p.damping * s.omega
}

/** RK4: angles can get large here, and accuracy matters for the period. */
function stepRK4(s: State, p: Params, linear: boolean, dt: number): State {
  const f = (theta: number, omega: number) => acceleration({ theta, omega }, p, linear)
  const k1t = s.omega
  const k1w = f(s.theta, s.omega)
  const k2t = s.omega + (k1w * dt) / 2
  const k2w = f(s.theta + (k1t * dt) / 2, k2t)
  const k3t = s.omega + (k2w * dt) / 2
  const k3w = f(s.theta + (k2t * dt) / 2, k3t)
  const k4t = s.omega + k3w * dt
  const k4w = f(s.theta + k3t * dt, k4t)
  return {
    theta: s.theta + ((k1t + 2 * k2t + 2 * k3t + k4t) * dt) / 6,
    omega: s.omega + ((k1w + 2 * k2w + 2 * k3w + k4w) * dt) / 6,
  }
}

function Slider(props: {
  label: React.ReactNode
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

export function Pendulum() {
  const [length, setLength] = useState(1.5)
  const [gravity, setGravity] = useState(9.81)
  const [damping, setDamping] = useState(0.1)
  const [startAngle, setStartAngle] = useState(60)
  const [showLinear, setShowLinear] = useState(true)
  const [periods, setPeriods] = useState<{ real: number | null; linear: number | null }>({
    real: null,
    linear: null,
  })

  const params = useRef<Params>({ length, gravity, damping })
  params.current = { length, gravity, damping }

  // Simulation state lives in a ref: it changes every frame, React shouldn't re-render.
  const sim = useRef({
    real: { theta: rad(60), omega: 0 } as State,
    linear: { theta: rad(60), omega: 0 } as State,
    t: 0,
    accumulator: 0,
    grabbed: false,
    history: [] as { t: number; real: number; linear: number }[],
    crossings: { real: [] as number[], linear: [] as number[] },
  })
  const stopLoop = useRef<(() => void) | null>(null)
  const readout = useRef<HTMLSpanElement>(null)

  const geometry = (width: number, height: number) => {
    // Pivot in the middle so the bob stays visible even when it swings over the top.
    const pivotX = width / 2
    const pivotY = height / 2
    const scale = (Math.min(height / 2 - 22, width / 2 - 22)) / MAX_LENGTH
    return { pivotX, pivotY, rodLength: params.current.length * scale }
  }

  const drawPendulum = ({ ctx, width, height, color }: Frame) => {
    const s = sim.current
    const { pivotX, pivotY, rodLength } = geometry(width, height)
    const bob = (theta: number) => [pivotX + Math.sin(theta) * rodLength, pivotY + Math.cos(theta) * rodLength]

    // Swing arc for reference, plus the vertical rest line
    ctx.strokeStyle = color('--grid')
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(pivotX, pivotY, rodLength, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = color('--target')
    ctx.setLineDash([4, 4])
    polyline(ctx, [[pivotX, pivotY], [pivotX, pivotY + rodLength + 16]])
    ctx.setLineDash([])

    // Mount: a small bracket holding the pivot
    ctx.fillStyle = color('--muted')
    ctx.beginPath()
    ctx.moveTo(pivotX, pivotY)
    ctx.lineTo(pivotX - 9, pivotY - 14)
    ctx.lineTo(pivotX + 9, pivotY - 14)
    ctx.closePath()
    ctx.fill()

    if (showLinear) {
      const [gx, gy] = bob(s.linear.theta)
      ctx.globalAlpha = 0.45
      ctx.strokeStyle = color('--exact')
      ctx.setLineDash([5, 4])
      ctx.lineWidth = 2
      polyline(ctx, [[pivotX, pivotY], [gx, gy]])
      ctx.setLineDash([])
      ctx.fillStyle = color('--exact')
      ctx.beginPath()
      ctx.arc(gx, gy, 14, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    const [bx, by] = bob(s.real.theta)
    ctx.strokeStyle = color('--text')
    ctx.lineWidth = 2
    polyline(ctx, [[pivotX, pivotY], [bx, by]])
    ctx.fillStyle = s.grabbed ? color('--live') : color('--accent')
    ctx.beginPath()
    ctx.arc(bx, by, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = color('--text')
    ctx.beginPath()
    ctx.arc(pivotX, pivotY, 4, 0, Math.PI * 2)
    ctx.fill()

    // Angle label
    ctx.fillStyle = color('--muted')
    ctx.textAlign = 'left'
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(`θ = ${fmt(deg(s.real.theta), 1)}°`, 12, height - 12)
  }

  const drawPlot = (frame: Frame) => {
    const { ctx, color } = frame
    const { history, t } = sim.current
    const tEnd = Math.max(4, t)
    const xRange: [number, number] = [Math.max(0, tEnd - HISTORY), tEnd]
    let reach = 10
    for (const h of history) reach = Math.max(reach, Math.abs(deg(h.real)), showLinear ? Math.abs(deg(h.linear)) : 0)
    const yRange: [number, number] = [-reach * 1.1, reach * 1.1]
    const plot = plotArea(frame, xRange, yRange)
    grid(frame, plot, xRange, yRange, { x: (v) => `${v}s`, y: (v) => `${v}°` })
    ctx.save()
    clip(ctx, plot)
    if (showLinear) {
      ctx.strokeStyle = color('--exact')
      ctx.globalAlpha = 0.6
      ctx.lineWidth = 2
      ctx.setLineDash([5, 4])
      polyline(ctx, history.map((h) => [plot.x(h.t), plot.y(deg(h.linear))] as [number, number]))
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = color('--accent')
    ctx.lineWidth = 2
    polyline(ctx, history.map((h) => [plot.x(h.t), plot.y(deg(h.real))] as [number, number]))
    ctx.restore()
  }

  const pendulumCanvas = useCanvas(drawPendulum)
  const plotCanvas = useCanvas(drawPlot)

  const redraw = () => {
    pendulumCanvas.redraw()
    plotCanvas.redraw()
    const s = sim.current
    if (readout.current) {
      readout.current.textContent = `θ = ${fmt(deg(s.real.theta), 1)}°   ω = ${fmt(deg(s.real.omega), 0)}°/s`
    }
  }

  /** Period from the last two times the bob swung through the bottom going the same way. */
  const period = (times: number[]) => (times.length >= 2 ? times[times.length - 1] - times[times.length - 2] : null)

  const tick = (seconds: number) => {
    const s = sim.current
    if (s.grabbed) {
      redraw()
      return
    }
    s.accumulator += Math.min(seconds, 1 / 15)
    while (s.accumulator >= DT) {
      const before = { real: s.real.theta, linear: s.linear.theta }
      s.real = stepRK4(s.real, params.current, false, DT)
      s.linear = stepRK4(s.linear, params.current, true, DT)
      s.accumulator -= DT
      s.t += DT
      if (before.real > 0 && s.real.theta <= 0) s.crossings.real.push(s.t)
      if (before.linear > 0 && s.linear.theta <= 0) s.crossings.linear.push(s.t)
    }
    s.history.push({ t: s.t, real: s.real.theta, linear: s.linear.theta })
    while (s.history.length && s.history[0].t < s.t - HISTORY) s.history.shift()

    const real = period(s.crossings.real)
    const linear = period(s.crossings.linear)
    setPeriods((p) => (p.real === real && p.linear === linear ? p : { real, linear }))

    const still = (st: State) => Math.abs(st.theta) < 1e-4 && Math.abs(st.omega) < 1e-4
    if (still(s.real) && still(s.linear)) {
      stopLoop.current?.()
      stopLoop.current = null
    }
    redraw()
  }

  const ensureRunning = () => {
    if (!stopLoop.current) stopLoop.current = onFrame(tick)
  }

  const release = (angleDegrees: number) => {
    const s = sim.current
    s.real = { theta: rad(angleDegrees), omega: 0 }
    s.linear = { theta: rad(angleDegrees), omega: 0 }
    s.t = 0
    s.accumulator = 0
    s.grabbed = false
    s.history = [{ t: 0, real: s.real.theta, linear: s.linear.theta }]
    s.crossings = { real: [], linear: [] }
    setPeriods({ real: null, linear: null })
    ensureRunning()
    redraw()
  }

  useEffect(() => {
    release(60)
    return () => {
      stopLoop.current?.()
      stopLoop.current = null
    }
  }, [])

  // Dragging: the angle follows the pointer around the pivot.
  const angleFromPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const { pivotX, pivotY } = geometry(canvas.clientWidth, canvas.clientHeight)
    return Math.atan2(event.clientX - rect.left - pivotX, event.clientY - rect.top - pivotY)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const { pivotX, pivotY, rodLength } = geometry(canvas.clientWidth, canvas.clientHeight)
    const s = sim.current
    const bx = pivotX + Math.sin(s.real.theta) * rodLength
    const by = pivotY + Math.cos(s.real.theta) * rodLength
    if (Math.hypot(event.clientX - rect.left - bx, event.clientY - rect.top - by) > 30) return
    canvas.setPointerCapture(event.pointerId)
    s.grabbed = true
    ensureRunning()
    onPointerMove(event)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sim.current
    if (!s.grabbed) return
    const theta = angleFromPointer(event)
    s.real = { theta, omega: 0 }
    s.linear = { theta, omega: 0 }
    redraw()
  }

  const onPointerUp = () => {
    const s = sim.current
    if (!s.grabbed) return
    release(deg(s.real.theta))
  }

  const formulaPeriod = 2 * Math.PI * Math.sqrt(length / gravity)

  return (
    <section className="card">
      <div className="section-head">
        <span className="step">8</span>
        <div>
          <h2>Pendulum</h2>
          <p>
            Gravity pulls the bob back towards the bottom with a force proportional to sin θ:
            &nbsp;<var>θ</var>″ = −(<var>g</var>/<var>L</var>)·sin <var>θ</var> − <var>b</var>·<var>θ</var>′.
            For small angles sin θ ≈ θ, and this becomes the spring equation with{' '}
            <var>k</var>/<var>m</var> = <var>g</var>/<var>L</var>. The faint amber pendulum uses that
            approximation. <strong>Drag the bob</strong> and compare them at 10° and at 150°.
          </p>
        </div>
      </div>

      <div className="pendulum-grid">
        <div className="pendulum-controls">
          <Slider label={<>Length <var>L</var></>} value={length} min={0.2} max={3} step={0.1} unit=" m" onChange={setLength} />
          <Slider label={<>Gravity <var>g</var></>} value={gravity} min={0.5} max={30} step={0.01} unit=" m/s²" onChange={setGravity} />
          <div className="presets">
            {planets.map((planet) => (
              <button key={planet.name} className="chip" onClick={() => setGravity(planet.g)}>
                {planet.name}
              </button>
            ))}
          </div>
          <Slider label={<>Air friction <var>b</var></>} value={damping} min={0} max={2} step={0.05} unit="" onChange={setDamping} />
          <Slider label="Release angle" value={startAngle} min={5} max={175} step={5} unit="°" onChange={setStartAngle} />
          <label className="checkbox">
            <input type="checkbox" checked={showLinear} onChange={(e) => setShowLinear(e.target.checked)} />
            Show small-angle (spring) version
          </label>

          <dl className="stats">
            <div>
              <dt>Period, formula 2π√(L/g)</dt>
              <dd>{formulaPeriod.toFixed(2)} s</dd>
            </div>
            <div>
              <dt>Period, measured</dt>
              <dd>{periods.real === null ? '…' : `${periods.real.toFixed(2)} s`}</dd>
            </div>
            <div className="wide">
              <dt>Real pendulum vs. spring version</dt>
              <dd>
                {periods.real === null || periods.linear === null
                  ? 'swinging…'
                  : `${(((periods.real - periods.linear) / periods.linear) * 100).toFixed(1)}% slower per swing`}
              </dd>
            </div>
          </dl>
        </div>

        <canvas
          ref={pendulumCanvas.ref}
          className="canvas canvas-pendulum draggable"
          aria-label="Pendulum, draggable"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      <canvas ref={plotCanvas.ref} className="canvas canvas-short" aria-label="Pendulum angle over time" />
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--accent)' }} /> real pendulum (sin θ)</span>
        {showLinear && <span><i className="swatch" style={{ background: 'var(--exact)' }} /> spring version (θ)</span>}
        <span className="mono" ref={readout} />
      </div>
      <div className="row">
        <button className="primary" onClick={() => release(startAngle)}>Release from {startAngle}°</button>
        <button onClick={() => release(10)}>Small swing (10°)</button>
        <button onClick={() => release(170)}>Almost upside down (170°)</button>
      </div>
      <p className="hint">
        The formula 2π√(L/g) only holds for small swings. Released near the top, the real pendulum
        lingers there and its period grows a lot, while the spring version keeps the same rhythm
        whatever the angle. Physicists call that property isochronism.
      </p>
    </section>
  )
}
