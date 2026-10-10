# Mini Framer Motion

A small, educational re-implementation of [Framer Motion](https://motion.dev) in
TypeScript + React 19. There are no animation libraries: springs are integrated by
hand on `requestAnimationFrame`, exit animations keep unmounted children alive,
and layout animations use FLIP.

```tsx
import { AnimatePresence, motion } from 'mini-framer-motion'

<AnimatePresence>
  {items.map((item) => (
    <motion.li
      key={item.id}
      layout
      initial={{ opacity: 0, x: -40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 60 }}
      transition={{ stiffness: 400, damping: 32 }}
    />
  ))}
</AnimatePresence>
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | The physics playground (see below) |
| `npm test` | Vitest: spring math, MotionValue, AnimatePresence (jsdom) |
| `npm run build` | Library build (ESM + CJS + `.d.ts`) into `dist/` |
| `npm run build:playground` | Static playground build into `dist-playground/` |
| `npm run typecheck` | `tsc --noEmit` over library and playground |

## Playground

`npm run dev` opens an interactive page about the spring physics behind the library. One set of
sliders (stiffness, damping, mass, starting velocity, integrator) drives every section:

1. **Position over time**: the simulated curve against the exact formula, plus a ball driven by a
   real `MotionValue` that you can redirect mid-flight.
2. **Mass on a spring**: a draggable block with a spring and a damper, and arrows for force and velocity.
3. **The equation, live**: `F = −k·x − c·v` with the current numbers plugged in every frame.
4. **Energy**: spring energy and motion energy trading places while damping drains the total.
5. **Phase space**: position against velocity, where damping turns a circle into a spiral.
6. **Three kinds of damping**: underdamped, critically damped and overdamped springs released together.
7. **Integrator race**: semi-implicit Euler, RK4 and explicit Euler against the exact answer as the
   time step grows.
8. **Pendulum**: a draggable pendulum next to its small-angle approximation (which is a spring),
   with measured and textbook periods.
9. **Projectile motion**: drag to aim and fire, with optional air drag compared against the
   textbook parabola.
10. **Orbits and gravity**: throw a planet around a star, with Kepler's equal-area wedges, orbit
    shape and period, and energy drift for leapfrog versus explicit Euler.

Sections 2–5 watch one shared simulation ([`playground/physics.ts`](playground/physics.ts)).

## How it works

### 1. Springs: [`src/spring.ts`](src/spring.ts)

The spring force is `F = −k·x − c·v`, so the acceleration is `a = F / m`. Everything
in this file is a pure function of `(state, target, config, dt)`.

- **Semi-implicit Euler** (default): update the velocity first, then move using the
  *new* velocity. Plain explicit Euler adds energy every step, so an undamped spring
  spirals outwards. This variant doesn't, and there's a test that shows it.
- **RK4**: optional, and far more accurate for the same `dt`.
- **Fixed timestep**: the physics always steps in 1 ms increments. Real frames
  (16.6 ms, 6.9 ms, a 200 ms hiccup) feed an accumulator, so the motion looks the same
  at 60 Hz and 144 Hz. Frame gaps are capped so a backgrounded tab doesn't explode.
- **`analyticSpring`**: the closed-form solution of the damped oscillator. Tests and the
  playground compare the integrators against it.
- **Damping ratio** `ζ = c / (2√(k·m))`: below 1 is underdamped (bounces), 1 is
  critically damped (fastest arrival with no overshoot), above 1 is overdamped (creeps in).

### 2. MotionValue: [`src/motion-value.ts`](src/motion-value.ts)

A MotionValue is a number that owns at most one spring. It pushes updates straight
to subscribers, which write to `element.style`, so **React never re-renders while a
value animates**. Calling `start()` mid-flight creates the new spring from the
current position **and current velocity**. That's why a redirected animation bends
smoothly instead of snapping. All running values share one rAF loop
([`src/frameloop.ts`](src/frameloop.ts)), and the loop stops when nothing is animating.

### 3. AnimatePresence: [`src/presence.tsx`](src/presence.tsx)

When a child disappears from `children`, React removes its DOM node in the same
commit, before any effect could animate it. So `AnimatePresence`:

1. remembers what it rendered last commit;
2. merges children that disappeared back into the output, in their old position;
3. wraps each child in a `PresenceChild` whose context says `isPresent: false`;
4. waits until every `motion` component inside with an `exit` prop reports
   `safeToRemove()`;
5. drops the child from its list and re-renders. Only then does React unmount it.

If the child comes back mid-exit, it's the same component instance, so it springs
back from wherever it is. Components without an `exit` don't hold up removal.
`usePresence()` is exported for custom exit logic.

### 4. Layout animations (FLIP): [`src/layout.tsx`](src/layout.tsx)

- **First**: each layout node keeps the box it measured after the previous commit. Its
  visual position is that box plus the FLIP transform currently applied, which is what
  makes interrupted layout animations continue smoothly.
- **Last**: in `useLayoutEffect` (DOM updated, not yet painted) all nodes in the group
  have their transforms removed and are measured with `getBoundingClientRect`. All
  reads happen first and all writes after, to avoid layout thrashing.
- **Invert**: `translate(first − last)` and `scale(first.size / last.size)` with
  `transform-origin: 0 0`.
- **Play**: spring the transform back to identity, keeping velocity.

The whole group is re-measured on every commit, because one element changing size can
move siblings that didn't re-render. `AnimatePresence` triggers this too when it finally
removes an exited child, so the remaining items slide into the gap.

**Scale correction.** A parent animating its size is drawn with `scale(sx, sy)`, which
also squashes its children. Motion children (without their own `layout`) read the
parent's scale values from context and apply `scale(1/sx, 1/sy)`, so they keep their
true size.

## API

| Export | |
| --- | --- |
| `motion.<tag>` | `initial`, `animate`, `exit`, `transition` (spring config), `layout` (`true` or `'position'`), `onAnimationComplete` |
| `AnimatePresence` | `initial={false}` skips enter animations on first render, `onExitComplete` |
| `LayoutGroup` | Scopes layout measurement to a subtree (default: one global group) |
| `usePresence`, `useIsPresent` | Presence hooks |
| `MotionValue` | `get`, `set`, `start(target, config) → Promise<finished>`, `stop`, `on` |
| Spring math | `step`, `stepEuler`, `stepRK4`, `simulate`, `analyticSpring`, `dampingRatio`, `dampingKind`, `Spring` |

Animatable keys: `x`, `y`, `scale`, `scaleX`, `scaleY`, `rotate` (composed into one
`transform`), `opacity` (clamped to [0, 1]), and any other numeric style property
(written in px).

## Known limitations

These are deliberate, to keep the project small:

- Only springs; there are no tweens or keyframes.
- Nested `layout` elements are measured together, but a `layout` child inside a
  `layout` parent doesn't get scale correction.
- `border-radius` and box shadows distort while a layout animation scales the element.
- Layout transforms use `transform-origin: 0 0`, which also affects `rotate` on that element.
- A layout node is re-measured when something in its group commits. A change that
  happens entirely outside React (a window resize, for example) shows up as an
  animation on the next commit.
