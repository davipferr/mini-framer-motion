import {
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type JSX,
  type ReactElement,
  type Ref,
} from 'react'
import { LayoutGroupContext, ParentLayoutContext, type LayoutNode } from './layout'
import { MotionValue } from './motion-value'
import { PresenceContext, usePresence } from './presence'
import type { SpringConfig } from './spring'
import { buildStyle, defaultValue, type LayoutTransform, type Target } from './style'

export type Transition = Partial<SpringConfig>

export interface MotionOwnProps {
  /** Values on mount. `false` = start at `animate` (no enter animation). */
  initial?: Target | false
  /** Values to spring to. Changing this mid-animation redirects the spring. */
  animate?: Target
  /** Values to spring to before being removed. Needs an AnimatePresence parent. */
  exit?: Target
  /** Spring settings for every animated value of this element. */
  transition?: Transition
  /**
   * Animate layout changes with FLIP. `'position'` only animates position.
   * Motion children of a layout element have its scale cancelled out.
   */
  layout?: boolean | 'position'
  /** Fires when the `animate` target is reached (not when interrupted). */
  onAnimationComplete?: () => void
}

type Tag = keyof JSX.IntrinsicElements

export type MotionProps<T extends Tag> = Omit<ComponentProps<T>, keyof MotionOwnProps> &
  MotionOwnProps

export type MotionComponent<T extends Tag> = (props: MotionProps<T>) => ReactElement

function useConstant<T>(init: () => T): T {
  const ref = useRef<{ value: T } | null>(null)
  if (ref.current === null) ref.current = { value: init() }
  return ref.current.value
}

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

function createMotionComponent<T extends Tag>(tag: T): MotionComponent<T> {
  function Motion(props: MotionProps<T>) {
    const {
      initial,
      animate,
      exit,
      transition,
      layout,
      onAnimationComplete,
      style,
      ref: externalRef,
      ...rest
    } = props as MotionOwnProps & {
      style?: CSSProperties
      ref?: Ref<HTMLElement>
      [key: string]: unknown
    }

    const presence = useContext(PresenceContext)
    const parentLayout = useContext(ParentLayoutContext)
    const layoutGroup = useContext(LayoutGroupContext)
    const isPresent = presence?.isPresent ?? true
    const [, safeToRemove] = usePresence(exit !== undefined)

    const elementRef = useRef<HTMLElement | null>(null)

    // Rendering never goes through React state: values push straight to the DOM.
    const render = useRef(() => {})
    const subscribe = (value: MotionValue) => {
      value.on(() => render.current())
      return value
    }

    const values = useConstant(() => {
      const skipInitial = initial === false || presence?.initial === false
      const source = skipInitial ? animate : initial || undefined
      const map = new Map<string, MotionValue>()
      for (const [key, value] of Object.entries(source ?? {})) {
        if (value !== undefined) map.set(key, subscribe(new MotionValue(value)))
      }
      return map
    })

    const getValue = (key: string) => {
      let value = values.get(key)
      if (!value) {
        value = subscribe(new MotionValue(defaultValue(key)))
        values.set(key, value)
      }
      return value
    }

    const layoutTransform = useConstant<LayoutTransform>(() => ({
      x: subscribe(new MotionValue(0)),
      y: subscribe(new MotionValue(0)),
      scaleX: subscribe(new MotionValue(1)),
      scaleY: subscribe(new MotionValue(1)),
    }))

    // Scale correction applies to motion children of a layout element that
    // don't do their own layout animation.
    const styleInputs = {
      values,
      layout: layout ? layoutTransform : null,
      parentLayout: layout ? null : parentLayout,
    }
    render.current = () => {
      const element = elementRef.current
      if (element) Object.assign(element.style, buildStyle(styleInputs))
    }

    // Latest-value refs so effects keyed on targets don't need these as deps.
    const transitionRef = useRef(transition)
    transitionRef.current = transition
    const onCompleteRef = useRef(onAnimationComplete)
    onCompleteRef.current = onAnimationComplete

    const run = (target: Target) => {
      const animations = Object.entries(target)
        .filter((entry): entry is [string, number] => entry[1] !== undefined)
        .map(([key, to]) => getValue(key).start(to, transitionRef.current))
      return Promise.all(animations).then((results) => results.every(Boolean))
    }

    // --- animate -----------------------------------------------------------
    const animateKey = JSON.stringify(animate ?? null)
    useEffect(() => {
      if (!isPresent || !animate) return
      void run(animate).then((finished) => {
        if (finished) onCompleteRef.current?.()
      })
    }, [animateKey, isPresent])

    // --- exit --------------------------------------------------------------
    useEffect(() => {
      if (isPresent || !exit) return
      let cancelled = false
      void run(exit).then((finished) => {
        if (finished && !cancelled) safeToRemove()
      })
      return () => {
        cancelled = true
      }
    }, [isPresent])

    // --- layout ------------------------------------------------------------
    const layoutNode = useConstant<LayoutNode>(() => ({
      element: null,
      box: null,
      mode: 'size',
      transform: layoutTransform,
      transition: {},
      render: () => render.current(),
    }))
    layoutNode.mode = layout === 'position' ? 'position' : 'size'
    layoutNode.transition = transition ?? {}

    useLayoutEffect(() => {
      if (!layout || !elementRef.current) return
      layoutNode.element = elementRef.current
      return layoutGroup.register(layoutNode)
    }, [Boolean(layout), layoutGroup])

    // Every commit of a layout element re-measures the whole group.
    useLayoutEffect(() => {
      if (layout) layoutGroup.didCommit()
    })

    // Follow the parent's FLIP scale so we can cancel it out every frame.
    useLayoutEffect(() => {
      if (layout || !parentLayout) return
      const offX = parentLayout.scaleX.on(() => render.current())
      const offY = parentLayout.scaleY.on(() => render.current())
      return () => {
        offX()
        offY()
      }
    }, [parentLayout, Boolean(layout)])

    useEffect(
      () => () => {
        for (const value of values.values()) value.stop()
        for (const value of Object.values(layoutTransform)) value.stop()
      },
      [],
    )

    const setRef = useCallback(
      (element: HTMLElement | null) => {
        elementRef.current = element
        assignRef(externalRef, element)
      },
      [externalRef],
    )

    const element = createElement(tag, {
      ...rest,
      ref: setRef,
      style: { ...style, ...buildStyle(styleInputs) },
    })

    return (
      <ParentLayoutContext.Provider value={layout ? layoutTransform : null}>
        {element}
      </ParentLayoutContext.Provider>
    )
  }

  ;(Motion as { displayName?: string }).displayName = `motion.${tag}`
  return Motion as MotionComponent<T>
}

type MotionComponents = { [T in Tag]: MotionComponent<T> }

const cache = new Map<string, MotionComponent<Tag>>()

/** `motion.div`, `motion.li`, `motion.svg`… created on first access. */
export const motion = new Proxy({} as MotionComponents, {
  get(_, tag: string) {
    let component = cache.get(tag)
    if (!component) {
      component = createMotionComponent(tag as Tag) as MotionComponent<Tag>
      cache.set(tag, component)
    }
    return component
  },
})
