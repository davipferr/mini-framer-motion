import { onFrame } from './frameloop'
import { Spring, type SpringConfig } from './spring'

type Listener = (value: number) => void

/**
 * A number that can animate itself. It owns at most one spring at a time and
 * remembers its velocity, so starting a new animation mid-flight picks up
 * exactly where the old one left off: no jolt, the motion just bends.
 *
 * Updates go straight to subscribers (which write to the DOM); React never
 * re-renders because a value moved.
 */
export class MotionValue {
  private current: number
  private velocity = 0
  private spring: Spring | null = null
  private unsubscribeFrame: (() => void) | null = null
  private resolveAnimation: ((finished: boolean) => void) | null = null
  private listeners = new Set<Listener>()

  constructor(initial: number) {
    this.current = initial
  }

  get(): number {
    return this.current
  }

  getVelocity(): number {
    return this.velocity
  }

  isAnimating(): boolean {
    return this.spring !== null
  }

  /** Jump to a value. Stops any animation; velocity is dropped unless asked to keep it. */
  set(value: number, { keepVelocity = false } = {}): void {
    this.stop()
    if (!keepVelocity) this.velocity = 0
    this.update(value)
  }

  /**
   * Spring towards `target`. Resolves `true` when the spring comes to rest and
   * `false` if it was interrupted by another `start`, `set` or `stop`.
   */
  start(target: number, config: Partial<SpringConfig> = {}): Promise<boolean> {
    this.stop()
    const spring = new Spring(this.current, target, config, this.velocity)
    if (spring.done) return Promise.resolve(true)

    this.spring = spring
    const finished = new Promise<boolean>((resolve) => {
      this.resolveAnimation = resolve
    })
    this.unsubscribeFrame = onFrame((delta) => this.advance(delta))
    return finished
  }

  /** Advance the running spring manually. The frame loop calls this; tests can too. */
  advance(seconds: number): void {
    const spring = this.spring
    if (!spring) return
    const done = spring.advance(seconds)
    this.velocity = spring.velocity
    this.update(spring.position)
    if (done) this.finish(true)
  }

  /** Stop animating where we are. Velocity is kept so the next `start` inherits it. */
  stop(): void {
    if (this.spring) this.finish(false)
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  destroy(): void {
    this.stop()
    this.listeners.clear()
  }

  private finish(completed: boolean) {
    this.unsubscribeFrame?.()
    this.unsubscribeFrame = null
    this.spring = null
    if (completed) this.velocity = 0
    const resolve = this.resolveAnimation
    this.resolveAnimation = null
    resolve?.(completed)
  }

  private update(value: number) {
    this.current = value
    for (const listener of this.listeners) listener(value)
  }
}

export function motionValue(initial: number): MotionValue {
  return new MotionValue(initial)
}
