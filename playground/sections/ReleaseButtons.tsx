import type { LiveSpring } from '../physics'

/** Start the shared experiment. Repeated on each live section so it's always in reach. */
export function ReleaseButtons({ sim, velocity }: { sim: LiveSpring; velocity: number }) {
  return (
    <div className="row">
      <button className="primary" onClick={() => sim.release(100, velocity)}>
        Pull to 100 and release
      </button>
      <button onClick={() => sim.release(-100, velocity)}>Push to −100</button>
      <button onClick={() => sim.release(0, 0)}>Stop</button>
    </div>
  )
}
