# Maneuver-Beta

This repository contains a browser-based radar simulator. The app can be
installed as a Progressive Web App (PWA). On iOS, add it to your home screen
to launch in standalone mode without Safari's UI chrome.

When viewed on mobile, rotate to landscape orientation for the best experience. The settings drawer includes an **Add to Home** option to quickly install the simulator as a PWA.

## Simulator notes

- ORCA max neighbors are set to 15 and neighbor distances refreshed before each simulation step. For scenarios with more than 50 agents, switch to sector-pruning (TODO).
