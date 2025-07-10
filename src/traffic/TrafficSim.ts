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
  private readonly timeStep: number;
  private readonly turnRateRad: number;

  constructor(private args: TrafficSimArgs, scenario?: ScenarioConfig) {
    this.wrapper = new OrcaWrapper(
      args.timeStep,
      args.timeHorizon,
      args.neighborDist,
      args.radius,
      args.maxSpeed
    );
    this.timeStep = args.timeStep;
    this.turnRateRad = args.turnRateRad;

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
    // classify encounters
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const encA = classifyEncounter(this.relativeBearing(a, b));
        const encB = classifyEncounter(this.relativeBearing(b, a));
        a.encounter = encA;
        b.encounter = encB;
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
}
