import buildScenario from '../src/traffic/buildScenario'
import TrafficSim from '../src/traffic/TrafficSim'

test('20+ mobile ships never breach 0.25 NM CPA in 10 min sim', () => {
  const sim = new TrafficSim(buildScenario())
  const steps = 10 * 60 / 0.25  // 10 min @ 0.25 s
  for (let i = 0; i < steps; i++) sim.tick()
  const logs = sim.getEncounterLog()
  expect(logs.every(e => e.cpaMeters >= 463)).toBe(true)
})
