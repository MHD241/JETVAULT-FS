# Prompt for another AI: JetVault Flight Simulator

You are joining an existing project, JetVault Flight Simulator: a browser flight simulator written in TypeScript with three.js and Vite. It is working software. Do not rebuild it or remove features. Read `PROJECT_STATE.md` in the repository first. It is the honest, dated log of what is done, what was only tested headlessly, and what is not verified.

## What the game is
- A realistic, expandable browser flight sim. Edinburgh (EGPH) is the reference airport. Glasgow (EGPF) and Portmoak gliding site (EGPM) are also modelled, all inside one Scotland world.
- Aircraft: Cessna 172S, Boeing 737-800, and an ASK-21-class glider.
- Repository: `mhd241/jetvault-fs`, branch `claude/jetvault-foundation` (also pushed to `main`).

## Architecture (where things are)
- `src/sim/` physics: fixed 240 Hz step, six-degree-of-freedom rigid body, quaternion attitude, SI units, NED/FRD frames. `fdm/aircraft.ts` (forces, ground contact, buffet), `fdm/aero.ts` (strip-theory aerodynamics, stall), `fdm/gear.ts`, `fdm/piston.ts`, `fdm/turbofan.ts`; aircraft data in `sim/aircraft/{c172,b738,glider}.ts`; `atmosphere.ts`, `weather.ts`, `lift.ts`; `marshal.ts` (stand marshal logic), `buggy.ts` (glider retrieval buggy).
- `src/world/` data: Scotland terrain, land cover, airports, buildings. Detail patches stream in and out around the aircraft. Data is in `public/data/scot/`; the build tool is `tools/build_scotland.py`.
- `src/render/` three.js rendering: terrain shader, airport, buildings, sky/clouds, 737 and cockpit models, tyre smoke, ground vehicles, trees, marshal figure, crash effects.
- `src/input/`, `src/ui/` controls (keyboard, mouse, touch joystick), HUD, menus, minimap.
- `src/main.ts` wires everything together; `window.jetvault` exposes the app for headless tests.
- `tests/` has 110 vitest tests (103 pass, 7 are crash tests skipped on purpose). Run: `npx vitest run`, `npx tsc --noEmit`, `npx vite build`.

## Current state (summary)
- Done: 737 with animated real cockpit model (converted to `public/models/cockpit737.*`), supplied glTF 737 exterior (`public/models/b738_geo.bin`, a renamed .glb, with no moving control surfaces), jet bridges, pushback, stand marshal with signals, gate lead-in lines, glider winch launch with buggy retrieval at Portmoak, streaming terrain, volumetric-looking clouds, sun disc, shadows, sky reflections on aircraft, tyre smoke, wing flex, stall buffet, LOW/HIGH/ULTRA presets, "easy flying" and beginner-assist toggles.
- Crashes are switched off (`CRASHES_ENABLED = false` in `sim/fdm/aircraft.ts`).
- Known gaps: no real-GPU or phone frame-rate measurement (only software rendering was available); 737 aerodynamic data are estimates, not Boeing data; the glTF 737 has no moving surfaces or gear; no night-lighting polish; no multiplayer, ATC or airline/passenger gameplay yet.

## Rules of engagement
1. Inspect before changing. Preserve working systems and tests.
2. Never claim a feature works unless you ran it and looked at a screenshot or test result. Say "not tested" when it is not. Do not present estimated aircraft data as authentic.
3. Third-party assets (the cockpit model, the glTF 737) have unconfirmed or owner-approved licences. Do not add assets of unknown origin. Respect licences. OpenStreetMap and Sentinel-2 credit is required. GeoFS code and assets are proprietary and must not be copied.
4. After each piece of work: run tests and type-check, update `PROJECT_STATE.md` honestly, commit and push to both branches.
5. The owner wants speed and minimal credit use: small steps, show results, no long rebuilds.

## Good next tasks (pick with the owner)
Real-device performance measurement and a lighter cockpit; moving control surfaces for the new 737 exterior; Edinburgh ground detail (apron buildings in the way, signage); cloud shadows; passenger/airline gameplay; hosting (static site on Cloudflare Pages).
