import buildScenario, { ScenarioConfig } from '../src/traffic/buildScenario'
import TrafficSim, { DEFAULT_ARGS } from '../src/traffic/TrafficSim'

test('20+ mobile ships never breach 0.25 NM CPA in 10 min sim', () => {
  const sim = new TrafficSim(DEFAULT_ARGS, buildScenario())
  const steps = 10 * 60 / DEFAULT_ARGS.timeStep  // 10 min
  for (let i = 0; i < steps; i++) sim.tick()
  const logs = sim.getEncounterLog()
  expect(logs.every(e => e.cpaMeters >= 463)).toBe(true)
})

test('no static collision', () => {
  const scenario: ScenarioConfig = {
    mobiles: [
      { id: 'M1', start: [-2000, 0], waypoints: [[2000, 0]], speedMps: 5 }
    ],
    statics: [
      { id: 'S1', pos: [0, 0], radius: 200 }
    ]
  }
  const sim = new TrafficSim(DEFAULT_ARGS, scenario)
  const steps = 10 * 60 / DEFAULT_ARGS.timeStep
  for (let i = 0; i < steps; i++) sim.tick()
  const logs = sim.getEncounterLog()
  const entry = logs.find(l => l.ids.includes('M1') && l.ids.includes('S1'))
  expect(entry && entry.cpaMeters >= 463).toBe(true)
})
