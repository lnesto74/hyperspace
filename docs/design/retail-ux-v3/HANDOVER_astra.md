# Astra handover — retail UX v3 freeze

Date: 12 October 2026. Requested local snapshot branch: `ux-v3-astra`. Starting branch: `feature/retail-ux-seven-lenses`; starting HEAD: `4305c0c`. Snapshot commit message: `UX v3 Astra work in progress, before merge`.

Implementation is frozen. No further changes to `frontend/public/flowfield/` are authorized until the merge is done. Only this handover and the requested local Git snapshot are being produced. Nothing has been pushed or deployed. Claude owns the parallel `frontend/public/flowfield-v3/` integration; Astra has not merged or edited that build.

## Ownership and snapshot scope

The working tree was already dirty before Astra started. The user explicitly requested `git add -A`, so this local snapshot includes pre-existing and parallel work as well as Astra’s implementation. A diff against the starting HEAD is **not** an Astra-only diff. In particular, `main.js` and `workspace.js` contain inherited changes as well as the Astra additions described below. The saved Frutta baseline is the approved first-stage result, not a pristine pre-Astra checkout.

## Finished

- Integrated the Blender/Three.js digital twin into the existing Flowfield application: 113 distinct mapped fixtures, 13 checkout lanes and 32 selectable categories/lanes.
- Created 21 fixture variants with 42 full/L0 GLBs; preserved the approved original `produce.glb` byte-for-byte. Saved editable Blender sources, mapping/configuration, generators and baseline copies.
- Preserved exact CAD footprints and source IDs, analytical ROI polygons/holes and existing KPI availability gates. Implemented glass selection cages, separate waiting/service boundaries, source-aware anchored cards, store/category cameras, observed-only isolines, shelf fronts and reduced detail.
- Added progressive overview assets and selected/near detail with shared geometry/materials. Saved 32 browser category screenshots and 32 corresponding SkyRig Blender previews.
- Settled desktop samples at 1600 × 1000: overview 59.3 fps / 6.01 ms CPU; Frutta 60 fps / 3.99 ms; reduced Frutta 60 fps / 4.76 ms. These are single-machine observations, not a hardware-wide guarantee.

## Unfinished, broken or limited

- Claude’s v3 merge and post-merge verification remain undone. Production deployment is not part of this handover.
- The local API returned unavailable/500 responses; the preview uses clearly labelled archived September 14 snapshot fallbacks. A functioning live feed was not verified or repaired.
- Whole-frontend build and broad frontend/backend test runs remain unsuccessful (details below). Focused Flowfield checks passing does not mean the repository is green.
- No checkout transit spatial ROI is configured. Waiting and service use their existing separate geometry; no transit polygon was invented. Per-session lane metrics remain dashes where existing reliability/missing-data gates require that.
- Merchandise and fixture heights are representative: no exact SKU planogram or surveyed heights were supplied. Unknown aisle categories retain their source identity.
- CAD records 186/187/188 (thin freezer linings) and 794 (fish perimeter wall) remain architecture; duplicate table 917 is represented by 815 once. These exclusions are intentional, not lost departments.
- Cold GLB/shader loading and concurrent headless tests caused temporary frame-rate drops (roughly 25–60 fps during the screenshot sweep). Broad device/responsive-breakpoint testing is not complete.
- Default Node 23 x64 failed to start Vite because the matching Rollup binary was absent. The existing ARM Node 18 installation runs the preview; no dependency/configuration changes were made to hide the mismatch.

## Merge and regeneration notes

- Preserve `retail-twin.js`, `retail-geometry.js`, `retail-twin.css`, the `retail/` assets and the matching loader utilities as one integration. Port the explicit twin hooks from `main.js`/`workspace.js`; do not assume their entire Git diff belongs to Astra.
- Keep `layers.js`’s `selectionVisual` control and the stylesheet include in `index.html`. Preserve legacy Lab editing and the existing analytical/source/reliability logic.
- Current mapping/generation entry points are `scripts/retail/map_supermarket.py` and `scripts/retail/generate_supermarket.py`. Running historical `map_fixtures.py` would replace the expanded manifest with the original v1 mapping.
- `refine_overview.py` was a one-off refinement, not an idempotent routine: repeating it can add overview merchandise again. The relevant envelope/stock rules are integrated into the current full generator.
- Modules use a nominal 1.7 × 2.6 m floor-centred envelope. Blender Z-up exports to glTF Y-up; runtime fits X/Z to source footprints while retaining Y scale 1. Selection cage heights are visual design values, not measured dwell or merchandise height data.
- SkyRig generation used background Blender 5.2.1 LTS under `C:/Users/Administrator/HyperspaceRetail/`; remote `out/` contains the initial assets and `supermarket/` the expansion. The Blender MCP listener was unavailable, so background Python was used. Local editable sources and scripts are included; no credentials are recorded here.

## Tests actually run before the freeze

No implementation tests were rerun during handover; the results below are from the completed implementation session and its saved evidence.

| Check | Result / evidence |
|---|---|
| `node --test frontend/public/flowfield/*test.mjs` | Final rerun: 36/36 passed, including four new geometry tests; `docs/design/supermarket/flow-tests.txt`. |
| `node scripts/retail/verify_supermarket.mjs` | Passed: 42 GLBs, 113 placements, 13 analytical departments, 13 lanes, unique CAD IDs, sampled containment and preserved Frutta hash; `docs/design/supermarket/asset-validation.json`. |
| Source mapping assertions | All 1,119 exported source polygons exactly match current CAD; inventory and generation evidence saved. |
| `node scripts/retail/verify_assets.mjs` | Initial six-variant checks passed after initial fit corrections; `docs/design/retail-twin/asset-validation.json`. |
| Existing `docs/design/retail-ux/e2e-lenses.mjs` | 36 PASS, JavaScript errors `[]`; `docs/design/supermarket/existing-e2e.txt`. Used a temporary copy with only the Playwright import redirected to the bundled runtime. |
| JS syntax, Python compilation, scoped `git diff --check` | Passed for edited runtime/generator files. |
| Browser inspection | All 32 categories/lanes captured; store/top/Frutta/checkout/isolines views and performance evidence under `docs/design/supermarket/`. |
| Frontend `npm run build` | Failed with approximately 180 existing TypeScript errors outside Flowfield (including canvas model, operations footfall and readonly/unused declarations); temporary log `/tmp/hyperspace-frontend-build.txt`. |
| Broad frontend Vitest | 12 failed / 8 passed files; 1 failed / 33 passed assertions. Mixed Node/Vitest/Playwright collection, missing Playwright dependency and an existing reliability assertion; `/tmp/hyperspace-frontend-tests-arm.txt`. |
| Broad backend Vitest | 8 failed / 14 passed files; 3 failed / 120 passed / 1 skipped assertions plus two process-exit errors. Missing test tables, mixed-runner collection and DOOH edge/default-campaign expectations; `/tmp/hyperspace-backend-tests-arm.txt`. |

The broad-suite temporary logs are outside Git and may disappear. Saved validation summaries and focused evidence are included in the snapshot. No unrelated application/backend fixes were made as part of this twin work.

Browser regression invocation used:

```sh
FLOWFIELD_URL='http://127.0.0.1:5183/flowfield/index.html?embed=1' PW_CHROMIUM='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' /Users/lnesto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /tmp/hyperspace-existing-e2e.mjs
```

## Local preview

Final tested URL: **http://127.0.0.1:5183/flowfield/index.html?slice=trading&question=moved** (port **5183**). Initial testing used `http://localhost:5173/flowfield/index.html`; port 5173 was subsequently occupied by another project, so Hyperspace moved to 5183.

The preview was launched from `frontend/` with the existing runtime:

```sh
/Users/lnesto/.nvm/versions/node/v18.20.5/bin/node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5183 --strictPort
```

## Astra file inventory — one file per line

Paths are repository-relative. Each line states purpose and why it exists. Generated images/assets and preserved baseline copies are enumerated individually.

- `docs/RETAIL_DIGITAL_TWIN.md` — Documents generation, coordinate frames, integration, LOD, data boundaries and verification for future maintenance.
- `docs/design/retail-twin/asset-validation.json` — Preserves initial six-asset and placement validation evidence.
- `docs/design/retail-twin/existing-e2e.txt` — Preserves existing lens regression output from the initial Frutta stage.
- `docs/design/retail-twin/flow-tests.txt` — Preserves focused test output from the initial Frutta stage.
- `docs/design/retail-twin/frutta-focus.jpg` — Browser frutta-focus view; visual evidence for the Frutta/whole-store implementation.
- `docs/design/retail-twin/frutta-preview.png` — SkyRig rendered frutta-preview view; visual evidence for the Frutta/whole-store implementation.
- `docs/design/retail-twin/frutta-top.jpg` — Browser frutta-top view; visual evidence for the Frutta/whole-store implementation.
- `docs/design/retail-twin/latticini-focus.jpg` — Browser latticini-focus view; visual evidence for the Frutta/whole-store implementation.
- `docs/design/retail-twin/store-oblique.jpg` — Browser store-oblique view; visual evidence for the Frutta/whole-store implementation.
- `docs/design/retail-twin/surgelati-focus.jpg` — Browser surgelati-focus view; visual evidence for the Frutta/whole-store implementation.
- `docs/design/retail-ux-v3/HANDOVER_astra.md` — This freeze handover: records Astra ownership, file purposes, completion state, limitations, test evidence and the tested URL for Claude’s merge.
- `docs/design/supermarket/GALLERY.md` — Links category screenshots and Blender previews for visual review.
- `docs/design/supermarket/VALIDATION.md` — Records passing focused checks, broader repository failures, modeling limits and measured performance.
- `docs/design/supermarket/asset-validation.json` — Records final 42-asset and 113-placement validation evidence.
- `docs/design/supermarket/baseline-performance.json` — Records approved Frutta-stage browser performance for comparison.
- `docs/design/supermarket/blender/acqua.png` — SkyRig Blender preview of acqua; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/bakery-and-breakfast.png` — SkyRig Blender preview of bakery-and-breakfast; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/bar.png` — SkyRig Blender preview of bar; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/carne.png` — SkyRig Blender preview of carne; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-1.png` — SkyRig Blender preview of checkout-1; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-10.png` — SkyRig Blender preview of checkout-10; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-11.png` — SkyRig Blender preview of checkout-11; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-12.png` — SkyRig Blender preview of checkout-12; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-13.png` — SkyRig Blender preview of checkout-13; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-2.png` — SkyRig Blender preview of checkout-2; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-3.png` — SkyRig Blender preview of checkout-3; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-4.png` — SkyRig Blender preview of checkout-4; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-5.png` — SkyRig Blender preview of checkout-5; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-6.png` — SkyRig Blender preview of checkout-6; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-7.png` — SkyRig Blender preview of checkout-7; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-8.png` — SkyRig Blender preview of checkout-8; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/checkout-9.png` — SkyRig Blender preview of checkout-9; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/display-digitali.png` — SkyRig Blender preview of display-digitali; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/espositori-senza-categoria.png` — SkyRig Blender preview of espositori-senza-categoria; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/frutta-e-verdura.png` — SkyRig Blender preview of frutta-e-verdura; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/frutta.png` — SkyRig Blender preview of frutta; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/gastronomia.png` — SkyRig Blender preview of gastronomia; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/giornali.png` — SkyRig Blender preview of giornali; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/ingresso.png` — SkyRig Blender preview of ingresso; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/latticini.png` — SkyRig Blender preview of latticini; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/pane.png` — SkyRig Blender preview of pane; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/pesce.png` — SkyRig Blender preview of pesce; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/salumi.png` — SkyRig Blender preview of salumi; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/scaffali-senza-categoria.png` — SkyRig Blender preview of scaffali-senza-categoria; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/surgelati.png` — SkyRig Blender preview of surgelati; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/tavoli.png` — SkyRig Blender preview of tavoli; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/blender/verdura.png` — SkyRig Blender preview of verdura; evidence of the generated mapped department/lane geometry.
- `docs/design/supermarket/browser-validation.json` — Records browser selection/camera sweep diagnostics and screenshot evidence, including cold/transitional samples.
- `docs/design/supermarket/checkout-top.jpg` — Browser checkout-top view; visual evidence for the Frutta/whole-store implementation.
- `docs/design/supermarket/existing-e2e.txt` — Stores the existing lens regression results: 36 PASS and no JavaScript errors.
- `docs/design/supermarket/flow-tests.txt` — Stores the final 36 passing focused Node test results.
- `docs/design/supermarket/frutta-isolines.jpg` — Browser frutta-isolines view; visual evidence for the Frutta/whole-store implementation.
- `docs/design/supermarket/frutta-top.jpg` — Browser frutta-top view; visual evidence for the Frutta/whole-store implementation.
- `docs/design/supermarket/inventory.json` — Records mapped fixture/category inventory and exclusions to audit coverage.
- `docs/design/supermarket/performance.json` — Records settled expanded-scene frame rate, CPU time, draw calls and triangles.
- `docs/design/supermarket/screens/acqua.jpg` — Browser screenshot of acqua; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/bakery-and-breakfast.jpg` — Browser screenshot of bakery-and-breakfast; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/bar.jpg` — Browser screenshot of bar; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/carne.jpg` — Browser screenshot of carne; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-1.jpg` — Browser screenshot of checkout-1; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-10.jpg` — Browser screenshot of checkout-10; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-11.jpg` — Browser screenshot of checkout-11; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-12.jpg` — Browser screenshot of checkout-12; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-13.jpg` — Browser screenshot of checkout-13; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-2.jpg` — Browser screenshot of checkout-2; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-3.jpg` — Browser screenshot of checkout-3; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-4.jpg` — Browser screenshot of checkout-4; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-5.jpg` — Browser screenshot of checkout-5; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-6.jpg` — Browser screenshot of checkout-6; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-7.jpg` — Browser screenshot of checkout-7; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-8.jpg` — Browser screenshot of checkout-8; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/checkout-9.jpg` — Browser screenshot of checkout-9; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/display-digitali.jpg` — Browser screenshot of display-digitali; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/espositori-senza-categoria.jpg` — Browser screenshot of espositori-senza-categoria; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/frutta-e-verdura.jpg` — Browser screenshot of frutta-e-verdura; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/frutta.jpg` — Browser screenshot of frutta; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/gastronomia.jpg` — Browser screenshot of gastronomia; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/giornali.jpg` — Browser screenshot of giornali; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/ingresso.jpg` — Browser screenshot of ingresso; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/latticini.jpg` — Browser screenshot of latticini; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/pane.jpg` — Browser screenshot of pane; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/pesce.jpg` — Browser screenshot of pesce; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/salumi.jpg` — Browser screenshot of salumi; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/scaffali-senza-categoria.jpg` — Browser screenshot of scaffali-senza-categoria; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/surgelati.jpg` — Browser screenshot of surgelati; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/tavoli.jpg` — Browser screenshot of tavoli; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/screens/verdura.jpg` — Browser screenshot of verdura; evidence of integrated selection, camera and fixture presentation.
- `docs/design/supermarket/skyrig-generation.txt` — Preserves background Blender generation output from SkyRig for reproducibility.
- `docs/design/supermarket/skyrig-refinement.txt` — Preserves output of the final SkyRig overview/envelope refinement.
- `docs/design/supermarket/store-oblique.jpg` — Browser store-oblique view; visual evidence for the Frutta/whole-store implementation.
- `docs/design/supermarket/store-top.jpg` — Browser store-top view; visual evidence for the Frutta/whole-store implementation.
- `frontend/public/flowfield/index.html` — Linked retail-twin.css so the new presentation is loaded; other existing version-query changes in the overall diff are not attributed to Astra.
- `frontend/public/flowfield/layers.js` — Added selectionVisual(visible) to hide the legacy solid selection when the twin supplies its glass cage; retains legacy Lab editing.
- `frontend/public/flowfield/main.js` — Integrated the retail twin, observed-cell isolines, selection/picking, lighting, fitted store/category cameras, manual camera cancellation and diagnostics; presentation-only particle emphasis preserves analytical flow calculations.
- `frontend/public/flowfield/retail-geometry.js` — Provides polygon/hole membership, bounds, raw observed-cell masks and clipped level-set contours; prevents interpolated visual coverage from being treated as observed evidence.
- `frontend/public/flowfield/retail-geometry.test.mjs` — Adds four focused geometry/manifest tests covering holes, disjoint regions, observed-only contours/coverage, exact footprints and preserved Frutta IDs.
- `frontend/public/flowfield/retail-twin.css` — Styles spatial controls, anchored KPI cards/leaders, selection labels and waiting/service legend; suppresses opaque legacy selection fills outside Lab.
- `frontend/public/flowfield/retail-twin.js` — Implements exact-CAD architecture, cached/instanced GLBs, progressive overview and near/selected detail, reduced mode, floor/light/shadows, glass ROI cages, checkout boundaries/signs, dimming, camera profiles and disposal.
- `frontend/public/flowfield/retail/bakery-l0.glb` — Low-detail overview bakery fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/bakery.glb` — Detailed bakery fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/bar-l0.glb` — Low-detail overview bar fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/bar.glb` — Detailed bar fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/beverages-l0.glb` — Low-detail overview beverages fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/beverages.glb` — Detailed beverages fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/breakfast-l0.glb` — Low-detail overview breakfast fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/breakfast.glb` — Detailed breakfast fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/checkout-l0.glb` — Low-detail overview checkout fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/checkout.glb` — Detailed checkout fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/chilled-l0.glb` — Low-detail overview chilled fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/chilled.glb` — Detailed chilled fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/dairy-l0.glb` — Low-detail overview dairy fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/dairy.glb` — Detailed dairy fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/deli-l0.glb` — Low-detail overview deli fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/deli.glb` — Detailed deli fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/display-l0.glb` — Low-detail overview display fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/display.glb` — Detailed display fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/entrance-l0.glb` — Low-detail overview entrance fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/entrance.glb` — Detailed entrance fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/fish-l0.glb` — Low-detail overview fish fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/fish.glb` — Detailed fish fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/freezer-l0.glb` — Low-detail overview freezer fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/freezer-wall-l0.glb` — Low-detail overview freezer-wall fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/freezer-wall.glb` — Detailed freezer-wall fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/freezer.glb` — Detailed freezer fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/grocery-l0.glb` — Low-detail overview grocery fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/grocery.glb` — Detailed grocery fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/manifest.json` — Stores v2 CAD provenance, IDs, exact vertices, fixture transforms, assets, categories, camera hints and exclusions; joins visual fixtures to the authoritative layout.
- `frontend/public/flowfield/retail/meat-l0.glb` — Low-detail overview meat fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/meat.glb` — Detailed meat fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/news-l0.glb` — Low-detail overview news fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/news.glb` — Detailed news fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/prepared-l0.glb` — Low-detail overview prepared fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/prepared.glb` — Detailed prepared fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/produce-l0.glb` — Low-detail overview produce fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/produce.glb` — Detailed produce fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints. Approved original preserved byte-for-byte.
- `frontend/public/flowfield/retail/self-checkout-l0.glb` — Low-detail overview self-checkout fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/self-checkout.glb` — Detailed self-checkout fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/table-l0.glb` — Low-detail overview table fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/table.glb` — Detailed table fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/vegetables-l0.glb` — Low-detail overview vegetables fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/retail/vegetables.glb` — Detailed vegetables fixture module; supplies reusable supermarket geometry fitted to mapped CAD footprints.
- `frontend/public/flowfield/vendor/BufferGeometryUtils.js` — Vendors the matching Three.js geometry helper required by the loader and shared geometry workflow.
- `frontend/public/flowfield/vendor/GLTFLoader.js` — Vendors the matching Three.js 0.160.1 GLB loader with local imports so assets load without changing project dependencies.
- `frontend/public/flowfield/vendor/THREE-LICENSE.txt` — Preserves upstream MIT attribution for the vendored Three.js utilities.
- `frontend/public/flowfield/workspace.js` — Added category/lane selection, exact polygon/hole selection, anchored source-aware KPI cards, separate waiting/service boundaries, camera and detail controls; preserves existing metric reliability gates and avoids invented fixture KPIs.
- `retail/README.md` — Documents source layout, current generator entry points and asset coordinate conventions.
- `retail/asset-stats.json` — Original Blender asset statistics for the first six variants.
- `retail/baselines/frutta-v1/frontend/public/flowfield/main.js` — Preserved approved Frutta-stage baseline copy of frontend/public/flowfield/main.js for rollback and merge comparison.
- `retail/baselines/frutta-v1/frontend/public/flowfield/retail-twin.css` — Preserved approved Frutta-stage baseline copy of frontend/public/flowfield/retail-twin.css for rollback and merge comparison.
- `retail/baselines/frutta-v1/frontend/public/flowfield/retail-twin.js` — Preserved approved Frutta-stage baseline copy of frontend/public/flowfield/retail-twin.js for rollback and merge comparison.
- `retail/baselines/frutta-v1/frontend/public/flowfield/retail/manifest.json` — Preserved approved Frutta-stage baseline copy of frontend/public/flowfield/retail/manifest.json for rollback and merge comparison.
- `retail/baselines/frutta-v1/frontend/public/flowfield/retail/produce.glb` — Preserved approved Frutta-stage baseline copy of frontend/public/flowfield/retail/produce.glb for rollback and merge comparison.
- `retail/baselines/frutta-v1/frontend/public/flowfield/workspace.js` — Preserved approved Frutta-stage baseline copy of frontend/public/flowfield/workspace.js for rollback and merge comparison.
- `retail/baselines/frutta-v1/retail/retail-library.blend` — Preserved approved Frutta-stage baseline copy of retail/retail-library.blend for rollback and merge comparison.
- `retail/baselines/frutta-v1/scripts/retail/generate_assets.py` — Preserved approved Frutta-stage baseline copy of scripts/retail/generate_assets.py for rollback and merge comparison.
- `retail/baselines/frutta-v1/scripts/retail/map_fixtures.py` — Preserved approved Frutta-stage baseline copy of scripts/retail/map_fixtures.py for rollback and merge comparison.
- `retail/baselines/frutta-v1/sha256.json` — Preserved approved Frutta-stage baseline hash inventory for integrity comparison.
- `retail/config/departments.json` — Explicit source-category-to-asset/camera mapping and modeling assumptions for reproducible placement.
- `retail/retail-library.blend` — Editable original Frutta-stage Blender library and mapped preview, preserved as source.
- `retail/supermarket-asset-stats.json` — Final full/L0 asset geometry statistics for size and complexity review.
- `retail/supermarket-library.blend` — Editable expanded Blender library with reusable prototypes/materials and mapped preview.
- `scripts/retail/__pycache__/asset_library.cpython-314.pyc` — Generated Python bytecode from syntax validation; incidental local artifact, not source or a runtime dependency.
- `scripts/retail/__pycache__/generate_supermarket.cpython-314.pyc` — Generated Python bytecode from syntax validation; incidental local artifact, not source or a runtime dependency.
- `scripts/retail/__pycache__/map_supermarket.cpython-314.pyc` — Generated Python bytecode from syntax validation; incidental local artifact, not source or a runtime dependency.
- `scripts/retail/__pycache__/refine_overview.cpython-314.pyc` — Generated Python bytecode from syntax validation; incidental local artifact, not source or a runtime dependency.
- `scripts/retail/asset_library.py` — Extracts reusable Blender primitives/materials from the Frutta generator to keep the expanded library visually consistent.
- `scripts/retail/generate_assets.py` — Preserves the original six-variant Blender generator and approved Frutta preview for reproducibility.
- `scripts/retail/generate_supermarket.py` — Builds the 21 full/L0 asset variants, mapped category previews and editable Blender library with normalized floor-centred module envelopes.
- `scripts/retail/map_fixtures.py` — Preserves the initial conservative fresh-department/checkout mapping used for the approved Frutta build; historical v1 generator, not the current whole-store entry point.
- `scripts/retail/map_supermarket.py` — Current mapper: checks all 1,119 source polygons against CAD, preserves Frutta placements, fits irregular interiors, maps 113 unique fixtures and 13 lanes, and emits manifest/inventory without changing analytical ROIs.
- `scripts/retail/refine_overview.py` — Records the one-off freezer-wall envelope and overview-stock refinement used on SkyRig; retained to explain the final generated assets.
- `scripts/retail/verify_assets.mjs` — Validates initial asset envelopes/origins and placement conventions; retained as the original validation entry point.
- `scripts/retail/verify_supermarket.mjs` — Checks all 42 GLBs, placement containment, unique CAD IDs, department/lane coverage and unchanged approved Frutta hash.

## Explicitly requested files that Astra did not change

- `frontend/public/flowfield/field.js` — Inherited flow-field computation changes; Astra did not edit directional roses, bidirectional flow, accumulation or coverage math. Preserve the existing analytical behavior when merging.
- `frontend/public/flowfield/slices/field_afternoon.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_all.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_evening.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_h08_10.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_h10_12.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_h12_14.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_h14_16.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_h16_18.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_h18_20.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_midday.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_morning.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_trading.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_weekday.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/field_weekend.json` — Existing slice data payload consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.
- `frontend/public/flowfield/slices/slices.json` — Existing slice index/metadata consumed by Flowfield; not generated, edited or recomputed by Astra. Its presence in the snapshot is not Astra authorship.

Other inherited work includes `visitor-journey.js`, `workspace.css`, `lenses.js`, kinetic/recovery/value-at-stake modules, `docs/design/retail-ux/e2e-lenses.mjs`, frontend dependency/Vite files, backend/pipeline changes and production/deployment files. Astra used the existing regression script but did not edit it. Claude’s `frontend/public/flowfield-v3/` and existing `docs/design/retail-ux-v3/` files are parallel work; only this handover is Astra-authored in that documentation directory.

The local commit also captures other pre-existing analysis, reports, data, backend, infrastructure and frontend work because the requested command stages the entire working tree. Use the commit file list for that broader snapshot; the inventory above records Astra’s work specifically.
