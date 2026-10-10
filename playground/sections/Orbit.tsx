import { onFrame } from 'mini-framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { arrow, fmt, useCanvas, type Frame } from '../canvas'

/**
 * Newtonian gravity: a = −GM · r / |r|³
 *
 * The pull points at the star and weakens with the square of the distance.
 * Depending on speed, a planet falls into a circle, an ellipse, or escapes on
 * an open curve. Integration uses leapfrog (kick–drift–kick), which, like the
 * library's semi-implicit Euler, conserves energy over the long run, so orbits
 * close on themselves. Explicit Euler is offered for contrast: it spirals out.
 */

type Integrator = 'leapfrog' | 'explicit'

interface Body {
  x: number
  y: number
  vx: number
  vy: number
}

interface Sample {
  t: number
  x: number
  y: number
}

/** World units: the star sits at (0, 0) and the view spans about ±320. */
const VIEW = 320
const BASE_GM = 8e6
const STAR_RADIUS = 14
const SOFTENING = 2

function accel(x: number, y: number, gm: number) {
  const r2 = x * x + y * y + SOFTENING * SOFTENING
  const inv = gm / (r2 * Math.sqrt(r2))
  return { ax: -x * inv, ay: -y * inv }
}

function step(b: Body, gm: number, dt: number, method: Integrator): Body {
  if (method === 'explicit') {
    // Move with the old velocity, update velocity with the old acceleration.
    const { ax, ay } = accel(b.x, b.y, gm)
    return { x: b.x + b.vx * dt, y: b.y + b.vy * dt, vx: b.vx + ax * dt, vy: b.vy + ay * dt }
  }
  // Leapfrog: half kick, full drift, half kick.
  const a1 = accel(b.x, b.y, gm)
  const vx = b.vx + (a1.ax * dt) / 2
  const vy = b.vy + (a1.ay * dt) / 2
  const x = b.x + vx * dt
  const y = b.y + vy * dt
  const a2 = accel(x, y, gm)
  return { x, y, vx: vx + (a2.ax * dt) / 2, vy: vy + (a2.ay * dt) / 2 }
}

/** Specific orbital energy: kinetic + potential per unit mass. Negative = bound. */
const energy = (b: Body, gm: number) => 0.5 * (b.vx * b.vx + b.vy * b.vy) - gm / Math.hypot(b.x, b.y)

/** The shape of the orbit, from position and velocity alone. */
function elements(b: Body, gm: number) {
  const r = Math.hypot(b.x, b.y)
  const v2 = b.vx * b.vx + b.vy * b.vy
  const rv = b.x * b.vx + b.y * b.vy
  // Eccentricity vector: e = ((v² − GM/r)·r − (r·v)·v) / GM
  const ex = ((v2 - gm / r) * b.x - rv * b.vx) / gm
  const ey = ((v2 - gm / r) * b.y - rv * b.vy) / gm
  const e = Math.hypot(ex, ey)
  const E = energy(b, gm)
  const a = E < 0 ? -gm / (2 * E) : Infinity
  const period = E < 0 ? 2 * Math.PI * Math.sqrt((a * a * a) / gm) : Infinity
  return { r, speed: Math.sqrt(v2), e, a, period, E }
}

function shapeName(e: number, bound: boolean) {
  if (!bound) return e < 1.02 ? 'parabola (just escapes)' : 'hyperbola (escapes)'
  if (e < 0.03) return 'circle'
  return 'ellipse'
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

export function Orbit() {
  const [mass, setMass] = useState(1)
  const [stepMs, setStepMs] = useState(1)
  const [method, setMethod] = useState<Integrator>('leapfrog')
  const [showAreas, setShowAreas] = useState(true)

  const settings = useRef({ gm: BASE_GM * mass, dt: stepMs / 1000, method, showAreas })
  settings.current = { gm: BASE_GM * mass, dt: stepMs / 1000, method, showAreas }

  const sim = useRef({
    body: null as Body | null,
    t: 0,
    accumulator: 0,
    trail: [] as Sample[],
    launchEnergy: 0,
    status: 'idle' as 'idle' | 'flying' | 'crashed' | 'escaped',
    sweep: 0.25,
  })
  const aim = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const stopLoop = useRef<(() => void) | null>(null)
  const panel = useRef<HTMLDListElement>(null)

  const view = (width: number, height: number) => {
    const scale = Math.min(width, height) / 2 / VIEW
    const cx = width / 2
    const cy = height / 2
    return {
      scale,
      sx: (x: number) => cx + x * scale,
      sy: (y: number) => cy - y * scale,
      wx: (px: number) => (px - cx) / scale,
      wy: (py: number) => (cy - py) / scale,
    }
  }

  /** Where would a planet launched like this go? Cheap leapfrog look-ahead. */
  const predict = (start: Body, gm: number) => {
    const points: [number, number][] = []
    let b = start
    const { period } = elements(start, gm)
    const horizon = Number.isFinite(period) ? Math.min(period, 30) : 8
    const dt = horizon / 1500
    for (let i = 0; i < 1500; i++) {
      b = step(b, gm, dt, 'leapfrog')
      if (Math.hypot(b.x, b.y) < STAR_RADIUS || Math.hypot(b.x, b.y) > VIEW * 4) break
      if (i % 3 === 0) points.push([b.x, b.y])
    }
    return points
  }

  const draw = ({ ctx, width, height, color }: Frame) => {
    const v = view(width, height)
    const s = sim.current
    const { gm } = settings.current

    // Faint distance rings
    ctx.strokeStyle = color('--grid')
    ctx.lineWidth = 1
    for (const r of [100, 200, 300]) {
      ctx.beginPath()
      ctx.arc(v.sx(0), v.sy(0), r * v.scale, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Kepler's second law: wedges swept in equal times have equal areas.
    if (settings.current.showAreas && s.trail.length > 1) {
      const tokens = ['--spring-energy', '--exact']
      for (let i = 1; i < s.trail.length; i++) {
        const a = s.trail[i - 1]
        const b = s.trail[i]
        const slot = Math.floor(b.t / s.sweep)
        ctx.fillStyle = color(tokens[slot % 2])
        ctx.globalAlpha = 0.18
        ctx.beginPath()
        ctx.moveTo(v.sx(0), v.sy(0))
        ctx.lineTo(v.sx(a.x), v.sy(a.y))
        ctx.lineTo(v.sx(b.x), v.sy(b.y))
        ctx.closePath()
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    // Trail
    if (s.trail.length > 1) {
      ctx.strokeStyle = color('--accent')
      ctx.lineWidth = 1.5
      ctx.beginPath()
      s.trail.forEach((p, i) => (i === 0 ? ctx.moveTo(v.sx(p.x), v.sy(p.y)) : ctx.lineTo(v.sx(p.x), v.sy(p.y))))
      ctx.stroke()
    }

    // Aim preview
    if (aim.current) {
      const a = aim.current
      ctx.strokeStyle = color('--target')
      ctx.setLineDash([5, 5])
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(v.sx(a.x), v.sy(a.y))
      for (const [x, y] of predict(a, gm)) ctx.lineTo(v.sx(x), v.sy(y))
      ctx.stroke()
      ctx.setLineDash([])
      arrow(ctx, v.sx(a.x), v.sy(a.y), v.sx(a.x + a.vx * 0.4), v.sy(a.y + a.vy * 0.4), color('--live'), 2)
      ctx.fillStyle = color('--live')
      ctx.beginPath()
      ctx.arc(v.sx(a.x), v.sy(a.y), 7, 0, Math.PI * 2)
      ctx.fill()
    }

    // Star
    const glow = ctx.createRadialGradient(v.sx(0), v.sy(0), 0, v.sx(0), v.sy(0), STAR_RADIUS * 3 * v.scale)
    glow.addColorStop(0, color('--exact'))
    glow.addColorStop(1, 'transparent')
    ctx.fillStyle = glow
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.arc(v.sx(0), v.sy(0), STAR_RADIUS * 3 * v.scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = color('--exact')
    ctx.beginPath()
    ctx.arc(v.sx(0), v.sy(0), STAR_RADIUS * v.scale * Math.cbrt(mass), 0, Math.PI * 2)
    ctx.fill()

    // Planet with its velocity and the pull of gravity
    const b = s.body
    if (b && s.status !== 'escaped') {
      const px = v.sx(b.x)
      const py = v.sy(b.y)
      if (s.status === 'flying') {
        const { ax, ay } = accel(b.x, b.y, gm)
        const g = Math.hypot(ax, ay)
        const gLen = Math.min(70, 12 + Math.log10(1 + g) * 10)
        arrow(ctx, px, py, px - (b.x / Math.hypot(b.x, b.y)) * gLen, py + (b.y / Math.hypot(b.x, b.y)) * gLen, color('--force'), 2)
        arrow(ctx, px, py, px + b.vx * 0.2 * v.scale, py - b.vy * 0.2 * v.scale, color('--velocity'), 2)
      }
      ctx.fillStyle = s.status === 'crashed' ? color('--explicit') : color('--accent')
      ctx.beginPath()
      ctx.arc(px, py, 7, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.fillStyle = color('--muted')
    ctx.textAlign = 'left'
    if (s.status === 'crashed') ctx.fillText('Crashed into the star', 12, height - 12)
    if (s.status === 'escaped') ctx.fillText('Escaped: it will never come back', 12, height - 12)
    if (s.status === 'idle' && !aim.current) ctx.fillText('Drag anywhere to place and throw a planet', 12, height - 12)
  }

  const { ref, redraw } = useCanvas(draw)

  /** Write the numbers straight into the DOM every frame. */
  const updatePanel = () => {
    const el = panel.current
    const s = sim.current
    const b = aim.current ?? s.body
    if (!el) return
    const { gm } = settings.current
    const set = (slot: string, text: string) => {
      const node = el.querySelector<HTMLElement>(`[data-slot="${slot}"]`)
      if (node) node.textContent = text
    }
    if (!b) {
      for (const slot of ['shape', 'speed', 'circular', 'escape', 'period', 'drift']) set(slot, '–')
      return
    }
    const o = elements(b, gm)
    const bound = o.E < 0
    set('shape', `${shapeName(o.e, bound)}, e = ${fmt(o.e, 2)}`)
    set('speed', `${fmt(o.speed, 0)} at r = ${fmt(o.r, 0)}`)
    set('circular', fmt(Math.sqrt(gm / o.r), 0))
    set('escape', fmt(Math.sqrt((2 * gm) / o.r), 0))
    set('period', bound ? `${fmt(o.period, 2)} s` : 'never returns')
    if (s.body && !aim.current && s.launchEnergy !== 0) {
      const drift = ((energy(s.body, gm) - s.launchEnergy) / Math.abs(s.launchEnergy)) * 100
      set('drift', `${drift >= 0 ? '+' : ''}${fmt(drift, 3)}%`)
    } else {
      set('drift', '–')
    }
  }

  const tick = (seconds: number) => {
    const s = sim.current
    const { gm, dt, method: integrator } = settings.current
    if (s.status !== 'flying' || !s.body) return
    s.accumulator += Math.min(seconds, 1 / 15)
    while (s.accumulator >= dt) {
      s.body = step(s.body, gm, dt, integrator)
      s.accumulator -= dt
      s.t += dt
      const r = Math.hypot(s.body.x, s.body.y)
      if (r < STAR_RADIUS * Math.cbrt(gm / BASE_GM)) {
        s.status = 'crashed'
        break
      }
      if (r > VIEW * 4) {
        s.status = 'escaped'
        break
      }
      const last = s.trail[s.trail.length - 1]
      if (!last || s.t - last.t >= 0.01) s.trail.push({ t: s.t, x: s.body.x, y: s.body.y })
    }
    // Keep one orbit's worth of trail (or a few seconds for open paths).
    const { period } = elements(s.body, gm)
    const keep = Number.isFinite(period) ? Math.min(period * 0.98, 30) : 6
    while (s.trail.length > 2 && s.trail[0].t < s.t - keep) s.trail.shift()

    if (s.status !== 'flying') {
      stopLoop.current?.()
      stopLoop.current = null
    }
    redraw()
    updatePanel()
  }

  const launch = (body: Body) => {
    const s = sim.current
    const { gm } = settings.current
    const { period } = elements(body, gm)
    s.body = body
    s.t = 0
    s.accumulator = 0
    s.trail = [{ t: 0, x: body.x, y: body.y }]
    s.launchEnergy = energy(body, gm)
    s.status = 'flying'
    // Twelve equal-time wedges per orbit.
    s.sweep = Number.isFinite(period) ? period / 12 : 0.25
    if (!stopLoop.current) stopLoop.current = onFrame(tick)
    redraw()
    updatePanel()
  }

  /** Start at distance r to the right of the star, moving up at `factor` × circular speed. */
  const preset = (factor: number, r = 170) => {
    const v = Math.sqrt(settings.current.gm / r) * factor
    launch({ x: r, y: 0, vx: 0, vy: v })
  }

  useEffect(() => {
    preset(0.8)
    return () => {
      stopLoop.current?.()
      stopLoop.current = null
    }
  }, [])

  // Changing the star's mass or the integrator mid-flight: re-measure energy drift from here.
  useEffect(() => {
    const s = sim.current
    if (s.body) s.launchEnergy = energy(s.body, BASE_GM * mass)
    updatePanel()
  }, [mass, method, stepMs])

  // Slingshot: press where the planet starts, drag out its velocity, release.
  const worldPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const v = view(canvas.clientWidth, canvas.clientHeight)
    return { x: v.wx(event.clientX - rect.left), y: v.wy(event.clientY - rect.top) }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = worldPoint(event)
    aim.current = { x: p.x, y: p.y, vx: 0, vy: 0 }
    redraw()
    updatePanel()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const a = aim.current
    if (!a) return
    const p = worldPoint(event)
    a.vx = (p.x - a.x) * 2.5
    a.vy = (p.y - a.y) * 2.5
    redraw()
    updatePanel()
  }

  const onPointerUp = () => {
    const a = aim.current
    if (!a) return
    aim.current = null
    if (Math.hypot(a.x, a.y) > STAR_RADIUS * 2) launch(a)
    else redraw()
  }

  return (
    <section className="card">
      <div className="section-head">
        <span className="step">10</span>
        <div>
          <h2>Orbits and gravity</h2>
          <p>
            Gravity pulls the planet towards the star with acceleration <var>GM</var>/<var>r</var>²:
            twice as far, a quarter of the pull. An orbit is a planet that is falling towards the star
            but moving sideways fast enough to keep missing it. <strong>Drag on the canvas</strong>:
            where you press is where the planet starts, the direction and length of the drag set its
            velocity.
          </p>
        </div>
      </div>

      <div className="projectile-grid">
        <div className="pendulum-controls">
          <Slider label={<>Star mass <var>M</var></>} value={mass} min={0.25} max={4} step={0.25} unit="×" onChange={setMass} />
          <Slider label={<>Time step <var>dt</var></>} value={stepMs} min={1} max={40} step={1} unit=" ms" onChange={setStepMs} />
          <label className="select">
            Integrator
            <select value={method} onChange={(e) => setMethod(e.target.value as Integrator)}>
              <option value="leapfrog">Leapfrog (energy-conserving)</option>
              <option value="explicit">Explicit Euler</option>
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={showAreas} onChange={(e) => setShowAreas(e.target.checked)} />
            Show equal areas (Kepler's 2nd law)
          </label>
          <dl className="stats" ref={panel}>
            <div className="wide">
              <dt>Orbit shape</dt>
              <dd data-slot="shape">–</dd>
            </div>
            <div className="wide">
              <dt>Speed now</dt>
              <dd data-slot="speed">–</dd>
            </div>
            <div>
              <dt>Circular speed √(GM/r)</dt>
              <dd data-slot="circular">–</dd>
            </div>
            <div>
              <dt>Escape speed √(2GM/r)</dt>
              <dd data-slot="escape">–</dd>
            </div>
            <div>
              <dt>Period (Kepler's 3rd law)</dt>
              <dd data-slot="period">–</dd>
            </div>
            <div>
              <dt>Energy drift since launch</dt>
              <dd data-slot="drift">–</dd>
            </div>
          </dl>
        </div>

        <canvas
          ref={ref}
          className="canvas canvas-orbit draggable"
          aria-label="Orbit simulation, drag to throw a planet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            aim.current = null
            redraw()
          }}
        />
      </div>

      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--velocity)' }} /> velocity</span>
        <span><i className="swatch" style={{ background: 'var(--force)' }} /> gravity (always towards the star)</span>
        {showAreas && (
          <span><i className="swatch" style={{ background: 'var(--spring-energy)' }} /> each wedge: 1/12 of an orbit</span>
        )}
      </div>

      <div className="row">
        <button className="primary" onClick={() => preset(1)}>Circular orbit</button>
        <button onClick={() => preset(0.75)}>Ellipse</button>
        <button onClick={() => preset(0.45)}>Narrow ellipse</button>
        <button onClick={() => preset(Math.SQRT2 * 1.03)}>Escape</button>
      </div>
      <p className="hint">
        Kepler noticed the planet moves fast close to the star and slow far away, and that the line from
        star to planet sweeps equal areas in equal times. The shaded wedges each take the same time, so
        they all have the same area. Switch to Explicit Euler with a 10 ms step and watch the energy
        drift: the orbit creeps outwards every lap, just like the spring in section 7.
      </p>
    </section>
  )
}
