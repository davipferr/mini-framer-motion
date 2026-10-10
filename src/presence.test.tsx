// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnimatePresence } from './presence'
import { motion } from './motion'

// React needs this to allow act() outside a test renderer.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A controllable rAF: frames only happen when the test says so.
let queue: FrameRequestCallback[] = []
let now = 0
function frames(count: number, ms = 1000 / 60) {
  for (let i = 0; i < count; i++) {
    now += ms
    const callbacks = queue
    queue = []
    callbacks.forEach((cb) => cb(now))
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  queue = []
  now = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb))
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

let setShow: (show: boolean) => void = () => {}
let exitCompleted = 0

function App({ initialShow = true }: { initialShow?: boolean }) {
  const [show, set] = useState(initialShow)
  setShow = set
  return (
    <AnimatePresence onExitComplete={() => exitCompleted++}>
      {show && (
        <motion.div
          key="box"
          data-testid="box"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      )}
    </AnimatePresence>
  )
}

const box = () => container.querySelector<HTMLElement>('[data-testid="box"]')
const flush = () => act(async () => {}) // let promise callbacks run

describe('AnimatePresence', () => {
  it('keeps a removed child mounted until its exit animation finishes', async () => {
    exitCompleted = 0
    act(() => root.render(<App />))
    act(() => frames(120))
    expect(box()!.style.opacity).toBe('1')

    act(() => setShow(false))
    // Gone from props, but still in the DOM.
    expect(box()).not.toBeNull()

    act(() => frames(10))
    const midway = Number(box()!.style.opacity)
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(1)

    act(() => frames(240))
    await flush()
    expect(box()).toBeNull()
    expect(exitCompleted).toBe(1)
  })

  it('a child that comes back mid-exit is not removed', async () => {
    exitCompleted = 0
    act(() => root.render(<App />))
    act(() => frames(120))

    act(() => setShow(false))
    act(() => frames(5))
    const element = box()
    act(() => setShow(true))

    act(() => frames(240))
    await flush()
    // The very same DOM node, animated back in.
    expect(box()).toBe(element)
    expect(box()!.style.opacity).toBe('1')
    expect(exitCompleted).toBe(0)
  })

  it('removes children without an exit animation immediately', async () => {
    let set: (v: boolean) => void = () => {}
    function Plain() {
      const [show, setter] = useState(true)
      set = setter
      return <AnimatePresence>{show && <motion.div key="a" data-testid="box" />}</AnimatePresence>
    }
    act(() => root.render(<Plain />))
    act(() => set(false))
    await flush()
    expect(box()).toBeNull()
  })
})
