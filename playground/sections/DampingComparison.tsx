import { onFrame, resolveSpring, simulate, type SpringConfig } from 'mini-framer-motion'
import { useEffect, useMemo, useRef } from 'react'
import { clip, grid, plotArea, polyline, useCanvas } from '../canvas'

const SAMPLE = 1 / 120
const DURATION = 3

const cases = [
  { zeta: 0.2, label: 'Underdamped  ζ = 0.2', token: '--under' },
  { zeta: 1, label: 'Critically damped  ζ = 1', token: '--critical' },
  { zeta: 3, label: 'Overdamped  ζ = 3', token: '--over' },
] as const

export function DampingComparison({ config }: { config: SpringConfig }) {
  const { stiffness, mass } = config

  // Same k and m as the controls; only c changes, chosen to hit each ζ.
  const runs = useMemo(
    () =>
      cases.map((c) => {
        const damping = c.zeta * 2 * Math.sqrt(stiffness * mass)
        const result = simulate(0, 100, resolveSpring({ stiffness, mass, damping }), {
          maxDuration: DURATION,
          sampleEvery: SAMPLE,
        })
        return { ...c, damping, result }
      }),
    [stiffness, mass],
  )

  const time = useRef(0)
  const stopRef = useRef<(() => void) | null>(null)

  const positionAt = (run: (typeof runs)[number], t: number) => {
    const { samples, settled } = run.result
    const last = samples[samples.length - 1]
    if (t >= last.t) return settled ? 100 : last.position
    // Samples are evenly spaced except the final "settled" one, so look up by spacing.
    const spacing = samples.length > 1 ? samples[1].t - samples[0].t : SAMPLE
    const index = Math.min(samples.length - 1, Math.max(0, Math.round(t / spacing)))
    return samples[index].position
  }

  const { ref, redraw } = useCanvas((frame) => {
    const { ctx, width, color } = frame
    const t = time.current

    // Lanes with a ball each
    const laneTop = 8
    const laneH = 30
    const laneLeft = 150
    const laneRight = width - 24
    ctx.textAlign = 'left'
    runs.forEach((run, i) => {
      const y = laneTop + i * (laneH + 8) + laneH / 2
      ctx.fillStyle = color('--muted')
      ctx.fillText(run.label, 0, y + 4)
      ctx.strokeStyle = color('--grid')
      ctx.lineWidth = 2
      polyline(ctx, [[laneLeft, y], [laneRight, y]])
      ctx.strokeStyle = color('--target')
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1
      const targetX = laneLeft + (laneRight - laneLeft) * 0.6
      polyline(ctx, [[targetX, y - 13], [targetX, y + 13]])
      ctx.setLineDash([])
      const x = laneLeft + (positionAt(run, t) / 100) * (laneRight - laneLeft) * 0.6
      ctx.fillStyle = color(run.token)
      ctx.beginPath()
      ctx.arc(Math.max(laneLeft, Math.min(laneRight, x)), y, 10, 0, Math.PI * 2)
      ctx.fill()
    })

    // Curves drawn up to the current time
    const top = laneTop + cases.length * (laneH + 8) + 12
    let hi = 100
    for (const run of runs) for (const s of run.result.samples) hi = Math.max(hi, s.position)
    const xRange: [number, number] = [0, DURATION]
    const yRange: [number, number] = [-5, hi * 1.05]
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
      ctx.strokeStyle = color(run.token)
      ctx.lineWidth = 2
      const points: [number, number][] = []
      for (let s = 0; s <= t + 1e-9; s += SAMPLE) points.push([plot.x(s), plot.y(positionAt(run, s))])
      polyline(ctx, points)
    }
    ctx.restore()
  })

  const play = () => {
    stopRef.current?.()
    time.current = 0
    stopRef.current = onFrame((dt) => {
      time.current = Math.min(DURATION, time.current + Math.min(dt, 1 / 15))
      redraw()
      if (time.current >= DURATION) {
        stopRef.current?.()
        stopRef.current = null
      }
    })
  }

  // Replay whenever k or m changes.
  useEffect(() => {
    play()
    return () => stopRef.current?.()
  }, [runs])

  return (
    <section className="card">
      <div className="section-head">
        <span className="step">6</span>
        <div>
          <h2>Three kinds of damping</h2>
          <p>
            Same stiffness and mass as your controls, three damping values, released together. The
            damping ratio ζ = <var>c</var> / 2√(<var>k</var>·<var>m</var>) decides the character of the
            motion: below 1 it bounces, at exactly 1 it arrives fastest without overshooting, above 1
            it crawls.
          </p>
        </div>
      </div>
      <canvas ref={ref} className="canvas canvas-tall" aria-label="Three springs with different damping" />
      <div className="legend">
        {runs.map((run) => (
          <span key={run.zeta}>
            <i className="swatch" style={{ background: `var(${run.token})` }} /> c = {run.damping.toFixed(1)}
            {run.result.settled ? `, settles in ${(run.result.duration * 1000).toFixed(0)} ms` : ', still moving after 3 s'}
          </span>
        ))}
      </div>
      <div className="row">
        <button className="primary" onClick={play}>Release all three</button>
      </div>
    </section>
  )
}
