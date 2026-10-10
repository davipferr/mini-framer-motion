/**
 * One shared requestAnimationFrame loop for every running animation.
 *
 * Each callback receives the seconds elapsed since the previous frame. The loop
 * only runs while something is subscribed, so an idle page costs nothing.
 */

export type FrameCallback = (deltaSeconds: number) => void

const callbacks = new Set<FrameCallback>()
let frameId: number | null = null
let lastTime: number | null = null

function tick(now: number) {
  const delta = lastTime === null ? 0 : (now - lastTime) / 1000
  lastTime = now
  // Copy so callbacks can unsubscribe themselves (or subscribe others) safely.
  for (const callback of [...callbacks]) callback(delta)
  frameId = callbacks.size > 0 ? requestAnimationFrame(tick) : null
  if (frameId === null) lastTime = null
}

export function onFrame(callback: FrameCallback): () => void {
  callbacks.add(callback)
  if (frameId === null) {
    // Prime lastTime so the first real frame gets a sensible delta.
    lastTime = typeof performance !== 'undefined' ? performance.now() : null
    frameId = requestAnimationFrame(tick)
  }
  return () => {
    callbacks.delete(callback)
  }
}
