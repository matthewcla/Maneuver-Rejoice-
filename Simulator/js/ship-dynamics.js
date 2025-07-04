/* ==== DDG‐51 Flight IIA – realistic manoeuvring model ====================
   Generate the code requested below.  Follow every instruction exactly.
   ------------------------------------------------------------------------
   Ship & manoeuvring data (public sources):
     • Length between perpendiculars  LPP ≈ 150 m, draft T ≈ 9.4 m.
     • “Standard rudder” = +/−20 deg; helm orders also include half, full,
       hard (10, 30, 35 deg respectively).
     • Tactical diameter at 20 kts with 20 deg rudder  ≈ 1 060 yd.
       90° Advance ≈‎530 m ; 90° Transfer ≈‎440 m.
     • Sea‑trial steering fit: first‑order Nomoto constants
         ‑ steering time constant  T_N  = 7 s
         ‑ yaw gain at 20 kts      K_20 = 0.045 s⁻¹
       => steady yaw rate  r_ss = (K_20 · v/20kt) · δ  (rad s⁻¹).
     • Propulsive acceleration limited to ±0.07 m s⁻² (≈0.14 kt s⁻¹).
     • Minimum steerageway 3 kts.

   TASKS FOR CODEX
   ===============
   1. Implement a class  ShipDynamics  with state variables:
        x, y  (NM) ;  ψ (rad) ; yawRate r (rad/s) ; speed v (kt)
      and public method  update(dt, rudderDegCmd, speedCmdKts).
   2. Inside update:
        a. Convert speed to m/s.  Compute K(v) = K_20 * (v/20kt).
        b. Integrate Nomoto:   ṙ = (K(v)·δ - r)/T_N ;  ψ̇ = r.
        c. Integrate speed:    v̇ = clip((v_cmd - v)/τ_v, ±0.07 m/s²)
           with τ_v = 45 s and v ≥ 3 kts.
        d. Advance position in metres, then convert back to NM for storage.
   3. Write helper  preview90degTurn()  returning {advance_nm, transfer_nm}
        where  radius  R = v / |r_ss| ,
        advance A = 1.08·R , transfer Tr = 0.90·R .
   4. Export ready‑to‑use JS code (ES module) – no HTML, no CSS.
   5. Do not remove •this comment block• – keep it as documentation.
   ======================================================================= */

const DEG_TO_RAD = Math.PI / 180;
const KT_TO_MPS = 0.514444;
const M_PER_NM = 1852;
const T_N = 7;        // steering time constant in seconds
const K_20 = 0.045;   // yaw gain at 20 kts in s^-1
const TAU_V = 45;     // propulsion time constant
const MAX_ACC = 0.07; // m/s^2
const MIN_STEERAGE_KTS = 3;

export class ShipDynamics {
    constructor() {
        this.x = 0;    // position east in nautical miles
        this.y = 0;    // position north in nautical miles
        this.psi = 0;  // heading in radians (0 = north, +clockwise)
        this.r = 0;    // yaw rate in rad/s
        this.v = 0;    // speed in knots
    }

    /**
     * Advance the ship state by dt seconds.
     * @param {number} dt - time step in seconds
     * @param {number} rudderDegCmd - rudder angle command in degrees
     * @param {number} speedCmdKts - commanded speed in knots
     */
    update(dt, rudderDegCmd, speedCmdKts) {
        const delta = rudderDegCmd * DEG_TO_RAD;

        // Current speed in m/s and yaw gain
        let vMps = this.v * KT_TO_MPS;
        const Kv = K_20 * (this.v / 20);

        // --- Nomoto first-order steering ---
        const rDot = (Kv * delta - this.r) / T_N;
        this.r += rDot * dt;
        this.psi += this.r * dt;

        // --- Propulsion dynamics ---
        const vCmdMps = speedCmdKts * KT_TO_MPS;
        let acc = (vCmdMps - vMps) / TAU_V;
        if (acc > MAX_ACC) acc = MAX_ACC;
        if (acc < -MAX_ACC) acc = -MAX_ACC;
        vMps += acc * dt;
        const minSpeedMps = MIN_STEERAGE_KTS * KT_TO_MPS;
        if (vMps < minSpeedMps) vMps = minSpeedMps;
        this.v = vMps / KT_TO_MPS;

        // --- Integrate position ---
        const dx = vMps * dt * Math.sin(this.psi);
        const dy = vMps * dt * Math.cos(this.psi);
        this.x += dx / M_PER_NM;
        this.y += dy / M_PER_NM;
    }
}

/**
 * Predict 90° manoeuvre characteristics.
 * @param {number} speedKts - vessel speed in knots
 * @param {number} rudderDeg - rudder command in degrees
 * @returns {{advance_nm:number, transfer_nm:number}}
 */
export function preview90degTurn(speedKts, rudderDeg) {
    const delta = rudderDeg * DEG_TO_RAD;
    const r_ss = K_20 * (speedKts / 20) * delta;
    if (r_ss === 0) {
        return { advance_nm: Infinity, transfer_nm: Infinity };
    }
    const vMps = speedKts * KT_TO_MPS;
    const radius = vMps / Math.abs(r_ss);
    const advance = 1.08 * radius;
    const transfer = 0.90 * radius;
    return {
        advance_nm: advance / M_PER_NM,
        transfer_nm: transfer / M_PER_NM,
    };
}
