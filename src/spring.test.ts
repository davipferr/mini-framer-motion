import { describe, expect, it } from 'vitest'
import {
  FIXED_DT,
  Spring,
  analyticSpring,
  dampingKind,
  dampingRatio,
  resolveSpring,
  simulate,
  step,
  stepEuler,
  type SpringConfig,
} from './spring'

const under = resolveSpring({ stiffness: 200, damping: 8, mass: 1 }) // ζ ≈ 0.28
const critical = resolveSpring({ stiffness: 100, damping: 20, mass: 1 }) // ζ = 1
const over = resolveSpring({ stiffness: 100, damping: 60, mass: 1 }) // ζ = 3

/** Integrate for `seconds` with the fixed timestep, no rest detection. */
function run(from: number, to: number, config: SpringConfig, seconds: number, velocity = 0) {
  let state = { position: from, velocity }
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) state = step(state, to, config)
  return state
}

describe('damping ratio', () => {
  it('classifies springs', () => {
    expect(dampingRatio(critical)).toBeCloseTo(1)
    expect(dampingKind(under)).toBe('underdamped')
    expect(dampingKind(critical)).toBe('critically damped')
    expect(dampingKind(over)).toBe('overdamped')
  })

  it('depends on mass as well as damping', () => {
    // Same k and c, 4x the mass: ζ halves, so a heavy object bounces more.
    expect(dampingRatio({ ...critical, mass: 4 })).toBeCloseTo(0.5)
  })
})

describe('settling', () => {
  for (const [name, config] of [
    ['underdamped', under],
    ['critically damped', critical],
    ['overdamped', over],
  ] as const) {
    it(`${name} springs come to rest exactly on the target`, () => {
      const result = simulate(0, 100, config)
      expect(result.settled).toBe(true)
      const last = result.samples.at(-1)!
      expect(last.position).toBe(100)
      expect(last.velocity).toBe(0)
    })
  }

  it('settles from any direction and with initial velocity', () => {
    expect(simulate(300, -40, under, { velocity: 5000 }).settled).toBe(true)
  })

  it('stiffer springs settle faster', () => {
    const soft = simulate(0, 100, resolveSpring({ stiffness: 100, damping: 20 }))
    const stiff = simulate(0, 100, resolveSpring({ stiffness: 400, damping: 40 }))
    expect(stiff.duration).toBeLessThan(soft.duration)
  })

  it('an undamped spring never settles (energy is conserved)', () => {
    const result = simulate(0, 100, resolveSpring({ damping: 0 }), { maxDuration: 3 })
    expect(result.settled).toBe(false)
    const peak = Math.max(...result.samples.map((s) => s.position))
    // Semi-implicit Euler keeps the amplitude: still swinging out to ~200 after 3s.
    expect(peak).toBeGreaterThan(199)
    expect(peak).toBeLessThan(201)
  })
})

describe('underdamped vs overdamped', () => {
  it('underdamped springs overshoot and oscillate around the target', () => {
    const { samples } = simulate(0, 100, under)
    const positions = samples.map((s) => s.position)
    expect(Math.max(...positions)).toBeGreaterThan(100)

    // Count crossings of the target: more than one means it oscillates.
    let crossings = 0
    for (let i = 1; i < positions.length; i++) {
      if (Math.sign(positions[i - 1] - 100) !== Math.sign(positions[i] - 100)) crossings++
    }
    expect(crossings).toBeGreaterThan(2)
  })

  it('critically damped springs do not overshoot', () => {
    const { samples } = simulate(0, 100, critical)
    expect(Math.max(...samples.map((s) => s.position))).toBeLessThanOrEqual(100)
  })

  it('overdamped springs approach monotonically and never overshoot', () => {
    const { samples } = simulate(0, 100, over)
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].position).toBeGreaterThanOrEqual(samples[i - 1].position)
      expect(samples[i].position).toBeLessThanOrEqual(100)
    }
  })

  it('critically damped is the fastest way to arrive without overshooting', () => {
    const settle = (damping: number) =>
      simulate(0, 100, resolveSpring({ stiffness: 100, damping, restDelta: 0.5, restSpeed: 0.5 }))
        .duration
    expect(settle(20)).toBeLessThan(settle(40))
    expect(settle(20)).toBeLessThan(settle(80))
  })
})

describe('integrators against the exact solution', () => {
  const cases = { under, critical, over }

  for (const [name, config] of Object.entries(cases)) {
    it(`semi-implicit Euler tracks the analytic ${name} spring`, () => {
      for (const t of [0.05, 0.2, 0.5, 1]) {
        const numeric = run(0, 100, config, t, 250)
        const exact = analyticSpring(0, 100, 250, config, t)
        expect(Math.abs(numeric.position - exact.position)).toBeLessThan(0.5)
      }
    })

    it(`RK4 is much more accurate on the ${name} spring`, () => {
      const rk4 = { ...config, integrator: 'rk4' as const }
      const t = 0.5
      const exact = analyticSpring(0, 100, 250, config, t)
      const eulerError = Math.abs(run(0, 100, config, t, 250).position - exact.position)
      const rk4Error = Math.abs(run(0, 100, rk4, t, 250).position - exact.position)
      expect(rk4Error).toBeLessThan(1e-6)
      expect(rk4Error).toBeLessThan(eulerError)
    })
  }

  it('explicit Euler would gain energy; semi-implicit Euler does not', () => {
    const config = resolveSpring({ stiffness: 400, damping: 0 })
    const dt = 1 / 60
    let semi = { position: 100, velocity: 0 }
    let explicit = { position: 100, velocity: 0 }
    for (let i = 0; i < 600; i++) {
      semi = stepEuler(semi, 0, config, dt)
      const a = -config.stiffness * explicit.position
      explicit = {
        position: explicit.position + explicit.velocity * dt, // old velocity
        velocity: explicit.velocity + a * dt,
      }
    }
    expect(Math.abs(semi.position)).toBeLessThan(150)
    expect(Math.abs(explicit.position)).toBeGreaterThan(1e4)
  })
})

describe('Spring (fixed timestep over real frames)', () => {
  it('produces the same result whatever the frame rate', () => {
    const a = new Spring(0, 100, under)
    const b = new Spring(0, 100, under)
    for (let i = 0; i < 60; i++) a.advance(1 / 60) // 60 fps for 1s
    for (let i = 0; i < 144; i++) b.advance(1 / 144) // 144 fps for 1s
    expect(a.position).toBeCloseTo(b.position, 0)
  })

  it('clamps huge frame gaps instead of exploding', () => {
    const spring = new Spring(0, 100, under)
    spring.advance(5) // a backgrounded tab comes back
    expect(spring.position).toBeGreaterThan(0)
    expect(spring.position).toBeLessThan(200)
    expect(spring.done).toBe(false)
  })

  it('is already done when starting at the target with no velocity', () => {
    expect(new Spring(5, 5).done).toBe(true)
    expect(new Spring(5, 5, {}, 100).done).toBe(false)
  })
})
