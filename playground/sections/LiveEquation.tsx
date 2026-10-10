import { useEffect, useRef } from 'react'
import { fmt, useLive } from '../canvas'
import type { LiveSpring } from '../physics'
import { ReleaseButtons } from './ReleaseButtons'

/**
 * F = −k·x − c·v with the live numbers plugged in, updated every frame by
 * writing to the DOM directly (no React re-render per frame).
 */
export function LiveEquation({ sim, velocity }: { sim: LiveSpring; velocity: number }) {
  const root = useRef<HTMLDivElement>(null)

  const update = () => {
    const el = root.current
    if (!el) return
    const { stiffness: k, damping: c, mass: m } = sim.config
    const springForce = -k * sim.x
    const dampingForce = -c * sim.v
    const force = springForce + dampingForce
    const values: Record<string, string> = {
      k: fmt(k, 0),
      c: fmt(c, 1),
      m: fmt(m, 1),
      x: fmt(sim.x, 1),
      v: fmt(sim.v, 1),
      springForce: fmt(springForce, 0),
      dampingForce: fmt(Math.abs(dampingForce), 0),
      dampingSign: dampingForce < 0 ? '−' : '+',
      force: fmt(force, 0),
      accel: fmt(force / m, 0),
    }
    for (const node of el.querySelectorAll<HTMLElement>('[data-slot]')) {
      node.textContent = values[node.dataset.slot!] ?? ''
    }

    // Bars: each force as a share of the spring force at full stretch (x = 100).
    const full = k * 100 || 1
    for (const [name, value] of [
      ['spring', springForce],
      ['damping', dampingForce],
      ['net', force],
    ] as const) {
      const bar = el.querySelector<HTMLElement>(`[data-bar="${name}"]`)
      if (!bar) continue
      const share = Math.min(1, Math.abs(value) / full) * 50
      bar.style.width = `${share}%`
      bar.style.left = value >= 0 ? '50%' : `${50 - share}%`
    }
  }

  useLive(sim, update)
  useEffect(update)

  return (
    <section className="card">
      <div className="section-head">
        <span className="step">3</span>
        <div>
          <h2>The equation, live</h2>
          <p>
            Two forces act on the block. The spring pulls it towards rest, harder the further it is
            stretched. The damper pushes against the motion, harder the faster it moves. Their sum is
            the net force, and Newton's <var>a</var> = <var>F</var> / <var>m</var> turns it into acceleration.
          </p>
        </div>
      </div>

      <div className="equation" ref={root}>
        <div className="eq-row">
          <span className="eq-lhs"><var>F</var></span>
          <span>=</span>
          <span className="eq-term spring">−<var>k</var>·<var>x</var></span>
          <span>−</span>
          <span className="eq-term damping"><var>c</var>·<var>v</var></span>
        </div>
        <div className="eq-row">
          <span />
          <span>=</span>
          <span className="eq-term spring">
            −<b data-slot="k" /> × <b data-slot="x" />
          </span>
          <span>−</span>
          <span className="eq-term damping">
            <b data-slot="c" /> × (<b data-slot="v" />)
          </span>
        </div>
        <div className="eq-row">
          <span />
          <span>=</span>
          <span className="eq-term spring"><b data-slot="springForce" /></span>
          <span data-slot="dampingSign" />
          <span className="eq-term damping"><b data-slot="dampingForce" /></span>
        </div>
        <div className="eq-row">
          <span />
          <span>=</span>
          <span className="eq-term net"><b data-slot="force" /></span>
        </div>
        <div className="eq-row eq-accel">
          <span className="eq-lhs"><var>a</var></span>
          <span>=</span>
          <span>
            <var>F</var> / <var>m</var> = <b data-slot="force" /> / <b data-slot="m" /> ={' '}
            <b className="net" data-slot="accel" />
          </span>
        </div>

        <div className="bars">
          {[
            ['spring', 'Spring  −k·x'],
            ['damping', 'Damper  −c·v'],
            ['net', 'Net force F'],
          ].map(([name, label]) => (
            <div className="bar-row" key={name}>
              <span className="bar-label">{label}</span>
              <div className="bar-track">
                <div className={`bar bar-${name}`} data-bar={name} />
                <div className="bar-zero" />
              </div>
            </div>
          ))}
          <p className="hint">
            Bars run left for negative, right for positive. Watch the damper bar always oppose the
            direction of motion, and the spring bar always point back to rest.
          </p>
        </div>
      </div>

      <ReleaseButtons sim={sim} velocity={velocity} />
    </section>
  )
}
