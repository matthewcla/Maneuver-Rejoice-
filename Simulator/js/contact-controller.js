// ContactController module extracted for testing and reuse

export function solveCPA(own, tgt) {
    const rx = tgt.x - own.x;
    const ry = tgt.y - own.y;
    const vx = tgt.vx - own.vx;
    const vy = tgt.vy - own.vy;
    const v2 = vx * vx + vy * vy;
    const tCPA = v2 < 1e-6 ? 1e9 : - (rx * vx + ry * vy) / v2;
    const xCPA = rx + vx * tCPA;
    const yCPA = ry + vy * tCPA;
    const dCPA = Math.sqrt(xCPA * xCPA + yCPA * yCPA);
    return { t: tCPA, d: dCPA };
}

export class ContactController {
    constructor(track){ this.t = track; }
    update(dtHours,allContacts,cfg){
        if(this.t.isUserControlled||this.t.isHazard) return;
        switch(this.t.state){
            case 'MONITORING':
                if(this._collisionThreat(allContacts,cfg)){ this._planManeuver(cfg); }
                break;
            case 'EXECUTING_MANEUVER':
                this._applyManeuver(dtHours); break;
            case 'RESUMING_COURSE':
                this._returnToBase(dtHours); break;
        }
    }
    _collisionThreat(all,cfg){
        const own=this._asParticle(this.t);
        for(const other of all){
            if(other===this.t||other.isHazard) continue;
            const tgt=this._asParticle(other);
            const {t,d}=solveCPA(own,tgt);
            if(d<cfg.cpa_leeway && t>0 && t<cfg.time_to_cpa_range[1]/60){
                this.t.threat=other; return true;
            }
        } return false;
    }
    _planManeuver(cfg){
        const other=this.t.threat;
        if(!other) return;
        const rel=this._relativeSituation(this.t,other);
        const desired=cfg.cpa_leeway;
        const step=5; const max=60;
        const starCandidates=[];
        const portCandidates=[];
        for(let ang=step; ang<=max; ang+=step){
            let hdg=(this.t.course+ang)%360;
            let own={...this.t, course:hdg};
            const {d}=solveCPA(this._asParticle(own), this._asParticle(other));
            if(d>desired){ starCandidates.push(ang); break; }
        }
        for(let ang=step; ang<=max; ang+=step){
            let hdg=(this.t.course-ang+360)%360;
            let own={...this.t, course:hdg};
            const {d}=solveCPA(this._asParticle(own), this._asParticle(other));
            if(d>desired){ portCandidates.push(-ang); break; }
        }
        let deltaC=null;
        switch(rel){
            case 'HEAD_ON':
            case 'CROSS_GIVEWAY':
                deltaC=starCandidates[0] ?? portCandidates[0];
                break;
            case 'OVERTAKING':
                deltaC=starCandidates[0] ?? portCandidates[0];
                break;
            default:
                deltaC=(starCandidates.concat(portCandidates).sort((a,b)=>Math.abs(a)-Math.abs(b))[0]);
        }
        if(deltaC==null) deltaC=0;
        this.t._targetCourse=(this.t.course+deltaC+360)%360;
        this.t._targetSpeed=Math.max(2,this.t.speed);
        if(rel==='OVERTAKING') this.t._targetSpeed=Math.max(2,this.t.speed*0.6);
        this.t.state='EXECUTING_MANEUVER';
    }
    _applyManeuver(dt){
        const rateTurn=10*dt*60;
        const acc=1*dt*60;
        const diffC=((this.t._targetCourse - this.t.orderedCourse + 540)%360)-180;
        if(Math.abs(diffC)>rateTurn){
            this.t.orderedCourse=(this.t.orderedCourse+Math.sign(diffC)*rateTurn+360)%360;
        }else{ this.t.orderedCourse=this.t._targetCourse; }
        if(Math.abs(this.t.orderedSpeed-this.t._targetSpeed)>acc){
            this.t.orderedSpeed+=Math.sign(this.t._targetSpeed - this.t.orderedSpeed)*acc;
        }else{ this.t.orderedSpeed=this.t._targetSpeed; }
        if(!this._collisionThreat([...this.t._sim.tracks],this.t._sim.scenarioCfg)){
            this.t.state='RESUMING_COURSE';
        }
    }
    _returnToBase(dt){
        const rateTurn=5*dt*60;
        const acc=0.5*dt*60;
        const diffC=((this.t._base.course - this.t.orderedCourse + 540)%360)-180;
        if(Math.abs(diffC)>rateTurn){
            this.t.orderedCourse=(this.t.orderedCourse+Math.sign(diffC)*rateTurn+360)%360;
        }else{ this.t.orderedCourse=this.t._base.course; }
        if(Math.abs(this.t.orderedSpeed-this.t._base.speed)>acc){
            this.t.orderedSpeed+=Math.sign(this.t._base.speed - this.t.orderedSpeed)*acc;
        }else{ this.t.orderedSpeed=this.t._base.speed; }
        if(Math.abs(diffC)<1 && Math.abs(this.t.orderedSpeed-this.t._base.speed)<0.1){
            this.t.state='MONITORING';
            delete this.t.threat;
        }
    }
    _relativeSituation(a,b){
        const brg=(Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI+360)%360;
        const diffHdgs=Math.abs(((a.course - b.course + 540)%360)-180);
        if(diffHdgs>150&&diffHdgs<210) return 'HEAD_ON';
        const relBrg=(brg - a.course + 360)%360;
        if(relBrg>112.5&&relBrg<247.5) return 'OVERTAKING';
        if(relBrg>0&&relBrg<112.5) return 'CROSS_GIVEWAY';
        return 'OTHER';
    }
    _asParticle(v){
        const rad=(90-v.course)*Math.PI/180;
        return{ x:v.x, y:v.y, vx:v.speed*Math.cos(rad), vy:v.speed*Math.sin(rad) };
    }
}

