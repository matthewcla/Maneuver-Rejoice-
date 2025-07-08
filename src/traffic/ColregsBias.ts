/** Possible COLREGS encounter types between two vessels. */
export type Encounter =
    | 'headOn'
    | 'crossingStarboard'
    | 'crossingPort'
    | 'overtaking'
    | 'none';

/** Order of encounters from highest to lowest priority. */
const encounterPriority: Encounter[] = [
    'headOn',
    'crossingStarboard',
    'crossingPort',
    'overtaking',
    'none',
];

/**
 * Chooses the more urgent encounter between two classifications.
 */
export function mergeEncounters(a: Encounter, b: Encounter): Encounter {
    return encounterPriority.indexOf(a) <= encounterPriority.indexOf(b) ? a : b;
}

/**
 * Simple helper that applies COLREGS based course changes.
 *
 * The class currently exposes a single method `apply` which
 * adjusts a velocity vector according to the encounter type
 * and a configured starboard turn rate.  It can be extended
 * in the future with more sophisticated heuristics.
 */
export class ColregsBias {
    constructor(private turnRateRadPerSec: number) {}

    /**
     * Returns a velocity vector that obeys basic COLREGS guidance.
     */
    apply(encounter: Encounter, current: [number, number]): [number, number] {
        return getLegalPreferredVelocity(
            encounter,
            current,
            this.turnRateRadPerSec
        );
    }
}

/**
 * Classifies the relative encounter type based on bearing to the target.
 *
 * The input bearing is expected to be the target's relative bearing in degrees
 * where 0 degrees is dead ahead and positive angles are measured clockwise.
 */
export function classifyEncounter(bearingDeg: number): Encounter {
    // Normalize the angle to the range [0, 360).
    const b = ((bearingDeg % 360) + 360) % 360;

    // Head on: target dead ahead.
    if (b <= 5 || b >= 355) {
        return 'headOn';
    }

    // Overtaking: target within the sector 112.5–247.5 deg.
    if (b >= 112.5 && b <= 247.5) {
        return 'overtaking';
    }

    // Crossing on the starboard bow.
    if (b < 112.5) {
        return 'crossingStarboard';
    }

    // Crossing on the port bow.
    if (b > 247.5) {
        return 'crossingPort';
    }

    return 'none';
}

/** Rotates a 2D vector by the provided angle in radians. */
function rotate(vec: [number, number], angleRad: number): [number, number] {
    const [x, y] = vec;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    return [x * cos - y * sin, x * sin + y * cos];
}

/**
 * Returns a COLREGS compliant preferred velocity based on the encounter type.
 */
export function getLegalPreferredVelocity(
    encounter: Encounter,
    currentVelocity: [number, number],
    turnRateRadPerSec: number
): [number, number] {
    switch (encounter) {
        case 'headOn':
        case 'crossingStarboard':
            // Give-way vessel: turn to starboard.
            return rotate(currentVelocity, -turnRateRadPerSec);

        case 'crossingPort':
            // Stand-on vessel: maintain course and speed.
            return currentVelocity;

        case 'overtaking':
            // Slow down slightly to allow the vessel ahead to clear.
            return [currentVelocity[0] * 0.9, currentVelocity[1] * 0.9];

        default:
            return currentVelocity;
    }
}
