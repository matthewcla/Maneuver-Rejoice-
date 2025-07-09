export class OrcaWrapper {
  constructor(private id: string) {}

  simulateStep(delta: number): void {
    console.log(`Simulating ORCA step for ${this.id} with dt=${delta}`);
  }
}
