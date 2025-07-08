import { OrcaWrapper } from './OrcaWrapper';
import {
    ColregsBias,
    classifyEncounter,
    Encounter,
    mergeEncounters,
} from './ColregsBias';

export interface Track {
    id: string;
    pos: [number, number];
    vel: [number, number];
    waypoints: [number, number][];
    encounter?: Encounter;
}

export interface TrafficSimArgs {
    timeStep: number;
    timeHorizon: number;
    neighborDist: number;
    radius: number;
    maxSpeed: number;
    turnRateRadPerSec: number;
}

export class TrafficSim {
    private wrapper: OrcaWrapper;
    private tracks: Map<string, Track> = new Map();
    private bias: ColregsBias;

    // Minimum allowed CPA distances in simulation units (nautical miles).
    // 1000 yards ~ 0.5 nm, 500 yards ~ 0.25 nm.
    private static readonly CPA_BOW_MIN = 1000 / 1852;
    private static readonly CPA_STERN_MIN = 500 / 1852;

    constructor(args: TrafficSimArgs) {
        this.wrapper = new OrcaWrapper(
            args.timeStep,
            args.timeHorizon,
            args.neighborDist,
            args.radius,
            args.maxSpeed
        );
        this.bias = new ColregsBias(args.turnRateRadPerSec);
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
        const vel: [number, number] = [dir[0] * speedMps, dir[1] * speedMps];

        this.wrapper.addAgent(id, startPos, vel);
        this.tracks.set(id, { id, pos: [...startPos] as [number, number], vel, waypoints });
    }

    /** Main simulation update step. */
    tick(): void {
        const trackList = Array.from(this.tracks.values());

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

            // Apply CPA constraints relative to other tracks
            let push: [number, number] = [0, 0];
            for (const other of trackList) {
                if (other === t) continue;
                const { time: tcpa, dist: dcpa } = this.computeCPA(t, other);
                if (tcpa < 0) continue;
                const rel: [number, number] = [other.pos[0] - t.pos[0], other.pos[1] - t.pos[1]];
                const bearing = this.bearingRelativeTo(rel, t.vel);
                const enc = classifyEncounter(bearing);
                const minDist =
                    enc === 'headOn' || enc === 'crossingStarboard' || enc === 'crossingPort'
                        ? TrafficSim.CPA_BOW_MIN
                        : TrafficSim.CPA_STERN_MIN;
                if (dcpa < minDist) {
                    const dir = this.normalize([-rel[0], -rel[1]]);
                    const factor = (minDist - dcpa) / minDist;
                    push = [push[0] + dir[0] * factor * speed, push[1] + dir[1] * factor * speed];
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

        // Update tracks from wrapper
        for (const t of trackList) {
            t.vel = this.wrapper.getVelocity(t.id);
            t.pos = this.wrapper.getPosition(t.id);
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

    /**
     * Computes time and distance of closest point of approach between two tracks.
     */
    private computeCPA(
        a: Track,
        b: Track
    ): { time: number; dist: number } {
        const rx = b.pos[0] - a.pos[0];
        const ry = b.pos[1] - a.pos[1];
        const vx = b.vel[0] - a.vel[0];
        const vy = b.vel[1] - a.vel[1];

        const v2 = vx * vx + vy * vy;
        const t = v2 < 1e-6 ? 1e9 : -((rx * vx + ry * vy) / v2);
        const xCPA = rx + vx * t;
        const yCPA = ry + vy * t;
        const d = Math.hypot(xCPA, yCPA);
        return { time: t, dist: d };
    }
}

