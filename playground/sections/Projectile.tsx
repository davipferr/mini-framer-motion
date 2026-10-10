import { onFrame } from 'mini-framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { arrow, fmt, polyline, useCanvas, type Frame } from '../canvas'

/**
 * Projectile motion: a = (0, −g) − k·|v|·v
 *
 * Without air (k = 0) the horizontal velocity never changes and the vertical
 * one drops by g every second, which traces a parabola with closed-form range,
 * height and flight time. With air, drag grows with speed², the path stops
 * being a parabola and there is no neat formula: we simulate it instead.
 */

const DT = 1 / 1000
const MAX_SHOTS = 8
const shotColors = ['--accent', '--live', '--rk4', '--exact', '--explicit', '--over']

interface Point {
  t: number
  x: number
  y: number
  vx: number
  vy: number
}

interface Shot {
  id: number
  angle: number
  speed: number
  points: Point[]
  /** Clock time at which this shot was fired. */
  firedAt: number
  color: string
}

interface Launch {
  speed: number
  angle: number
  height: number
  gravity: number
  drag: number
}

const rad = (degrees: number) => (degrees * Math.PI) / 180

/** Integrate until the projectile hits the ground (y = 0). */
function fly({ speed, angle, height, gravity, drag }: Launch): Point[] {
  let x = 0
  let y = height
  let vx = speed * Math.cos(rad(angle))
  let vy = speed * Math.sin(rad(angle))
  let t = 0
  const points: Point[] = [{ t, x, y, vx, vy }]
  for (let i = 1; i < 60_000; i++) {
    const v = Math.hypot(vx, vy)
    // Semi-implicit Euler, as in the library: velocity first, then position.
    vx += -drag * v * vx * DT
    vy += (-gravity - drag * v * vy) * DT
    const nx = x + vx * DT
    const ny = y + vy * DT
    t += DT
    if (ny <= 0) {
      // Interpolate the exact landing point within this step.
      const f = y / (y - ny)
      points.push({ t: t - DT + f * DT, x: x + (nx - x) * f, y: 0, vx, vy })
      break
    }
    x = nx
    y = ny
    if (i % 5 === 0) points.push({ t, x, y, vx, vy })
  }
  return points
}

/** The textbook answers for a launch without air resistance. */
function formulas({ speed, angle, height, gravity }: Launch) {
  const vx = speed * Math.cos(rad(angle))
  const vy = speed * Math.sin(rad(angle))
  const time = (vy + Math.sqrt(vy * vy + 2 * gravity * height)) / gravity
  return { time, range: vx * time, peak: height + (vy * vy) / (2 * gravity) }
}

function summary(points: Point[]) {
  const last = points[points.length - 1]
  let peak = 0
  for (const p of points) peak = Math.max(peak, p.y)
  return { time: last.t, range: last.x, peak }
}

/** Position at time t along a recorded path (linear interpolation). */
function pointAt(points: Point[], t: number): Point {
  if (t >= points[points.length - 1].t) return points[points.length - 1]
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  const f = (t - a.t) / (b.t - a.t || 1)
  const mix = (p: number, q: number) => p + (q - p) * f
  return { t, x: mix(a.x, b.x), y: mix(a.y, b.y), vx: mix(a.vx, b.vx), vy: mix(a.vy, b.vy) }
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

export function Projectile() {
  const [speed, setSpeed] = useState(20)
  const [angle, setAngle] = useState(45)
  const [height, setHeight] = useState(0)
  const [gravity, setGravity] = useState(9.81)
  const [drag, setDrag] = useState(0)
  const [shots, setShots] = useState<Shot[]>([])
  const [aiming, setAiming] = useState(false)

  const launch: Launch = { speed, angle, height, gravity, drag }
  const launchRef = useRef(launch)
  launchRef.current = launch

  const clock = useRef(0)
  const stopLoop = useRef<(() => void) | null>(null)
  const nextId = useRef(1)
  const shotsRef = useRef(shots)
  shotsRef.current = shots

  /** World → screen with one scale for both axes, so angles look like angles. */
  const view = (width: number, height: number) => {
    const shown = shotsRef.current
    const preview = formulas(launchRef.current)
    let maxX = Math.max(10, preview.range)
    let maxY = Math.max(5, preview.peak)
    for (const shot of shown) {
      const s = summary(shot.points)
      maxX = Math.max(maxX, s.range)
      maxY = Math.max(maxY, s.peak)
    }
    const pad = { left: 44, right: 20, top: 20, bottom: 30 }
    const scale = Math.min(
      (width - pad.left - pad.right) / (maxX * 1.08),
      (height - pad.top - pad.bottom) / (maxY * 1.12),
    )
    const groundY = height - pad.bottom
    return {
      scale,
      groundY,
      left: pad.left,
      sx: (x: number) => pad.left + x * scale,
      sy: (y: number) => groundY - y * scale,
      wx: (px: number) => (px - pad.left) / scale,
      wy: (py: number) => (groundY - py) / scale,
    }
  }

  const draw = ({ ctx, width, height: canvasHeight, color }: Frame) => {
    const v = view(width, canvasHeight)
    const current = launchRef.current

    // Ground and distance ticks
    ctx.fillStyle = color('--grid')
    ctx.fillRect(0, v.groundY, width, 2)
    ctx.fillStyle = color('--muted')
    ctx.textAlign = 'center'
    const maxMeters = v.wx(width - 20)
    const tick = maxMeters > 200 ? 50 : maxMeters > 80 ? 20 : maxMeters > 30 ? 10 : 5
    for (let m = 0; m <= maxMeters; m += tick) {
      ctx.fillRect(v.sx(m), v.groundY, 1, 5)
      ctx.fillText(`${m} m`, v.sx(m), v.groundY + 18)
    }

    // Launch tower
    if (current.height > 0) {
      ctx.fillStyle = color('--chip')
      ctx.fillRect(v.sx(0) - 10, v.sy(current.height), 10, current.height * v.scale)
      ctx.fillStyle = color('--muted')
      ctx.textAlign = 'right'
      ctx.fillText(`${current.height} m`, v.sx(0) - 14, v.sy(current.height) + 4)
    }

    // Aim preview: the no-air parabola for the current settings
    const f = formulas(current)
    const vx0 = current.speed * Math.cos(rad(current.angle))
    const vy0 = current.speed * Math.sin(rad(current.angle))
    ctx.strokeStyle = color('--target')
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 5])
    polyline(
      ctx,
      Array.from({ length: 81 }, (_, i) => {
        const t = (i / 80) * f.time
        const y = current.height + vy0 * t - 0.5 * current.gravity * t * t
        return [v.sx(vx0 * t), v.sy(y)] as [number, number]
      }),
    )
    ctx.setLineDash([])

    // Launch arrow showing angle and speed
    const aimLength = 30 + current.speed * 2
    arrow(
      ctx,
      v.sx(0),
      v.sy(current.height),
      v.sx(0) + Math.cos(rad(current.angle)) * aimLength,
      v.sy(current.height) - Math.sin(rad(current.angle)) * aimLength,
      aiming ? color('--live') : color('--text'),
      2,
    )

    // Shots: path so far, the ball, and its velocity split into vx and vy
    for (const shot of shotsRef.current) {
      const elapsed = clock.current - shot.firedAt
      const visible = shot.points.filter((p) => p.t <= elapsed)
      const now = pointAt(shot.points, Math.max(0, elapsed))
      const landed = elapsed >= shot.points[shot.points.length - 1].t
      ctx.strokeStyle = color(shot.color)
      ctx.lineWidth = 2
      ctx.globalAlpha = landed ? 0.55 : 1
      polyline(ctx, [...visible, now].map((p) => [v.sx(p.x), v.sy(p.y)] as [number, number]))
      ctx.globalAlpha = 1
      ctx.fillStyle = color(shot.color)
      ctx.beginPath()
      ctx.arc(v.sx(now.x), v.sy(now.y), landed ? 4 : 7, 0, Math.PI * 2)
      ctx.fill()

      if (landed) {
        ctx.fillStyle = color('--muted')
        ctx.textAlign = 'center'
        ctx.fillText(`${shot.angle}°`, v.sx(now.x), v.sy(0) - 10)
      } else {
        const px = v.sx(now.x)
        const py = v.sy(now.y)
        const k = 2.2 // px per m/s
        arrow(ctx, px, py, px + now.vx * k, py, color('--velocity'), 2)
        arrow(ctx, px, py, px, py - now.vy * k, color('--force'), 2)
        ctx.globalAlpha = 0.5
        arrow(ctx, px, py, px + now.vx * k, py - now.vy * k, color('--text'), 1.5)
        ctx.globalAlpha = 1
      }
    }
  }

  const { ref, redraw } = useCanvas(draw)

  const ensureRunning = () => {
    if (stopLoop.current) return
    stopLoop.current = onFrame((seconds) => {
      clock.current += Math.min(seconds, 1 / 15)
      redraw()
      const flying = shotsRef.current.some(
        (shot) => clock.current - shot.firedAt < shot.points[shot.points.length - 1].t,
      )
      if (!flying) {
        stopLoop.current?.()
        stopLoop.current = null
      }
    })
  }

  useEffect(() => () => stopLoop.current?.(), [])

  const fire = (angles: number[]) => {
    const fired = angles.map((a) => {
      const id = nextId.current++
      return {
        id,
        angle: a,
        speed: launchRef.current.speed,
        points: fly({ ...launchRef.current, angle: a }),
        firedAt: clock.current,
        color: shotColors[(id - 1) % shotColors.length],
      }
    })
    const next = [...shotsRef.current, ...fired].slice(-MAX_SHOTS)
    shotsRef.current = next
    setShots(next)
    ensureRunning()
  }

  const clear = () => {
    shotsRef.current = []
    setShots([])
  }

  // Slingshot aiming: drag from anywhere; direction sets angle, distance sets speed.
  const aimFromPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const v = view(canvas.clientWidth, canvas.clientHeight)
    const dx = event.clientX - rect.left - v.sx(0)
    const dy = v.sy(launchRef.current.height) - (event.clientY - rect.top)
    const a = Math.round((Math.atan2(Math.max(0, dy), Math.max(0, dx)) * 180) / Math.PI)
    const s = Math.round(Math.max(2, Math.min(50, (Math.hypot(dx, dy) - 30) / 2)))
    setAngle(Math.max(0, Math.min(90, a)))
    setSpeed(s)
  }

  const last = shots[shots.length - 1]
  const lastSummary = last ? summary(last.points) : null
  const formula = formulas(launch)
  const terminal = drag > 0 ? Math.sqrt(gravity / drag) : null

  return (
    <section className="card">
      <div className="section-head">
        <span className="step">9</span>
        <div>
          <h2>Projectile motion</h2>
          <p>
            Once thrown, only gravity acts on the ball (plus air, if you turn it on). Gravity only
            pulls down, so the horizontal speed <var>v</var><sub>x</sub> never changes while the
            vertical speed <var>v</var><sub>y</sub> drops by <var>g</var> every second. Put together, that
            traces a parabola. <strong>Drag on the canvas to aim</strong>, then let go to fire.
          </p>
        </div>
      </div>

      <div className="projectile-grid">
        <div className="pendulum-controls">
          <Slider label={<>Speed <var>v</var>₀</>} value={speed} min={2} max={50} step={1} unit=" m/s" onChange={setSpeed} />
          <Slider label={<>Angle <var>θ</var></>} value={angle} min={0} max={90} step={1} unit="°" onChange={setAngle} />
          <Slider label="Launch height" value={height} min={0} max={30} step={1} unit=" m" onChange={setHeight} />
          <Slider label={<>Gravity <var>g</var></>} value={gravity} min={0.5} max={30} step={0.01} unit=" m/s²" onChange={setGravity} />
          <Slider label={<>Air drag <var>k</var></>} value={drag} min={0} max={0.1} step={0.002} unit="" onChange={setDrag} />
          <dl className="stats">
            <div className="wide">
              <dt>No air, by formula</dt>
              <dd className="formula-row">
                <span>range {fmt(formula.range, 1)} m</span>
                <span>height {fmt(formula.peak, 1)} m</span>
                <span>time {fmt(formula.time, 2)} s</span>
              </dd>
            </div>
            <div className="wide">
              <dt>Last shot{last ? ` (${last.angle}°)` : ''}, simulated</dt>
              <dd className="formula-row">
                {lastSummary ? (
                  <>
                    <span>range {fmt(lastSummary.range, 1)} m</span>
                    <span>height {fmt(lastSummary.peak, 1)} m</span>
                    <span>time {fmt(lastSummary.time, 2)} s</span>
                  </>
                ) : (
                  <span>fire a shot</span>
                )}
              </dd>
            </div>
            {terminal !== null && (
              <div className="wide">
                <dt>Terminal velocity √(g/k)</dt>
                <dd>{fmt(terminal, 1)} m/s</dd>
              </div>
            )}
          </dl>
        </div>

        <canvas
          ref={ref}
          className="canvas canvas-projectile draggable"
          aria-label="Projectile motion, drag to aim"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setAiming(true)
            aimFromPointer(e)
          }}
          onPointerMove={(e) => aiming && aimFromPointer(e)}
          onPointerUp={() => {
            if (!aiming) return
            setAiming(false)
            fire([launchRef.current.angle])
          }}
          onPointerCancel={() => setAiming(false)}
        />
      </div>

      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--velocity)' }} /> horizontal speed v<sub>x</sub> (constant without air)</span>
        <span><i className="swatch" style={{ background: 'var(--force)' }} /> vertical speed v<sub>y</sub> (changes by g each second)</span>
        <span><i className="swatch" style={{ background: 'var(--target)' }} /> aim preview, no air</span>
      </div>

      <div className="row">
        <button className="primary" onClick={() => fire([angle])}>Fire at {angle}°</button>
        <button onClick={() => fire([15, 30, 45, 60, 75])}>Fire 15°, 30°, 45°, 60°, 75°</button>
        <button onClick={clear}>Clear</button>
      </div>
      <p className="hint">
        Without air, 45° goes furthest from the ground, and 30° and 60° land in the same spot: range is
        <var> v</var>₀²·sin(2θ)/<var>g</var>, and sin(2·30°) = sin(2·60°). Turn on air drag and fire the five
        angles again: the path is no longer symmetric, it falls more steeply than it rose, and the
        best angle drops below 45°.
      </p>
    </section>
  )
}
