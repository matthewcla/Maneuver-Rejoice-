import * as RVO from 'rvo2';

export class OrcaWrapper {
  private sim: any;
  private agents = new Map<string, number>();

  constructor(
    private timeStep: number,
    private timeHorizon: number,
    private neighborDist: number,
    private radius: number,
    private maxSpeed: number
  ) {
    // maxNeighbors is left as default (10)
    const maxNeighbors = 10;
    const timeHorizonObst = this.timeHorizon;
    this.sim = new (RVO as any).RVOSimulator(
      this.timeStep,
      this.neighborDist,
      maxNeighbors,
      this.timeHorizon,
      timeHorizonObst,
      this.radius,
      this.maxSpeed
    );
  }

  addAgent(id: string, pos: [number, number], vel: [number, number]): void {
    const handle = this.sim.addAgent(
      pos,
      this.neighborDist,
      10,
      this.timeHorizon,
      this.timeHorizon,
      this.radius,
      this.maxSpeed,
      vel
    );
    this.agents.set(id, handle);
  }

  setAgentState(id: string, pos: [number, number], vel: [number, number]): void {
    const handle = this.agents.get(id);
    if (handle === undefined) return;
    this.sim.setAgentPosition(handle, pos);
    this.sim.setAgentVelocity(handle, vel);
  }

  setPreferredVelocity(id: string, vel: [number, number]): void {
    const handle = this.agents.get(id);
    if (handle === undefined) return;
    this.sim.setAgentPrefVelocity(handle, vel);
  }

  step(): void {
    this.sim.setAgentMaxNeighbors(15);
    for (const handle of this.agents.values()) {
      this.sim.setAgentNeighborDist(handle, this.neighborDist);
    }
    // TODO: switch to sector-pruning when agent count exceeds 50
    this.sim.doStep();
  }

  getVelocity(id: string): [number, number] {
    const handle = this.agents.get(id);
    if (handle === undefined) return [0, 0];
    return this.sim.getAgentVelocity(handle);
  }
}
