# Maneuver-Beta

This repository contains a browser-based radar simulator. The app can be
installed as a Progressive Web App (PWA). On iOS, add it to your home screen
to launch in standalone mode without Safari's UI chrome.

When viewed on mobile, rotate to landscape orientation for the best experience. The settings drawer includes an **Add to Home** option to quickly install the simulator as a PWA.

## Units

All distances and positions are measured in nautical miles (nm). Speeds within
the simulation are stored as nautical miles per second (nm/s). When adding a new
track, any provided speed in metres per second is converted to nm/s before being
applied.

## Example

```ts
import { TrafficSim } from './src/traffic/TrafficSim';

const sim = new TrafficSim({
    timeStep: 1,
    // 90 s horizon ensures contacts at the bow CPA distance are detected for
    // vessels moving around 10 m/s (~20 kts).
    timeHorizon: 90,
    neighborDist: 10,
    radius: 0.1,
    maxSpeed: 10,
    turnRateRadPerSec: 0.1,
    // Set to false to rely solely on ORCA without the additional CPA push.
    enableCpaPush: true,
});
```

### Large surface ship settings

```ts
const shipSim = new TrafficSim({
    timeStep: 1,
    // 120 s horizon paired with a smaller neighbor distance works well
    // for large surface vessels.
    timeHorizon: 120,
    neighborDist: 4,
    radius: 0.1,
    maxSpeed: 10,
    turnRateRadPerSec: 0.1,
});
```
