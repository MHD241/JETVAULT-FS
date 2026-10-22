# JetVault Flight Simulator — Project State

_Last updated: update 2 (left-veer diagnosis, Boeing 737-800, Edinburgh imagery/roads)._

## Engine and architecture
- **Platform:** browser, TypeScript + three.js (WebGL2), built with Vite. Chosen because the dev environment has no GPU and no native engine; the user plays in a browser. Fallback/native path: Godot 4 (the flight model is engine-independent TypeScript and can be ported).
- **Physics core** (`src/sim`, no three.js dependency): fixed-step 240 Hz 6-DOF rigid body, separate from rendering (render interpolates at display rate).
  - `fdm/aero.ts` lifting-surface (strip) aerodynamics, full ±180° AoA, stall/post-stall, flap/aileron/elevator/rudder, Fowler-flap mapping, slats, spoilers, downwash with lag, ground effect.
  - `fdm/piston.ts` piston engine + fixed-pitch propeller; `fdm/turbofan.ts` CFM56-class turbofan (N1 spool dynamics, density/Mach lapse, reverse thrust, fuel flow).
  - `fdm/gear.ts` spring/damper struts, tyre slip-angle + stiction model, brakes, speed-scheduled nosewheel steering; airframe contact points (tail, nacelles, wingtips…) for scrape/crash detection.
  - `fdm/aircraft.ts` assembles everything; retractable gear (squat switch), speedbrakes, multiple engines.
  - `systems/c172Systems.ts` electrical, fuel, vacuum/gyros, pitot-static instruments, engine indications (used by both aircraft).
  - `autopilot.ts` 2-axis autopilot acting through servos (ROL/HDG, VS/ALT) with auto-trim.
- **World** (`src/world`): two-level heightfield (30 m core ±24 km, 240 m far field ±120 km), land cover, airport data, building prisms (same prisms used for rendering and collision), local transverse-Mercator projection.
- **Renderer** (`src/render`): chunked LOD terrain using the *same* triangulation as physics, Sentinel-2 imagery + OSM roads + pavement overlays, runway with ICAO markings, lights + optical PAPI, buildings, procedural C172 and 737 models, C172 steam-gauge cockpit, 737 glass flight deck, sky/sun/fog/clouds/rain, cameras, collision debug view.

## Data sources (see About screen for attribution)
- Copernicus DEM GLO-30 (terrain) · ESA WorldCover 2021 (land cover, CC BY 4.0)
- **Copernicus Sentinel-2 L2A**, 16 May 2025, tiles 30UVG + 30VVH (true-colour imagery, ±12 km around EGPH, 6 m/px) — `tools/build_imagery.py`
- Overture Maps / OpenStreetMap (ODbL): taxiways, aprons, gates, buildings, **roads** (`tools/fetch_roads.py`)
- OurAirports (public domain): runway thresholds and elevations

## Update 2 — changes

### 1. "Aircraft veers left" — diagnosed and fixed
Investigated every listed cause with headless experiments (`tools/probe/veer*.ts`, `tests/straight.test.ts`):
- Gear/tyres/CG/coordinate frames: **not the cause.** With the engine off, the C172 coasts dead straight (0.013° heading change in 8 s) and yaw disturbances damp out.
- **Cause: propeller slipstream swirl striking the fin** (plus P-factor/torque), i.e. the real C172 left-turning tendency. Turning the swirl term off removes the drift (−14° → −0.27° in 8 s at 30 % power). Swirl magnitude (~3° at the fin) is consistent with momentum theory for the measured prop torque, so the physics was **not** artificially altered.
- The actual problem was the controls: the optional *auto-rudder* assist only worked in the air, so keyboard pilots had no way to hold the needed right rudder on the ground. The assist now also holds heading on the ground (moving the real pedals while no rudder key is pressed; Settings → Beginner mode). Default solo-pilot loading still offsets the CG slightly left (real effect).
- New **diagnostic overlay** (F10 / backquote): pedal input and assist contribution, rudder, aileron L/R, elevator, trim, nosewheel steer, yaw rate, roll rate, sideslip, lateral velocity, wind, CG offset, thrust, per-wheel normal and side forces.
- The 737 (no propeller) tracks perfectly straight with neutral controls: 0.000° drift at taxi and up to 120 KIAS.

### 2. Boeing 737-800 added (`src/sim/aircraft/b738.ts`, `render/b737Model.ts`, `render/b737Cockpit.ts`)
- Public dimensions/weights (span 35.79 m, wing 124.6 m², MTOW 79,016 kg, OEW ~41.4 t, wheelbase 15.6 m, track 5.72 m, 2 × 117 kN). Aerodynamic increments, inertia, gear rates, spool/lapse and control travels are **ESTIMATES**, marked in the file, tuned with a static trim solver (`tools/probe/trim.ts`) and the tests below.
- Systems: 9 flap detents (0–40), Fowler flaps + slats, spoilers/speedbrake, thrust reversers (ground only), retractable gear (8 s, squat switch), stabiliser trim, 70° tiller / 7° pedal steering, stick-shaker threshold.
- Flight deck: Boeing-style PFD (speed/alt tapes, attitude, VS, heading, FMA), ND (heading-up, real EGPH runway drawn to scale, GS/TAS/wind), engine display (N1, EGT, FF, fuel, gear, flaps, REV), clickable MCP (HDG, ALT, V/S, HDG SEL, ALT HOLD, V/S, CMD A), gear/flap/speedbrake levers, draggable thrust levers. **Not implemented:** autothrottle, LNAV/VNAV, APP/ILS, FMC, CDU, overhead panel, engine start panel.
- Exterior: original procedural model (fuselage loft with windows/livery, swept wing with winglets, CFM-style nacelles with moving reverser sleeves, spoilers, flaps, ailerons, elevators, rudder, retracting gear). Not a photoreal model — no licensed 737 asset was available offline.

### 3. Edinburgh Airport realism
- Real **Sentinel-2 imagery** draped on the terrain within ±12 km (runway, terminal, aprons, M8/M9, Gogar, Newbridge, fields recognisable); land-cover shading outside it.
- Real **road network** (18,806 OSM segments, motorway → service roads).
- **Jet stands** derived from OSM gates with 20 m clearance (3 stands), GA stands unchanged.
- Terminal/hangars/tower remain OSM footprint extrusions (accurate positions and outlines, generic flat-roof appearance — not detailed 3D buildings).

### 4. Handling
- The 737 is markedly heavier: full-aileron roll rate 38°/s vs C172 55°/s, ~39 s takeoff run, slower control surface time constant, much larger inertia.

### 5. Aircraft selection
- Fly Now: aircraft cards with planform preview (drawn from the flight-model geometry), airport, start position (stands/runway/approach), start view (cockpit or external), cold & dark (C172).

## Update 3 — "plane keeps going up on its own"
- **Cause (physical, not a bug):** after takeoff the elevator trim is still at the take-off setting (nose up). With the keyboard stick re-centred the aircraft returns to its trimmed (slow) speed and climbs: measured +734 ft/min (C172) and +2020 ft in 60 s (737) at cruise power with the stick released. Real aircraft do the same until the pilot re-trims.
- **Fix:** optional beginner assist **auto-trim** (`src/sim/assists.ts`, Settings → Beginner mode, on by default): when the pitch input is released in flight it holds the vertical speed at release (level if within ±300 fpm) through a small rate-limited elevator servo and moves the trim wheel to carry the load (same structure as the autopilot pitch channel). Disabled while the autopilot is engaged. The flight model is unchanged.
- **Tests:** `tests/autotrim.test.ts` — with assist: max deviation 4 ft (C172) / 63 ft (737) over 2 minutes starting from take-off trim at cruise speed. 74 tests pass. Browser: no page errors.

## Update 4 — simplified controls + mobile
- Desktop: mouse position = stick, 1-9 throttle (1 idle … 9 full), Left/Right arrows rudder, Space brakes, B spoilers, G gear, F flaps (cycle through detents), C view, Esc menu. Wheel = zoom.
- Touch (phone/iPad): joystick left, throttle slider right, GEAR/FLAPS/SPLR/BRAKE/VIEW/MENU buttons, lower render scale. Touch layout is **NOT TESTED on a real device** (only a headless phone viewport: loads, no errors).
- Minimap top-left (heading-up, Sentinel-2 imagery + major roads + runway). Auto-rudder and auto-trim always on. HUD reduced; autopilot/cockpit-click/cold-start UI removed from the UI.
- Real licensed 737 model: pending user-provided GLB; procedural model still used.

## Update 5 — EGPH terminal (first pass)
- Data audit: Overture/OSM gives footprints, 55 taxiway centrelines, 28 gate points, 6 aprons; **no** taxiway names, gate numbers, building heights or tower. Overpass (direct OSM) is blocked in this environment.
- Terminal (>20,000 m²) and pier (>5,000 m² within 150 m of the stands) are now classified in `styleAirportBuildings` (`src/world/obstacles.ts`) with ESTIMATED heights (15 m / 11 m), glazed ribbon-window facades and light roofs; other large airside buildings use grey cladding. Collision uses the same heights.
- Taxiway centrelines/edge lights already existed. **Not done:** jet bridges, taxiway signs/names, gate numbers, control tower, detailed facades.

## Update 6
- Jet bridges (`src/render/jetBridges.ts`): procedural bridges at the OSM gate points (de-duplicated within 9 m), oriented along the outward normal of the nearest terminal/pier wall, 17 m, visual only (no collision, no docking animation). Built and located correctly in the scene (5,760 vertices, over the gate area); **visual appearance NOT inspected** in a screenshot.
- Overlapping small OSM features inside the terminal/pier footprints are removed (render and collision).
- Structural-failure crash (g-overload) removed per user request; its test removed (73 tests). Crashes now come from ground/building/water impact and gear failure above 2500 fpm.
- Mobile joystick: low-pass filter (70 ms), expo curve, smoothly moving knob, softer visuals.

## Update 7
- Touch camera: one-finger swipe orbits/looks, two-finger pinch zooms (`bindTouchLook` in main.ts). NOT TESTED on a real device.
- Jet bridges enlarged/darkened (24 m) and a yellow stand lead-in line + stop bar added at each; verified in a top-down screenshot along the west pier (14 bridges). Gate numbers and taxiway names are still absent (not in the open data). The east piers have no bridges: gates there are >40 m from any classified terminal wall.

## Update 8
- East piers: any building with a gate on its facade (>1,000 m²) is now a glazed pier, so jet bridges and stand lines appear along it too (checked top-down).
- Landing assist (`AutoTrim`): with the stick released below ~60 ft AGL a descent is eased towards ~0.45 m/s at touchdown (elevator servo only, pitch capped at 7° to avoid tail strikes). Headless: a 600 fpm descent released at 120 ft touches down at ~356 fpm (C172) / ~598 fpm (737 in approach configuration). It reduces, but does not eliminate, hard landings. Touch only: wings-levelling aileron input when the joystick is released in the air.

## Required tests — results (`npm test`, 70 tests, all passing)
| # | Test | Result |
|---|------|--------|
| 1 | Neutral controls, zero wind, straight taxi | PASSED. C172 engine-off coast: 0.013°. 737 taxi 9 kt, 40 s: 0.000° / 0.000 m. C172 under power: −14° in 8 s, **explained** (slipstream swirl; 0.27° with swirl removed); holding heading with pedals: −0.9°. |
| 2 | Acceleration down the runway without unexplained veering | PASSED. 737 to 120 KIAS in 834 m: 0.000° heading change. |
| 3 | 737 takeoff | PASSED. EGPH 24, 74.2 t, flaps 5: VR 148, liftoff 154 KIAS at 10.0° after 39 s, no tail strike, gear up 8.0 s, 1500 ft AGL at 81 s. (Plausible; not validated against the Boeing FPPM.) |
| 4 | Stable flight and controlled turns | PASSED. Hands-off 30 s: 0.00° bank. 25° bank turn: 77° of turn in 40 s, ≤11 ft altitude error. Autopilot ALT ±8 ft, HDG within 1.6°. |
| 5 | Flap and landing gear deployment | PASSED. Flaps 5→30: 18° after 10 s, 30° final. Gear will not retract on the ground; retracts in 8 s airborne. Trim solver: approach flaps 30 α 3.7°, drag 97 kN (~60 % N1). |
| 6 | Approach and landing at EGPH | PASSED. 737 runway 24, 59 t, flaps 30: touchdown 141 KIAS, 400 fpm. C172 runway 06: passes as before. |
| 7 | Braking and taxiing after touchdown | PASSED. 737 roll 758 m (brakes, reversers, spoilers), on the centreline, then taxi + tiller turn of 52°. |
| 8 | Collision with runway and airport environment | PASSED. 737 over-rotation tail strike detected; gear-up landing → nacelle impact crash; flying into an EGPH building → building collision. C172 dive, hard landing, wingtip, building, ditching tests still pass. |
| 9 | Cockpit instruments | PASSED (headless): IAS/altitude/N1/fuel-flow indications equal the simulated state. Browser: PFD/ND/EICAS visually checked in screenshots. |
| 10 | Performance / frame rate | MEASURED ON SOFTWARE RENDERING ONLY (no GPU here): C172 cockpit 20.8 fps, C172 chase 16.4, 737 cockpit 14.3, 737 chase 13.6 fps at 1280×720; 430–610 draw calls, 0.4–0.9 M triangles. Physics: ~15 µs per 240 Hz step. **Real-GPU frame rate: NOT TESTED.** |

Earlier tests still pass: C172 POH performance (takeoff 960 ft, Vy climb, cruise, stall speeds, landing), stability derivatives/modes, systems, autopilot, EGPH ground handling.

## Known limitations / bugs
- Imagery is 10 m Sentinel-2 (not sub-metre aerial); airport buildings are footprint extrusions; no 3D trees, no jet bridges/airport vehicles.
- 737 has no autothrottle/LNAV/VNAV/ILS/FMC; engines spawn running (no APU/start sequence); centre fuel tank merged into wing tanks.
- C172 cockpit model is simple geometry; radios/transponder not modelled.
- Landing performance values are plausible but not validated against manufacturer data for the 737.
- Live METAR not connected (weather is manual).
- Real-GPU performance not measured.

## Next steps
1. 737: autothrottle (SPD/N1), ILS approach mode with real EGPH ILS data, LNAV to a simple flight plan, APU/engine start.
2. Higher-resolution aerial imagery where licensing allows (e.g. Scottish Government open aerial data) and 3D airport buildings (terminal, tower, hangars).
3. Live METAR (aviationweather.gov) — distinguish live vs manual in the UI (already labelled).
4. Performance pass on real GPUs; cascaded shadows; volumetric clouds.
5. A320 and further airports after EGPH is validated.

## How to run
```
npm install
npm run dev        # http://localhost:5173
npm test           # 70 headless physics / systems / collision tests
npm run build      # production build in dist/
```
Data rebuild (optional, needs network): `python3 tools/fetch_overture.py && python3 tools/build_geodata.py && python3 tools/fetch_roads.py && python3 tools/build_imagery.py`.
