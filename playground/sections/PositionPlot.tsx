import { MotionValue, analyticSpring, simulate, type SpringConfig } from 'mini-framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { clip, grid, plotArea, polyline, useCanvas } from '../canvas'

interface TracePoint {
  t: number
  x: number
}

export function PositionPlot({ config, velocity }: { config: SpringConfig; velocity: number }) {
  const [showExact, setShowExact] = useState(true)
  const result = useMemo(
    () => simulate(0, 100, config, { velocity, maxDuration: 6 }),
    [config, velocity],
  )
  const trace = useRef<TracePoint[]>([])
  const traceStart = useRef(0)

  const { ref, redraw } = useCanvas((frame) => {
    const { ctx, color } = frame
    const tMax = Math.min(6, Math.max(0.5, result.duration * 1.1))
    let lo = 0
    let hi = 100
    for (const s of result.samples) {
      lo = Math.min(lo, s.position)
      hi = Math.max(hi, s.position)
    }
    for (const p of trace.current) {
      if (p.t > tMax) break
      lo = Math.min(lo, p.x)
      hi = Math.max(hi, p.x)
    }
    const margin = (hi - lo) * 0.08
    const xRange: [number, number] = [0, tMax]
    const yRange: [number, number] = [lo - margin, hi + margin]
    const plot = plotArea(frame, xRange, yRange)
    grid(frame, plot, xRange, yRange, { x: (v) => `${+v.toFixed(2)}s`, y: (v) => `${Math.round(v)}` })

    ctx.save()
    clip(ctx, plot)

    ctx.strokeStyle = color('--target')
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    polyline(ctx, [[plot.left, plot.y(100)], [plot.left + plot.width, plot.y(100)]])
    ctx.setLineDash([])

    if (showExact) {
      ctx.strokeStyle = color('--exact')
      ctx.lineWidth = 5
      ctx.globalAlpha = 0.35
      polyline(
        ctx,
        Array.from({ length: 301 }, (_, i) => {
          const t = (i / 300) * tMax
          return [plot.x(t), plot.y(analyticSpring(0, 100, velocity, config, t).position)] as [number, number]
        }),
      )
      ctx.globalAlpha = 1
    }

    ctx.strokeStyle = color('--accent')
    ctx.lineWidth = 2
    const points = result.samples.map((s) => [plot.x(s.t), plot.y(s.position)] as [number, number])
    if (result.settled) points.push([plot.x(tMax), plot.y(100)])
    polyline(ctx, points)

    if (trace.current.length > 1) {
      ctx.strokeStyle = color('--live')
      ctx.lineWidth = 2
      polyline(ctx, trace.current.map((p) => [plot.x(p.t), plot.y(p.x)] as [number, number]))
    }
    ctx.restore()

    if (result.settled && result.duration <= tMax) {
      ctx.fillStyle = color('--accent')
      ctx.beginPath()
      ctx.arc(plot.x(result.duration), plot.y(100), 4, 0, Math.PI * 2)
      ctx.fill()
    }
  })

  // The ball is a raw MotionValue: exactly what motion.div uses internally.
  const value = useMemo(() => new MotionValue(0), [])
  const ballRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState(0)

  useEffect(() => {
    const render = (x: number) => {
      const ball = ballRef.current
      const track = trackRef.current
      if (!ball || !track) return
      const travel = track.clientWidth - ball.offsetWidth - 12
      ball.style.transform = `translateX(${(x / 100) * travel}px)`
      trace.current.push({ t: (performance.now() - traceStart.current) / 1000, x })
      redraw()
    }
    const off = value.on(render)
    render(value.get())
    return () => {
      off()
      value.stop()
    }
  }, [value, redraw])

  const play = () => {
    const next = target === 100 ? 0 : 100
    setTarget(next)
    if (!value.isAnimating()) {
      trace.current = []
      traceStart.current = performance.now()
    }
    void value.start(next, config)
  }

  const reset = () => {
    value.set(0)
    setTarget(0)
    trace.current = []
    redraw()
  }

  return (
    <section className="card">
      <div className="section-head">
        <span className="step">1</span>
        <div>
          <h2>Position over time</h2>
          <p>
            Where the object is, moment by moment, as it springs from 0 to 100. The blue curve is the
            simulation stepped every 1 ms. The wide amber curve is the exact formula.
          </p>
        </div>
      </div>

      <canvas ref={ref} className="canvas" aria-label="Position over time" />
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--accent)' }} /> simulated</span>
        {showExact && <span><i className="swatch" style={{ background: 'var(--exact)' }} /> exact</span>}
        <span><i className="swatch" style={{ background: 'var(--live)' }} /> the ball below</span>
        <label className="checkbox">
          <input type="checkbox" checked={showExact} onChange={(e) => setShowExact(e.target.checked)} />
          show exact solution
        </label>
      </div>

      <div className="track" ref={trackRef}>
        <div className="ball" ref={ballRef} />
      </div>
      <div className="row">
        <button className="primary" onClick={play}>Send ball to {target === 100 ? 0 : 100}</button>
        <button onClick={reset}>Reset</button>
        <span className="hint">
          Click again while it's moving: it keeps its speed and the pink trace bends instead of jerking.
        </span>
      </div>
    </section>
  )
}
