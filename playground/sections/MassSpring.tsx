import { useRef } from 'react'
import { arrow, useCanvas, useLive, type Frame } from '../canvas'
import type { LiveSpring } from '../physics'
import { ReleaseButtons } from './ReleaseButtons'

const BLOCK = 56
/** Displacement (in units) that fits on each side of the rest position. */
const REACH = 130

function geometry(width: number, height: number) {
  const wall = 18
  const rest = wall + (width - wall) * 0.52
  const scale = ((width - rest - BLOCK / 2 - 8) / REACH)
  const floor = height - 24
  const centerY = floor - BLOCK / 2
  return { wall, rest, scale, floor, centerY }
}

function drawCoil(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, turns: number, amp: number) {
  const lead = 10
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x1 + lead, y)
  const span = x2 - x1 - lead * 2
  const segments = turns * 2
  for (let i = 0; i < segments; i++) {
    const x = x1 + lead + ((i + 0.5) / segments) * span
    ctx.lineTo(x, y + (i % 2 === 0 ? -amp : amp))
  }
  ctx.lineTo(x2 - lead, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
}

export function MassSpring({ sim, velocity }: { sim: LiveSpring; velocity: number }) {
  const readout = useRef<HTMLDivElement>(null)

  const draw = ({ ctx, width, height, color }: Frame) => {
    const { wall, rest, scale, floor, centerY } = geometry(width, height)
    const x = Math.max(-REACH * 1.6, Math.min(REACH * 1.15, sim.x))
    const blockLeft = rest + x * scale - BLOCK / 2

    // Floor and wall
    ctx.fillStyle = color('--grid')
    ctx.fillRect(0, floor, width, 2)
    ctx.fillRect(wall - 6, floor - 120, 6, 122)

    // Rest position marker
    ctx.strokeStyle = color('--target')
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(rest, floor - 118)
    ctx.lineTo(rest, floor)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = color('--muted')
    ctx.textAlign = 'center'
    ctx.fillText('x = 0 (rest)', rest, floor + 16)

    // Spring (k), above the center line
    const springY = centerY - 12
    ctx.strokeStyle = color('--text')
    ctx.lineWidth = 2
    drawCoil(ctx, wall, Math.max(wall + 30, blockLeft), springY, 10, 9)

    // Damper / dashpot (c), below: a cylinder on the wall, a piston on the block
    const damperY = centerY + 14
    const cylinderEnd = wall + Math.max(40, (rest - BLOCK / 2 - wall) * 0.55)
    ctx.strokeStyle = color('--muted')
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(wall, damperY)
    ctx.lineTo(wall + 12, damperY)
    ctx.moveTo(wall + 12, damperY - 7)
    ctx.lineTo(cylinderEnd, damperY - 7)
    ctx.moveTo(wall + 12, damperY + 7)
    ctx.lineTo(cylinderEnd, damperY + 7)
    ctx.moveTo(wall + 12, damperY - 7)
    ctx.lineTo(wall + 12, damperY + 7)
    ctx.stroke()
    const pistonX = Math.max(wall + 18, Math.min(cylinderEnd - 4, blockLeft - (rest - BLOCK / 2 - cylinderEnd) - 10))
    ctx.beginPath()
    ctx.moveTo(pistonX, damperY - 5)
    ctx.lineTo(pistonX, damperY + 5)
    ctx.moveTo(pistonX, damperY)
    ctx.lineTo(Math.max(pistonX, blockLeft), damperY)
    ctx.stroke()

    // Block
    ctx.fillStyle = sim.grabbed ? color('--live') : color('--accent')
    ctx.beginPath()
    ctx.roundRect(blockLeft, floor - BLOCK, BLOCK, BLOCK, 8)
    ctx.fill()
    ctx.fillStyle = color('--accent-text')
    ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText('m', blockLeft + BLOCK / 2, floor - BLOCK / 2 + 5)
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'

    // Force and velocity arrows above the block, normalised to the spring's scale
    const { stiffness, mass } = sim.config
    const forceScale = 90 / (stiffness * 100)
    const velocityScale = 90 / (Math.sqrt(stiffness / mass) * 100)
    const cx = blockLeft + BLOCK / 2
    const clampLen = (v: number) => Math.max(-width * 0.4, Math.min(width * 0.4, v))
    const fLen = clampLen(sim.force * forceScale)
    const vLen = clampLen(sim.v * velocityScale)
    arrow(ctx, cx, floor - BLOCK - 34, cx + fLen, floor - BLOCK - 34, color('--force'))
    arrow(ctx, cx, floor - BLOCK - 14, cx + vLen, floor - BLOCK - 14, color('--velocity'))
    ctx.textAlign = fLen >= 0 ? 'left' : 'right'
    ctx.fillStyle = color('--force')
    if (Math.abs(fLen) > 2) ctx.fillText('F', cx + fLen + (fLen >= 0 ? 6 : -6), floor - BLOCK - 30)
    ctx.textAlign = vLen >= 0 ? 'left' : 'right'
    ctx.fillStyle = color('--velocity')
    if (Math.abs(vLen) > 2) ctx.fillText('v', cx + vLen + (vLen >= 0 ? 6 : -6), floor - BLOCK - 10)
  }

  const { ref, redraw } = useCanvas(draw)
  useLive(sim, () => {
    redraw()
    if (readout.current) {
      readout.current.textContent =
        `x = ${sim.x.toFixed(1)}   v = ${sim.v.toFixed(0)}   F = ${sim.force.toFixed(0)}`
    }
  })

  // Drag the block with the mouse or a finger.
  const toUnits = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const { rest, scale } = geometry(canvas.clientWidth, canvas.clientHeight)
    const units = (event.clientX - rect.left - rest) / scale
    return Math.max(-REACH * 1.5, Math.min(REACH, units))
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const { rest, scale, floor } = geometry(canvas.clientWidth, canvas.clientHeight)
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const blockCenter = rest + sim.x * scale
    if (Math.abs(px - blockCenter) > BLOCK / 2 + 10 || py < floor - BLOCK - 10 || py > floor + 10) return
    canvas.setPointerCapture(event.pointerId)
    sim.grab()
    sim.drag(toUnits(event))
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (sim.grabbed) sim.drag(toUnits(event))
  }

  return (
    <section className="card">
      <div className="section-head">
        <span className="step">2</span>
        <div>
          <h2>Mass on a spring</h2>
          <p>
            The physical picture behind every animation: a block on a spring (<var>k</var>) with a damper
            (<var>c</var>) that acts like friction. <strong>Drag the block</strong> and let go, or flick it.
          </p>
        </div>
      </div>
      <canvas
        ref={ref}
        className="canvas canvas-short draggable"
        aria-label="Mass on a spring, draggable"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => sim.letGo()}
        onPointerCancel={() => sim.letGo()}
      />
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--force)' }} /> force F (pulls back to rest)</span>
        <span><i className="swatch" style={{ background: 'var(--velocity)' }} /> velocity v</span>
        <span className="mono" ref={readout} />
      </div>
      <ReleaseButtons sim={sim} velocity={velocity} />
    </section>
  )
}
