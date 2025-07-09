import { TrafficSim } from '../traffic/TrafficSim';
import { Scenarios } from '../traffic/Scenarios';

// Simple stub for the ORCA wrapper used by integration tests. It mirrors the
// minimal API required by `TrafficSim` and simply applies the preferred
// velocities directly each step.
class StubWrapper {
    private pos = new Map<string, [number, number]>();
    private vel = new Map<string, [number, number]>();
    private pref = new Map<string, [number, number]>();
    constructor(private dt: number) {}

    addAgent(id: string, pos: [number, number], vel: [number, number]) {
        this.pos.set(id, [...pos]);
        this.vel.set(id, [...vel]);
    }
    setAgentState(id: string, pos: [number, number], vel: [number, number]) {
        this.pos.set(id, [...pos]);
        this.vel.set(id, [...vel]);
    }
    setPreferredVelocity(id: string, vel: [number, number]) {
        this.pref.set(id, [...vel]);
    }
    step() {
        for (const [id, pv] of this.pref.entries()) {
            const pos = this.pos.get(id)!;
            this.vel.set(id, [...pv]);
            this.pos.set(id, [pos[0] + pv[0] * this.dt, pos[1] + pv[1] * this.dt]);
        }
    }
    getVelocity(id: string): [number, number] {
        return this.vel.get(id)!;
    }
    getPosition(id: string): [number, number] {
        return this.pos.get(id)!;
    }
}

const CPA_MIN = 500 / 1852; // lowest allowed CPA (stern value)

describe('multi-ship scenarios', () => {
    const args = {
        timeStep: 1,
        timeHorizon: 90,
        neighborDist: 10,
        radius: 0.1,
        maxSpeed: 20,
        turnRateRadPerSec: 0.1,
    };

    for (const scenario of Scenarios.all()) {
        test(`${scenario.name} maintains CPA`, () => {
            const sim = new TrafficSim(args);
            (sim as any).wrapper = new StubWrapper(args.timeStep);

            for (const t of scenario.tracks) {
                sim.addTrack(t.id, t.startPos, t.waypoints, t.speed);
            }

            let minDist = Infinity;
            for (let i = 0; i < 60; i++) {
                sim.tick();
                const snap = sim.getSnapshot();
                for (let a = 0; a < snap.length; a++) {
                    for (let b = a + 1; b < snap.length; b++) {
                        const d = Math.hypot(
                            snap[a].pos[0] - snap[b].pos[0],
                            snap[a].pos[1] - snap[b].pos[1]
                        );
                        minDist = Math.min(minDist, d);
                    }
                }
            }

            expect(minDist).toBeGreaterThanOrEqual(CPA_MIN);
        });
    }
});

describe('multi-ship scenarios without CPA push', () => {
    const args = {
        timeStep: 1,
        timeHorizon: 90,
        neighborDist: 10,
        radius: 0.1,
        maxSpeed: 20,
        turnRateRadPerSec: 0.1,
        enableCpaPush: false,
    };

    for (const scenario of Scenarios.all()) {
        test(`${scenario.name} maintains CPA`, () => {
            const sim = new TrafficSim(args);
            (sim as any).wrapper = new StubWrapper(args.timeStep);

            for (const t of scenario.tracks) {
                sim.addTrack(t.id, t.startPos, t.waypoints, t.speed);
            }

            let minDist = Infinity;
            for (let i = 0; i < 60; i++) {
                sim.tick();
                const snap = sim.getSnapshot();
                for (let a = 0; a < snap.length; a++) {
                    for (let b = a + 1; b < snap.length; b++) {
                        const d = Math.hypot(
                            snap[a].pos[0] - snap[b].pos[0],
                            snap[a].pos[1] - snap[b].pos[1]
                        );
                        minDist = Math.min(minDist, d);
                    }
                }
            }

            expect(minDist).toBeGreaterThanOrEqual(CPA_MIN);
        });
    }
});

