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

        // Set preferred velocities
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

            const pref = this.bias.apply(t.encounter || 'none', desired);
            this.wrapper.setPreferredVelocity(t.id, pref);
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
}

