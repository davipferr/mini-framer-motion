import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react'
import { LayoutGroupContext } from './layout'

/**
 * Exit animations.
 *
 * The problem: when a child disappears from `children`, React removes its DOM
 * node in the same commit. There is no "about to unmount, please wait" hook.
 * By the time any effect runs, the node is gone and there's nothing to animate.
 *
 * The fix: AnimatePresence remembers the children it rendered last time. A
 * child that vanished from props is *kept in the rendered output* and told,
 * through context, that it is no longer present. It plays its `exit`
 * animation, reports back, and only then does AnimatePresence drop it, which is
 * when React finally unmounts it.
 */

export interface PresenceContextValue {
  isPresent: boolean
  /** false when AnimatePresence initial={false} and this child was there on first render. */
  initial: boolean
  /** Register a component that needs to finish an exit animation. Returns unregister. */
  register(id: string): () => void
  /** That component's exit animation has finished. */
  complete(id: string): void
}

export const PresenceContext = createContext<PresenceContextValue | null>(null)

/**
 * For components that want to run their own exit animation.
 * Returns `[isPresent, safeToRemove]`; call `safeToRemove` when you're done.
 * Outside AnimatePresence it always returns `[true, noop]`.
 * Pass `enabled = false` to not hold up removal (e.g. no exit animation).
 */
export function usePresence(enabled = true): [isPresent: boolean, safeToRemove: () => void] {
  const context = useContext(PresenceContext)
  const id = useId()
  const register = context?.register
  useLayoutEffect(() => (enabled ? register?.(id) : undefined), [register, id, enabled])
  if (!context) return [true, noop]
  return [context.isPresent, () => context.complete(id)]
}

/** Read-only presence, for components that don't block removal. */
export function useIsPresent(): boolean {
  return useContext(PresenceContext)?.isPresent ?? true
}

function noop() {}

interface PresenceChildProps {
  isPresent: boolean
  initial: boolean
  onExitComplete: () => void
  children: ReactNode
}

function PresenceChild({ isPresent, initial, onExitComplete, children }: PresenceChildProps) {
  // id -> has finished its exit animation
  const exits = useRef(new Map<string, boolean>()).current
  const isPresentRef = useRef(isPresent)
  isPresentRef.current = isPresent
  const onExitCompleteRef = useRef(onExitComplete)
  onExitCompleteRef.current = onExitComplete

  const maybeDone = () => {
    if (isPresentRef.current) return
    for (const done of exits.values()) if (!done) return
    onExitCompleteRef.current()
  }

  // Register/complete are stable for the lifetime of this child.
  const register = useMemo(
    () => (id: string) => {
      exits.set(id, false)
      return () => {
        exits.delete(id)
        maybeDone()
      }
    },
    [],
  )
  const complete = useMemo(
    () => (id: string) => {
      if (exits.has(id)) exits.set(id, true)
      maybeDone()
    },
    [],
  )

  const context = useMemo<PresenceContextValue>(() => {
    // Re-entering (or leaving again) starts a fresh round of exits.
    for (const id of exits.keys()) exits.set(id, false)
    return { isPresent, initial, register, complete }
  }, [isPresent])

  // Nobody inside has an exit animation: remove right away.
  useEffect(() => {
    if (!isPresent && exits.size === 0) onExitCompleteRef.current()
  }, [isPresent])

  return <PresenceContext.Provider value={context}>{children}</PresenceContext.Provider>
}

export interface AnimatePresenceProps {
  children?: ReactNode
  /** Set to false to skip `initial` animations for children present on first render. */
  initial?: boolean
  /** Fires when every exiting child has finished and been removed. */
  onExitComplete?: () => void
}

// React stores keys as strings on the element.
type KeyedElement = ReactElement & { key: string }

function keyedChildren(children: ReactNode): KeyedElement[] {
  const result: KeyedElement[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.key == null) {
      console.warn('AnimatePresence: every child needs a unique `key` so it can be tracked.')
    }
    result.push(child as KeyedElement)
  })
  return result
}

export function AnimatePresence({ children, initial = true, onExitComplete }: AnimatePresenceProps) {
  const present = keyedChildren(children)
  const presentKeys = new Set(present.map((child) => child.key))

  // What we rendered last commit, including children still exiting.
  const rendered = useRef<KeyedElement[]>([])
  const presentKeysRef = useRef(presentKeys)
  const isFirstRender = useRef(true)
  const onExitCompleteRef = useRef(onExitComplete)
  const [, forceRender] = useReducer((n: number) => n + 1, 0)
  const layoutGroup = useContext(LayoutGroupContext)

  // Merge: present children in their new order, plus exiting children slotted
  // back in near where they used to be.
  const merged: KeyedElement[] = [...present]
  rendered.current.forEach((child, index) => {
    if (!presentKeys.has(child.key)) merged.splice(Math.min(index, merged.length), 0, child)
  })

  useLayoutEffect(() => {
    rendered.current = merged
    presentKeysRef.current = presentKeys
    onExitCompleteRef.current = onExitComplete
    isFirstRender.current = false
    // Children appearing or disappearing moves their siblings.
    layoutGroup.didCommit()
  })

  const handleExitComplete = (key: string) => {
    if (presentKeysRef.current.has(key)) return // came back before finishing
    const before = rendered.current.length
    rendered.current = rendered.current.filter((child) => child.key !== key)
    if (rendered.current.length === before) return // already removed
    forceRender()
    if (rendered.current.every((child) => presentKeysRef.current.has(child.key))) {
      onExitCompleteRef.current?.()
    }
  }

  return (
    <>
      {merged.map((child) => (
        <PresenceChild
          key={child.key}
          isPresent={presentKeys.has(child.key)}
          initial={isFirstRender.current ? initial : true}
          onExitComplete={() => handleExitComplete(child.key)}
        >
          {child}
        </PresenceChild>
      ))}
    </>
  )
}
