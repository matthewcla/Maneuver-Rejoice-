import { TrafficSim } from '../traffic/TrafficSim';

describe('computeCPA', () => {
    test('returns large time when velocities are parallel', () => {
        const sim = new TrafficSim({
            timeStep: 1,
            timeHorizon: 5,
            neighborDist: 10,
            radius: 0.1,
            maxSpeed: 10,
            turnRateRadPerSec: 0.1,
        });

        const a: any = { id: 'a', pos: [0, 0], vel: [1, 0], waypoints: [] };
        const b: any = { id: 'b', pos: [1, 0], vel: [1, 0], waypoints: [] };
        const cpa = (sim as any).computeCPA(a, b);
        expect(cpa.time).toBeGreaterThan(1e8);
    });

    test('computes symmetric approach distance', () => {
        const sim = new TrafficSim({
            timeStep: 1,
            timeHorizon: 5,
            neighborDist: 10,
            radius: 0.1,
            maxSpeed: 10,
            turnRateRadPerSec: 0.1,
        });
        const a: any = { id: 'a', pos: [0, 0], vel: [1, 0], waypoints: [] };
        const b: any = { id: 'b', pos: [1, 0], vel: [-1, 0], waypoints: [] };
        const cpa = (sim as any).computeCPA(a, b);
        expect(cpa.dist).toBeCloseTo(0, 5);
    });
});
