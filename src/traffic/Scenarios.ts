export interface ScenarioTrack {
    id: string;
    startPos: [number, number];
    waypoints: [number, number][];
    speed: number;
}

export interface Scenario {
    name: string;
    tracks: ScenarioTrack[];
}

/**
 * Collection of simple multi-ship scenarios used by integration tests and
 * manual experimentation.  The coordinates are specified in nautical miles and
 * speeds in metres per second to match the `TrafficSim` API.
 */
export class Scenarios {
    /** Two vessels on a reciprocal course. */
    static headOn: Scenario = {
        name: 'headOn',
        tracks: [
            {
                id: 'A',
                startPos: [0, 0],
                waypoints: [[10, 0]],
                speed: 10,
            },
            {
                id: 'B',
                startPos: [2, 0],
                waypoints: [[-10, 0]],
                speed: 10,
            },
        ],
    };

    /** Three vessels crossing near a common point. */
    static threeWayCross: Scenario = {
        name: 'threeWayCross',
        tracks: [
            {
                id: 'A',
                startPos: [0, 0],
                waypoints: [[10, 0]],
                speed: 8,
            },
            {
                id: 'B',
                startPos: [2, -1],
                waypoints: [[-10, 1]],
                speed: 8,
            },
            {
                id: 'C',
                startPos: [-2, 1],
                waypoints: [[10, -1]],
                speed: 8,
            },
        ],
    };

    /** Faster vessel overtaking a slower one. */
    static overtake: Scenario = {
        name: 'overtake',
        tracks: [
            {
                id: 'A',
                startPos: [0, 0],
                waypoints: [[10, 0]],
                speed: 6,
            },
            {
                id: 'B',
                startPos: [-1, -0.1],
                waypoints: [[10, -0.1]],
                speed: 10,
            },
        ],
    };

    /** Moving vessel passing a stationary obstacle. */
    static stationaryObstacle: Scenario = {
        name: 'stationaryObstacle',
        tracks: [
            {
                id: 'A',
                startPos: [0, 0],
                waypoints: [[10, 0]],
                speed: 10,
            },
            {
                id: 'B',
                startPos: [5, 0],
                waypoints: [[5, 0]],
                speed: 0,
            },
        ],
    };

    /** Returns all available scenarios. */
    static all(): Scenario[] {
        return [
            Scenarios.headOn,
            Scenarios.threeWayCross,
            Scenarios.overtake,
            Scenarios.stationaryObstacle,
        ];
    }
}
