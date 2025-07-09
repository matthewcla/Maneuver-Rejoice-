import { OrcaWrapper } from './OrcaWrapper.js';
import { applyColregsBias, BiasSettings } from './ColregsBias.js';

export class TrafficSim {
  private wrapper: OrcaWrapper;

  constructor(id: string, private bias: BiasSettings) {
    this.wrapper = new OrcaWrapper(id);
  }

  step(dt: number, speed: number): void {
    const adjustedSpeed = applyColregsBias(speed, this.bias);
    console.log(`Advancing sim with speed ${adjustedSpeed}`);
    this.wrapper.simulateStep(dt);
  }
}
