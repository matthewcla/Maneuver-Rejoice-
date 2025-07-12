import TrafficSim, { DEFAULT_ARGS } from '../src/traffic/TrafficSim'

test('highest priority encounter is kept when multiple ships present', () => {
  const sim = new TrafficSim(DEFAULT_ARGS)
  sim.addTrack('A', [0, 0], [[1000, 0]], 5)
  sim.addTrack('B', [1000, 0], [[-1000, 0]], 5)
  sim.addTrack('C', [-50, -100], [[1000, -100]], 7)

  sim.tick()

  const tracks = (sim as any).tracks
  expect(tracks.get('A').encounter).toBe('headOn')
  expect(tracks.get('B').encounter).toBe('headOn')
  expect(tracks.get('C').encounter).toBe('crossingStarboard')
})
