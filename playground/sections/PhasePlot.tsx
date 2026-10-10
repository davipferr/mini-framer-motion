import { dampingKind } from 'mini-framer-motion'
import { clip, grid, plotArea, useCanvas, useLive, type Frame } from '../canvas'
import type { LiveSpring } from '../physics'
import { ReleaseButtons } from './ReleaseButtons'

const descriptions = {
  underdamped: 'Underdamped: the path spirals into the center, once around per swing.',
  critically: 'Critically damped: it heads straight for the center without circling.',
  overdamped: 'Overdamped: it slides slowly into the center along a line.',
}

export function PhasePlot({ sim, velocity }: { sim: LiveSpring; velocity: number }) {
  const kind = dampingKind(sim.config).split(' ')[0] as keyof typeof descriptions
  const undamped = sim.config.damping === 0

  const draw = (frame: Frame) => {
    const { ctx, color } = frame
    const history = sim.history

    // Symmetric ranges sized to the whole trail. Velocity is shown in units of
    // ω₀·x so that an undamped spring draws a circle rather than an ellipse.
    const omega = Math.sqrt(sim.config.stiffness / sim.config.mass)
    let reach = 10
    for (const s of history) reach = Math.max(reach, Math.abs(s.x), Math.abs(s.v / omega))
    reach *= 1.1
    const pad = { left: 44, right: 12, top: 12, bottom: 26 }
    const side = Math.min(frame.width - pad.left - pad.right, frame.height - pad.top - pad.bottom)
    const extraX = (frame.width - pad.left - pad.right - side) / 2
    const range: [number, number] = [-reach, reach]
    const area = { ...pad, left: pad.left + extraX, right: pad.right + extraX }
    const plot = plotArea(frame, range, range, area)
    // Same pixels, labelled in real velocity units so the ticks land on round numbers.
    const velocityRange: [number, number] = [-reach * omega, reach * omega]
    grid(frame, plotArea(frame, range, velocityRange, area), range, velocityRange, {
      x: (v) => `${Math.round(v)}`,
      y: (v) => `${Math.round(v)}`,
    })

    // Axes through the origin
    ctx.strokeStyle = color('--target')
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(plot.x(-reach), plot.y(0))
    ctx.lineTo(plot.x(reach), plot.y(0))
    ctx.moveTo(plot.x(0), plot.y(-reach))
    ctx.lineTo(plot.x(0), plot.y(reach))
    ctx.stroke()
    ctx.fillStyle = color('--muted')
    ctx.textAlign = 'right'
    ctx.fillText('position x →', plot.left + plot.width - 4, plot.y(0) - 6)
    ctx.textAlign = 'left'
    ctx.fillText('↑ velocity v', plot.x(0) + 6, plot.top + 12)

    ctx.save()
    clip(ctx, plot)
    // Trail fades with age.
    ctx.strokeStyle = color('--accent')
    ctx.lineWidth = 2
    const n = history.length
    for (let i = 1; i < n; i++) {
      ctx.globalAlpha = 0.15 + 0.85 * (i / n)
      ctx.beginPath()
      ctx.moveTo(plot.x(history[i - 1].x), plot.y(history[i - 1].v / omega))
      ctx.lineTo(plot.x(history[i].x), plot.y(history[i].v / omega))
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.restore()

    ctx.fillStyle = color('--live')
    ctx.beginPath()
    ctx.arc(plot.x(sim.x), plot.y(sim.v / omega), 6, 0, Math.PI * 2)
    ctx.fill()
  }

  const { ref, redraw } = useCanvas(draw)
  useLive(sim, redraw)

  return (
    <section className="card">
      <div className="section-head">
        <span className="step">5</span>
        <div>
          <h2>Phase space</h2>
          <p>
            Plot position against velocity and time disappears: each instant becomes one point, and
            the motion becomes a shape. The center (0, 0) is "at rest".
          </p>
        </div>
      </div>
      <canvas ref={ref} className="canvas canvas-square" aria-label="Phase plot of position against velocity" />
      <p className="callout">
        {undamped
          ? 'No damping: the point goes round the same circle forever. Nothing removes energy.'
          : descriptions[kind]}
      </p>
      <ReleaseButtons sim={sim} velocity={velocity} />
    </section>
  )
}
