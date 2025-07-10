// Utility functions and scenario builder for Singapore Strait traffic

export interface ScenarioConfig {
  mobiles: {
    id: string;
    start: [number, number]; // metres in local XY
    waypoints: [number, number][];
    speedMps: number;
    color?: string;
  }[];
  statics: {
    id: string;
    pos: [number, number]; // metres in local XY
    radius: number; // safety radius (m)
  }[];
}

const EARTH_RADIUS_M = 6371000;
const LAT0 = 1.12; // south west corner lat
const LON0 = 103.71; // south west corner lon
const LAT0_RAD = (LAT0 * Math.PI) / 180;
const LON0_RAD = (LON0 * Math.PI) / 180;

/** Convert WGS-84 degrees to local XY in meters */
export function deg2xy(lat: number, lon: number): [number, number] {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const x = (lonRad - LON0_RAD) * Math.cos(LAT0_RAD) * EARTH_RADIUS_M;
  const y = (latRad - LAT0_RAD) * EARTH_RADIUS_M;
  return [x, y];
}

/** Convert local XY meters back to degrees */
export function xy2deg(x: number, y: number): [number, number] {
  const latRad = y / EARTH_RADIUS_M + LAT0_RAD;
  const lonRad = x / (Math.cos(LAT0_RAD) * EARTH_RADIUS_M) + LON0_RAD;
  return [(latRad * 180) / Math.PI, (lonRad * 180) / Math.PI];
}

function randInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randSpeed(): number {
  const base = 6.7; // m/s ~13 knots
  return base * randInRange(0.9, 1.1);
}

export function buildScenario(): ScenarioConfig {
  const latRange: [number, number] = [1.12, 1.32];
  const lonRange: [number, number] = [103.71, 104.08];

  const cfg: ScenarioConfig = { mobiles: [], statics: [] };

  // east-bound lane (blue)
  for (let i = 0; i < 8; i++) {
    const lat = randInRange(latRange[0], latRange[1]);
    const start = deg2xy(lat, lonRange[0]);
    const wp = deg2xy(lat, lonRange[1]);
    cfg.mobiles.push({
      id: `E${i + 1}`,
      start,
      waypoints: [wp],
      speedMps: randSpeed(),
      color: 'blue',
    });
  }

  // west-bound lane (red)
  for (let i = 0; i < 8; i++) {
    const lat = randInRange(latRange[0], latRange[1]);
    const start = deg2xy(lat, lonRange[1]);
    const wp = deg2xy(lat, lonRange[0]);
    cfg.mobiles.push({
      id: `W${i + 1}`,
      start,
      waypoints: [wp],
      speedMps: randSpeed(),
      color: 'red',
    });
  }

  // crossing feeder lane (green)
  for (let i = 0; i < 4; i++) {
    const lon = randInRange(lonRange[0], lonRange[1]);
    const start = deg2xy(latRange[0], lon);
    const wp = deg2xy(latRange[1], lon);
    cfg.mobiles.push({
      id: `C${i + 1}`,
      start,
      waypoints: [wp],
      speedMps: randSpeed(),
      color: 'green',
    });
  }

  // anchored tankers near cluster around 1.23N 103.90E
  for (let i = 0; i < 5; i++) {
    const lat = 1.23 + randInRange(-0.005, 0.005);
    const lon = 103.9 + randInRange(-0.005, 0.005);
    const pos = deg2xy(lat, lon);
    cfg.statics.push({
      id: `A${i + 1}`,
      pos,
      radius: 200,
    });
  }

  return cfg;
}
