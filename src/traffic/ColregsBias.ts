export interface BiasSettings {
  /**
   * How strongly to bias toward the legally preferred maneuver.
   * A value of 0 returns the original velocity while 1 applies the
   * full COLREGS turn or speed reduction.
   */
  aggressiveness: number;
}

/**
 * Blend the current desired velocity with the maneuver required by COLREGS.
 *
 * @param enc          Encounter classification relative to the other vessel.
 * @param curVel       Current desired velocity vector in meters per second.
 * @param turnRateRad  Maximum permitted turn rate in radians.
 * @param bias         Aggressiveness of the maneuver from 0 to 1.
 * @returns Adjusted velocity respecting COLREGS.
 */
export function applyColregsBias(
  enc: Encounter,
  curVel: [number, number],
  turnRateRad: number,
  bias: BiasSettings
): [number, number] {
  const legal = legalPreferredVelocity(enc, curVel, turnRateRad);
  const a = Math.min(Math.max(bias.aggressiveness, 0), 1);
  return [
    curVel[0] * (1 - a) + legal[0] * a,
    curVel[1] * (1 - a) + legal[1] * a,
  ];
}

export type Encounter =
  | 'headOn'
  | 'crossingStarboard'
  | 'crossingPort'
  | 'overtaking'
  | 'none';

/**
 * Classify the type of COLREGS encounter based on relative bearing.
 *
 * @param bearingDeg Bearing from own ship to the target in degrees.
 *                   Any numeric input is accepted and normalized to 0-360.
 * @returns The encounter classification.
 */
export function classifyEncounter(bearingDeg: number): Encounter {
  // normalize bearing to range [0, 360)
  const beta = ((bearingDeg % 360) + 360) % 360;
  const abs = Math.abs;

  // check head-on condition first
  if (abs(beta) <= 5 || abs(beta - 180) <= 5) {
    return 'headOn';
  }

  // overtaking sector is between 112.5 and 247.5 degrees (exclusive)
  if (beta > 112.5 && beta < 247.5) {
    return 'overtaking';
  }

  // starboard crossing if target is on starboard side
  if (beta < 112.5) {
    return 'crossingStarboard';
  }

  // port crossing if bearing is greater than or equal to 247.5
  if (beta >= 247.5) {
    return 'crossingPort';
  }

  return 'none';
}

function rotate2D(v: [number, number], angle: number): [number, number] {
  const [x, y] = v;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

export function legalPreferredVelocity(
  enc: Encounter,
  curVel: [number, number],
  turnRateRad: number
): [number, number] {
  const ang = Math.abs(turnRateRad);
  switch (enc) {
    case 'headOn':
    case 'crossingStarboard':
      return rotate2D(curVel, -ang);
    case 'crossingPort':
      return rotate2D(curVel, ang);
    case 'overtaking': {
      const speed = Math.hypot(curVel[0], curVel[1]) * 0.9;
      if (speed === 0) return curVel;
      const heading = Math.atan2(curVel[1], curVel[0]);
      return [Math.cos(heading) * speed, Math.sin(heading) * speed];
    }
    default:
      return curVel;
  }
}
