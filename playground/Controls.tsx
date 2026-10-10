import { dampingKind, dampingRatio, simulate, type Integrator, type SpringConfig } from 'mini-framer-motion'
import { useMemo, type ReactNode } from 'react'

export interface Params {
  stiffness: number
  damping: number
  mass: number
  velocity: number
  integrator: Integrator
}

export const defaultParams: Params = {
  stiffness: 170,
  damping: 12,
  mass: 1,
  velocity: 0,
  integrator: 'euler',
}

const presets: Record<string, Pick<Params, 'stiffness' | 'damping' | 'mass'>> = {
  Bouncy: { stiffness: 170, damping: 6, mass: 1 },
  Default: { stiffness: 170, damping: 26, mass: 1 },
  Critical: { stiffness: 100, damping: 20, mass: 1 },
  Molasses: { stiffness: 100, damping: 80, mass: 1 },
  Heavy: { stiffness: 120, damping: 10, mass: 5 },
  Frictionless: { stiffness: 170, damping: 0, mass: 1 },
}

interface SliderProps {
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (value: number) => void
}

function Slider({ label, value, min, max, step, unit, onChange }: SliderProps) {
  return (
    <label className="slider">
      <span className="slider-label">
        <span>{label}</span>
        <output>
          {value}
          {unit}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function Controls({
  params,
  config,
  onChange,
}: {
  params: Params
  config: SpringConfig
  onChange: (params: Params) => void
}) {
  const set = (patch: Partial<Params>) => onChange({ ...params, ...patch })
  const zeta = dampingRatio(config)
  const kind = dampingKind(config)
  const omega = Math.sqrt(params.stiffness / params.mass)
  const critical = 2 * Math.sqrt(params.stiffness * params.mass)
  const settle = useMemo(
    () => simulate(0, 100, config, { velocity: params.velocity, maxDuration: 10 }),
    [config, params.velocity],
  )

  return (
    <aside className="card controls">
      <div>
        <h2>The spring</h2>
        <p className="muted small">These settings drive every experiment on the page.</p>
      </div>

      <div className="presets">
        {Object.entries(presets).map(([name, preset]) => (
          <button key={name} className="chip" onClick={() => set(preset)}>
            {name}
          </button>
        ))}
      </div>

      <Slider
        label={<>Stiffness <var>k</var></>}
        value={params.stiffness}
        min={1}
        max={1000}
        step={1}
        onChange={(stiffness) => set({ stiffness })}
      />
      <Slider
        label={<>Damping <var>c</var></>}
        value={params.damping}
        min={0}
        max={100}
        step={0.5}
        onChange={(damping) => set({ damping })}
      />
      <Slider
        label={<>Mass <var>m</var></>}
        value={params.mass}
        min={0.1}
        max={10}
        step={0.1}
        onChange={(mass) => set({ mass })}
      />
      <Slider
        label={<>Initial velocity <var>v₀</var></>}
        value={params.velocity}
        min={-3000}
        max={3000}
        step={50}
        onChange={(velocity) => set({ velocity })}
      />

      <label className="select">
        Integrator
        <select
          value={params.integrator}
          onChange={(e) => set({ integrator: e.target.value as Integrator })}
        >
          <option value="euler">Semi-implicit Euler</option>
          <option value="rk4">RK4</option>
        </select>
      </label>

      <dl className="stats">
        <div>
          <dt>Damping ratio ζ = c / 2√(km)</dt>
          <dd>{zeta.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Behaviour</dt>
          <dd className={`kind-${kind.split(' ')[0]}`}>{kind}</dd>
        </div>
        <div>
          <dt>Natural frequency ω₀ = √(k/m)</dt>
          <dd>{omega.toFixed(1)} rad/s</dd>
        </div>
        <div>
          <dt>Critical damping 2√(km)</dt>
          <dd>
            {critical.toFixed(1)}{' '}
            <button className="link" onClick={() => set({ damping: Math.round(critical * 2) / 2 })}>
              use
            </button>
          </dd>
        </div>
        <div className="wide">
          <dt>Settles in (0 → 100)</dt>
          <dd>{settle.settled ? `${(settle.duration * 1000).toFixed(0)} ms` : 'never (> 10 s)'}</dd>
        </div>
      </dl>
    </aside>
  )
}
