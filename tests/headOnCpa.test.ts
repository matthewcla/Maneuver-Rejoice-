import TrafficSim, { DEFAULT_ARGS } from '../src/traffic/TrafficSim'

/** Ensure two ships on a head-on course maintain a safe CPA. */
test('head-on encounter keeps CPA above 0.25 NM', () => {
  const sim = new TrafficSim(DEFAULT_ARGS)
  sim.addTrack('A', [-1000, 0], [[1000, 0]], 5)
  sim.addTrack('B', [1000, 0], [[-1000, 0]], 5)

  sim.tick()
  const tracks = (sim as any).tracks
  expect(tracks.get('A').encounter).toBe('headOn')
  expect(tracks.get('B').encounter).toBe('headOn')

  for (let i = 0; i < 200; i++) sim.tick()

  const logs = sim.getEncounterLog()
  const entry = logs.find(l => l.ids.includes('A') && l.ids.includes('B'))
  expect(entry && entry.cpaMeters >= 463).toBe(true)
})
