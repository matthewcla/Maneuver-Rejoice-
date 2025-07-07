const fs = require('fs');
const vm = require('vm');

function loadController() {
  let code = fs.readFileSync('Simulator/js/arena.js', 'utf8');
  code = code.replace('class ContactController', 'ContactController = class ContactController');
  const sandbox = {
    document:{addEventListener(){},getElementById(){return null;},querySelector(){return null;},body:{classList:{add(){},remove(){}}},fonts:{ready:Promise.resolve()}},
    window:{matchMedia:()=>({matches:true}),addEventListener(){},navigator:{standalone:false}},
    navigator:{userAgent:''},
    ResizeObserver:function(){return {observe(){}};},
    console,
    performance:{now:()=>0}
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.ContactController;
}

const ContactController = loadController();
const cfg = { cpa_leeway: 0.3, time_to_cpa_range: [15, 30] };

function makeTrack(id,x,y,course,speed) {
  return {id,x,y,course,speed,state:'MONITORING',_base:{course,speed}};
}

function runControllers(t1,t2) {
  const sim={tracks:[t1,t2],scenarioCfg:cfg};
  t1._sim=sim; t2._sim=sim;
  t1._controller=new ContactController(t1);
  t2._controller=new ContactController(t2);
  t1._controller.update(0,sim.tracks,cfg);
  t2._controller.update(0,sim.tracks,cfg);
}

// Head-on: both should turn starboard
{
  const a=makeTrack('a',-2,0,90,10);
  const b=makeTrack('b',2,0,270,10);
  runControllers(a,b);
  if(!(a._targetCourse > a.course && b._targetCourse > b.course)) {
    console.error('Head-on maneuver failed', a._targetCourse, b._targetCourse);
    process.exit(1);
  }
}

// Crossing: vessel with contact on starboard should turn starboard
{
  const a=makeTrack('a',0,0,0,10);      // heading north
  const b=makeTrack('b',1,1,270,10);    // westbound crossing from starboard
  runControllers(a,b);
  if(!(a._targetCourse > a.course && b._targetCourse === b.course)) {
    console.error('Crossing maneuver failed', a._targetCourse, b._targetCourse);
    process.exit(1);
  }
}

// Overtaking: overtaking vessel alters course or speed, other holds
{
  const a=makeTrack('a',0,0,0,12);      // ahead moving north
  const b=makeTrack('b',0,-1,0,15);     // behind overtaking
  runControllers(a,b);
  const changed = b._targetCourse !== b.course || b._targetSpeed !== b.speed;
  if(!(changed && a._targetCourse === a.course)) {
    console.error('Overtaking maneuver failed', b._targetCourse, b._targetSpeed);
    process.exit(1);
  }
}
console.log('All COLREGS tests passed');
