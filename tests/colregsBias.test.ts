import { describe, test, expect } from 'vitest'
import {
  classifyEncounter,
  legalPreferredVelocity,
  applyColregsBias,
  BiasSettings,
  Encounter
} from '../src/traffic/ColregsBias'

describe('classifyEncounter', () => {
  test('returns correct sector names', () => {
    expect(classifyEncounter(0)).toBe('headOn')
    expect(classifyEncounter(90)).toBe('crossingStarboard')
    expect(classifyEncounter(180)).toBe('headOn')
    expect(classifyEncounter(270)).toBe('crossingPort')
    expect(classifyEncounter(150)).toBe('overtaking')
  })

  test('bearings near 360° are headOn', () => {
    expect(classifyEncounter(355)).toBe('headOn')
    expect(classifyEncounter(-5)).toBe('headOn')
  })
})

describe('applyColregsBias', () => {
  const vel: [number, number] = [10, 0]
  const rate = Math.PI / 2 // 90 deg turn
  const bias: BiasSettings = { aggressiveness: 0.5 }

  test('blends current velocity with legal maneuver', () => {
    const enc: Encounter = 'crossingStarboard'
    const out = applyColregsBias(enc, vel, rate, bias)
    const legal = legalPreferredVelocity(enc, vel, rate)
    expect(out[0]).toBeCloseTo(vel[0] * 0.5 + legal[0] * 0.5)
    expect(out[1]).toBeCloseTo(vel[1] * 0.5 + legal[1] * 0.5)
  })

  test('aggressiveness 0 returns original velocity', () => {
    const out = applyColregsBias('overtaking', vel, rate, { aggressiveness: 0 })
    expect(out[0]).toBeCloseTo(vel[0])
    expect(out[1]).toBeCloseTo(vel[1])
  })

  test('aggressiveness 1 returns legal velocity', () => {
    const enc: Encounter = 'crossingPort'
    const out = applyColregsBias(enc, vel, rate, { aggressiveness: 1 })
    const legal = legalPreferredVelocity(enc, vel, rate)
    expect(out[0]).toBeCloseTo(legal[0])
    expect(out[1]).toBeCloseTo(legal[1])
  })
})
