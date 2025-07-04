# Polar Grid Manual Test Checklist

## Canvas Sizes
- **600x600 px**
  - Rings and radial lines scale to fit.
  - Range labels appear in faint green just outside each ring.
- **1024x1024 px**
  - Grid maintains proportions; range labels remain readable.

## Interactions
- Resizing the browser triggers a one-time rebuild of the static grid.
- Toggling radar range updates ring spacing without extra radial lines.
- Dynamic items (targets, vectors) draw normally after grid update.

