# JetVault Flight Simulator — Project State

_Last updated: update 25 (landing assist removed; cockpit model pending licence/performance decision). This file is regenerated and handed over at the end of every piece of work._

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

## Update 9
- Jet bridges rest swung ~28° off the wall normal. A CONNECT JET BRIDGE button (also key J) appears when an airliner is stopped within 85 m of a bridge: the nearest bridge swings, telescopes and raises/lowers to the forward-left door, and the button becomes RETRACT. Moving the aircraft (>2 m/s) retracts it. Other stowed bridges shorten to stay clear of the fuselage.
- Door position (12.8 m aft of datum forward, left side, sill 2.6 m) is an ESTIMATE for the 737-800; no door model exists. Verified in a headless top-down screenshot (bridge reaches the front-left of the fuselage). No collision, no passengers/boarding yet. Not tested on a touch device.

## Update 10
- Airliner stands are now gate stands: `findGateSites`/`spacedStands` (`src/world/obstacles.ts`) snap each gate to the nearest terminal/pier wall and place the 737 nose-in so its front-left door (estimated position) lines up with the stowed bridge; 17 stands, spaced ≥42 m, replace the 3 derived apron stands for the 737. Yellow lead-in line and stop bar follow the aircraft's centreline. Spawn is parking-brake-on. Checked in a headless top-down screenshot (bridge connects to the door).
- Parking brake: on-screen PARK BRAKE button (top-right, on the ground) and K key; HUD BRK shows PARK; connecting a bridge sets it automatically. Gate positions are from OSM points, so some gate stands may overlap neighbouring structures or fall short of the real stand layout (not surveyed).

## Update 11 — pushback
- START/STOP PUSHBACK button (airliner stopped on the ground; key U). A tug pulls on the nose gear with a speed-controlled horizontal force (max 90 kN, target 1.5 m/s reverse) - a real force in the flight model (`Aircraft.tugSpeed`), not a position override. Steer with left/right (nosewheel). Stop re-sets the parking brake; bridge must be retracted first; advancing the throttle >40 % also releases the tug.
- Test: 737 pushed back 36.5 m in 30 s at ~1.3 m/s with 0.00° heading change; after release it creeps to rest in ~30 s with the parking brake. Browser: aircraft moves backwards, no page errors. Tug is a simple box model; steered pushback curves not tuned/tested.

## Update 12 — drive the pushback tug
- START PUSHBACK now puts you in the tug cab (tug driver view with dashboard and steering wheel; swipe/look works). 1-9 (or the throttle slider) sets tug speed 0-5 m/s (1 = stop), mouse/arrows/joystick steer the tug, Space/BRAKE brakes. The aircraft is neutral and its engines stay at idle. **FINISHED - BACK TO AIRCRAFT** disconnects the tug, sets the parking brake and restores your previous view.
- Physics: the tug is a real force at the nose gear along the towbar (max 90 kN, towbar swings up to 35°; nosewheel follows), so steering swings the tail. Browser check: at 3.2 m/s the aircraft turned from 089° to 073° with right steer, no page errors. Not tested on a touch device; the tug is simplified geometry and the HUD speed cell still shows airspeed (0 kt) while pushing.

## Update 13
- **Volumetric clouds** (`src/render/cloudField.ts`): FEW/SCT/BKN weather now renders scattered 3D cumulus: world-anchored clusters of ~8–14 soft, sun- and height-shaded instanced puffs (1 draw call, ~2,800–4,500 puffs within 20 km), which you can fly through (whiteout inside, CPU-tested) and above (ground partly hidden, gaps remain). OVC keeps the flat layers. It is a stacked-billboard approximation, not ray-marched; real-GPU/phone performance NOT TESTED (software render only). Needed log-depth chunks in the shader (the renderer uses a logarithmic depth buffer).
- **737 engines:** measured first: the CFM56-class model already gives ~3,000 fpm at 195 kt (pitch 12°, 3,000-ft start) and ~215 kt at pitch 8°; the 140 kt climbs came from pitching too high / the VS-hold assist. Changes: static thrust raised ~12 % to 131 kN per engine (GAME TUNING, above the published 117 kN) and the auto-trim VS hold now reduces a climb rate that would bleed a jet below ~1.15–1.3 x approach speed.
- **Pushback steering** stays where you leave it (no self-centring); Up arrow / X centres it.

## Update 14 — glider (step 1, on the Edinburgh map)
- **Aircraft:** "Training glider (ASK 21 class)" - 17 m span, 17.95 m², 360 kg empty, original model and flight-model data from public type figures (not a licensed model). Unpowered (engine block skipped), fixed wheel + nose skid, airbrakes (B), ailerons/elevator/rudder, T-tail. ESTIMATES: section drag, airbrake drag, inertia, tail geometry, gear.
- **Polar (headless, energy-height method, `tests/glider.test.ts`):** best L/D ~32 at ~50 kt (target ~34), min sink ~0.8 m/s at 36-40 kt (published ~0.6), stall ~37 kt (published ~35), airbrakes out L/D ~7. The polar is a few percent worse than the published figures.
- **Lift (`src/sim/lift.ts`, gliders only):** thermals (hashed 1.7 km grid, 15-min life cycle, scaled by sun height and cloud cover, 90-230 m radius, 1.4-4 m/s cores, sink ring, wind lean, boundary layer 0.7-2 km) and ridge lift from wind and the real terrain slope with lee sink. Engineering estimates, not real weather. Powered aircraft are unaffected.
- **Winch launch:** START WINCH LAUNCH button / L (stopped on the ground): a 1,400 m cable pulls at the nose hook with up to 4.5 kN, speed-controlled (target 54 kt, backs off above ~60 kt), cut automatically when steep/overhead; RELEASE CABLE button / R. Headless: lifts off at ~50 kt and climbs 180+ m with a simple pilot; browser launch checked (cable visible, no errors). **No aerotow yet.**
- **Assists:** auto-trim holds airspeed at stick release (gliders) and flares below 10 m. Vario cell on the HUD and an audio vario (V toggles; web audio, first gesture) - audio NOT tested.
- Not done: Portmoak (needs a second map region), cockpit instruments (HUD only), wave lift, water ballast, retractable gear.

## Update 15
- **Fixed: black screen / NaN HUD after picking an aircraft in the menu.** `selectAircraft` created an un-placed, un-paused simulation that stepped while the menu was open and poisoned the instrument filters with NaN. The new simulation is now created paused and the downwash filter is reset on every placement. Verified by clicking the glider card and FLY in a headless browser (HUD shows sensible values, no page errors).
- Restored the full menu (World Map, Aircraft Selection, Airport Selection, Weather, Settings, Controls, About); the Controls tab now documents the fixed key scheme.
- Mouse pitch inverted (mouse up = nose down).

## Update 16 — Portmoak (EGPM) region
- Second map region `public/data/egpm` built by the same pipeline with `AIRPORT=egpm` (`tools/fetch_overture.py`, `fetch_roads.py`, `build_geodata.py`, `build_imagery.py`): Copernicus DEM (32 km square at 30 m), ESA WorldCover, Sentinel-2 imagery (±9 km, 16 May 2025), OSM roads and buildings via Overture. Airport selection reloads the simulator with that region (stored in localStorage `jv-airport`, or `?airport=egpm`).
- **Runway data is not from OurAirports** (it only has the airfield point for Portmoak): the 10/28 strip is the longer OpenStreetMap runway way (~990 m); designators come from its heading, width 30 m is an estimate, elevation ~350 ft. OSM also shows a second parallel strip and shorter ways that are not modelled. Grass surface: no markings, lights or PAPI, grass friction.
- Glider options at Portmoak: winch launch from either end, airborne at the Lomond Hills ridge (the hills rise north of the airfield: 335-430 m within 3 km), final approach. The ridge faces south, so ridge lift needs a southerly wind (Weather tab); ridge lift comes from the real terrain slope.
- Not done: the real airfield layout (hangars, clubhouse detail, second runway, winch sites), thermals tied to ground type, aerotow, the other aircraft's start positions at Portmoak are generic. Real-device behaviour NOT TESTED.

## Update 17 — Portmoak airfield look
- Removed the painted grass strip (the mown field in the Sentinel-2 imagery now shows). The launch line was moved from the OpenStreetMap runway way onto the worn track visible in the imagery: found by a line-contrast search (heading 103° true, ~84 m south of the OSM strip, ~1,000 m long, strongest contrast from -440 m to +560 m along the line). That is an inference from 6 m/px imagery plus the user's Google Earth reference; it is NOT a surveyed runway. The user's reference image was used only to check layout, not as a texture (licence).
- Still to do: hangar/clubhouse appearance, windsock, launch cones, trees, trailer park.

## Update 18 — 737 wiggle ("fish-tail")
- **Cause:** the always-on air assist drove the rudder from sideslip (beta x 4), which excited a sustained yaw/roll wobble. Headless, hands off at 150/250/280 kt: rms yaw rate 0.4-0.7 deg/s and bank up to 6 deg with it, vs 0.03-0.1 deg/s without. The bare aircraft is stable.
- **Fix:** jets now get a yaw damper (rudder against yaw rate, gain 4.6 per rad/s) in place of the sideslip assist: rms yaw rate 0.06-0.07 deg/s with light turbulence (0.08-0.11 with no assist). Piston aircraft and the glider keep the old coordination assist (not re-tuned).

## Update 19 — real 737-800 model
- `public/models/b738.fbx` (2.9 MB, supplied by the user as free for public use; **author and licence NOT verified**) now replaces the procedural exterior (`B737Model.loadReal`, falls back to the procedural model if it fails to load). It is a SketchUp/3ds Max-derived 737-800 with blended winglets, ~98k triangles; scaled by wingspan (35.79 m), mapped to the body frame and pitched 2.06° about the main wheels so the nose and main wheels match the flight model's gear (nose gear lands at the FDM's x = 14.1 m).
- It arrived painted in a real airline's livery (geometry patches, not textures). That branding is removed: tail plain navy, lettering/swooshes/engine lips recoloured white. Embedded textures are dropped. About screen notes the unverified licence.
- Static parts: the control surfaces, flaps, spoilers, thrust reversers and engine fans are not separate animated parts (they are merged into groups), so they do not move. Landing-gear parts are picked out by position and hidden when the gear is up (no folding animation). Gear selection is a heuristic; the transit look is unchecked.
- Cockpit view still uses the existing procedural flight deck (the model has no interior).

## Update 20 — 737 animation rig, desktop camera
- **Control surfaces (real 737 mesh, `src/render/b737Rig.ts`):** the supplied FBX has no skeleton and only some surfaces are separate meshes. Separate meshes used: flap panels (inboard 4 parts + outboard 2 parts per side), 12 leading-edge slats/Krueger flaps, 2 elevators, landing-gear parts. Carved (duplicate triangles over the untouched skin, so no hole opens): 2 ailerons and 4 spoilers from the wing skin (`Group_010`), the rudder from the fin (`Group_082`). Hinge lines come from each part's own geometry (principal axis in plan). Result at load: aileron 2/2, spoilers 4/4, flaps 4/4, slats 12/12, elevators 2/2, rudder 1/1 (logged to the console as "737 rig").
- **Realism of the motion:** deflections are the flight model's actual surface positions after actuator lag (ailerons, elevator, rudder); flaps rotate and also move aft and down (Fowler travel, up to ~0.4 m); slats extend intermediate for flaps 1-5 and fully beyond; ground spoilers rise only on the ground, flight spoilers follow the speedbrake and also rise on the up-going aileron side; the gear folds smoothly (nose forward, mains inboard) in step with the gear position, and the nose wheel steers with the tiller. Verified in headless screenshots (flaps 40° with gap, spoilers/ailerons, gear in transit). **Not done:** thrust reversers, engine fan rotation, gear doors, wheel spin and strut compression (the mesh does not separate them); the rudder deflection is small to see and was only checked in one view; the livery patches are now exactly the fuselage white.
- **Desktop camera:** mouse wheel or trackpad pinch = zoom (pinch arrives as ctrl+wheel); hold the right mouse button and move = look/orbit; two-finger trackpad scroll = look/orbit (a mouse wheel is told apart by whole notches/line mode). Touch gestures unchanged. Not tested with a physical trackpad (headless only).
- Renamed `PROJECT_STATE_JETVAULT.md` to `PROJECT_STATE.md` at the user's request.

## Update 21 — 737 fixes after the first animation pass (user feedback)
- **Wheels in the ground:** the mesh is now placed each frame from the flight model's real tyre contact (gear bottom 4.05 m below the datum minus strut compression, nose and mains separately, tilting the mesh to match), instead of a fixed offset. Verified: wheels rest on the apron.
- **Flaps too slow:** flap rate raised from 1.3°/s to 3.0°/s (about 13 s for 0 to 40°; real aircraft take roughly 20-30 s, shortened on request).
- **Ailerons not part of the wing:** the aileron regions are now cut out of the wing skin and replaced by closed wedge bodies lofted through the local cross-sections (hinge wall, top, bottom, end caps), so the surface of the wing itself moves. The rudder is built the same way from the fin (smoothed hinge and trailing edge).
- **Spoilers looked wrong:** they are now thin plates lying on the upper skin, hinged at their forward edge (4 per aircraft: 2 inboard ground spoilers that rise only on the ground, 2 outboard flight spoilers that follow the speedbrake and the roll command), instead of ragged groups of triangles.
- **Gear:** the earlier version grouped the wrong parts (nose cone parts, door fairings) and pivoted around the wrong point. The supplied mesh's gear parts were identified individually: nose strut+wheels (`Group_102`), each main leg with drag brace (`Component#5_00x`), wheel/axle assemblies, and the tyres of both mains, which are one merged mesh (`Group_001`) that is now split into left and right halves. Each main gear swings inboard about the top of its strut; the nose gear folds forward about its attachment, steering when down. Headless frames at 70 %, 45 % and 20 % extension show a continuous fold. Still simplified: the thin outboard door panels travel with the leg and the inboard doors stay fixed (no door sequencing).
- Remaining known gaps: engine fans, reversers and wheel spin do not animate; rudder deflection is subtle on screen.

## Update 22 — rudder
- The rudder was squiggly because its hinge line and trailing edge followed noisy per-height samples of the fin mesh. They are now straight least-squares fits (the fin's edges are straight), with the hinge 30 % of the chord ahead of the trailing edge and a linearly tapering thickness. Headless screenshots at neutral and 0.45 rudder show a straight, clean trailing edge; the deflection itself is still subtle to see from the side.

## Update 23 — Scotland world (one map, three detailed airports)
- **One world instead of per-airport regions.** Shared frame: transverse Mercator at the EGPH ARP (Edinburgh data unchanged). `public/data/scot/`: regional terrain + land cover **800 x 800 km at 500 m** (`tools/build_scotland.py lo`; covers all of Scotland, Orkney (not Shetland), the Hebrides, northern England and most of Northern Ireland; total 5.1 MB + 0.2 MB), and 30 m terrain / 20 m land cover / 6 m Sentinel-2 imagery / roads / buildings / airport patches around **Edinburgh** (±24 km, the earlier data), **Glasgow** (±14.4 km) and **Portmoak** (±12.5 km, grass launch line as in update 17, rebuilt in the shared frame). Whole `dist/data` is ~30 MB loaded at start-up (no streaming yet; local load 5.5 s).
- **Glasgow (EGPF):** runway 05/23 from OurAirports (8,730 ft, 980 ft displaced on 23; the closed 09/27 is omitted), 44 OSM gates, jet bridges, 11 airliner gate stands (derived the same way as Edinburgh), terminal/pier heights are estimates as at Edinburgh. Buildings are kept only within 5 km of the airfield (Glasgow city has 269,000 footprints: too heavy), roads without service lanes, so the 3D city beyond 5 km is absent. Imagery: Sentinel-2 tiles 30UUG + 30UVG, 16 May 2025 (about 90 % covered; a black edge is possible near the patch margin). Frequencies in `airport.json` are from memory and **unverified**.
- **Altitude-dependent detail:** terrain LOD distances are scaled by (1 + altitude / 3,500 m), so the higher you fly the coarser (fewer, larger squares) the ground becomes; regional chunks beyond 230 km are not drawn. Regional terrain under a patch is lowered 40 m in the *rendered* mesh only (physics uses the patch).
- **World/physics:** `Terrain` holds several patches plus the regional grid; `World.airports`, `setAirport()`, `isPaved()` / `landAt()` cover all patches. Menu: Airport Selection chooses where you start (Edinburgh, Glasgow, Portmoak); World Map is the whole of Scotland (click to start airborne); the minimap shows imagery inside a patch and a coarse land-cover map elsewhere. The old per-airport region switching is gone (`public/data/egph`, `egpm` removed; the pipeline scripts for them remain in tools/).
- **Tests (94 pass):** new `tests/scotland.test.ts` (three airports, threshold heights within 15 m of published elevation, 737 on Glasgow asphalt, Portmoak winch launch on grass). Existing Edinburgh tests run against the new world unchanged.
- **Not done / limits:** no streaming of patches (everything loads up front, ~30 MB); no satellite imagery or 3D buildings outside the three patches (land-cover colours only); thermals are not tied to ground type; real-GPU and phone frame rates NOT TESTED (software render: terrain ~50-60k triangles, ~200-450 draw calls in the views I checked); the UK south of the map edge (about 52.5°N) is not included.

## Update 24 — streaming (less lag)
- **Detail patches now stream with the aircraft.** Only the patch you start in is loaded at first (start-up download 19 MB instead of ~30 MB: regional terrain 5 MB + Edinburgh 12 MB + code). A patch (30 m terrain, land cover, buildings, imagery, roads, airfield lights, jet bridges, minimap tile) is loaded when the aircraft comes within 12 km of its terrain square and released when it is more than 30 km away (hysteresis). Choosing an airport in the menu or starting there loads it first (`fly()` is async and waits). Per-airport data that stays resident: the small `airport.json` files (runways, gates).
- **Regional terrain** is drawn only within about 45 km of the aircraft (plus 14 m per metre of altitude, so more of it as you climb): a block of about 5 x 5 squares of 20 km at low altitude; farther chunks are released (their geometry is freed) and come back as you approach. Terrain detail still coarsens with altitude.
- Overlapping patches (Edinburgh/Portmoak overlap by ~10 km): the later patch wins; covered chunks of the earlier patch are hidden. Physics and rendering use the same priority.
- Resolution cap: the renderer pixel ratio is capped at 1.5 (was 2) because retina screens at 2x cost a lot of fill rate with the terrain shader; Settings -> render scale still applies on top.
- Headless check: Edinburgh -> Glasgow -> Edinburgh -> Portmoak transitions load/unload exactly as above with no errors; `tests/scotland.test.ts` checks unload/reload restores terrain and buildings (95 tests pass). **Frame rate was NOT measured on a real GPU** (software rendering only), so how much smoother it is on your machine is unconfirmed. Loading a patch builds its meshes in one go, so a short hitch is possible when you cross into a new airport area.

## Update 25 — landing flare assist removed; cockpit model received (not integrated)
- **Removed** the landing flare in the auto-trim (powered aircraft: descent easing below ~60 ft AGL; glider: below 10 m) and its test; the auto-trim itself (hold vertical speed / airspeed at stick release) and the mobile wings-level assist are unchanged. Hard landings are no longer softened: a 600 fpm arrival stays at ~600 fpm. 93 tests pass.
- **737 cockpit model (`B737-800 Cockpit Final Product for sale.fbx`, 35 MB) is NOT integrated yet.** Findings: 1,679 meshes and 1.75 M triangles (far too heavy for phones and heavy for desktop without merging/decimating); generic part names (Cube847, Cylinder738 ...) so yoke, throttle, switches and screens would have to be identified by position; Blender-origin texture paths only (embedded textures not found); the file name says "for sale", so its licence was unknown at the time; the user has since confirmed commercial-use approval (see Update 26).

## Update 26 — detailed 737 cockpit integrated (desktop)
- **Licence:** the cockpit FBX is a third-party "for sale" model; the project owner confirmed they hold approval for commercial use, so the converted mesh is shipped in `public/models/` (`cockpit737.json/.bin`). Keep that approval on file with the original purchase/licence.
- **Conversion (offline, not in the repo):** 1.75 M triangles -> ~187 k static + moving parts (~255 k total), 7.9 MB, vertex colours only (textures were not supplied), identified by position because part names are generic. Thin details (lettering, small switch labels, window posts) were merged by vertex clustering, so some posts and panels look chunky/low-poly and a few unused vertices were NaN (their triangles removed).
- **Animated from the simulation:** both control wheels (roll turns, pitch moves fore/aft, incl. autopilot output), both thrust levers, speedbrake lever, flap lever, gear lever (up/down), stabiliser trim wheels. The control columns themselves are part of the static mesh (only the wheels move).
- **Screens:** the existing live PFD / ND / engine display canvas is mapped onto the five model screens (captain PFD+ND, centre EICAS, first officer ND+PFD) and the MCP strip (heading/altitude/V-S readouts). Screen and MCP positions were **estimated from a screenshot**, not measured; they may be a few cm off the bezels. Clicking on the cockpit panels is not available in this model (use keyboard/menus as before).
- **Eye position** aligned to the 737 eye point (raised 0.18 m above the model's seat reference so the PFD is visible over the wheel).
- **Phones/tablets (touch):** keep the simple procedural cockpit (the detailed one is desktop-only for performance). Desktop frame-rate with the detailed cockpit is **NOT measured on a real GPU** (only software rendering).
- Not done: switch/knob animation on the overhead and pedestal, rudder pedals, working lighting on panels at night (it uses plain scene lighting + a small emissive fill), windows/pillars quality.
- 93 tests pass; tsc clean; headless screenshots checked (no console errors).

## Update 27 — 737 cockpit roof
- The cockpit model had no roof (open sky above the pilots). Added a plain dark headliner that follows the model's own roof line (side walls, overhead panel, windshield header). It stops about 0.6 m behind the windshield header, so a thin gap of sky can show above the header at the front-left. Checked in headless screenshots only (looking up, forward, left, right).

## Update 28 — Portmoak: retrieval buggy, harder winch launch, trees and field scenery
- **Winch launch is faster and steeper:** cable speed target 34 m/s with a 1.4 s ramp (was 28 m/s over 3 s), up to 7.5 kN pull, driver backs off above ~72 kt. Headless test (pilot holds 40 deg nose-up above 8 m): peak ~73 kt on the cable, ~580 m AGL at release, cable cut at 38 s. Real launches peak ~60-65 kt and reach roughly 300-400 m on a 1.4 km cable; **this is stronger than real**, tune after you try it. While the cable pulls, the camera widens (+16 deg FOV) and shakes, scaled by speed.
- **Retrieval flow (gliders):** the START WINCH LAUNCH button only appears when the glider sits on a launch point (just inside a runway end, facing along the runway; the "Runway N winch launch" start is one). Anywhere else on the ground the button reads GET THE BUGGY: a kinematic buggy appears beside the glider (chase camera, 1-9 speed, mouse/arrows steer, Space brakes, no reverse). Drive its tow hitch to within 10 m of the glider nose -> HOOK UP; the glider is pulled on a slack-capable rope (physics, not teleport); tow it to the orange cones/board at a runway end -> UNHOOK AND GET IN (the glider is set on the launch point, buggy parked beside it) -> START WINCH LAUNCH. LEAVE THE BUGGY cancels. Winch launches are not blocked in the air or elsewhere except by this button logic.
- **Portmoak scenery:** ~6,000 low-poly trees (conifer and broadleaf) placed on the land-cover "tree" class within 2.4 km, kept off the runway corridor and building footprints; orange cones and a sign board at both launch points; an animated windsock (follows the weather wind direction and strength); six parked gliders near the field. Existing OSM-derived buildings (74) are unchanged: **no hangars/clubhouse were modelled by hand**.
- Tested: headless full sim of a buggy towing the parked glider 220 m on flat ground (glider follows within ~10 m, no upset; `tests/glider.test.ts`); in the browser the buggy drive-up and hook-up were checked, but the **tow-to-cones/unhook/get-in step was not completed in a browser run** (software rendering is too slow to script it), so that last step is only covered by code review.
- Not done / not tested: real-GPU frame rate with the trees; the towed glider's handling over rough ground at speed; reverse gear for the buggy; aerotow; the winch vehicle itself is not drawn (the cable ends at an anchor 1.4 km ahead); phone UI for the buggy was not tested (it reuses the tug controls).

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
