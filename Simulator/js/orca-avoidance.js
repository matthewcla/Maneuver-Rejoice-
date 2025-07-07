/* ======================================================================
 * Simple ORCA-style collision avoidance helper
 * ======================================================================
 * Exports a global ORCA object with a single method `compute`.
 * compute(ownship, tracks, cfg) -> {deltaCourse, deltaSpeed}
 *
 * This implementation is intentionally lightweight and is not a full
 * optimisation solver. It approximates the ORCA velocity–obstacle
 * formulation and folds in basic COLREGs considerations.  It analyses
 * all nearby contacts, selects the most urgent threat and proposes a
 * course/speed adjustment for the own ship.
 * ====================================================================== */
(function(global){
    const DEG_TO_RAD = Math.PI/180;
    const RAD_TO_DEG = 180/Math.PI;

    function toVelocity(v){
        const ang = (90 - v.course) * DEG_TO_RAD;
        return { vx: v.speed * Math.cos(ang), vy: v.speed * Math.sin(ang) };
    }


    function relativeSituation(a,b){
        const brg = (Math.atan2(b.y - a.y, b.x - a.x) * RAD_TO_DEG + 360) % 360;
        const diff = Math.abs(((a.course - b.course + 540) % 360) - 180);
        if(diff > 150 && diff < 210) return 'HEAD_ON';
        const relBrg = (brg - a.course + 360) % 360;
        if(relBrg > 112.5 && relBrg < 247.5) return 'OVERTAKING';
        if(relBrg > 0 && relBrg < 112.5) return 'CROSS_GIVEWAY';
        return 'OTHER';
    }

    // Lightweight CPA solver (same as arena.js)
    function solveCPA(own, tgt) {
        const rx = tgt.x - own.x;
        const ry = tgt.y - own.y;
        const vx = tgt.vx - own.vx;
        const vy = tgt.vy - own.vy;

        const v2   = vx*vx + vy*vy;
        const tCPA = v2 < 1e-6 ? 1e9 : - (rx*vx + ry*vy) / v2;
        const xCPA = rx + vx*tCPA;
        const yCPA = ry + vy*tCPA;
        const dCPA = Math.sqrt(xCPA*xCPA + yCPA*yCPA);
        return { t: tCPA, d: dCPA };
    }

    /**
     * Compute course & speed adjustments using a simplified ORCA approach.
     * @param {Object} own - ownship {x,y,course,speed}
     * @param {Array<Object>} tracks - surrounding contacts
     * @param {Object} cfg - optional {timeHorizon, minCPA}
     * @returns {{deltaCourse:number, deltaSpeed:number}}
     */
    function compute(own, tracks, cfg={}){
        const timeH = cfg.timeHorizon ?? 30/60; // hours
        const minCPA = cfg.minCPA ?? 0.3;       // nautical miles
        const ownVel = toVelocity(own);

        let threat=null; let soon=timeH+1;
        for(const t of tracks){
            if(t===own || t.isHazard) continue;
            const vel = toVelocity(t);
            const {t:tcpa,d:dcpa} = solveCPA({...own,...ownVel},{...t,...vel});
            if(tcpa>0 && tcpa<timeH && dcpa<minCPA && tcpa<soon){
                threat = t; soon = tcpa;
            }
        }
        if(!threat){
            return {deltaCourse:0, deltaSpeed:0};
        }

        // --- Basic COLREGs compliant response ---
        const rel = relativeSituation(own, threat);
        let deltaC=0, deltaS=0;
        switch(rel){
            case 'HEAD_ON':
                deltaC = 30; break;             // turn to starboard
            case 'CROSS_GIVEWAY':
                deltaC = 35; break;             // give-way vessel turns to starboard
            case 'OVERTAKING':
                deltaS = -0.4 * own.speed; break; // slow down slightly
            default:
                deltaC = 25;                    // default small starboard turn
        }

        return {deltaCourse: deltaC, deltaSpeed: deltaS};
    }

    global.ORCA = { compute };
})(this);
