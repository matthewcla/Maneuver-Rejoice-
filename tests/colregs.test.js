import assert from 'assert';
import { ContactController } from '../Simulator/js/contact-controller.js';

const cfg = { cpa_leeway: 0.3, time_to_cpa_range: [15, 30] };

function makeTrack(opts){
  return Object.assign({state:'MONITORING',orderedCourse:opts.course,orderedSpeed:opts.speed,_base:{course:opts.course,speed:opts.speed}}, opts);
}

function runController(own, other){
  own._sim = {scenarioCfg: cfg, tracks: [own, other]};
  const ctrl = new ContactController(own);
  ctrl.update(0,[other],cfg);
  return own;
}

// Head-on: both vessels meeting on reciprocal courses
(function(){
  const own = makeTrack({x:0,y:0,course:0,speed:10});
  const trg = makeTrack({x:0,y:5,course:180,speed:10});
  runController(own, trg);
  assert.strictEqual(own.state,'EXECUTING_MANEUVER');
  const delta = (own._targetCourse - own.course + 360)%360;
  assert(delta > 0 && delta <= 60, 'should turn starboard');
})();

// Crossing: target on starboard crossing ahead
(function(){
  const own = makeTrack({x:0,y:0,course:0,speed:10});
  const trg = makeTrack({x:0.3,y:0.5,course:270,speed:10});
  runController(own, trg);
  assert.strictEqual(own.state,'EXECUTING_MANEUVER');
  const delta = (own._targetCourse - own.course + 360)%360;
  assert(delta > 0 && delta <= 60, 'give-way ship should turn starboard');
})();

console.log('All COLREGS tests passed');
