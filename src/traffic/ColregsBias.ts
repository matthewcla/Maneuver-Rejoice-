export interface BiasSettings {
  aggressiveness: number;
}

export function applyColregsBias(speed: number, bias: BiasSettings): number {
  return speed * (1 - bias.aggressiveness);
}
