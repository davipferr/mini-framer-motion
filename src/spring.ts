/**
 * Spring physics, as pure functions.
 *
 * A damped spring pulls a mass towards a target with the force
 *
 *     F = -k·x - c·v
 *
 * where x is the displacement from the target, v the velocity, k the stiffness
 * and c the damping. Newton gives us the acceleration a = F / m. Nothing here
 * knows about time, frames or the DOM: you hand in a state and a timestep, you
 * get a new state back. That makes it trivially testable.
 */

export type Integrator = 'euler' | 'rk4'

export interface SpringConfig {
  /** k — how hard the spring pulls. Higher = faster, snappier. */
  stiffness: number
  /** c — friction proportional to velocity. Higher = less bounce. */
  damping: number
  /** m — inertia. Higher = slower to start and to stop. */
  mass: number
  /** The spring is "at rest" when |x| is below this … */
  restDelta: number
  /** … and |v| is below this. */
  restSpeed: number
  /** Semi-implicit Euler (cheap, stable enough) or RK4 (accurate). */
  integrator: Integrator
}

export interface SpringState {
  position: number
  velocity: number
}

export const defaultSpring: SpringConfig = {
  stiffness: 170,
  damping: 26,
  mass: 1,
  restDelta: 0.01,
  restSpeed: 0.01,
  integrator: 'euler',
}

/** Physics steps are always this long (seconds), regardless of frame rate. */
export const FIXED_DT = 1 / 1000

export function resolveSpring(config: Partial<SpringConfig> = {}): SpringConfig {
  return { ...defaultSpring, ...config }
}

/** a = F / m = (-k·x - c·v) / m, with x measured from the target. */
export function acceleration(
  position: number,
  velocity: number,
  target: number,
  { stiffness, damping, mass }: SpringConfig,
): number {
  const x = position - target
  return (-stiffness * x - damping * velocity) / mass
}

/**
 * Semi-implicit (symplectic) Euler: update velocity first, then use the *new*
 * velocity to update position. Explicit Euler (old velocity) gains energy every
 * step and an undamped spring would spiral outwards; this variant doesn't.
 */
export function stepEuler(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number,
): SpringState {
  const a = acceleration(state.position, state.velocity, target, config)
  const velocity = state.velocity + a * dt
  const position = state.position + velocity * dt
  return { position, velocity }
}

/**
 * Classic 4th-order Runge–Kutta. Samples the derivative four times per step and
 * blends them, which is far more accurate for the same dt.
 */
export function stepRK4(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number,
): SpringState {
  const { position: x, velocity: v } = state
  const accel = (px: number, pv: number) => acceleration(px, pv, target, config)

  const k1x = v
  const k1v = accel(x, v)

  const k2x = v + (k1v * dt) / 2
  const k2v = accel(x + (k1x * dt) / 2, k2x)

  const k3x = v + (k2v * dt) / 2
  const k3v = accel(x + (k2x * dt) / 2, k3x)

  const k4x = v + k3v * dt
  const k4v = accel(x + k3x * dt, k4x)

  return {
    position: x + ((k1x + 2 * k2x + 2 * k3x + k4x) * dt) / 6,
    velocity: v + ((k1v + 2 * k2v + 2 * k3v + k4v) * dt) / 6,
  }
}

export function step(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number = FIXED_DT,
): SpringState {
  return config.integrator === 'rk4'
    ? stepRK4(state, target, config, dt)
    : stepEuler(state, target, config, dt)
}

export function isAtRest(state: SpringState, target: number, config: SpringConfig): boolean {
  return (
    Math.abs(state.position - target) < config.restDelta &&
    Math.abs(state.velocity) < config.restSpeed
  )
}

/**
 * ζ = c / (2·√(k·m)).
 *   ζ < 1 underdamped: oscillates around the target, amplitude decays
 *   ζ = 1 critically damped: fastest approach with no overshoot
 *   ζ > 1 overdamped: creeps towards the target, never crosses it
 */
export function dampingRatio({ stiffness, damping, mass }: SpringConfig): number {
  return damping / (2 * Math.sqrt(stiffness * mass))
}

export type DampingKind = 'underdamped' | 'critically damped' | 'overdamped'

export function dampingKind(config: SpringConfig, tolerance = 1e-3): DampingKind {
  const zeta = dampingRatio(config)
  if (Math.abs(zeta - 1) <= tolerance) return 'critically damped'
  return zeta < 1 ? 'underdamped' : 'overdamped'
}

/**
 * The closed-form solution of the damped harmonic oscillator, for comparison
 * with the integrators (and for the tests). Returns the state `t` seconds after
 * starting at `from` with `velocity`, heading for `to`.
 */
export function analyticSpring(
  from: number,
  to: number,
  velocity: number,
  config: SpringConfig,
  t: number,
): SpringState {
  const x0 = from - to
  const v0 = velocity
  const w0 = Math.sqrt(config.stiffness / config.mass) // natural frequency
  const zeta = dampingRatio(config)

  let x: number
  let v: number

  if (Math.abs(zeta - 1) < 1e-9) {
    // x(t) = e^(-w0·t)·(x0 + (v0 + w0·x0)·t)
    const B = v0 + w0 * x0
    const e = Math.exp(-w0 * t)
    x = e * (x0 + B * t)
    v = e * (B - w0 * (x0 + B * t))
  } else if (zeta < 1) {
    // x(t) = e^(-ζ·w0·t)·(x0·cos(wd·t) + B·sin(wd·t))
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    const B = (v0 + zeta * w0 * x0) / wd
    const e = Math.exp(-zeta * w0 * t)
    const cos = Math.cos(wd * t)
    const sin = Math.sin(wd * t)
    x = e * (x0 * cos + B * sin)
    v = e * (-zeta * w0 * (x0 * cos + B * sin) + wd * (-x0 * sin + B * cos))
  } else {
    // x(t) = C1·e^(r1·t) + C2·e^(r2·t), two real negative roots
    const root = w0 * Math.sqrt(zeta * zeta - 1)
    const r1 = -zeta * w0 + root
    const r2 = -zeta * w0 - root
    const C2 = (v0 - r1 * x0) / (r2 - r1)
    const C1 = x0 - C2
    x = C1 * Math.exp(r1 * t) + C2 * Math.exp(r2 * t)
    v = C1 * r1 * Math.exp(r1 * t) + C2 * r2 * Math.exp(r2 * t)
  }

  return { position: to + x, velocity: v }
}

export interface SpringSample extends SpringState {
  /** seconds */
  t: number
}

export interface SimulateOptions {
  velocity?: number
  /** Stop after this many seconds even if the spring hasn't settled. */
  maxDuration?: number
  /** Record one sample every `sampleEvery` seconds (rounded to whole steps). */
  sampleEvery?: number
  dt?: number
}

export interface SimulationResult {
  samples: SpringSample[]
  settled: boolean
  /** Seconds until the spring came to rest (or maxDuration). */
  duration: number
}

/** Run a spring from `from` to `to` and record its trajectory. */
export function simulate(
  from: number,
  to: number,
  config: SpringConfig,
  { velocity = 0, maxDuration = 10, sampleEvery = 1 / 120, dt = FIXED_DT }: SimulateOptions = {},
): SimulationResult {
  let state: SpringState = { position: from, velocity }
  const samples: SpringSample[] = [{ t: 0, ...state }]
  const stepsPerSample = Math.max(1, Math.round(sampleEvery / dt))
  const maxSteps = Math.ceil(maxDuration / dt)

  for (let i = 1; i <= maxSteps; i++) {
    state = step(state, to, config, dt)
    const t = i * dt
    if (isAtRest(state, to, config)) {
      samples.push({ t, position: to, velocity: 0 })
      return { samples, settled: true, duration: t }
    }
    if (i % stepsPerSample === 0) samples.push({ t, ...state })
  }
  return { samples, settled: false, duration: maxDuration }
}

/**
 * A spring in motion, advanced by wall-clock time but integrated with a fixed
 * timestep. Frames are irregular (16.6ms, 8.3ms, a 200ms hiccup…); the physics
 * shouldn't care. We bank elapsed time in an accumulator and spend it in
 * FIXED_DT-sized steps; leftovers carry over to the next frame.
 */
export class Spring {
  state: SpringState
  target: number
  config: SpringConfig
  done = false
  private accumulator = 0

  /** Never simulate more than this per frame (e.g. after a background tab). */
  static maxFrameSeconds = 1 / 15

  constructor(from: number, to: number, config: Partial<SpringConfig> = {}, velocity = 0) {
    this.state = { position: from, velocity }
    this.target = to
    this.config = resolveSpring(config)
    this.done = from === to && velocity === 0
  }

  get position() {
    return this.state.position
  }

  get velocity() {
    return this.state.velocity
  }

  /** Advance by `seconds` of wall-clock time. Returns true once at rest. */
  advance(seconds: number, dt: number = FIXED_DT): boolean {
    if (this.done) return true
    this.accumulator += Math.min(seconds, Spring.maxFrameSeconds)
    while (this.accumulator >= dt) {
      this.state = step(this.state, this.target, this.config, dt)
      this.accumulator -= dt
      if (isAtRest(this.state, this.target, this.config)) {
        this.state = { position: this.target, velocity: 0 }
        this.done = true
        break
      }
    }
    return this.done
  }
}
