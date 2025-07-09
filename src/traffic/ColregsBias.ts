export interface BiasSettings {
  aggressiveness: number;
}

export function applyColregsBias(speed: number, bias: BiasSettings): number {
  return speed * (1 - bias.aggressiveness);
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
