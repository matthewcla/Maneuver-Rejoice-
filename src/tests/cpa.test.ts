import { TrafficSim, computeCPA } from '../traffic/TrafficSim';

// Simple stub for the ORCA wrapper used by tests. It exposes only the minimal
// API required by `TrafficSim` and stores preferred velocities so the tests can
// inspect them.
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

describe('computeCPA', () => {
    test('returns large time when velocities are parallel', () => {
        const sim = new TrafficSim({
            timeStep: 1,
            timeHorizon: 90,
            neighborDist: 10,
            radius: 0.1,
            maxSpeed: 10,
            turnRateRadPerSec: 0.1,
        });

        const a: any = { id: 'a', pos: [0, 0], vel: [1, 0], waypoints: [] };
        const b: any = { id: 'b', pos: [1, 0], vel: [1, 0], waypoints: [] };
        const cpa = computeCPA(a, b);
        expect(cpa.time).toBeGreaterThan(1e8);
    });

    test('computes symmetric approach distance', () => {
        const sim = new TrafficSim({
            timeStep: 1,
            timeHorizon: 90,
            neighborDist: 10,
            radius: 0.1,
            maxSpeed: 10,
            turnRateRadPerSec: 0.1,
        });
        const a: any = { id: 'a', pos: [0, 0], vel: [1, 0], waypoints: [] };
        const b: any = { id: 'b', pos: [1, 0], vel: [-1, 0], waypoints: [] };
        const cpa = computeCPA(a, b);
        expect(cpa.dist).toBeCloseTo(0, 5);
    });

    test('distant CPA yields smaller course correction', () => {
        const args = {
            timeStep: 1,
            timeHorizon: 90,
            neighborDist: 10,
            radius: 0.1,
            maxSpeed: 10,
            turnRateRadPerSec: 0.1,
        };

        const closeSim = new TrafficSim(args);
        (closeSim as any).wrapper = new StubWrapper(1);
        closeSim.addTrack('a', [0, 0], [[10, 0]], 100);
        closeSim.addTrack('b', [1, 0], [[-10, 0]], 100);
        const closeWrapper = (closeSim as any).wrapper as StubWrapper;
        closeSim.tick();
        const closeVel = closeWrapper.getVelocity('a');

        const farSim = new TrafficSim(args);
        (farSim as any).wrapper = new StubWrapper(1);
        farSim.addTrack('a', [0, 0], [[10, 0]], 100);
        farSim.addTrack('b', [5, 0], [[-10, 0]], 100);
        const farWrapper = (farSim as any).wrapper as StubWrapper;
        farSim.tick();
        const farVel = farWrapper.getVelocity('a');

        const speedNmps = 100 / 1852;
        const closeDelta = speedNmps - closeVel[0];
        const farDelta = speedNmps - farVel[0];
        expect(farDelta).toBeLessThan(closeDelta);
    });
});
