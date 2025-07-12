import { performance } from 'node:perf_hooks'
import TrafficSim, { DEFAULT_ARGS } from '../src/traffic/TrafficSim'
import buildScenario from '../src/traffic/buildScenario'

const scenario = buildScenario()
const sim = new TrafficSim(DEFAULT_ARGS, scenario)
const steps = Math.round(60 / DEFAULT_ARGS.timeStep)
let maxMs = 0
console.time('sim')
const start = performance.now()
for (let i = 0; i < steps; i++) {
  const frameStart = performance.now()
  sim.tick()
  const elapsed = performance.now() - frameStart
  if (elapsed > maxMs) maxMs = elapsed
}
const total = performance.now() - start
console.timeEnd('sim')
console.log('avg frame ms', (total / steps).toFixed(3))
console.log('max frame ms', maxMs.toFixed(3))
console.log('#agents processed', scenario.mobiles.length + scenario.statics.length)
