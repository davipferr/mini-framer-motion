import { resolveSpring } from 'mini-framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { Controls, defaultParams, type Params } from './Controls'
import { LiveSpring } from './physics'
import { DampingComparison } from './sections/DampingComparison'
import { EnergyChart } from './sections/EnergyChart'
import { IntegratorRace } from './sections/IntegratorRace'
import { LiveEquation } from './sections/LiveEquation'
import { MassSpring } from './sections/MassSpring'
import { Orbit } from './sections/Orbit'
import { Pendulum } from './sections/Pendulum'
import { PhasePlot } from './sections/PhasePlot'
import { PositionPlot } from './sections/PositionPlot'
import { Projectile } from './sections/Projectile'
import { Waves } from './sections/Waves'

export function App() {
  const [params, setParams] = useState<Params>(defaultParams)
  const config = useMemo(
    () =>
      resolveSpring({
        stiffness: params.stiffness,
        damping: params.damping,
        mass: params.mass,
        integrator: params.integrator,
      }),
    [params.stiffness, params.damping, params.mass, params.integrator],
  )

  // One shared experiment watched by sections 2–5.
  const sim = useMemo(() => new LiveSpring(config), [])
  sim.config = config
  useEffect(() => {
    sim.release(100, 0)
    return () => sim.dispose()
  }, [sim])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Spring physics, visually</h1>
        <p>
          Every animation in Mini Framer Motion is a simulated spring: <code>F = −k·x − c·v</code>.
          Move the sliders and watch what changes.
        </p>
      </header>

      <div className="layout">
        <Controls params={params} config={config} onChange={setParams} />
        <main className="sections">
          <PositionPlot config={config} velocity={params.velocity} />
          <MassSpring sim={sim} velocity={params.velocity} />
          <LiveEquation sim={sim} velocity={params.velocity} />
          <EnergyChart sim={sim} velocity={params.velocity} />
          <PhasePlot sim={sim} velocity={params.velocity} />
          <DampingComparison config={config} />
          <IntegratorRace config={config} />
          <Pendulum />
          <Projectile />
          <Orbit />
          <Waves />
        </main>
      </div>
    </div>
  )
}
