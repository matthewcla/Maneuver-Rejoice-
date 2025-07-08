import * as rvo2 from 'rvo2';

/**
 * Thin wrapper around the `rvo2` library used by the traffic simulation.
 *
 * Each agent is identified externally by a string `id`. Internally, the
 * underlying library refers to agents via a numeric handle. This class keeps a
 * map between the two and exposes a small set of helper methods for common
 * operations.
 */
export class OrcaWrapper {
    private sim: any;
    private idToHandle: Map<string, number> = new Map();

    constructor(
        private timeStep: number,
        private timeHorizon: number,
        private neighborDist: number,
        private radius: number,
        private maxSpeed: number
    ) {
        // rvo2's Simulator constructor accepts parameters in the same order as
        // the Python bindings. We keep the maxNeighbors value conservative.
        const maxNeighbors = 10;
        const timeHorizonObst = timeHorizon;

        // The library might export Simulator directly or under a property. We
        // access it in a generic way so compilation succeeds even without
        // type definitions.
        const SimulatorCtor = (rvo2 as any).Simulator || (rvo2 as any).RVOSimulator;
        this.sim = new SimulatorCtor(
            timeStep,
            neighborDist,
            maxNeighbors,
            timeHorizon,
            timeHorizonObst,
            radius,
            maxSpeed,
            [0, 0]
        );
    }

    /** Adds a new agent to the simulation. */
    addAgent(id: string, pos: [number, number], vel: [number, number]): void {
        const handle = this.sim.addAgent(pos);
        this.idToHandle.set(id, handle);
        this.setAgentState(id, pos, vel);
    }

    /** Sets an agent's position and velocity directly. */
    setAgentState(id: string, pos: [number, number], vel: [number, number]): void {
        const handle = this.getHandle(id);
        this.sim.setAgentPosition(handle, pos);
        this.sim.setAgentVelocity(handle, vel);
    }

    /** Sets the preferred velocity for the next step. */
    setPreferredVelocity(id: string, vel: [number, number]): void {
        const handle = this.getHandle(id);
        this.sim.setAgentPrefVelocity(handle, vel);
    }

    /** Advances the simulation by one time step. */
    step(): void {
        this.sim.doStep();
    }

    /** Returns the current velocity of the agent. */
    getVelocity(id: string): [number, number] {
        const handle = this.getHandle(id);
        const v = this.sim.getAgentVelocity(handle);
        return [v[0], v[1]];
    }

    /** Returns the current position of the agent. */
    getPosition(id: string): [number, number] {
        const handle = this.getHandle(id);
        const p = this.sim.getAgentPosition(handle);
        return [p[0], p[1]];
    }

    private getHandle(id: string): number {
        const handle = this.idToHandle.get(id);
        if (handle === undefined) {
            throw new Error(`Unknown agent id: ${id}`);
        }
        return handle;
    }
}

