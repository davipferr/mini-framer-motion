import { onFrame, type SpringConfig } from 'mini-framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { clip, grid, plotArea, polyline, useCanvas } from '../canvas'
import { methodLabels, trajectory, type Method } from '../physics'

const DURATION = 3
const steps = [0.001, 0.004, 0.008, 0.016, 0.025, 0.04, 0.06, 0.08, 0.1]
const methods: { method: Method; token: string }[] = [
  { method: 'exact', token: '--exact' },
  { method: 'semi', token: '--accent' },
  { method: 'rk4', token: '--rk4' },
  { method: 'explicit', token: '--explicit' },
]

export function IntegratorRace({ config }: { config: SpringConfig }) {
  const [stepIndex, setStepIndex] = useState(3) // 16 ms ≈ one frame at 60 fps
  const dt = steps[stepIndex]

  const runs = useMemo(
    () =>
      methods.map(({ method, token }) => {
        const positions = trajectory(method, 0, 100, config, dt, DURATION)
        return { method, token, positions }
      }),
    [config, dt],
  )

  const errors = useMemo(() => {
    const exact = runs[0].positions
    return runs.map(({ positions }) => {
      let max = 0
      for (let i = 0; i < positions.length; i++) {
        const error = Math.abs(positions[i] - exact[i])
        if (!Number.isFinite(error)) return Infinity
        max = Math.max(max, error)
      }
      return max
    })
  }, [runs])

  const time = useRef(DURATION)
  const stopRef = useRef<(() => void) | null>(null)

  const { ref, redraw } = useCanvas((frame) => {
    const { ctx, width, color } = frame
    const t = time.current
    const lastIndex = Math.floor(t / dt + 1e-9)
    const at = (positions: number[]) => positions[Math.min(lastIndex, positions.length - 1)]

    // Lanes: the race itself
    const laneLeft = 150
    const laneRight = width - 24
    const laneSpan = (laneRight - laneLeft) * 0.6
    ctx.textAlign = 'left'
    runs.forEach((run, i) => {
      const y = 18 + i * 30
      ctx.fillStyle = color('--muted')
      ctx.fillText(methodLabels[run.method], 0, y + 4)
      ctx.strokeStyle = color('--grid')
      ctx.lineWidth = 2
      polyline(ctx, [[laneLeft, y], [laneRight, y]])
      ctx.strokeStyle = color('--target')
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      polyline(ctx, [[laneLeft + laneSpan, y - 11], [laneLeft + laneSpan, y + 11]])
      ctx.setLineDash([])
      const value = at(run.positions)
      const exploded = !Number.isFinite(value) || Math.abs(value) > 1000
      const x = laneLeft + (value / 100) * laneSpan
      ctx.fillStyle = color(run.token)
      ctx.beginPath()
      ctx.arc(Math.max(laneLeft, Math.min(laneRight, exploded ? laneRight : x)), y, 8, 0, Math.PI * 2)
      ctx.fill()
      if (exploded) {
        ctx.fillStyle = color('--explicit')
        ctx.textAlign = 'right'
        ctx.fillText('blew up', laneRight - 14, y + 4)
        ctx.textAlign = 'left'
      }
    })

    // Curves: each method only knows its value at whole steps, so plot those points.
    const top = 18 + methods.length * 30
    const xRange: [number, number] = [0, DURATION]
    const yRange: [number, number] = [-60, 200]
    const plot = plotArea(frame, xRange, yRange, { left: 44, right: 12, top, bottom: 26 })
    grid(frame, plot, xRange, yRange, { x: (v) => `${v}s`, y: (v) => `${Math.round(v)}` })
    ctx.save()
    clip(ctx, plot)
    ctx.strokeStyle = color('--target')
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    polyline(ctx, [[plot.left, plot.y(100)], [plot.left + plot.width, plot.y(100)]])
    ctx.setLineDash([])
    for (const run of runs) {
      const exact = run.method === 'exact'
      ctx.strokeStyle = color(run.token)
      ctx.lineWidth = exact ? 5 : 2
      ctx.globalAlpha = exact ? 0.35 : 1
      const points: [number, number][] = []
      for (let i = 0; i <= Math.min(lastIndex, run.positions.length - 1); i++) {
        const value = Math.max(-1e4, Math.min(1e4, run.positions[i]))
        points.push([plot.x(i * dt), plot.y(Number.isFinite(value) ? value : 1e4)])
      }
      polyline(ctx, points)
      // Dots at each step make a coarse dt visible.
      if (!exact && dt >= 0.025) {
        ctx.fillStyle = color(run.token)
        for (const [px, py] of points) ctx.fillRect(px - 1.5, py - 1.5, 3, 3)
      }
      ctx.globalAlpha = 1
    }
    ctx.restore()
  })

  const play = () => {
    stopRef.current?.()
    time.current = 0
    stopRef.current = onFrame((elapsed) => {
      time.current = Math.min(DURATION, time.current + Math.min(elapsed, 1 / 15))
      redraw()
      if (time.current >= DURATION) {
        stopRef.current?.()
        stopRef.current = null
      }
    })
  }

  useEffect(() => {
    play()
    return () => stopRef.current?.()
  }, [runs])

  const omega = Math.sqrt(config.stiffness / config.mass)

  return (
    <section className="card">
      <div className="section-head">
        <span className="step">7</span>
        <div>
          <h2>Integrator race</h2>
          <p>
            A computer can't follow the formula continuously. It jumps forward in small time steps
            <var> dt</var>: work out the force, nudge the velocity, nudge the position, repeat. How you
            nudge matters. Make <var>dt</var> bigger and watch the methods drift apart from the exact
            answer.
          </p>
        </div>
      </div>

      <label className="slider">
        <span className="slider-label">
          <span>Time step <var>dt</var></span>
          <output>
            {dt * 1000} ms {dt === 0.016 ? '(about one frame at 60 fps)' : ''}
          </output>
        </span>
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={stepIndex}
          onChange={(e) => setStepIndex(Number(e.target.value))}
        />
      </label>

      <canvas ref={ref} className="canvas canvas-tall" aria-label="Integration methods racing" />

      <table className="errors">
        <thead>
          <tr>
            <th>Method</th>
            <th>Each step</th>
            <th>Worst error</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><i className="swatch" style={{ background: 'var(--accent)' }} /> Semi-implicit Euler</td>
            <td>new <var>v</var> first, then move with the <em>new</em> <var>v</var></td>
            <td>{formatError(errors[1])}</td>
          </tr>
          <tr>
            <td><i className="swatch" style={{ background: 'var(--rk4)' }} /> RK4</td>
            <td>sample the force 4 times per step and blend</td>
            <td>{formatError(errors[2])}</td>
          </tr>
          <tr>
            <td><i className="swatch" style={{ background: 'var(--explicit)' }} /> Explicit Euler</td>
            <td>move with the <em>old</em> <var>v</var>, then update <var>v</var></td>
            <td>{formatError(errors[3])}</td>
          </tr>
        </tbody>
      </table>
      <p className="hint">
        Rough stability limit for the Euler methods: <var>dt</var> &lt; 2/ω₀ = {((2 / omega) * 1000).toFixed(0)} ms
        with these settings (less with heavy damping). Explicit Euler gains a little energy every step, so
        with little damping it spirals outwards even below that limit. The library steps at 1 ms
        with semi-implicit Euler.
      </p>
      <div className="row">
        <button className="primary" onClick={play}>Race again</button>
      </div>
    </section>
  )
}

function formatError(error: number) {
  if (!Number.isFinite(error) || error > 1000) return 'blew up'
  if (error < 0.001) return error.toExponential(1)
  return error.toFixed(error < 1 ? 3 : 1)
}
