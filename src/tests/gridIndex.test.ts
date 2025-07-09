import * as TrafficSimModule from '../traffic/TrafficSim';
const { TrafficSim, computeCPA } = TrafficSimModule;

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

describe('Grid index optimization', () => {
    const args = {
        timeStep: 1,
        timeHorizon: 90,
        neighborDist: 1,
        radius: 0.1,
        maxSpeed: 10,
        turnRateRadPerSec: 0.1,
    };

    test('distant tracks skip CPA checks', () => {
        const sim = new TrafficSim(args);
        (sim as any).wrapper = new StubWrapper(args.timeStep);

        const count = 50;
        for (let i = 0; i < count; i++) {
            sim.addTrack(`A${i}`, [i * 5, 0], [[i * 5 + 1, 0]], 5);
        }

        const spy = jest.spyOn(TrafficSimModule, 'computeCPA');
        sim.tick();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();

        const speedNmps = 5 / 1852;
        for (const t of sim.getSnapshot()) {
            expect(t.vel[0]).toBeCloseTo(speedNmps);
            expect(t.vel[1]).toBeCloseTo(0);
        }
    });
});
