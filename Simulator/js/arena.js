/* ============================================================
 * Scenario generation & COLREGs contact controller
 * ============================================================
 */
const ScenarioConfig = {
    contact_density        : 6,
    cpa_leeway             : 0.3,
    time_to_cpa_range      : [15, 30],
    vector_randomization   : 0.15,
    maneuvering_probability: 0.35,
    constraint_density     : 2,
};

// --- Polar grid rendering constants ---
const CARDINAL_BEARINGS   = [0, 90, 180, 270];
const DASH_PATTERN_NONCAR = [4, 4];      // dashed
const DASH_PATTERN_SOLID  = [];          // solid
const LABEL_OFFSET_PX     = 6;           // gap between ring and label

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

class ScenarioGenerator {
    constructor(cfg){
        this.cfg = cfg;
        this.nextId = 1;
    }
    makeScenario(ownship){
        const tracks = [];
        const archetypes = ['STARBOARD_CROSS','HEAD_ON','OVERTAKE','CONSTRAINED'];
        const type = archetypes[Math.floor(Math.random()*archetypes.length)];
        const primary = this._makePrimary(type, ownship);
        tracks.push(primary);
        const nExtra = this._randInt(this.cfg.contact_density-1, this.cfg.contact_density+1);
        for(let i=0;i<nExtra;i++){
            const c = this._makeSecondary(ownship, tracks);
            tracks.push(c);
        }
        for(let i=0;i<this.cfg.constraint_density;i++){
            tracks.push(this._makeHazard(ownship));
        }
        return tracks;
    }
    _makePrimary(type,own){
        const rng = this._rand(4,8);
        let brg, crs, spd;
        switch(type){
            case 'STARBOARD_CROSS':
                brg = this._rand(20,60);
                crs = (own.course + 270 + this._rand(-10,10))%360; break;
            case 'HEAD_ON':
                brg = this._rand(350,10);
                crs = (own.course + 180 + this._rand(-5,5))%360; break;
            case 'OVERTAKE':
                brg = this._rand(150,210);
                crs = own.course + this._rand(-5,5);
                spd = own.speed - this._rand(2,4); break;
            case 'CONSTRAINED':
            default:
                brg = this._rand(40,60);
                crs = (own.course + 270)%360; break;
        }
        spd = spd ?? this._rand(5,12);
        const tgt = this._spawn(own, brg, rng, crs, spd);
        this._tuneCPA(own, tgt);
        tgt.archetype = type;
        return tgt;
    }
    _makeSecondary(own, existing){
        const brg = this._rand(0,360);
        const rng = this._rand(2, own.maxRange??12);
        const crs = this._rand(0,360);
        const spd = this._rand(3,15);
        const c = this._spawn(own, brg, rng, crs, spd);
        if(Math.random()<this.cfg.maneuvering_probability && existing.length){
            const tgt = existing[Math.floor(Math.random()*existing.length)];
            c.course = (Math.atan2(tgt.y-c.y, tgt.x-c.x)*180/Math.PI + 360 + this._rand(-5,5))%360;
        }
        return c;
    }
    _makeHazard(own){
        const brg = this._rand(0,360);
        const rng = this._rand(3, own.maxRange??12);
        const h = this._spawn(own, brg, rng, 0, 0);
        h.isHazard = true;
        return h;
    }
    _spawn(own,bearing,range,course,speed){
        const id  = String(this.nextId++).padStart(4, '0');
        const rad = bearing * Math.PI / 180;
        return {
            id,
            x: own.x + range * Math.sin(rad),
            y: own.y + range * Math.cos(rad),
            course: course % 360,
            speed,
            state: 'MONITORING',
            isUserControlled: false,
            _base: { course, speed },
            initialBearing: bearing,
            initialRange: range,
        };
    }
    _tuneCPA(own,tgt){
        for(let i=0;i<90;i++){
            const ownVec=this._vel(own), tgtVec=this._vel(tgt);
            const {t,d}=solveCPA({...own,...ownVec},{...tgt,...tgtVec});
            const minT=this.cfg.time_to_cpa_range[0]/60,
                maxT=this.cfg.time_to_cpa_range[1]/60;
            if(d<this.cfg.cpa_leeway && t>minT && t<maxT) return;
            tgt.course=(tgt.course+this._rand(-4,4))%360;
        }
    }
    _vel(v){const rad=(90-v.course)*Math.PI/180;return{vx:v.speed*Math.cos(rad),vy:v.speed*Math.sin(rad)}}
    _rand(a,b){return a+Math.random()*(b-a)}
    _randInt(a,b){return Math.floor(this._rand(a,b+1))}
}

class ContactController {
    constructor(track){this.t=track;}
    update(dtHours,allContacts,cfg){
        if(this.t.isUserControlled||this.t.isHazard) return;
        switch(this.t.state){
            case 'MONITORING':
                if(this._collisionThreat(allContacts,cfg)){ this._planManeuver(); }
                break;
            case 'CALCULATING_MANEUVER': break;
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
    _planManeuver(){
        const rel=(this.t.threat&&this._relativeSituation(this.t,this.t.threat))||'UNKNOWN';
        let deltaCrs=0, deltaSpd=0;
        switch(rel){
            case 'HEAD_ON': deltaCrs=30; break;
            case 'CROSS_GIVEWAY': deltaCrs=35; break;
            case 'OVERTAKING': deltaCrs=0; deltaSpd=-0.4*this.t.speed; break;
            default: deltaCrs=25;
        }
        this.t._targetCourse=(this.t.course+deltaCrs+360)%360;
        this.t._targetSpeed=Math.max(2,this.t.speed+deltaSpd);
        this.t.state='EXECUTING_MANEUVER';
    }
    _applyManeuver(dt){
        const rateTurn=10*dt*60;
        const acc=1*dt*60;
        const diffC=((this.t._targetCourse - this.t.course + 540)%360)-180;
        if(Math.abs(diffC)>rateTurn){
            this.t.course=(this.t.course+Math.sign(diffC)*rateTurn+360)%360;
        }else{ this.t.course=this.t._targetCourse; }
        if(Math.abs(this.t.speed-this.t._targetSpeed)>acc){
            this.t.speed+=Math.sign(this.t._targetSpeed - this.t.speed)*acc;
        }else{ this.t.speed=this.t._targetSpeed; }
        if(!this._collisionThreat([...this.t._sim.tracks],this.t._sim.scenarioCfg)){
            this.t.state='RESUMING_COURSE';
        }
    }
    _returnToBase(dt){
        const rateTurn=5*dt*60;
        const acc=0.5*dt*60;
        const diffC=((this.t._base.course - this.t.course + 540)%360)-180;
        if(Math.abs(diffC)>rateTurn){
            this.t.course=(this.t.course+Math.sign(diffC)*rateTurn+360)%360;
        }else{ this.t.course=this.t._base.course; }
        if(Math.abs(this.t.speed-this.t._base.speed)>acc){
            this.t.speed+=Math.sign(this.t._base.speed - this.t.speed)*acc;
        }else{ this.t.speed=this.t._base.speed; }
        if(Math.abs(diffC)<1 && Math.abs(this.t.speed-this.t._base.speed)<0.1){
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
    _asParticle(v){const rad=(90-v.course)*Math.PI/180;return{x:v.x,y:v.y,vx:v.speed*Math.cos(rad),vy:v.speed*Math.sin(rad)}}
}

/**
 * @class Simulator
 * Encapsulates the entire state and logic for the ship maneuvering simulator.
 */
class Simulator {
    constructor() {
        // --- Suppress rendering flag for editable fields ---
        this.suppressEditRender = false;
        // Flag and helper for debounced UI updates
        this.uiUpdatePending = false;
        // --- DOM Element References ---
        this.canvas = document.getElementById('radarCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.dragTooltip = document.getElementById('drag-tooltip');
        this.orderTooltip = document.getElementById('order-tooltip');
        this.btnVectorTime = document.getElementById('btn-vector-time');
        this.btnPlayPause = document.getElementById('btn-play-pause');
        this.iconPlay = document.getElementById('icon-play');
        this.iconPause = document.getElementById('icon-pause');
        this.btnRange = document.getElementById('btn-range');
        this.btnAddTrack  = document.getElementById('btn-add-track');
        this.btnDropTrack = document.getElementById('btn-drop-track');
        this.btnScen = document.getElementById('btn-scen');
        this.btnFf = document.getElementById('btn-ff');
        this.btnRev = document.getElementById('btn-rev');
        this.ffSpeedIndicator = document.getElementById('ff-speed-indicator');
        this.revSpeedIndicator = document.getElementById('rev-speed-indicator');
        this.btnHelp = document.getElementById('btn-help');
        this.helpModal = document.getElementById('help-modal');
        this.helpCloseBtn = document.getElementById('help-close-btn');
        this.helpContent = this.helpModal.querySelector('pre');
        this.buttonBar = document.getElementById('button-bar');
        this.radarWrapper = document.getElementById('radar-wrapper');
        this.radarContainer = document.getElementById('radar-container');
        this.rightPane = document.getElementById('right-pane');
        this.dataPane = document.getElementById('data-pane');
        this.trackDataContainer = document.getElementById('track-data-container');
        this.rmDataContainer = document.getElementById('rm-data-container');
        this.cpaDataContainer = document.getElementById('cpa-data-container');
        this.windDataContainer = document.getElementById('wind-data-container');
        this.simClock = document.getElementById('sim-clock');
        this.mainContainer = document.querySelector('main.sim-radar');
        this.btnFullscreen = document.getElementById('btn-fullscreen');
        this.btnSettings = document.getElementById('btn-settings');
        this.settingsDrawer = document.getElementById('settings-drawer');
        this.chkPolarPlot = document.getElementById('toggle-polar-plot');
        this.chkTrackIds = document.getElementById('toggle-track-ids');

        // --- Configuration ---
        this.radarGreen = getComputedStyle(document.documentElement).getPropertyValue('--radar-green').trim();
        this.radarWhite = getComputedStyle(document.documentElement).getPropertyValue('--radar-white').trim();
        this.radarFaintGreen = getComputedStyle(document.documentElement).getPropertyValue('--radar-faint-green').trim();
        this.radarFaintWhite = getComputedStyle(document.documentElement).getPropertyValue('--radar-faint-white').trim();
        this.radarDarkOrange = getComputedStyle(document.documentElement).getPropertyValue('--radar-dark-orange').trim();
        this.scenarioCfg = ScenarioConfig;

        // --- State Data ---
        this.ownShip = {
            course: 91,
            speed: 12.7,
            id: 'ownShip',
            x: 0,
            y: 0,
            orderedCourse: 91,
            orderedSpeed: 12.7,
            dragCourse: null,
            dragSpeed: null,
            orderedVectorEndpoint: null
        };
        this.tracks = [
            { id: '0001', initialBearing: 327, initialRange: 7.9, course: 255, speed: 6.1 },
            { id: '0002', initialBearing: 345, initialRange: 6.5, course: 250, speed: 7.2 },
            { id: '0003', initialBearing: 190, initialRange: 8.2, course: 75,  speed: 8.0 },
            { id: '0004', initialBearing: 205, initialRange: 5.5, course: 70,  speed: 7.5 },
            { id: '0005', initialBearing: 180, initialRange: 3.1, course: 72,  speed: 8.2 },
        ];

        this.selectedTrackId = '0001';
        this.hoveredTrackId = null;
        this.draggedItemId = null;
        this.dragType = null;
        this.pendingDragId = null;
        this.pendingDragType = null;
        this.DPR = window.devicePixelRatio || 1;
        this.pointerDownPos = { x: 0, y: 0 };
        this.dragThreshold = 6 * this.DPR;
        this.lastMousePos = { x: 0, y: 0 };
        this.lastTimestamp = 0;
        this.lastDomUpdate  = 0;
        this.DOM_UPDATE_INTERVAL = 200;
        this.sceneDirty = true;
        this.simulationElapsed = 0;
        this.activeEditField = null;

        // --- Weather Data ---
        this.trueWind = {
            direction: 70,
            speed: 15,
            wPos: {x: 0, y: 0},
            arrowEndpoint: {x: 0, y: 0}
        };
        this.relativeWind = {};

        // --- Feature Toggle States ---
        this.maxRange = 12.0;
        this.rangeScales = [3.0, 6.0, 12.0, 24.0];
        this.vectorTimeInMinutes = 15;
        this.vectorTimes = [3, 15, 30];
        // Indexes for cycling vector time and range (ensure label updates immediately)
        this.vectorTimeIndex = this.vectorTimes.indexOf(this.vectorTimeInMinutes);
        this.rangeIndex = this.rangeScales.indexOf(this.maxRange);
        this.simulationSpeed = 1;
        this.ffSpeeds = [25, 50];
        this.revSpeeds = [-25, -50];
        this.showRelativeMotion = false;
        this.showCPAInfo = false;
        this.isSimulationRunning = true;
        this.showWeather = true;
        this.showPolarPlot = true;
        this.showTrackIds = true;
        this.uiScaleFactor = 1;

        // Sync data panel visibility with feature toggles
        this.rmDataContainer.open   = this.showRelativeMotion;
        this.cpaDataContainer.open  = this.showCPAInfo;
        this.windDataContainer.open = this.showWeather;

        // Pre-rendered radar backdrop
        this.staticCanvas = document.createElement('canvas');
        this.staticCtx = this.staticCanvas.getContext('2d');
        this.staticDirty = true;

        // Bind methods to ensure correct `this` context
        this.gameLoop = this.gameLoop.bind(this);
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);

        this._initialize();
    }

    // --- Main Initialization ---
    _initialize() {
        this._attachEventListeners();

        const BASE_CANVAS_SIZE = 900;
        this.canvas.width = BASE_CANVAS_SIZE * this.DPR;
        this.canvas.height = BASE_CANVAS_SIZE * this.DPR;
        this.staticCanvas.width = this.canvas.width;
        this.staticCanvas.height = this.canvas.height;
        this.drawStaticRadar();
        this.staticDirty = false;

        this.simulationElapsed = 0;
        this.updateSimClock();
        if (this.tracks.length > 0) {
            this.tracks.forEach(track => {
                if (track.initialBearing !== undefined && track.initialRange !== undefined) {
                    track.x = this.ownShip.x + track.initialRange * Math.sin(this.toRadians(track.initialBearing));
                    track.y = this.ownShip.y + track.initialRange * Math.cos(this.toRadians(track.initialBearing));
                } else if (track.x !== undefined && track.y !== undefined) {
                    const dx = track.x - this.ownShip.x;
                    const dy = track.y - this.ownShip.y;
                    track.initialRange = Math.sqrt(dx ** 2 + dy ** 2);
                    track.initialBearing = (this.toDegrees(Math.atan2(dx, dy)) + 360) % 360;
                }
                if (!track._controller) {
                    track._controller = new ContactController(track);
                    track._sim = this;
                }
            });
        }

        this.tracks.forEach(t => this.calculateAllData(t));
        this.calculateWindData();

        this.updateButtonStyles();
        this.updatePanelsAndRedraw();
        this.scaleUI();

        this.lastTimestamp = performance.now();
        if (this.isSimulationRunning) {
            this.startGameLoop();
        }
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => this.scaleUI());
        }
    }

    // --- Event Listener Setup ---
    _attachEventListeners() {
        // Canvas interaction
        if (window.PointerEvent) {
            this.canvas?.addEventListener('pointerdown', this.handlePointerDown);
            this.canvas?.addEventListener('pointerup', this.handlePointerUp);
            this.canvas?.addEventListener('pointerleave', this.handlePointerUp);
            this.canvas?.addEventListener('pointercancel', this.handlePointerUp);
            this.canvas?.addEventListener('pointermove', this.handlePointerMove);
        } else if ('ontouchstart' in window) {
            const wrap = (handler) => (e) => {
                const touch = e.touches[0] || e.changedTouches[0];
                if (!touch) return;
                handler({
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    button: 0,
                    buttons: 1,
                    pointerType: 'touch'
                });
                e.preventDefault();
            };
            this.canvas?.addEventListener('touchstart', wrap(this.handlePointerDown), { passive: false });
            this.canvas?.addEventListener('touchmove', wrap(this.handlePointerMove), { passive: false });
            this.canvas?.addEventListener('touchend', wrap(this.handlePointerUp));
            this.canvas?.addEventListener('touchcancel', wrap(this.handlePointerUp));
        } else {
            this.canvas?.addEventListener('mousedown', this.handlePointerDown);
            this.canvas?.addEventListener('mouseup', this.handlePointerUp);
            this.canvas?.addEventListener('mouseleave', this.handlePointerUp);
            this.canvas?.addEventListener('mousemove', this.handlePointerMove);
        }

        // Window resize
        window.addEventListener('resize', this._throttleRAF(() => {
            this.scaleUI();
        }));

        // Control buttons
        this.btnVectorTime?.addEventListener('click', () => this.toggleVectorTime());
        this.btnRange?.addEventListener('click', () => this.toggleRange());
        this.btnPlayPause?.addEventListener('click', () => this.togglePlayPause());
        this.btnFf?.addEventListener('click', () => this.fastForward());
        this.btnRev?.addEventListener('click', () => this.rewind());
        this.btnAddTrack?.addEventListener('click', () => this.addTrack());
        this.btnDropTrack?.addEventListener('click', () => this.dropTrack());
        this.btnScen?.addEventListener('click', () => this.setupRandomScenario());

        // Help Modal
        // this.btnHelp?.addEventListener('click', () => this.showHelpModal());
        this.helpCloseBtn?.addEventListener('click', () => this.hideHelpModal());
        if (this.helpModal && this.helpContent && this.helpCloseBtn) {
            new ResizeObserver(() => {
                const scale = Math.max(0.8, Math.min(1.2, this.helpModal.clientWidth / 500));
                this.helpContent.style.fontSize = `${1 * scale}rem`;
                this.helpCloseBtn.style.fontSize = `${0.9 * scale}rem`;
                this.helpCloseBtn.style.padding = `${0.5 * scale}rem`;
            }).observe(this.helpModal);
        }

        // Data panel expand/collapse toggles radar elements
        this.rmDataContainer?.addEventListener('toggle', () => {
            this.showRelativeMotion = this.rmDataContainer.open;
            this.markSceneDirty();
            this._scheduleUIUpdate();
        });
        this.cpaDataContainer?.addEventListener('toggle', () => {
            this.showCPAInfo = this.cpaDataContainer.open;
            this.markSceneDirty();
            this._scheduleUIUpdate();
        });
        this.windDataContainer?.addEventListener('toggle', () => {
            this.showWeather = this.windDataContainer.open;
            this.markSceneDirty();
            this._scheduleUIUpdate();
        });

        // Settings drawer interactions
        if (this.btnSettings && this.settingsDrawer) {
            this.btnSettings.addEventListener('click', () => {
                if (this.settingsDrawer.classList.contains('open')) {
                    this.settingsDrawer.classList.remove('open');
                    this.settingsDrawer.addEventListener('transitionend', () => {
                        this.settingsDrawer.style.display = 'none';
                    }, { once: true });
                } else {
                    this.settingsDrawer.style.display = 'flex';
                    requestAnimationFrame(() => this.settingsDrawer.classList.add('open'));
                }
            });

            this.settingsDrawer.addEventListener('mouseleave', () => {
                if (this.settingsDrawer.classList.contains('open')) {
                    this.settingsDrawer.classList.remove('open');
                    this.settingsDrawer.addEventListener('transitionend', () => {
                        this.settingsDrawer.style.display = 'none';
                    }, { once: true });
                }
            });
        }
        // Fullscreen toggle
        this.btnFullscreen?.addEventListener('click', () => this.toggleFullScreen());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.fullscreenElement) {
                document.exitFullscreen();
            }
        });

        // Settings toggles for polar plot and track IDs
        this.chkPolarPlot?.addEventListener('change', () => this.togglePolarPlot());
        this.chkTrackIds?.addEventListener('change', () => this.toggleTrackIds());

        // Shared tooltip behavior for elements with data-tooltip
        document.querySelectorAll('[data-tooltip]').forEach(el => {
            el.addEventListener('pointerenter', e => {
                this.dragTooltip.textContent = el.getAttribute('data-tooltip');
                this.dragTooltip.style.color = this.radarGreen;
                this.dragTooltip.style.display = 'block';
                this.dragTooltip.style.transform = `translate(${e.clientX - this.dragTooltip.offsetWidth - 10}px, ${e.clientY - this.dragTooltip.offsetHeight - 10}px)`;
            });
            el.addEventListener('pointermove', e => {
                if (this.dragTooltip.style.display === 'block') {
                    this.dragTooltip.style.transform = `translate(${e.clientX - this.dragTooltip.offsetWidth - 10}px, ${e.clientY - this.dragTooltip.offsetHeight - 10}px)`;
                }
            });
            el.addEventListener('pointerleave', () => {
                this.dragTooltip.style.display = 'none';
            });
            el.addEventListener('pointerdown', () => {
                this.dragTooltip.style.display = 'none';
            });
        });

        // Editable fields
        this.dataPane?.addEventListener('click', (e) => {
            if (e.target.classList.contains('editable')) {
                if (this.activeEditField) return; // Prevent new input if one is already active
                this.activeEditField = e.target.id;
                this._scheduleUIUpdate();
            }
        });
    }

    // --- Vector Time Toggle ---
    toggleVectorTime() {
        this.vectorTimeIndex = (this.vectorTimeIndex + 1) % this.vectorTimes.length;
        this.vectorTimeInMinutes = this.vectorTimes[this.vectorTimeIndex];
        this.btnVectorTime.textContent = `${this.vectorTimeInMinutes} min`;
        this.markSceneDirty();
    }

    // --- Range Toggle ---
    toggleRange() {
        this.rangeIndex = (this.rangeIndex + 1) % this.rangeScales.length;
        this.maxRange = this.rangeScales[this.rangeIndex];
        this.btnRange.textContent = `${this.maxRange.toFixed(1)} nm`;
        this.staticDirty = true;
        this.markSceneDirty();
    }

    // TODO: Optimize the simulation loop to handle ~50-100 tracks smoothly.
    // - Avoid creating new objects or strings every frame (reuse them instead).
    // - Do minimal work for off-screen or non-selected tracks.
    // - Keep each frame under ~16ms.
    // --- Animation & Optimizations ---

    gameLoop(timestamp) {
        const deltaTime = (timestamp - this.lastTimestamp) || 0;
        this.lastTimestamp = timestamp;

        this.updatePhysics(deltaTime);

        if (this.isSimulationRunning) {
            this.simulationElapsed += (deltaTime / 1000) * Math.abs(this.simulationSpeed);
            this.sceneDirty = true;
        }

        if (this.sceneDirty) {
            this.tracks.forEach(t => this.calculateAllData(t));
            this.calculateWindData();
            this.drawRadar();
            this.sceneDirty = false;
        }

        if (timestamp - this.lastDomUpdate >= this.DOM_UPDATE_INTERVAL) {
            this.updateOwnShipPanel();
            this.updateDataPanels();
            this.updateButtonStyles();
            this.updateSimClock();
            this.lastDomUpdate = timestamp;
        }

        if (this.isSimulationRunning || this.sceneDirty) {
            requestAnimationFrame(this.gameLoop);
        } else {
            this.gameLoop.running = false;
        }
    }

    startGameLoop() {
        if (!this.gameLoop.running) {
            this.gameLoop.running = true;
            requestAnimationFrame(this.gameLoop);
        }
    }

    markSceneDirty() {
        this.sceneDirty = true;
        this.startGameLoop();
    }

    _throttleRAF(fn) {
        let running = false;
        return (...args) => {
            if (!running) {
                running = true;
                requestAnimationFrame(() => {
                    fn.apply(this, args);
                    running = false;
                });
            }
        };
    }

    _setText(id, value) {
        const el = document.getElementById(id);
        if (el && el.textContent !== value) {
            el.textContent = value;
        }
    }

    _renderEditableField(id, displayValue, numericValue) {
        const el = document.getElementById(id);
        if (!el) return;

        if (this.activeEditField === id) {
            if (this.suppressEditRender) return;
            if (!el.querySelector('input')) {
                el.innerHTML = `<input type="text" value="${parseFloat(numericValue).toFixed(1)}">`;
                const input = el.querySelector('input');
                const commit = () => {
                    const newVal = parseFloat(input.value);
                    this.activeEditField = null;
                    this.suppressEditRender = true;          // block edit‑field render for the next frame
                    el.textContent = this._formatDisplayValue(id, newVal); // immediate static text
                    this.commitEdit(id, newVal);
                    this._scheduleUIUpdate();                // refresh, block lifted inside
                };
                input.addEventListener('blur', commit, { once: true });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        input.blur();
                    } else if (e.key === 'Escape') {
                        this.activeEditField = null;
                        this._scheduleUIUpdate();
                    }
                });
                setTimeout(() => { input.focus(); input.select(); }, 0);
            }
        } else {
            if (el.textContent !== displayValue) {
                el.textContent = displayValue;
            }
        }
    }

    /**
     * Format the numeric value for immediate static display after editing.
     */
    _formatDisplayValue(id, num) {
        if (id === 'ownship-crs' || id === 'track-crs' || id === 'track-brg') {
            return `${this.formatBearing(num)} T`;
        }
        if (id === 'ownship-spd' || id === 'track-spd') {
            return `${num.toFixed(1)} KTS`;
        }
        if (id === 'track-rng') {
            return `${num.toFixed(1)} NM`;
        }
        return String(num);
    }

    /**
     * Schedule a single UI refresh on the next animation frame.
     * Prevents rapid back‑to‑back redraws that cause visual bounce.
     * Also clears the temporary suppress flag used during input‑blur commits.
     */
    _scheduleUIUpdate() {
        if (this.uiUpdatePending) return;
        this.uiUpdatePending = true;
        requestAnimationFrame(() => {
            this.uiUpdatePending = false;
            this.suppressEditRender = false;   // lift one‑frame block
            this.updatePanelsAndRedraw();
        });
    }

    commitEdit(id, value) {
        let didUpdate = false;
        if (isNaN(value)) {
            this.activeEditField = null;
            this._scheduleUIUpdate();
            return;
        }

        const track = this.tracks.find(t => t.id === this.selectedTrackId);

        if (id === 'ownship-crs') {
            this.ownShip.orderedCourse = Math.max(0, Math.min(359.9, value));
            didUpdate = true;
        } else if (id === 'ownship-spd') {
            this.ownShip.orderedSpeed = value;
            didUpdate = true;
        } else if (track) {
            if (id === 'track-brg') {
                track.bearing = Math.max(0, Math.min(359.9, value));
                didUpdate = true;
            } else if (id === 'track-rng') {
                track.range = Math.max(0, Math.min(359.9, value));
                didUpdate = true;
            } else if (id === 'track-crs') {
                track.course = Math.max(0, Math.min(359.9, value));
                didUpdate = true;
            } else if (id === 'track-spd') {
                track.speed = value;
                didUpdate = true;
            }

            if ((id === 'track-brg' || id === 'track-rng') && track.bearing !== undefined && track.range !== undefined) {
                const angleRad = this.toRadians(track.bearing);
                track.x = this.ownShip.x + track.range * Math.sin(angleRad);
                track.y = this.ownShip.y + track.range * Math.cos(angleRad);
            }
        }

        this.activeEditField = null;
        this._scheduleUIUpdate();
        if (didUpdate) {
            this.markSceneDirty();
        }
    }

    // --- Physics & Calculations ---
    updatePhysics(deltaTime) {
        if (!this.isSimulationRunning) return;

        const dtSec = (deltaTime / 1000) * Math.abs(this.simulationSpeed);

        // Gradually adjust ownship toward ordered values
        const maxTurn = 3 * dtSec;            // degrees per second
        let courseDiff = (this.ownShip.orderedCourse - this.ownShip.course + 540) % 360 - 180;
        if (Math.abs(courseDiff) <= maxTurn) {
            this.ownShip.course = this.ownShip.orderedCourse;
        } else {
            this.ownShip.course = (this.ownShip.course + Math.sign(courseDiff) * maxTurn + 360) % 360;
        }

        const maxSpdChange = 0.1 * dtSec;     // knots per second
        const spdDiff = this.ownShip.orderedSpeed - this.ownShip.speed;
        if (Math.abs(spdDiff) <= maxSpdChange) {
            this.ownShip.speed = this.ownShip.orderedSpeed;
        } else {
            this.ownShip.speed += Math.sign(spdDiff) * maxSpdChange;
        }

        const timeMultiplier = (deltaTime / 3600000) * this.simulationSpeed;
        const ownShipDist = this.ownShip.speed * timeMultiplier;
        this.ownShip.x += ownShipDist * Math.sin(this.toRadians(this.ownShip.course));
        this.ownShip.y += ownShipDist * Math.cos(this.toRadians(this.ownShip.course));

        this.tracks.forEach(track => {
            if (this.draggedItemId === track.id) return;

            const dist = track.speed * timeMultiplier;
            track.x += dist * Math.sin(this.toRadians(track.course));
            track.y += dist * Math.cos(this.toRadians(track.course));
            const dtH = (deltaTime/3600000)*Math.abs(this.simulationSpeed);
            track._controller?.update(dtH, this.tracks, this.scenarioCfg);
        });
    }

    calculateAllData(track) {
        const dx = track.x - this.ownShip.x;
        const dy = track.y - this.ownShip.y;
        track.range = Math.max(0, Math.min(359.9, Math.sqrt(dx**2 + dy**2)));
        track.bearing = (this.toDegrees(Math.atan2(dx, dy)) + 360) % 360;

        const ownShipCanvasAngle = this.toRadians(this.bearingToCanvasAngle(this.ownShip.course));
        const ownShipVelX = this.ownShip.speed * Math.cos(ownShipCanvasAngle);
        const ownShipVelY = this.ownShip.speed * Math.sin(ownShipCanvasAngle);

        const targetCourseCanvasAngle = this.toRadians(this.bearingToCanvasAngle(track.course));
        const targetVelX = track.speed * Math.cos(targetCourseCanvasAngle);
        const targetVelY = track.speed * Math.sin(targetCourseCanvasAngle);

        const relVelX = targetVelX - ownShipVelX;
        const relVelY = targetVelY - ownShipVelY;
        const relSpeed = Math.sqrt(relVelX**2 + relVelY**2);
        const relVectorCanvasAngle = this.toDegrees(Math.atan2(relVelY, relVelX));

        if (!track.rmVector) track.rmVector = { x: 0, y: 0, speed: 0, bearing: 0 };
        track.rmVector.x = relVelX;
        track.rmVector.y = relVelY;
        track.rmVector.speed = relSpeed;
        track.rmVector.bearing = this.canvasAngleToBearing(relVectorCanvasAngle);

        const targetPosCanvasAngle = this.toRadians(this.bearingToCanvasAngle(track.bearing));
        const targetPosX = track.range * Math.cos(targetPosCanvasAngle);
        const targetPosY = track.range * Math.sin(targetPosCanvasAngle);


        const dotProduct = (targetPosX * relVelX) + (targetPosY * relVelY);
        if (!track.cpa) track.cpa = { range: '--', time: '--:--:--', brg: '--' };
        if (relSpeed < 0.001) {
            track.cpa.range = '--';
            track.cpa.time = '--:--:--';
            track.cpa.brg = '--';
            track.hasPassedCPA = true;
        } else {
            const tcpa = -dotProduct / (relSpeed**2);
            track.hasPassedCPA = tcpa < 0;
            const cpaX = targetPosX + tcpa * relVelX;
            const cpaY = targetPosY + tcpa * relVelY;
            if (!track.cpaPosition) track.cpaPosition = { x: 0, y: 0 };
            track.cpaPosition.x = cpaX;
            track.cpaPosition.y = cpaY;

            if (track.hasPassedCPA) {
                track.cpa.range = '-- nm';
                track.cpa.time = '--:--:--';
                track.cpa.brg = '--';
            } else {
                const cpaRange = Math.sqrt(cpaX**2 + cpaY**2);
                const cpaCanvasAngle = this.toDegrees(Math.atan2(cpaY, cpaX));
                const cpaBearing = this.canvasAngleToBearing(cpaCanvasAngle);
                const cpaQuarter = this.getRelativeQuarter(cpaBearing, this.ownShip.course);
                track.cpa.range = `${cpaRange.toFixed(1)} nm`;
                track.cpa.time = this.formatTime(tcpa);
                track.cpa.brg = `${this.formatBearing(cpaBearing)} T / ${cpaQuarter}`;
            }
        }
        const ownshipBearingFromTarget = (track.bearing + 180) % 360;
        const targetAngle = (ownshipBearingFromTarget - track.course + 360) % 360;
        if (!track.rm) track.rm = { dir: '', spd: '', rate: '', angle: '', aspect: '' };

        // TODO: Only format bearing/speed strings for the selected track or when updating the UI, not for every track each frame.

        track.rm.dir = `${this.formatBearing(track.rmVector.bearing)} T`;
        track.rm.spd = `${relSpeed.toFixed(1)} kts`;
        track.rm.rate = this.getBearingRate({x: relVelX, y: relVelY}, {x: targetPosX, y: targetPosY}, track.range);
        track.rm.angle = `${this.formatBearing(targetAngle)} deg`;
        track.rm.aspect = this.getAspect(targetAngle);
    }

    calculateWindData() {
        const trueWindVectorAngle = (this.trueWind.direction + 180) % 360;
        const trueWindRad = this.toRadians(this.bearingToCanvasAngle(trueWindVectorAngle));
        const trueWindVelX = this.trueWind.speed * Math.cos(trueWindRad);
        const trueWindVelY = this.trueWind.speed * Math.sin(trueWindRad);

        const ownShipRad = this.toRadians(this.bearingToCanvasAngle(this.ownShip.course));
        const ownShipVelX = this.ownShip.speed * Math.cos(ownShipRad);
        const ownShipVelY = this.ownShip.speed * Math.sin(ownShipRad);

        const relWindVelX = trueWindVelX - ownShipVelX;
        const relWindVelY = trueWindVelY - ownShipVelY;

        this.relativeWind.speed = Math.sqrt(relWindVelX**2 + relWindVelY**2);
        const relWindVectorCanvasAngle = this.toDegrees(Math.atan2(relWindVelY, relWindVelX));

        this.relativeWind.vectorDirection = this.canvasAngleToBearing(relWindVectorCanvasAngle);
    }

    // --- Drawing ---
    drawRadar() {
        const size = this.canvas.width;
        if (size === 0) return;
        const center = size / 2;
        const radius = size / 2 * 0.9;
        if (this.staticDirty || this.staticCanvas.width !== size) {
            this.staticCanvas.width = size;
            this.staticCanvas.height = size;
            this.drawStaticRadar();
            this.staticDirty = false;
        }
        this.ctx.drawImage(this.staticCanvas, 0, 0);

        if (this.showWeather) {
            this.drawWeatherInfo(center, radius);
        }
        this.drawOwnShipIcon(center, radius);
        this.tracks.forEach(track => {
            if (track.range > this.maxRange) return;
            this.drawTarget(center, radius, track);
            if(this.showRelativeMotion) {
                this.drawRelativeMotionVector(center, radius, track);
            }
        });
        if(this.showCPAInfo && this.selectedTrackId !== null) {
            this.drawCPAIndicator(center, radius);
        }
        if (this.selectedTrackId !== null) {
            const track = this.tracks.find(t => t.id === this.selectedTrackId);
            if (track) this.drawBearingLine(center, radius, track);
            this.drawSelectionIndicator(center, radius, this.selectedTrackId, this.radarWhite, 1.5);
        }
        if (this.hoveredTrackId !== null && this.hoveredTrackId !== this.selectedTrackId) {
            this.drawSelectionIndicator(center, radius, this.hoveredTrackId, this.radarFaintWhite, 1);
        }
    }

    drawStaticRadar() {
        const size = this.staticCanvas.width;
        if (size === 0) return;
        const center = size / 2;
        const radius = size / 2 * 0.9;
        const ctx = this.staticCtx;
        ctx.save();
        // --- Outer and inner range rings ---
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = this.radarFaintGreen;
        ctx.lineWidth = 0.9;

        ctx.beginPath();
        ctx.arc(center, center, radius, 0, 2 * Math.PI);
        ctx.stroke();

        for (let i = 1; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(center, center, radius * (i / 3), 0, 2 * Math.PI);
            ctx.stroke();
        }

        // --- Range ring labels ---
        ctx.fillStyle = this.radarFaintGreen;
        ctx.font = `${Math.max(11, radius * 0.038)}px 'Share Tech Mono', monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (let i = 1; i <= 3; i++) {
            const ringRadius = radius * (i / 3);
            const range = this.maxRange * (i / 3);
            ctx.fillText(range.toFixed(1), center + ringRadius + LABEL_OFFSET_PX, center);
        }

        // --- Radial bearing lines ---
        if (this.showPolarPlot) {
            for (let deg = 0; deg < 360; deg += 10) {
                const isCardinal = CARDINAL_BEARINGS.includes(deg);
                ctx.setLineDash(isCardinal ? DASH_PATTERN_SOLID : DASH_PATTERN_NONCAR);
                const ang = this.toRadians(deg);
                const originalRadius = isCardinal ? (size / 2) : radius + (size / 2 - radius) / 2;
                const startRadius = radius;
                let endRadius = originalRadius;
                if (!isCardinal) {
                    endRadius = radius + 0.8 * (originalRadius - radius);
                }
                ctx.beginPath();
                ctx.moveTo(
                    center + startRadius * Math.cos(ang),
                    center - startRadius * Math.sin(ang)
                );
                ctx.lineTo(
                    center + endRadius * Math.cos(ang),
                    center - endRadius * Math.sin(ang)
                );
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    drawRangeRings(center, radius) { this.ctx.strokeStyle = this.radarFaintGreen; this.ctx.lineWidth = 0.9; this.ctx.beginPath(); this.ctx.arc(center, center, radius, 0, 2 * Math.PI); this.ctx.stroke(); for (let i = 1; i < 3; i++) { this.ctx.beginPath(); this.ctx.arc(center, center, radius * (i / 3), 0, 2 * Math.PI); this.ctx.stroke(); } }
    drawRangeLabels(center, radius) { this.ctx.fillStyle = this.radarFaintGreen; this.ctx.font = `${Math.max(11, radius * 0.038)}px 'Share Tech Mono',monospace`; this.ctx.textAlign = 'left'; this.ctx.textBaseline = 'middle'; for (let i = 1; i <= 3; i++) { const ringRadius = radius * (i / 3); const range = this.maxRange * (i / 3); this.ctx.fillText(range.toFixed(1), center + ringRadius + LABEL_OFFSET_PX, center); } }

    drawOwnShipIcon(center, radius) {
        this.ctx.strokeStyle = this.radarGreen;
        this.ctx.lineWidth = 1.4;
        const iconRadius = this.canvas.width * 0.014;
        this.ctx.beginPath();
        this.ctx.arc(center, center, iconRadius, 0, 2 * Math.PI);
        this.ctx.stroke();
        const timeInHours = this.vectorTimeInMinutes / 60;
        const pixelsPerNm = radius / this.maxRange;
        const vectorDistPixels = this.ownShip.speed * timeInHours * pixelsPerNm;
        const courseAngle = this.toRadians(this.bearingToCanvasAngle(this.ownShip.course));
        const endX = center + vectorDistPixels * Math.cos(courseAngle);
        const endY = center - vectorDistPixels * Math.sin(courseAngle);
        this.ownShip.vectorEndpoint = { x: endX, y: endY };
        this.ctx.beginPath();
        this.ctx.moveTo(center, center);
        this.ctx.lineTo(endX, endY);
        this.ctx.stroke();

        // Draw ordered course/speed vector if still manoeuvring
        const orderedCourse = this.ownShip.orderedCourse;
        const orderedSpeed  = this.ownShip.orderedSpeed;
        const diffCourse = Math.abs(((orderedCourse - this.ownShip.course + 540) % 360) - 180);
        const diffSpeed  = Math.abs(orderedSpeed - this.ownShip.speed);
        if (diffCourse > 0.5 || diffSpeed > 0.05) {
            const orderDistPixels = orderedSpeed * timeInHours * pixelsPerNm;
            const orderAngle = this.toRadians(this.bearingToCanvasAngle(orderedCourse));
            const oEndX = center + orderDistPixels * Math.cos(orderAngle);
            const oEndY = center - orderDistPixels * Math.sin(orderAngle);
            this.ownShip.orderedVectorEndpoint = { x: oEndX, y: oEndY };
            this.ctx.save();
            this.ctx.strokeStyle = this.radarDarkOrange;
            this.ctx.lineWidth = 1.4 * 1.2 * 2;
            this.ctx.beginPath();
            this.ctx.moveTo(center, center);
            this.ctx.lineTo(oEndX, oEndY);
            this.ctx.stroke();
            this.ctx.restore();

            const rect = this.canvas.getBoundingClientRect();
            const tipX = rect.left + (oEndX / this.DPR);
            const tipY = rect.top + (oEndY / this.DPR);
            const txt = `Crs: ${orderedCourse.toFixed(1)} T\nSpd: ${orderedSpeed.toFixed(1)} kts`;
            this.orderTooltip.style.color = this.radarDarkOrange;
            this.orderTooltip.innerText = txt;
            this.orderTooltip.style.display = 'block';
            this.orderTooltip.style.transform = `translate(${tipX - this.orderTooltip.offsetWidth - 10}px, ${tipY - this.orderTooltip.offsetHeight - 10}px)`;
        } else {
            this.orderTooltip.style.display = 'none';
            this.ownShip.orderedVectorEndpoint = null;
        }

        const dragging = this.draggedItemId === 'ownShip' && this.dragType === 'vector';
        if (dragging && this.ownShip.dragCourse !== null && this.ownShip.dragSpeed !== null) {
            const dragDistPixels = this.ownShip.dragSpeed * timeInHours * pixelsPerNm;
            const dragAngle = this.toRadians(this.bearingToCanvasAngle(this.ownShip.dragCourse));
            const dEndX = center + dragDistPixels * Math.cos(dragAngle);
            const dEndY = center - dragDistPixels * Math.sin(dragAngle);
            this.ctx.save();
            this.ctx.strokeStyle = this.radarWhite;
            this.ctx.lineWidth = 1.4 * 1.2 * 2;
            this.ctx.beginPath();
            this.ctx.moveTo(center, center);
            this.ctx.lineTo(dEndX, dEndY);
            this.ctx.stroke();
            this.ctx.restore();
        }
    }

    getTargetCoords(center, radius, track) {
        const angleRad = this.toRadians(this.bearingToCanvasAngle(track.bearing));
        const distOnCanvas = (track.range / this.maxRange) * radius;
        const x = center + distOnCanvas * Math.cos(angleRad);
        const y = center - distOnCanvas * Math.sin(angleRad);
        return { x, y };
    }

    drawTarget(center, radius, track) {
        const { x, y } = this.getTargetCoords(center, radius, track);
        const targetSize = Math.max(11, radius * 0.038);
        this.ctx.strokeStyle = this.radarGreen;
        this.ctx.lineWidth = 1.8;
        this.ctx.strokeRect(x - targetSize / 2, y - targetSize / 2, targetSize, targetSize);
        const timeInHours = this.vectorTimeInMinutes / 60;
        const pixelsPerNm = radius / this.maxRange;
        const vectorDistPixels = track.speed * timeInHours * pixelsPerNm;
        const courseAngle = this.toRadians(this.bearingToCanvasAngle(track.course));
        const endX = x + vectorDistPixels * Math.cos(courseAngle);
        const endY = y - vectorDistPixels * Math.sin(courseAngle);
        track.vectorEndpoint = { x: endX, y: endY };
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(endX, endY);
        this.ctx.stroke();
        this.ctx.fillStyle = this.radarGreen;
        this.ctx.font = `${Math.max(11, radius * 0.038)}px 'Share Tech Mono', monospace`;
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        if (this.showTrackIds) {
            this.ctx.fillText(track.id, x + targetSize / 2 + 3, y + targetSize / 2 + 3);
        }
    }

    drawRelativeMotionVector(center, radius, track) {
        if (!track.rmVector) return;
        const { x: startX, y: startY } = this.getTargetCoords(center, radius, track);
        const timeInHours = this.vectorTimeInMinutes / 60;
        const pixelsPerNm = radius / this.maxRange;
        const vectorDistPixels = track.rmVector.speed * timeInHours * pixelsPerNm;
        const vectorAngleRad = this.toRadians(this.bearingToCanvasAngle(track.rmVector.bearing));
        const endX = startX + vectorDistPixels * Math.cos(vectorAngleRad);
        const endY = startY - vectorDistPixels * Math.sin(vectorAngleRad);
        this.ctx.save();
        this.ctx.strokeStyle = this.radarGreen;
        this.ctx.lineWidth = 1.8;
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(endX, endY);
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawCPAIndicator(center, radius) {
        const track = this.tracks.find(t => t.id === this.selectedTrackId);
        if (!track || track.hasPassedCPA || !track.cpaPosition) return;
        const pixelsPerNm = radius / this.maxRange;

        const cpaBearing = (this.toDegrees(Math.atan2(track.cpaPosition.x, track.cpaPosition.y)) + 360) % 360;
        const cpaCanvasAngle = this.toRadians(this.bearingToCanvasAngle(cpaBearing));
        const cpaRange = Math.sqrt(track.cpaPosition.x**2 + track.cpaPosition.y**2);
        const cpaDistCanvas = cpaRange * pixelsPerNm;
        const cpaX = center + cpaDistCanvas * Math.cos(cpaCanvasAngle);
        const cpaY = center - cpaDistCanvas * Math.sin(cpaCanvasAngle);

        this.ctx.beginPath();
        this.ctx.arc(cpaX, cpaY, 4, 0, 2 * Math.PI);
        this.ctx.fillStyle = this.radarGreen;
        this.ctx.fill();
        this.ctx.save();
        this.ctx.strokeStyle = this.radarFaintGreen;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([2, 3]);
        this.ctx.beginPath();
        this.ctx.moveTo(center, center);
        this.ctx.lineTo(cpaX, cpaY);
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawBearingLine(center, radius, track) {
        const { x, y } = this.getTargetCoords(center, radius, track);
        this.ctx.save();
        this.ctx.strokeStyle = this.radarWhite;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([2, 4]);
        this.ctx.beginPath();
        this.ctx.moveTo(center, center);
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawSelectionIndicator(center, radius, trackId, color, lineWidth) { const track = this.tracks.find(t => t.id === trackId); if (!track) return; const { x, y } = this.getTargetCoords(center, radius, track); const targetSize = Math.max(11, radius * 0.038); const indicatorRadius = targetSize * 1.2; this.ctx.strokeStyle = color; this.ctx.lineWidth = lineWidth; this.ctx.beginPath(); this.ctx.arc(x, y, indicatorRadius, 0, 2 * Math.PI); this.ctx.stroke(); }

    drawWeatherInfo(center, radius) {
        const windFromAngle = this.toRadians(this.bearingToCanvasAngle(this.trueWind.direction));
        const pixelsPerKnot = 4;
        const arrowLength = this.trueWind.speed * pixelsPerKnot;

        const wX = center + Math.cos(windFromAngle) * radius;
        const wY = center - Math.sin(windFromAngle) * radius;
        this.trueWind.wPos = {x: wX, y: wY};

        const startX = wX;
        const startY = wY;
        const endX = startX - Math.cos(windFromAngle) * arrowLength;
        const endY = startY + Math.sin(windFromAngle) * arrowLength;
        this.trueWind.arrowEndpoint = {x: endX, y: endY};

        this.ctx.save();
        this.ctx.strokeStyle = this.radarFaintGreen;
        this.ctx.fillStyle   = this.radarFaintGreen;
        this.ctx.font        = `${Math.max(12, radius * 0.08)}px 'Share Tech Mono', monospace`;
        this.ctx.textAlign   = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('W', wX, wY);
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(endX, endY);
        this.ctx.stroke();
        const arrowAngle = Math.atan2(endY - startY, endX - startX);
        this.ctx.beginPath();
        this.ctx.moveTo(endX, endY);
        this.ctx.lineTo(endX - 15 * Math.cos(arrowAngle - Math.PI / 6), endY - 15 * Math.sin(arrowAngle - Math.PI / 6));
        this.ctx.lineTo(endX - 15 * Math.cos(arrowAngle + Math.PI / 6), endY - 15 * Math.sin(arrowAngle + Math.PI / 6));
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.restore();

        if (this.showRelativeMotion) {
            const pixelsPerNm = radius / this.maxRange;
            const timeInHours = this.vectorTimeInMinutes / 60;
            const vectorDistPixels = this.relativeWind.speed * timeInHours * pixelsPerNm;
            const relWindCanvasAngle = this.toRadians(this.bearingToCanvasAngle(this.relativeWind.vectorDirection));

            const vecEndX = center + vectorDistPixels * Math.cos(relWindCanvasAngle);
            const vecEndY = center - vectorDistPixels * Math.sin(relWindCanvasAngle);

            this.ctx.save();
            this.ctx.strokeStyle = this.radarFaintGreen;
            this.ctx.lineWidth = 1.8;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(center, center);
            this.ctx.lineTo(vecEndX, vecEndY);
            this.ctx.stroke();
            this.ctx.restore();
        }
    }

    // --- UI Updates ---
    updatePanelsAndRedraw() {
        this.updateOwnShipPanel();
        this.updateDataPanels();
        this.drawRadar();
    }

    updateOwnShipPanel() {
        this._renderEditableField('ownship-crs', `${this.formatBearing(this.ownShip.course)} T`, this.ownShip.course);
        this._renderEditableField('ownship-spd', `${this.ownShip.speed.toFixed(1)} kts`, this.ownShip.speed);
    }

    updateDataPanels() {
        const selectedTrack = this.tracks.find(t => t.id === this.selectedTrackId);

        this._setText('track-id', selectedTrack ? selectedTrack.id : '--');

        if (selectedTrack) {
            this._renderEditableField('track-brg', `${this.formatBearing(selectedTrack.bearing)} T`, selectedTrack.bearing);
            this._renderEditableField('track-rng', `${selectedTrack.range.toFixed(1)} nm`, selectedTrack.range);
            this._renderEditableField('track-crs', `${this.formatBearing(selectedTrack.course)} T`, selectedTrack.course);
            this._renderEditableField('track-spd', `${selectedTrack.speed.toFixed(1)} kts`, selectedTrack.speed);
        } else {
            this._setText('track-brg', '--');
            this._setText('track-rng', '--');
            this._setText('track-crs', '--');
            this._setText('track-spd', '--');
        }

        const showRM = selectedTrack && this.showRelativeMotion;
        this._setText('rm-dir', showRM ? selectedTrack.rm.dir : '--');
        this._setText('rm-spd', showRM ? selectedTrack.rm.spd : '--');
        this._setText('rm-rate', showRM ? selectedTrack.rm.rate : '--');
        this._setText('rm-angle', showRM ? selectedTrack.rm.angle : '--');
        this._setText('rm-aspect', showRM ? selectedTrack.rm.aspect : '--');

        const showCPA = selectedTrack && this.showCPAInfo && !selectedTrack.hasPassedCPA;
        this._setText('cpa-brg', showCPA ? selectedTrack.cpa.brg : '--');
        this._setText('cpa-rng', showCPA ? selectedTrack.cpa.range : '--');
        this._setText('cpa-time', showCPA ? selectedTrack.cpa.time : '--');

        const showTrueWind = this.showWeather;
        const showRelWind = this.showWeather && this.showRelativeMotion;
        const relWindBearing = (this.relativeWind.vectorDirection - this.ownShip.course + 360) % 360;
        this._setText('wind-true', showTrueWind ? `${this.formatBearing(this.trueWind.direction)} T  ${this.trueWind.speed.toFixed(1)} kts` : '--');
        this._setText('wind-rel', showRelWind ? `${this.formatBearing(relWindBearing)} R  ${this.relativeWind.speed.toFixed(1)} kts` : '--');

        // this.applyDataPanelFontSizes();
    }

    updateButtonStyles() {
        // this.btnWind.className = `control-btn ${this.showWeather ? 'selected' : 'unselected'}`;
        // this.btnRmv.className = `control-btn ${this.showRelativeMotion ? 'selected' : 'unselected'}`;
        // this.btnCpa.className = `control-btn ${this.showCPAInfo ? 'selected' : 'unselected'}`;

        this.btnPlayPause.className = `sim-control-btn ${this.isSimulationRunning ? 'selected' : 'unselected'}`;
        this.iconPlay.classList.toggle('d-none', this.isSimulationRunning);
        this.iconPause.classList.toggle('d-none', !this.isSimulationRunning);

        this.btnFf.className = `sim-control-btn ${this.simulationSpeed > 1 ? 'selected' : 'unselected'}`;
        this.btnRev.className = `sim-control-btn ${this.simulationSpeed < 0 ? 'selected' : 'unselected'}`;
    }

    updateSpeedIndicator() {
        this.ffSpeedIndicator.classList.add('d-none');
        this.revSpeedIndicator.classList.add('d-none');

        if (this.simulationSpeed > 1) {
            const label = this.simulationSpeed === 25 ? '25x'
                : this.simulationSpeed === 50 ? '50x'
                    : `${this.simulationSpeed}x`;
            this.ffSpeedIndicator.textContent = label;
            this.ffSpeedIndicator.classList.remove('d-none');
        } else if (this.simulationSpeed < 0) {
            const absSpeed = Math.abs(this.simulationSpeed);
            const label = absSpeed === 25 ? '25x'
                : absSpeed === 50 ? '50x'
                    : `${absSpeed}x`;
            this.revSpeedIndicator.textContent = label;
            this.revSpeedIndicator.classList.remove('d-none');
        }
    }

    updateSimClock() {
        this._setText('sim-clock', this.formatTime(this.simulationElapsed / 3600));
    }

    scaleUI() {
        const BASE = 900;
        const containerHeight = this.mainContainer.clientHeight;
        const wrapperWidth = this.radarWrapper.clientWidth;
        const dim = Math.min(wrapperWidth, containerHeight);
        const scale = Math.max(0.7, Math.min(1.5, dim / BASE));

        document.documentElement.style.setProperty('--ui-scale', scale);
        this.uiScaleFactor = scale;

        // Canvas resolution depends on its current size in the DOM, which is now controlled by CSS.
        const canvasRect = this.canvas.getBoundingClientRect();
        const size = canvasRect.width;

        if (size > 0) {
            this.canvas.width  = size * this.DPR;
            this.canvas.height = size * this.DPR;
            this.staticCanvas.width = this.canvas.width;
            this.staticCanvas.height = this.canvas.height;
            this.staticDirty = true;
        }

        this.prepareStaticStyles();
        // this.applyDataPanelFontSizes();

        this.markSceneDirty();
    }

    // applyDataPanelFontSizes() {
    //     const titleSize = 1.25 * this.uiScaleFactor;
    //     const largeValueSize = 1.4 * this.uiScaleFactor;
    //     const mediumValueSize = 1.3 * this.uiScaleFactor;
    //
    //     document.querySelectorAll('.data-title').forEach(el => el.style.fontSize = `${titleSize}rem`);
    //     document.querySelectorAll('.data-label').forEach(el => el.style.fontSize = `${mediumValueSize}rem`);
    //
    //     document.querySelectorAll('#ownship-crs, #ownship-spd, #track-data-container .data-value').forEach(el => {
    //         if (el) el.style.fontSize = `${largeValueSize}rem`;
    //     });
    //
    //     document.querySelectorAll('#rm-data-container .data-value, #cpa-data-container .data-value, #wind-data-container .data-value').forEach(el => {
    //         if (el) el.style.fontSize = `${mediumValueSize}rem`;
    //     });
    // }

    // --- Interaction Handlers ---
    updateDragTooltip(e) {
        if (!this.draggedItemId) {
            this.dragTooltip.style.display = 'none';
            return;
        }

        let tooltipText = '';
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) * this.DPR;
        const mouseY = (e.clientY - rect.top) * this.DPR;
        const center = this.canvas.width / 2;
        const pixelsPerNm = (center * 0.9) / this.maxRange;

        if (this.dragType === 'icon') {
            const dx = mouseX - center;
            const dy = -(mouseY - center);
            const newRange = Math.hypot(dx, dy) / pixelsPerNm;
            const newCanvasAngleRad = Math.atan2(dy, dx);
            const newBearing = this.canvasAngleToBearing(this.toDegrees(newCanvasAngleRad));

            tooltipText = `Brg: ${this.formatBearing(newBearing)} T\nRng: ${newRange.toFixed(1)} nm`;
        } else if (this.dragType === 'vector') {
            const vessel = (this.draggedItemId === 'ownShip') ? this.ownShip : this.tracks.find(t => t.id === this.draggedItemId);
            if (vessel) {
                const startPoint = (vessel.id === 'ownShip') ? { x: center, y: center } : this.getTargetCoords(center, (center * 0.9), vessel);
                const dx = mouseX - startPoint.x;
                const dy = -(mouseY - startPoint.y);
                const newCanvasAngleRad = Math.atan2(dy, dx);
                const newCourse = this.canvasAngleToBearing(this.toDegrees(newCanvasAngleRad));
                const distOnCanvas = Math.hypot(dx, dy);
                const newSpeed = distOnCanvas / pixelsPerNm / (this.vectorTimeInMinutes / 60);
                tooltipText = `Crs: ${this.formatBearing(newCourse)} T\nSpd: ${newSpeed.toFixed(1)} kts`;
            }
        } else if (this.draggedItemId === 'trueWind') {
            if (this.dragType === 'windDirection') {
                tooltipText = `Dir: ${this.formatBearing(this.trueWind.direction)} T`;
            } else if (this.dragType === 'windSpeed') {
                tooltipText = `Spd: ${this.trueWind.speed.toFixed(1)} kts`;
            }
        }

        if (tooltipText) {
            if (this.draggedItemId === 'ownShip' && this.dragType === 'vector') {
                this.dragTooltip.style.color = this.radarWhite;
            } else {
                this.dragTooltip.style.color = this.radarGreen;
            }
            this.dragTooltip.innerText = tooltipText;
            this.dragTooltip.style.display = 'block';
            this.dragTooltip.style.transform = `translate(${e.clientX - this.dragTooltip.offsetWidth - 10}px, ${e.clientY - this.dragTooltip.offsetHeight - 10}px)`;
        } else {
            this.dragTooltip.style.display = 'none';
        }
    }

    handlePointerDown(e) {
        if (e.button !== 0 && e.buttons !== undefined && e.buttons !== 1) return;
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) * this.DPR;
        const mouseY = (e.clientY - rect.top) * this.DPR;
        const item = this.getInteractiveItemAt(mouseX, mouseY);
        this.pointerDownPos = { x: mouseX, y: mouseY };
        if (item) {
            this.canvas.style.cursor = 'grabbing';
            this.pendingDragId = item.id;
            this.pendingDragType = item.type;
            this.lastMousePos = { x: mouseX, y: mouseY };
            if (item.id !== 'ownShip' && item.id !== 'trueWind') {
                this.selectedTrackId = item.id;
            }
            this.hoveredTrackId = item.id;
            this.markSceneDirty();
        } else {
            this.pendingDragId = null;
            this.pendingDragType = null;
            this.hoveredTrackId = null;
        }
    }

    handlePointerUp() {
        this.canvas.style.cursor = 'grab';
        if (this.draggedItemId === 'ownShip' && this.dragType === 'vector') {
            if (this.ownShip.dragCourse !== null && this.ownShip.dragSpeed !== null) {
                this.ownShip.orderedCourse = this.ownShip.dragCourse;
                this.ownShip.orderedSpeed = this.ownShip.dragSpeed;
            }
        }
        this.ownShip.dragCourse = null;
        this.ownShip.dragSpeed = null;
        this.draggedItemId = null;
        this.dragType = null;
        this.pendingDragId = null;
        this.pendingDragType = null;
        this.dragTooltip.style.display = 'none';
        this.orderTooltip.style.display = 'none';
        this.markSceneDirty();
    }

    handlePointerMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) * this.DPR;
        const mouseY = (e.clientY - rect.top) * this.DPR;

        if (this.pendingDragId && !this.draggedItemId) {
            const dx0 = mouseX - this.pointerDownPos.x;
            const dy0 = mouseY - this.pointerDownPos.y;
            if (Math.hypot(dx0, dy0) > this.dragThreshold) {
                this.draggedItemId = this.pendingDragId;
                this.dragType = this.pendingDragType;
                if (this.draggedItemId === 'ownShip' && this.dragType === 'vector') {
                    this.ownShip.dragCourse = this.ownShip.orderedCourse;
                    this.ownShip.dragSpeed = this.ownShip.orderedSpeed;
                }
            }
        }

        if (this.draggedItemId) {
            this.updateDragTooltip(e);
            const center = this.canvas.width / 2;
            const pixelsPerNm = (center * 0.9) / this.maxRange;
            if (this.draggedItemId === 'trueWind') {
                const dx = mouseX - center;
                const dy = -(mouseY - center);
                const newCanvasAngleRad = Math.atan2(dy, dx);
                if (this.dragType === 'windDirection') {
                    this.trueWind.direction = this.canvasAngleToBearing(this.toDegrees(newCanvasAngleRad));
                } else if (this.dragType === 'windSpeed') {
                    const pixelsPerKnot = 4;
                    const windFromAngle = this.toRadians(this.bearingToCanvasAngle(this.trueWind.direction));
                    const radius = center * 0.9;
                    const mouseVecX = mouseX - center;
                    const mouseVecY = -(mouseY - center);
                    const windVecX = Math.cos(windFromAngle);
                    const windVecY = Math.sin(windFromAngle);
                    const projectedLength = mouseVecX * windVecX + mouseVecY * windVecY;
                    const arrowPixelLength = projectedLength - radius;
                    this.trueWind.speed = Math.max(0, -arrowPixelLength / pixelsPerKnot);
                }
                this.markSceneDirty();
            } else if (this.dragType === 'icon') {
                const track = this.tracks.find(t => t.id === this.draggedItemId);
                if (track) {
                    const deltaX_pixels = mouseX - this.lastMousePos.x;
                    const deltaY_pixels = mouseY - this.lastMousePos.y;
                    const deltaX_nm = deltaX_pixels / pixelsPerNm;
                    const deltaY_nm = deltaY_pixels / pixelsPerNm;
                    track.x += deltaX_nm;
                    track.y -= deltaY_nm;
                    this.markSceneDirty();
                }
            } else if (this.dragType === 'vector') {
                const timeInHours = this.vectorTimeInMinutes / 60;
                const vessel = (this.draggedItemId === 'ownShip') ? this.ownShip : this.tracks.find(t => t.id === this.draggedItemId);
                const startPoint = (vessel.id === 'ownShip') ? { x: center, y: center } : this.getTargetCoords(center, (center * 0.9), vessel);

                const dx = mouseX - startPoint.x;
                const dy = -(mouseY - startPoint.y);

                const newCanvasAngleRad = Math.atan2(dy, dx);
                const newCourse = this.canvasAngleToBearing(this.toDegrees(newCanvasAngleRad));
                const distOnCanvas = Math.sqrt(dx * dx + dy * dy);
                const newSpeed = distOnCanvas / pixelsPerNm / timeInHours;

                if (vessel.id === 'ownShip') {
                    this.ownShip.dragCourse = newCourse;
                    this.ownShip.dragSpeed = Math.max(0, newSpeed);
                } else {
                    vessel.course = newCourse;
                    vessel.speed = Math.max(2, newSpeed);
                }
                this.markSceneDirty();
            }
            this.lastMousePos = { x: mouseX, y: mouseY };
        } else {
            let item = null;
            if (!this.pendingDragId) {
                item = this.getInteractiveItemAt(mouseX, mouseY);
                this.canvas.style.cursor = item ? 'grab' : 'default';
            }
            const newHoverId = item ? item.id : null;
            if (newHoverId !== this.hoveredTrackId) {
                this.hoveredTrackId = newHoverId;
                this.markSceneDirty();
            }
        }
    }

    getInteractiveItemAt(mouseX, mouseY) {
        const center = this.canvas.width / 2;
        const radius = center * 0.9;
        const hitTolerance = 15 * this.DPR;
        const minVecPickDistance = 25 * this.DPR;

        if (this.showWeather) {
            const distToW = Math.sqrt((mouseX - this.trueWind.wPos.x)**2 + (mouseY - this.trueWind.wPos.y)**2);
            if (distToW < hitTolerance) return { type: 'windDirection', id: 'trueWind' };
            const distToArrowhead = Math.sqrt((mouseX - this.trueWind.arrowEndpoint.x)**2 + (mouseY - this.trueWind.arrowEndpoint.y)**2);
            if (distToArrowhead < hitTolerance) return { type: 'windSpeed', id: 'trueWind' };
        }

        for (const track of this.tracks) {
            const {x, y} = this.getTargetCoords(center, radius, track);
            const size = Math.max(11, radius * 0.038) * 1.5;
            if (mouseX > x - size/2 && mouseX < x + size/2 && mouseY > y - size/2 && mouseY < y + size/2) {
                return {type: 'icon', id: track.id};
            }
        }

        const allVessels = [this.ownShip, ...this.tracks];
        for (const vessel of allVessels) {
            if (!vessel.vectorEndpoint) continue;
            const startPt = (vessel.id === 'ownShip') ? {x: center, y: center} : this.getTargetCoords(center, radius, vessel);
            const distFromStart = Math.hypot(mouseX - startPt.x, mouseY - startPt.y);
            if (distFromStart < minVecPickDistance) continue;
            const endPt = vessel.vectorEndpoint;
            const dist = this.distToSegment({x: mouseX, y: mouseY}, startPt, endPt);
            if (dist < hitTolerance) return {type: 'vector', id: vessel.id};
        }
        return null;
    }

    // --- Control Button Actions ---
    toggleVectorTime() {
        const currentIndex = this.vectorTimes.indexOf(this.vectorTimeInMinutes);
        this.vectorTimeInMinutes = this.vectorTimes[(currentIndex + 1) % this.vectorTimes.length];
        this._setText('btn-vector-time', this.vectorTimeInMinutes+' min');
        this.markSceneDirty();
    }

    toggleRange() {
        const currentIndex = this.rangeScales.indexOf(this.maxRange);
        this.maxRange = this.rangeScales[(currentIndex + 1) % this.rangeScales.length];
        this._setText('btn-range', this.maxRange.toFixed(1)+' nm');
        this.staticDirty = true;
        this.markSceneDirty();
    }

    // toggleWeather() {
    //     this.showWeather = !this.showWeather;
    //     this.markSceneDirty();
    //     this.scaleUI();
    //     this.updateDataPanels();
    // }

    toggleRelativeMotion() {
        this.showRelativeMotion = !this.showRelativeMotion;
        this.markSceneDirty();
        this._scheduleUIUpdate();
    }

    toggleCPAInfo() {
        this.showCPAInfo = !this.showCPAInfo;
        this.markSceneDirty();
        this._scheduleUIUpdate();
    }

    togglePlayPause() {
        const wasRunning = this.isSimulationRunning;
        this.isSimulationRunning = !this.isSimulationRunning;
        this.simulationSpeed = 1;
        this.updateButtonStyles();
        this.updateSpeedIndicator();
        if (!wasRunning) {
            this.startGameLoop();
        }
    }

    fastForward() {
        const cycle = [1, ...this.ffSpeeds];
        if (!this.isSimulationRunning || this.simulationSpeed < 0) {
            this.simulationSpeed = this.ffSpeeds[0];
            this.isSimulationRunning = true;
        } else {
            let idx = cycle.indexOf(this.simulationSpeed);
            idx = (idx + 1) % cycle.length;
            this.simulationSpeed = cycle[idx];
            this.isSimulationRunning = true;
        }
        this.updateButtonStyles();
        this.updateSpeedIndicator();
        this.startGameLoop();
    }

    rewind() {
        const cycle = [1, ...this.revSpeeds];
        if (!this.isSimulationRunning || this.simulationSpeed > 0) {
            this.simulationSpeed = this.revSpeeds[0];
            this.isSimulationRunning = true;
        } else {
            let idx = cycle.indexOf(this.simulationSpeed);
            idx = (idx + 1) % cycle.length;
            this.simulationSpeed = cycle[idx];
            this.isSimulationRunning = true;
        }
        this.updateButtonStyles();
        this.updateSpeedIndicator();
        this.startGameLoop();
    }

    addTrack() {
        const existingNums = this.tracks.map(t => parseInt(t.id, 10)).sort((a,b) => a - b);
        let newNum = 1;
        while (existingNums.includes(newNum)) newNum++;
        const newId = String(newNum).padStart(4, '0');
        const newTrack = {
            id: newId,
            initialBearing: Math.random() * 360,
            initialRange: this.maxRange * (0.1 + Math.random() * 0.8),
            course: Math.random() * 360,
            speed: 2 + Math.random() * 13
        };
        newTrack.x = this.ownShip.x + newTrack.initialRange * Math.sin(this.toRadians(newTrack.initialBearing));
        newTrack.y = this.ownShip.y + newTrack.initialRange * Math.cos(this.toRadians(newTrack.initialBearing));
        newTrack._controller = new ContactController(newTrack);
        newTrack._sim = this;
        this.tracks.push(newTrack);
        this.selectedTrackId = newId;
        this.calculateAllData(newTrack);
        this.updatePanelsAndRedraw();
        this.markSceneDirty();
    }

    dropTrack() {
        if (this.selectedTrackId === null) return;
        const trackIndex = this.tracks.findIndex(t => t.id === this.selectedTrackId);
        if (trackIndex > -1) {
            this.tracks.splice(trackIndex, 1);
            if (this.tracks.length > 0) {
                const newIndex = Math.max(0, trackIndex - 1);
                this.selectedTrackId = this.tracks[newIndex].id;
            } else {
                this.selectedTrackId = null;
            }
            this.updatePanelsAndRedraw();
            this.markSceneDirty();
        }
    }

    togglePolarPlot() {
        this.showPolarPlot = !this.showPolarPlot;
        this.staticDirty = true;
        this.markSceneDirty();
    }

    toggleTrackIds() {
        this.showTrackIds = !this.showTrackIds;
        this.markSceneDirty();
    }

    toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
    }

    setupRandomScenario(){
        const gen = new ScenarioGenerator(this.scenarioCfg);
        this.tracks = gen.makeScenario(this.ownShip);
        this.tracks.forEach(t=>{ t._sim=this; t._controller=new ContactController(t); });
        this.selectedTrackId = this.tracks[0].id;
        this.isSimulationRunning = true;
        this.simulationElapsed = 0;
        this.scaleUI();
        this.isSimulationRunning = true;
        this._initialize();
        this.markSceneDirty();
    }

    showHelpModal() {
        this.helpModal.style.display = 'flex';
        const left = (window.innerWidth  - this.helpModal.offsetWidth)  / 2;
        const top  = (window.innerHeight - this.helpModal.offsetHeight) / 2;
        this.helpModal.style.left = `${Math.max(0, left)}px`;
        this.helpModal.style.top  = `${Math.max(0, top)}px`;
    }

    hideHelpModal() {
        this.helpModal.style.display = 'none';
    }

    // --- Utility & Helper Methods ---
    toRadians(degrees) { return degrees * Math.PI / 180; }
    toDegrees(radians) { return (radians * 180 / Math.PI + 360) % 360; }
    bearingToCanvasAngle(bearing) { return (450 - bearing) % 360; }
    canvasAngleToBearing(angle) { return (450 - angle) % 360; }
    formatBearing(num) { return Math.round(num).toString().padStart(3, '0'); }
    formatTime(hours) {
        if (hours < 0 || !isFinite(hours)) return '--:--:--';
        const totalSeconds = hours * 3600;
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = Math.floor(totalSeconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    getRelativeQuarter(cpaBearing, ownShipCourse){
        const relativeBearing = (cpaBearing - ownShipCourse + 360) % 360;
        if(relativeBearing >= 0 && relativeBearing < 90) return 'STBD BOW';
        if(relativeBearing >= 90 && relativeBearing < 180) return 'STBD QTR';
        if(relativeBearing >= 180 && relativeBearing < 270) return 'PORT QTR';
        return 'PORT BOW';
    }
    getAspect(targetAngle){
        if(targetAngle >= 337.5 || targetAngle < 22.5) return 'BOW';
        if(targetAngle >= 22.5 && targetAngle < 67.5) return 'STBD BOW';
        if(targetAngle >= 67.5 && targetAngle < 112.5) return 'STBD BM';
        if(targetAngle >= 112.5 && targetAngle < 157.5) return 'STBD QTR';
        if(targetAngle >= 157.5 && targetAngle < 202.5) return 'STERN';
        if(targetAngle >= 202.5 && targetAngle < 247.5) return 'PORT QTR';
        if(targetAngle >= 247.5 && targetAngle < 292.5) return 'PORT BM';
        if(targetAngle >= 292.5 && targetAngle < 337.5) return 'PORT BOW';
        return 'N/A';
    }
    getBearingRate(relativeVelocity, targetPosition, range){
        const crossProduct = targetPosition.x * relativeVelocity.y - targetPosition.y * relativeVelocity.x;
        if(range < 0.01) return '0.00 STEADY';
        const bearingRateRadPerHour = crossProduct / (range * range);
        const bearingRateDpm = (bearingRateRadPerHour * 180 / Math.PI) / 60;
        let direction;
        if(Math.abs(bearingRateDpm) < 0.01) {
            direction = 'STEADY';
        } else if (bearingRateDpm > 0) {
            direction = 'LEFT';
        } else {
            direction = 'RIGHT';
        }
        return `${Math.abs(bearingRateDpm).toFixed(2)} ${direction}`;
    }
    distToSegment(p, v, w) {
        const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
        if (l2 == 0) return Math.sqrt((p.x - v.x)**2 + (p.y - v.y)**2);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.sqrt((p.x - (v.x + t * (w.x - v.x)))**2 + (p.y - (v.y + t * (w.y - v.y)))**2);
    }
    prepareStaticStyles() {
        this.ctx.strokeStyle = this.radarFaintGreen;
        this.ctx.fillStyle   = this.radarFaintGreen;
        this.ctx.font        = `${Math.max(12, this.canvas.width * 0.04)}px 'Share Tech Mono', monospace`;
    }
}

// --- Application Entry Point ---
document.addEventListener('DOMContentLoaded', () => {
    new Simulator();
});
