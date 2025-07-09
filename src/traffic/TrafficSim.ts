import { OrcaWrapper } from './OrcaWrapper';
import {
    ColregsBias,
    classifyEncounter,
    Encounter,
    mergeEncounters,
} from './ColregsBias';
import { ShipDynamics } from '../../Simulator/js/ship-dynamics.js';

export interface Track {
    id: string;
    pos: [number, number];
    vel: [number, number];
    dyn: ShipDynamics;
    waypoints: [number, number][];
    encounter?: Encounter;
}

export interface TrafficSimArgs {
    timeStep: number;
    /**
     * Prediction horizon for the ORCA solver in seconds. It should be long
     * enough that a vessel travelling at typical speeds (~10 m/s or 20 kts)
     * covers at least the bow CPA distance. Recommended range is roughly
     * 60–120 seconds for the default CPA values. Values outside this range
     * may lead to overly cautious or overly aggressive avoidance behavior.
     */
    timeHorizon: number;
    /**
     * Maximum range (nm) to consider other vessels for avoidance. Recommended
     * range is 4–10 nm. Small craft generally use 8–10 nm while large ships
     * may opt for about 4 nm with a longer time horizon.
     */
    neighborDist: number;
    radius: number;
    maxSpeed: number;
    turnRateRadPerSec: number;
    /**
     * Enable the additional CPA push applied on top of ORCA's preferred
     * velocities. When disabled, the simulator relies solely on ORCA for
     * collision avoidance.
     */
    enableCpaPush?: boolean;
}

const MPS_TO_NMPS = 1 / 1852;
const MPS_TO_KTS = 3600 / 1852;

class GridIndex {
    private buckets: Map<string, Track[]> = new Map();
    constructor(private cellSize: number) {}

    rebuild(tracks: Track[]): void {
        this.buckets.clear();
        for (const t of tracks) {
            const key = this.key(t.pos);
            let bucket = this.buckets.get(key);
            if (!bucket) {
                bucket = [];
                this.buckets.set(key, bucket);
            }
            bucket.push(t);
        }
    }

    query(pos: [number, number]): Track[] {
        const cx = Math.floor(pos[0] / this.cellSize);
        const cy = Math.floor(pos[1] / this.cellSize);
        const result: Track[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const bucket = this.buckets.get(`${cx + dx},${cy + dy}`);
                if (bucket) {
                    result.push(...bucket);
                }
            }
        }
        return result;
    }

    private key(pos: [number, number]): string {
        const cx = Math.floor(pos[0] / this.cellSize);
        const cy = Math.floor(pos[1] / this.cellSize);
        return `${cx},${cy}`;
    }
}

export class TrafficSim {
    private wrapper: OrcaWrapper;
    private tracks: Map<string, Track> = new Map();
    private bias: ColregsBias;
    private dt: number;
    private index: GridIndex;
    private neighborDist: number;
    private enableCpaPush: boolean;

    // Minimum allowed CPA distances in simulation units (nautical miles).
    // 1000 yards ~ 0.5 nm, 500 yards ~ 0.25 nm. The `timeHorizon` value passed
    // to the constructor should span enough time for a vessel moving at
    // ordinary speeds to cover at least CPA_BOW_MIN. At around 10 m/s this
    // equates to roughly one to two minutes.
    private static readonly CPA_BOW_MIN = 1000 / 1852;
    private static readonly CPA_STERN_MIN = 500 / 1852;
    // Tunable gain applied to avoidance pushes. A value greater than 1 results
    // in slightly more aggressive maneuvers when vessels approach the minimum
    // CPA distance.  This is tweaked using the sample scenarios in the unit
    // tests to keep separation distances above the configured thresholds.
    private static readonly AVOIDANCE_GAIN = 1.5;

    constructor(args: TrafficSimArgs) {
        this.wrapper = new OrcaWrapper(
            args.timeStep,
            args.timeHorizon,
            args.neighborDist,
            args.radius,
            args.maxSpeed
        );
        this.bias = new ColregsBias(args.turnRateRadPerSec);
        this.dt = args.timeStep;
        this.neighborDist = args.neighborDist;
        this.index = new GridIndex(this.neighborDist);
        this.enableCpaPush = args.enableCpaPush !== false;
    }

    /** Adds a new vessel to the simulation. */
    addTrack(
        id: string,
        startPos: [number, number],
        waypoints: [number, number][],
        speedMps: number
    ): void {
        const wp = waypoints[0] || startPos;
        const dir = this.normalize([wp[0] - startPos[0], wp[1] - startPos[1]]);
        const speedNmps = speedMps * MPS_TO_NMPS;
        const vel: [number, number] = [dir[0] * speedNmps, dir[1] * speedNmps];

        const dyn = new ShipDynamics();
        dyn.x = startPos[0];
        dyn.y = startPos[1];
        dyn.psi = Math.atan2(vel[0], vel[1]);
        dyn.v = speedMps * MPS_TO_KTS;

        this.wrapper.addAgent(id, startPos, vel);
        this.tracks.set(id, {
            id,
            pos: [...startPos] as [number, number],
            vel,
            dyn,
            waypoints,
        });
    }

    /** Main simulation update step. */
    tick(): void {
        const trackList = Array.from(this.tracks.values());

        // Rebuild spatial index with current positions
        this.index.rebuild(trackList);

        // Reset encounters
        for (const t of trackList) {
            t.encounter = 'none';
        }

        // Classify encounters pairwise
        for (let i = 0; i < trackList.length; i++) {
            for (let j = i + 1; j < trackList.length; j++) {
                const a = trackList[i];
                const b = trackList[j];

                // Relative bearing from a to b
                const relAB: [number, number] = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]];
                const bearingAB = this.bearingRelativeTo(relAB, a.vel);
                a.encounter = mergeEncounters(a.encounter || 'none', classifyEncounter(bearingAB));

                // Relative bearing from b to a
                const relBA: [number, number] = [-relAB[0], -relAB[1]];
                const bearingBA = this.bearingRelativeTo(relBA, b.vel);
                b.encounter = mergeEncounters(b.encounter || 'none', classifyEncounter(bearingBA));
            }
        }

        // Set preferred velocities with CPA avoidance
        for (const t of trackList) {
            // Navigate toward the next waypoint at current speed
            let desired = t.vel;
            const speed = Math.hypot(t.vel[0], t.vel[1]);
            const wp = t.waypoints[0];
            if (wp) {
                const dir = this.normalize([wp[0] - t.pos[0], wp[1] - t.pos[1]]);
                desired = [dir[0] * speed, dir[1] * speed];

                // Waypoint reached?
                if (Math.hypot(wp[0] - t.pos[0], wp[1] - t.pos[1]) < speed * 1.5) {
                    t.waypoints.shift();
                }
            }

            // Apply CPA constraints relative to nearby tracks
            let push: [number, number] = [0, 0];
            if (this.enableCpaPush) {
                for (const other of this.index.query(t.pos)) {
                    if (other === t) continue;
                    const distNow = Math.hypot(
                        other.pos[0] - t.pos[0],
                        other.pos[1] - t.pos[1]
                    );
                    if (distNow > this.neighborDist) continue;
                    const { time: tcpa, dist: dcpa } = computeCPA(t, other);
                    if (tcpa < 0) continue;
                    const rel: [number, number] = [other.pos[0] - t.pos[0], other.pos[1] - t.pos[1]];
                    const bearing = this.bearingRelativeTo(rel, t.vel);
                    let enc = classifyEncounter(bearing);
                    // Treat stationary contacts as head-on to enforce the larger
                    // CPA distance and trigger an avoidance manoeuvre.
                    const otherSpeed = Math.hypot(other.vel[0], other.vel[1]);
                    if (otherSpeed < 1e-3) {
                        enc = 'headOn';
                    }
                    const minDist =
                        enc === 'headOn' || enc === 'crossingStarboard' || enc === 'crossingPort'
                            ? TrafficSim.CPA_BOW_MIN
                            : TrafficSim.CPA_STERN_MIN;
                    if (dcpa < minDist) {
                        const dir = this.normalize([-rel[0], -rel[1]]);
                        let factor = (minDist - dcpa) / minDist;
                        // Give closer CPA threats higher priority by scaling with
                        // the inverse time to CPA. Clamp the scale to avoid
                        // excessive corrections for very small tcpa values.
                        factor *= 1 / Math.max(tcpa, 1);
                        push = [
                            push[0] +
                                dir[0] * factor * speed * TrafficSim.AVOIDANCE_GAIN,
                            push[1] +
                                dir[1] * factor * speed * TrafficSim.AVOIDANCE_GAIN,
                        ];
                    }
                }
            }

            const biased = this.bias.apply(t.encounter || 'none', [
                desired[0] + push[0],
                desired[1] + push[1],
            ]);
            this.wrapper.setPreferredVelocity(t.id, biased);
        }

        // Step the ORCA simulator
        this.wrapper.step();

        // Update tracks using ship dynamics to respect physical limits
        for (const t of trackList) {
            const orcaVel = this.wrapper.getVelocity(t.id);
            const desiredHeading = Math.atan2(orcaVel[0], orcaVel[1]);
            const headingError = desiredHeading - t.dyn.psi;
            const rudderDegCmd = (headingError * 180) / Math.PI;
            const speedCmdKts = Math.hypot(orcaVel[0], orcaVel[1]) * 3600;

            t.dyn.update(this.dt, rudderDegCmd, speedCmdKts);

            t.pos = [t.dyn.x, t.dyn.y];
            const speedNmps = (t.dyn.v / 3600);
            t.vel = [
                Math.sin(t.dyn.psi) * speedNmps,
                Math.cos(t.dyn.psi) * speedNmps,
            ];

            this.wrapper.setAgentState(t.id, t.pos, t.vel);
        }
    }

    /** Returns a simple snapshot of all track states. */
    getSnapshot(): { id: string; pos: [number, number]; vel: [number, number] }[] {
        const result = [] as { id: string; pos: [number, number]; vel: [number, number] }[];
        for (const t of this.tracks.values()) {
            result.push({ id: t.id, pos: [...t.pos] as [number, number], vel: [...t.vel] as [number, number] });
        }
        return result;
    }

    private normalize(v: [number, number]): [number, number] {
        const len = Math.hypot(v[0], v[1]);
        if (len === 0) {
            return [0, 0];
        }
        return [v[0] / len, v[1] / len];
    }

    private bearingRelativeTo(target: [number, number], referenceVel: [number, number]): number {
        const bearing = Math.atan2(target[1], target[0]);
        const heading = Math.atan2(referenceVel[1], referenceVel[0]);
        const diff = bearing - heading;
        return (diff * 180) / Math.PI;
    }

}

/**
 * Computes time and distance of closest point of approach between two tracks.
 */
export function computeCPA(
    a: Track,
    b: Track
): { time: number; dist: number } {
    const rx = b.pos[0] - a.pos[0];
    const ry = b.pos[1] - a.pos[1];
    const vx = b.vel[0] - a.vel[0];
    const vy = b.vel[1] - a.vel[1];

    const v2 = vx * vx + vy * vy;
    if (v2 < 1e-6) {
        // Relative velocity is essentially zero so the separation remains
        // constant.  Return an infinite time and the current distance to avoid
        // propagating huge values.
        return { time: Infinity, dist: Math.hypot(rx, ry) };
    }

    const t = -((rx * vx + ry * vy) / v2);
    const xCPA = rx + vx * t;
    const yCPA = ry + vy * t;
    const d = Math.hypot(xCPA, yCPA);
    return { time: t, dist: d };
}

