import { clip, grid, plotArea, polyline, useCanvas, useLive, type Frame } from '../canvas'
import { LiveSpring, motionEnergy, springEnergy } from '../physics'
import { ReleaseButtons } from './ReleaseButtons'

export function EnergyChart({ sim, velocity }: { sim: LiveSpring; velocity: number }) {
  const draw = (frame: Frame) => {
    const { ctx, width, color } = frame
    const history = sim.history
    const { config } = sim
    const share = (energy: number) => (energy / sim.releaseEnergy) * 100

    // Grow the window with the experiment, then scroll once it's full.
    const tEnd = Math.max(3, sim.t)
    const xRange: [number, number] = [Math.max(0, tEnd - LiveSpring.historySeconds), tEnd]
    let peak = 100
    for (const s of history) peak = Math.max(peak, share(springEnergy(s.x, config) + motionEnergy(s.v, config)))
    const yRange: [number, number] = [0, Math.min(400, peak * 1.08)]

    const barSpace = 70
    const plot = plotArea({ ...frame, width: width - barSpace }, xRange, yRange)
    grid(frame, plot, xRange, yRange, { x: (v) => `${+v.toFixed(1)}s`, y: (v) => `${Math.round(v)}%` })

    ctx.save()
    clip(ctx, plot)
    const series: [string, (x: number, v: number) => number, number][] = [
      ['--spring-energy', (x) => share(springEnergy(x, config)), 2],
      ['--motion-energy', (_, v) => share(motionEnergy(v, config)), 2],
      ['--text', (x, v) => share(springEnergy(x, config) + motionEnergy(v, config)), 2.5],
    ]
    for (const [token, value, lineWidth] of series) {
      ctx.strokeStyle = color(token)
      ctx.lineWidth = lineWidth
      polyline(ctx, history.map((s) => [plot.x(s.t), plot.y(value(s.x, s.v))] as [number, number]))
    }
    ctx.restore()

    // Current split as a stacked bar on the right.
    const pe = Math.max(0, share(springEnergy(sim.x, config)))
    const ke = Math.max(0, share(motionEnergy(sim.v, config)))
    const barX = plot.left + plot.width + 26
    const barW = 26
    const y0 = plot.y(0)
    const clampY = (v: number) => Math.max(plot.top, plot.y(v))
    ctx.fillStyle = color('--grid')
    ctx.fillRect(barX, plot.top, barW, plot.height)
    ctx.fillStyle = color('--spring-energy')
    ctx.fillRect(barX, clampY(pe), barW, y0 - clampY(pe))
    ctx.fillStyle = color('--motion-energy')
    ctx.fillRect(barX, clampY(pe + ke), barW, clampY(pe) - clampY(pe + ke))
    ctx.fillStyle = color('--muted')
    ctx.textAlign = 'center'
    ctx.fillText('now', barX + barW / 2, plot.top + plot.height + 16)
  }

  const { ref, redraw } = useCanvas(draw)
  useLive(sim, redraw)

  return (
    <section className="card">
      <div className="section-head">
        <span className="step">4</span>
        <div>
          <h2>Energy</h2>
          <p>
            A stretched spring stores energy, <var>E</var><sub>spring</sub> = ½·<var>k</var>·<var>x</var>².
            A moving mass carries energy, <var>E</var><sub>motion</sub> = ½·<var>m</var>·<var>v</var>². As the block
            swings they trade back and forth. The damper turns some into heat every instant, so the total
            (thickest line) only goes down. Set damping to 0 and the total stays flat: energy is conserved.
          </p>
        </div>
      </div>
      <canvas ref={ref} className="canvas" aria-label="Energy over time" />
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--spring-energy)' }} /> spring energy ½kx²</span>
        <span><i className="swatch" style={{ background: 'var(--motion-energy)' }} /> motion energy ½mv²</span>
        <span><i className="swatch" style={{ background: 'var(--text)' }} /> total</span>
        <span className="muted">100% = energy at the moment of release</span>
      </div>
      <ReleaseButtons sim={sim} velocity={velocity} />
    </section>
  )
}
