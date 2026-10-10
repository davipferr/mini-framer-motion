import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionValue } from './motion-value'
import { resolveSpring, simulate } from './spring'

// MotionValue subscribes to the shared rAF loop. In Node there's no rAF, so
// stub it out and drive the value by hand with `advance`.
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const frame = 1 / 60
const config = { stiffness: 170, damping: 26 }

function advance(value: MotionValue, frames: number) {
  for (let i = 0; i < frames; i++) value.advance(frame)
}

describe('MotionValue', () => {
  it('animates to the target and resolves true', async () => {
    const value = new MotionValue(0)
    const done = value.start(100, config)
    advance(value, 600)
    await expect(done).resolves.toBe(true)
    expect(value.get()).toBe(100)
    expect(value.getVelocity()).toBe(0)
    expect(value.isAnimating()).toBe(false)
  })

  it('notifies listeners on every frame', () => {
    const value = new MotionValue(0)
    const seen: number[] = []
    value.on((v) => seen.push(v))
    void value.start(100, config)
    advance(value, 5)
    expect(seen).toHaveLength(5)
    expect(seen[4]).toBeGreaterThan(seen[0])
  })

  it('carries velocity over when interrupted', async () => {
    const value = new MotionValue(0)
    const first = value.start(100, config)
    advance(value, 10)

    const position = value.get()
    const velocity = value.getVelocity()
    expect(velocity).toBeGreaterThan(0) // moving towards 100

    // Redirect back to 0 mid-flight.
    const second = value.start(0, config)
    await expect(first).resolves.toBe(false)

    // The new spring starts from the old position *and* the old velocity…
    value.advance(0.001)
    expect(value.get()).toBeGreaterThan(position) // …so it keeps going up for a moment
    expect(value.getVelocity()).toBeGreaterThan(0)

    // …before turning around, exactly as the physics predicts.
    const expected = simulate(position, 0, resolveSpring(config), { velocity }).samples
    const peak = Math.max(...expected.map((s) => s.position))
    let observedPeak = value.get()
    for (let i = 0; i < 60; i++) {
      value.advance(frame)
      observedPeak = Math.max(observedPeak, value.get())
    }
    expect(observedPeak).toBeCloseTo(peak, 0)

    advance(value, 600)
    await expect(second).resolves.toBe(true)
    expect(value.get()).toBe(0)
  })

  it('without velocity carry-over the motion would reverse instantly', () => {
    const value = new MotionValue(0)
    void value.start(100, config)
    advance(value, 10)
    const position = value.get()
    value.set(position) // set() drops velocity
    void value.start(0, config)
    value.advance(0.001)
    expect(value.get()).toBeLessThan(position)
  })

  it('stop() keeps velocity, set() drops it unless asked', () => {
    const value = new MotionValue(0)
    void value.start(100, config)
    advance(value, 5)
    value.stop()
    expect(value.getVelocity()).not.toBe(0)
    value.set(50, { keepVelocity: true })
    expect(value.getVelocity()).not.toBe(0)
    value.set(50)
    expect(value.getVelocity()).toBe(0)
  })

  it('resolves immediately when already at the target', async () => {
    const value = new MotionValue(10)
    await expect(value.start(10)).resolves.toBe(true)
  })
})
