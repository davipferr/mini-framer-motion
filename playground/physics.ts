import {
  FIXED_DT,
  analyticSpring,
  isAtRest,
  onFrame,
  step,
  stepEuler,
  stepRK4,
  type SpringConfig,
  type SpringState,
} from 'mini-framer-motion'

/** Potential energy stored in the spring: ½·k·x² */
export const springEnergy = (x: number, config: SpringConfig) => 0.5 * config.stiffness * x * x

/** Kinetic energy of the mass: ½·m·v² */
export const motionEnergy = (v: number, config: SpringConfig) => 0.5 * config.mass * v * v

/** Plain (explicit) Euler: moves with the *old* velocity. Gains energy every step. */
export function stepExplicitEuler(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number,
): SpringState {
  const a = (-config.stiffness * (state.position - target) - config.damping * state.velocity) / config.mass
  return {
    position: state.position + state.velocity * dt,
    velocity: state.velocity + a * dt,
  }
}

export type Method = 'exact' | 'semi' | 'rk4' | 'explicit'

export const methodLabels: Record<Method, string> = {
  exact: 'Exact solution',
  semi: 'Semi-implicit Euler',
  rk4: 'RK4',
  explicit: 'Explicit Euler',
}

/** Positions at t = 0, dt, 2dt, … for one integration method. */
export function trajectory(
  method: Method,
  from: number,
  to: number,
  config: SpringConfig,
  dt: number,
  duration: number,
): number[] {
  const steps = Math.ceil(duration / dt)
  const positions = [from]
  let state: SpringState = { position: from, velocity: 0 }
  for (let i = 1; i <= steps; i++) {
    if (method === 'exact') {
      state = analyticSpring(from, to, 0, config, i * dt)
    } else if (method === 'semi') {
      state = stepEuler(state, to, config, dt)
    } else if (method === 'rk4') {
      state = stepRK4(state, to, config, dt)
    } else {
      state = stepExplicitEuler(state, to, config, dt)
    }
    positions.push(state.position)
  }
  return positions
}

export interface LiveSample {
  t: number
  x: number
  v: number
}

/**
 * The shared "experiment": a mass on a spring whose rest position is x = 0.
 * Release it, or grab and drag it, and every live view (the drawing, the
 * equation, the energy chart, the phase plot) watches the same state.
 *
 * It runs on the library's frame loop and integrates with the same fixed
 * timestep as `motion` components.
 */
export class LiveSpring {
  x = 0
  v = 0
  /** Seconds since the last release. */
  t = 0
  /** Total energy at the moment of release, so charts can show percentages. */
  releaseEnergy = 1
  grabbed = false
  history: LiveSample[] = []
  config: SpringConfig

  static historySeconds = 8

  private accumulator = 0
  private lastDragX = 0
  private stopLoop: (() => void) | null = null
  private listeners = new Set<() => void>()

  constructor(config: SpringConfig) {
    this.config = config
  }

  get force() {
    return -this.config.stiffness * this.x - this.config.damping * this.v
  }

  get energy() {
    return springEnergy(this.x, this.config) + motionEnergy(this.v, this.config)
  }

  get running() {
    return this.stopLoop !== null
  }

  release(x: number, v = 0) {
    this.x = x
    this.v = v
    this.grabbed = false
    this.restart()
  }

  grab() {
    this.grabbed = true
    this.lastDragX = this.x
    this.v = 0
    this.start()
  }

  drag(x: number) {
    this.x = x
    this.emit()
  }

  /** Let go: whatever speed the hand had becomes the starting velocity. */
  letGo() {
    if (!this.grabbed) return
    this.grabbed = false
    this.restart()
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Stop the frame loop. Subscribers clean themselves up. */
  dispose() {
    this.stopLoop?.()
    this.stopLoop = null
  }

  private restart() {
    this.t = 0
    this.accumulator = 0
    this.history = [{ t: 0, x: this.x, v: this.v }]
    this.releaseEnergy = Math.max(this.energy, 1e-9)
    this.start()
    this.emit()
  }

  private start() {
    if (!this.stopLoop) this.stopLoop = onFrame((dt) => this.tick(dt))
  }

  private tick(seconds: number) {
    const dt = Math.min(seconds, 1 / 15)
    if (dt <= 0) return

    if (this.grabbed) {
      // Estimate the hand's velocity, smoothed so a jittery pointer doesn't spike it.
      const instant = (this.x - this.lastDragX) / dt
      this.v = this.v * 0.6 + instant * 0.4
      this.lastDragX = this.x
      this.releaseEnergy = Math.max(this.energy, 1e-9)
      this.emit()
      return
    }

    this.accumulator += dt
    let state: SpringState = { position: this.x, velocity: this.v }
    let atRest = false
    while (this.accumulator >= FIXED_DT) {
      state = step(state, 0, this.config)
      this.accumulator -= FIXED_DT
      if (isAtRest(state, 0, this.config)) {
        state = { position: 0, velocity: 0 }
        atRest = true
        break
      }
    }
    this.x = state.position
    this.v = state.velocity
    this.t += dt
    this.history.push({ t: this.t, x: this.x, v: this.v })
    while (this.history.length > 0 && this.history[0].t < this.t - LiveSpring.historySeconds) {
      this.history.shift()
    }

    if (atRest) {
      this.stopLoop?.()
      this.stopLoop = null
    }
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}
