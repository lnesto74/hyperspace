# Retail UX v3 — Claude build (side by side, 12 Oct 2026)

Open: `http://localhost:5173/flowfield-v3/index.html?embed=1` (same Vite server as `/flowfield/`).
This folder is a self-contained copy of the flowfield app with the v3 "precision spatial twin" changes,
installed NEXT TO `frontend/public/flowfield/` because another v3 implementation (retail-twin.js,
retail-geometry.js, retail/) was being written into `/flowfield/` at the same time. Nothing in
`/flowfield/` was touched. Pick one, then merge; do not deploy either without review.

What changed vs the seven/eight-lens version (Behaviour lens unchanged except English labels):
- English UI everywhere (department names, slots, dates, number format, lane names).
- No colour-mapped floor: selection is a thin violet outline/cage, other departments faint; shelf face = white CAD edge + dashed 1 m band.
- Contour lines (marching squares, only on measured cells) for Flow Dwell and Engagement isolines (10 Hz "choosing" time).
- Flow Explorer: six modes, six pictures (streams / contours / track-key dots / direction arrows + rose / sinks & splits / path-type marks), each with its own panel.
- Engagement: lead number follows the layer (area / at the shelf / choice index); one department in focus.
- Service: coral queue outlines + dashed till band, per-entrant vs share-of-waiting kept apart, 10 Hz per-lane wait as secondary.
- Opportunities: Observed → Hypothesis (not measured) → Modelled scenario (default economics flagged) → Test → Verify; no "recoverable".
- Compare: one large map + six-slot filmstrip; A/B and Difference on the same frame.
- Camera fitted to the store outline; panel collapse; callouts avoid controls and each other.
Code: `twin-graphics.js` (+ test), `workspace.js`, `workspace.css`, `main.js` (fit, projector, stream gain), `lenses.js`.
Tests: unit (twin-graphics, kinetic, visitor-journey, value-at-stake, journey-scorecard) and `e2e-lenses.mjs` here (36 checks, all pass).
