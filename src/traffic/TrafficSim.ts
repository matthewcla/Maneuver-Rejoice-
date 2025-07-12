import { OrcaWrapper } from './OrcaWrapper.js';
import {
  classifyEncounter,
  legalPreferredVelocity,
  Encounter,
} from './ColregsBias.js';
import { ScenarioConfig } from './buildScenario.js';

export interface TrafficSimArgs {
  laneWidthNm: number;
  timeStep: number;
  timeHorizon: number;
  neighborDist: number;
  radius: number;
  maxSpeed: number;
  turnRateRad: number;
}

export const DEFAULT_ARGS: TrafficSimArgs = {
  laneWidthNm: 0.5,
  timeStep: 0.25,
  timeHorizon: 15,
  neighborDist: 1000,
  radius: 20,
  maxSpeed: 15,
  turnRateRad: Math.PI / 12,
};

interface Track {
  id: string;
  posXY: [number, number];
  velXY: [number, number];
  waypoints: [number, number][];
  encounter?: Encounter;
  wpIndex: number;
  speed: number; // meters per second
}

const M_PER_NM = 1852;
const DEG_PER_M = 1 / (60 * M_PER_NM);

export class TrafficSim {
  private wrapper: OrcaWrapper;
  private tracks = new Map<string, Track>();
  private staticObstacles: { id: string; posXY: [number, number]; radius: number }[] = [];
  private cpaMap = new Map<string, number>();
  private args!: TrafficSimArgs;
  private readonly timeStep: number;
  private readonly turnRateRad: number;

  constructor(args: TrafficSimArgs | ScenarioConfig = DEFAULT_ARGS, scenario?: ScenarioConfig) {
    if (scenario === undefined && this.isScenario(args)) {
      scenario = args;
      args = DEFAULT_ARGS;
    }
    this.args = args as TrafficSimArgs;
    this.wrapper = new OrcaWrapper(
      this.args.timeStep,
      this.args.timeHorizon,
      this.args.neighborDist,
      this.args.radius,
      this.args.maxSpeed
    );
    this.timeStep = this.args.timeStep;
    this.turnRateRad = this.args.turnRateRad;

    if (scenario) {
      for (const m of scenario.mobiles) {
        const idLower = m.id.toLowerCase();
        if (idLower === 'ownship') continue;
        this.addTrack(m.id, m.start, m.waypoints, m.speedMps);
      }

      for (const s of scenario.statics) {
        if (s.id.toLowerCase() === 'ownship') continue;
        this.wrapper.addAgent(s.id, s.pos, [0, 0]);
        this.staticObstacles.push({ id: s.id, posXY: [...s.pos], radius: s.radius });
      }
    }
  }

  addTrack(
    id: string,
    startPos: [number, number],
    waypoints: [number, number][],
    speedMps: number
  ): void {
    const wp = waypoints[0] ?? startPos;
    const heading = Math.atan2(wp[1] - startPos[1], wp[0] - startPos[0]);
    const vel: [number, number] = [
      Math.cos(heading) * speedMps,
      Math.sin(heading) * speedMps,
    ];
    const track: Track = {
      id,
      posXY: [...startPos],
      velXY: vel,
      waypoints: [...waypoints],
      wpIndex: 0,
      speed: speedMps,
    };
    this.tracks.set(id, track);
    this.wrapper.addAgent(id, track.posXY, track.velXY);
  }

  private relativeBearing(from: Track, to: Track): number {
    const dx = to.posXY[0] - from.posXY[0];
    const dy = to.posXY[1] - from.posXY[1];
    const brg = Math.atan2(dy, dx);
    const hdg = Math.atan2(from.velXY[1], from.velXY[0]);
    const rel = ((brg - hdg) * 180) / Math.PI;
    return (rel + 360) % 360;
  }

  private preferredToWaypoint(t: Track): [number, number] {
    const wp = t.waypoints[t.wpIndex];
    if (!wp) return t.velXY;
    const dx = wp[0] - t.posXY[0];
    const dy = wp[1] - t.posXY[1];
    const dist = Math.hypot(dx, dy);
    if (dist < t.speed * this.timeStep) {
      if (t.wpIndex < t.waypoints.length - 1) {
        t.wpIndex += 1;
      }
    }
    const heading = Math.atan2(dy, dx);
    return [Math.cos(heading) * t.speed, Math.sin(heading) * t.speed];
  }

  tick(): void {
    const list = Array.from(this.tracks.values());
    // reset encounter classifications
    for (const t of list) t.encounter = 'none';
    // classify encounters and keep the most severe for each track
    const priority: Record<Encounter, number> = {
      headOn: 3,
      crossingStarboard: 2,
      crossingPort: 2,
      overtaking: 1,
      none: 0,
    };
    const select = (cur: Encounter, next: Encounter): Encounter =>
      priority[next] > priority[cur] ? next : cur;

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const encA = classifyEncounter(this.relativeBearing(a, b));
        const encB = classifyEncounter(this.relativeBearing(b, a));
        a.encounter = select(a.encounter!, encA);
        b.encounter = select(b.encounter!, encB);
      }
    }

    // set preferred velocities
    for (const t of list) {
      const pref = this.preferredToWaypoint(t);
      const vPref = legalPreferredVelocity(
        t.encounter ?? 'none',
        pref,
        this.turnRateRad
      );
      this.wrapper.setAgentState(t.id, t.posXY, t.velXY);
      this.wrapper.setPreferredVelocity(t.id, vPref);
    }

    this.wrapper.step();

    // update positions
    for (const t of list) {
      t.velXY = this.wrapper.getVelocity(t.id);
      t.posXY = [
        t.posXY[0] + t.velXY[0] * this.timeStep,
        t.posXY[1] + t.velXY[1] * this.timeStep,
      ];
    }

    this.updateCpaMap();
  }

  getSnapshot(): { id: string; posLatLon: [number, number]; cog: number; sog: number }[] {
    const result = [] as {
      id: string;
      posLatLon: [number, number];
      cog: number;
      sog: number;
    }[];
    for (const t of this.tracks.values()) {
      const lat = t.posXY[1] * DEG_PER_M;
      const lon = t.posXY[0] * DEG_PER_M;
      const cog = (Math.atan2(t.velXY[1], t.velXY[0]) * 180) / Math.PI;
      const sog = Math.hypot(t.velXY[0], t.velXY[1]);
      result.push({ id: t.id, posLatLon: [lat, lon], cog, sog });
    }
    return result;
  }

  getStaticObstacles(): { id: string; posXY: [number, number]; radius: number }[] {
    return this.staticObstacles.map((o) => ({ id: o.id, posXY: [...o.posXY], radius: o.radius }));
  }

  getEncounterLog(): { ids: [string, string]; cpaMeters: number }[] {
    const result: { ids: [string, string]; cpaMeters: number }[] = [];
    for (const [key, val] of this.cpaMap.entries()) {
      const ids = key.split('|') as [string, string];
      result.push({ ids, cpaMeters: val });
    }
    return result;
  }

  private isScenario(obj: unknown): obj is ScenarioConfig {
    return !!obj && typeof obj === 'object' && Array.isArray((obj as any).mobiles) && Array.isArray((obj as any).statics);
  }

  private updateCpaMap(): void {
    const list = Array.from(this.tracks.values());
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dist = Math.hypot(a.posXY[0] - b.posXY[0], a.posXY[1] - b.posXY[1]);
        this.recordCpa(a.id, b.id, dist);
      }
      for (const s of this.staticObstacles) {
        const dist = Math.hypot(a.posXY[0] - s.posXY[0], a.posXY[1] - s.posXY[1]) - s.radius;
        this.recordCpa(a.id, s.id, dist);
      }
    }
  }

  private recordCpa(id1: string, id2: string, dist: number): void {
    const key = id1 < id2 ? `${id1}|${id2}` : `${id2}|${id1}`;
    const cur = this.cpaMap.get(key);
    if (cur === undefined || dist < cur) {
      this.cpaMap.set(key, dist);
    }
  }
}

export default TrafficSim;
