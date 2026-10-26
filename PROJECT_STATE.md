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

## Update 29 — Portmoak runway more visible
- The grass runway is now drawn: light mown strip with mowing stripes, white edge lines (about 1.4 m wide), 4 m threshold bars and large runway numbers (10 / 28, readable from the approach end), visible from several km. Windsock is larger (9 m pole). Checked in headless screenshots (ground and 600 m orbit view); numbers read correctly from the 10 end, the 28 end was not viewed. Friction/physics of the grass are unchanged.

## Update 30 — Graphics overhaul, phase 1: inspection + first lighting/preset slice
**Inspection result (what the renderer is):** plain three.js (r17x, WebGL2, `WebGLRenderer`, log depth buffer, no post-processing composer, no WebGPU). Already present: ACES filmic tone mapping, sRGB output, PMREM image-based lighting from a procedural sky (`render/environment.ts`), one sun directional light with a 2048 shadow map (PCF), hemisphere light, volumetric-looking cloud sprites, rain, runway/taxiway light points, terrain shader with land-cover, 6 m Sentinel-2 imagery, roads, water normal animation, wet surfaces, and a debug overlay with FPS / draw calls / triangles (`perfEl`). Missing or weak (seen in baseline screenshots): no normal/roughness/AO texture maps anywhere (materials are flat colours or vertex colours; the 737 exterior and cockpit are untextured), no ambient occlusion or screen-space reflections, no reflection probes beyond the sky environment, buildings are extruded footprints with procedural windows, no ground vehicles or traffic, no vegetation at EGPH, the near ground imagery smears when magnified (6 m/pixel), sunset/night ground is very dark, no wing flex/engine fans/wheel spin on the 737.
**Baseline measurements (software rendering only, 1100x620, 737 on EGPH 24):** ~600 draw calls, ~0.53 M triangles per frame. **No real-GPU frame rate has been measured.**
**Implemented and visually checked this step:**
- Night town lights were rendered as flat 9 m tan squares on the ground (terrain shader); now small warm lamp points. Before/after screenshots compared.
- Night/dusk visibility: hemisphere-light floor 0.15 -> 0.4, environment-light floor 0.1 -> 0.3, and eye adaptation (exposure x (1 + 1.6 x night)). The 737 hull and runway markings are now faintly visible at night; the ground beyond the lights is still very dark, and the sunset ground is still dark (sky is brighter than the ground there). **Not solved.**
- Graphics presets LOW / HIGH / ULTRA (Settings -> Graphics buttons): LOW = 0.7 render scale, no shadows, terrain detail 0.7, buildings 6 km; HIGH = default (2048 soft shadows); ULTRA = 4096 soft shadows, terrain detail 1.5, buildings 20 km. New settings: soft shadow edges (PCF soft) and shadow map size. Preset buttons and the sliders were built and compile; **only a headless run of the page was done, the preset buttons were not clicked in a browser and ULTRA's cost is unmeasured.**
- Files modified: `src/render/terrainMesh.ts`, `src/render/environment.ts`, `src/main.ts`, `src/ui/menu.ts`.
- New textures/models: none (no third-party assets added this step).
**Remaining (not started), in the order I recommend by visual payoff:** (1) sunset/night ground lighting curve and imagery sharpening (detail-texture overlay on the 6 m imagery); (2) 737 exterior PBR: roughness/metalness per part, panel-line normal map, engine fan, wheel spin, landing-light cones; (3) Edinburgh airport ground: asphalt/concrete detail textures with seams, apron slabs, service vehicles (instanced), fences and signage; (4) trees/vegetation at EGPH (the Portmoak tree system can be reused); (5) ambient occlusion and cloud shadows on terrain; (6) cockpit night lighting (instrument flood), display glass reflections; (7) wing flex, gear suspension animation; (8) camera shake on touchdown/turbulence. Each needs real-GPU timing before it is called complete.
**Next recommended step:** (1) then (2).

## Update 31 — graphics, daytime: ground detail, trees at all airports, apron slabs, service vehicles
(Night work skipped at the owner's request.)
- **Terrain/ground shader** (`render/terrainMesh.ts`): close-range blade/tuft-scale brightness variation on grass, soil and crops (fades out 70-420 m); asphalt grain and blotches; **concrete aprons now have 7.5 m slabs with joints, per-slab tone and oil/weathering stains** (visible in screenshots). The imagery itself is still 6 m/pixel, so far ground still looks soft/smeared; the new detail is visible mostly on aprons and close to the camera, **only subtly on grass** (not a big grass improvement).
- **Trees** now around all three airports (previously Portmoak only): about 3.2 km radius at Edinburgh/Glasgow (one tree per 20 m cell on land-cover "tree" cells, ~62 % thinned), 2.4 km at Portmoak; instanced, kept off runways and building footprints. Screenshots show tree lines along the airfield edge and field boundaries.
- **Ground service vehicles** (`render/groundVehicles.ts`, new): at every airliner gate site, instanced low-poly ground power unit, baggage tractor with one or two carts and a fuel truck under the right wing (random subset). Original geometry; placement is approximate and illustrative, not real traffic. No moving traffic yet; pushback tug at stands is not drawn.
- Files modified/added: `src/render/terrainMesh.ts`, `src/render/groundVehicles.ts`, `src/main.ts`.
- No new textures or third-party assets. **Frame rate not measured on a real GPU**; the software-render draw-call count was ~600 before these additions (trees and vehicles add a handful of instanced draw calls but tens of thousands of triangles; headless numbers after the change were not recorded).
- Not done from the graphics brief: 737 exterior PBR maps/panel lines, engine fan and wheel spin (the supplied model merges the tyres and legs into single meshes, so spinning them needs the mesh split first), wing flex, cloud shadows on terrain, ambient occlusion/SSR, texture compression, cockpit glass reflections, moving traffic. Several OSM buildings sit in the middle of some aprons (visible at one gate); they come from the map data and were not removed.
- **Next recommended step:** 737 exterior materials (panel-line normal map, per-part roughness/metalness), then cloud shadows on the terrain.

## Update 32 — visible sun
- Added a sun disc (1.6 deg bright core) with a wide soft glow (about 22 deg) in the sky, following the real sun position used for lighting and shadows (`render/environment.ts`). It is hidden below the horizon, turns warmer when low, is dimmed in overcast, is hidden behind terrain and buildings, and clouds are drawn over it. Checked in headless screenshots looking at the sun (clear sky, partly cloudy sky, low evening sun). No lens flare, no glare when looking directly at it, no god rays. Frame cost: two sprites.

## Update 33 — aircraft reflections
- The real 737 model arrived with Phong materials (no sky reflections at all, hence "no shine"). They are converted at load into physically based materials: clear-coated painted aluminium for the white paint, glossy glass for the windows, metallic roughness for engines/gear/wing hardware, matt rubber for tyres and dark trim (chosen by each material's colour, not hand-assigned per part, so a few parts may look slightly off).
- All aircraft materials (737, C172, glider) now get the sky environment map assigned directly (this three.js version ignores the intensity setting otherwise) with a per-material strength, and it refreshes as the sun moves (`syncAircraftEnv` in `main.ts`). Checked in headless screenshots: wing and engine metal, window glass and fuselage show sky reflections. The fuselage shine is soft (no mirror effect, as intended); there are still no real-time reflections of the ground/buildings (sky only). Not checked: C172 and glider close-ups, and cost on a real GPU (a handful of extra shader features on about a hundred materials).
- Files: `src/render/b737Model.ts`, `src/main.ts`.

## Update 34 — shadows and a stand marshal
**Shadows.** Shadows were being cast but were faint and only covered a 90 m box. Changes: shadow area 280 m (was 90 m); thin overcast now dims the sun by 40 % (was 75 %), sun strength 3.0 and ambient fill lowered (hemisphere 0.36, sky-light 0.30) so shadows have contrast; slightly larger shadow bias for the bigger area; a soft dark contact-shadow ellipse under the aircraft that fades with height. Headless screenshots show the 737's wing/tail/fuselage shadows clearly on the runway; the contact shadow is subtle. The overall scene is a little darker/more contrasty than before. **Not done:** trees do not cast shadows (about 240 k instanced triangles in the shadow pass would be too costly without a real-GPU measurement); shadows reach only ~140 m from the aircraft, buildings farther away cast none.
**Stand marshal (737 only, at every gate at EGPH/EGPF).** A hi-vis ramp marshaller with two lit wands (drawn about 1.35x life size) stands 24 m ahead of the stand and signals to you as you taxi in; a line at the bottom of the screen says the same in words. Logic (`sim/marshal.ts`, 8 unit tests): the gate ahead of you within 450 m is picked automatically; signals are come ahead, turn left, turn right (one arm out, the other beckons, from the pilot's point of view), slow, stop (wands crossed), cut engines, parked / chocks in, and overshoot. It calls "turn" from your offset from the stand centreline and heading, "slow" within ~12 m, "stop" at the mark, then asks for the parking brake (K) and engines off, and hides once the jet bridge connects. It is also hidden while pushing back or driving the glider buggy. Checked in headless screenshots at the gate (turn left / turn right poses and text). **Not tested:** a full taxi-in by a human pilot, the wording on phones, other-aircraft stands (C172 and glider have no marshal), taxi guidance from the runway to the gate (the marshal only appears within ~450 m of a gate, no follow-me car), and whether the stop mark lines up with the jet bridge door by a metre (it uses the same stand position the bridge code uses).
Files: `src/sim/marshal.ts`, `tests/marshal.test.ts`, `src/render/marshalFigure.ts`, `src/render/environment.ts`, `src/main.ts`.

## Update 35 — "Easy flying (GeoFS-style)" option
- Settings -> Controls -> **Easy flying (GeoFS-style)**: when on, the wings level themselves in the air when you release the stick (the phone assist, now on desktop too, up to 70 deg of bank). Auto-trim (holds pitch/vertical speed) was already on by default. Flight physics are unchanged: it only moves the ailerons for you. Off by default; remembered in the browser.
- Headless check: Cessna banked 45 deg, hands off for 10 s: stays at 44 deg without it, comes back to 28 deg with it (software rendering runs the simulation slowly, so real-time recovery will be faster).
- **Honest scope:** this is a first step toward the "GeoFS feel" only. I have not been able to run or measure GeoFS, so I am not matching its handling numbers; the interface (layout/menus) was **not** changed to look like GeoFS. Real matching needs your description of what feels different (too twitchy? too heavy? stalls too harsh? controls?) or screen recordings, then retuning the flight model and UI. GeoFS code and assets are proprietary and are not used.
- Files: `src/input/simpleControls.ts`, `src/ui/menu.ts`, `src/main.ts`.

## Update 36 — flight-physics audit and validation (GeoFS-inspired brief)
**Phase 1 inspection result (what already existed, kept as is):** fixed 240 Hz timestep (`sim/simulation.ts`, rendering interpolates), six-degree-of-freedom rigid body with quaternion attitude in SI units (`sim/fdm/aircraft.ts`), strip-theory aerodynamics with lift/drag/moment curves, stall and post-stall, sideslip, flaps, gear/spoiler drag, control-surface deflection and ground effect (`sim/fdm/aero.ts`), airspeed relative to the moving air mass with ISA density, wind shear with height, Dryden-type turbulence, thermals and ridge lift (`sim/atmosphere.ts`, `weather.ts`, `lift.ts`), a piston engine/propeller model with start-up (`piston.ts`), turbofan spool-up, altitude/speed thrust lapse and reversers (`turbofan.ts`), per-wheel spring/damper/tyre-friction/brake/steering contact (`gear.ts`), and one aircraft definition file per type (`sim/aircraft/c172.ts, b738.ts, glider.ts`). No instant-rotation or position-snapping code exists; the visual models only read the simulated state. Earlier tests already covered C172 POH performance, stability modes, 737 takeoff/landing/stability, collisions, ground handling and glider polar.
**Added this step:** `tests/flight.validation.test.ts` (7 tests, all pass; the whole suite is now 109 tests). Results:
- **A stationary:** parking brake on, neutral, 60 s on a level runway: moved 0.000 m, heading drift 0.001 deg, pitch/bank steady.
- **D banked turn:** 20 deg bank, altitude held: measured turn rate 3.49 deg/s vs theory g*tan(bank)/V = 3.52 deg/s (within 1 %).
- **E stall:** slow stick pull at idle power reaches 15 deg angle of attack at about 50 KIAS; with stick forward and power, alpha returns to 0.7 deg with no crash. (It checks a high angle of attack, not a fixed speed; it does not yet compare stalls at different load factors, wing-drop behaviour or buffet.)
- **F engine idle:** after the power chop (wings kept level as a pilot would) it glides, the phugoid damps, second-minute mean sink 1,128 ft/min at about 104 KIAS. Hands-off with no pilot input the aircraft enters a spiral dive (spiral mode, realistic) - see Known issues.
- **H wind:** headwind: TAS minus ground speed equals the modelled wind at altitude (32 kt at 4,000 ft for a 20 kt surface wind, because the model scales surface wind up with height); crosswind from the east: track 15 deg west of heading; crosswind takeoff at 15 kt with the pilot holding the centreline: max 4.8 m off the centreline on the runway, lifts off at 15 s, no crash.
- **I frame-rate independence:** a 25 s takeoff run advanced with 20, 60, 144 fps and jittery frame times differs by 0.00 m (the physics is deterministic on the fixed step).
**Changes to the code:** new setting **Settings -> Controls -> Beginner assists** (default on). Off = realistic mode: auto-trim, rudder coordination and ground heading hold are removed so nothing moves the controls for you (the 737 keeps its yaw damper, a real system). Previously these assists could not be turned off. `src/input/simpleControls.ts`, `src/main.ts`, `src/ui/menu.ts`. Not re-tested in a browser; unit tests do not exercise the assist toggle.
**Decisions:** kept semi-implicit Euler at 240 Hz instead of RK4 (stable in every test, ~15 us per step; RK4 would cost 4x for no measured gain). Kept three.js (no CesiumJS: the project's detailed local airports and tests depend on its own local world). Did not rewrite any working system.
**Known problems / honest limits:** aircraft data are engineering approximations (the C172 is checked against POH figures; the 737 uses public airport-planning dimensions and plausible performance, **not** Boeing manual data); the 737 inertia, section aerodynamics and flap/slat increments are labelled ESTIMATES in `sim/aircraft/b738.ts` (slats are modelled as a max-lift increment) and I did not verify them against published values; spiral mode makes hands-off flight diverge after a disturbance (realistic, but the default beginner assists hide it); wing flex, cockpit vibration and inertia-based camera movement are not implemented; the "GeoFS feel" cannot be compared because GeoFS cannot be run here.
**Remaining / next step:** (1) you describe how GeoFS handles differently (or send a recording) so I can retune control response; (2) stall characteristics at different loads, wing drop and buffet tests; (3) 737 flight-manual data comparison if you can supply it; (4) camera inertia and cockpit vibration.

## Update 37 — tyre smoke, quicker roll, wing flex, stall buffet, crashes off, marshal accuracy, stand lines, 737 cockpit on phones
- **Tyre smoke** (`render/tyreSmoke.ts`): grey-white puffs from both main wheels at touchdown (more for faster/harder arrivals, only above ~35 kt ground speed) and a thin trail while skidding under heavy braking. Seen in a headless screenshot behind the main gear after a forced touchdown (36 puffs). Gliders have none. Not checked on a phone.
- **Faster turning:** aileron travel raised 1.5x on the 737 and Cessna (glider 1.3x). Full-aileron roll rate after 2 s: 737 38 -> 57 deg/s, Cessna 55 -> 88 deg/s (the 737 is still clearly slower than the Cessna; both inside the existing 40-90 deg/s test limit). Roll only: pitch and yaw were not changed. 
- **Wing flex (737):** the wing tips bend up with load factor (spring-damper, so they bounce when you pull or hit gusts); none while parked or taxiing slowly. Done in the vertex shader of the 737 materials, so it costs no extra draw calls. Visible in a screenshot (tips raised in flight); amount is an estimate (about 1.1 m per g), not real wing data. Cessna and glider do not flex.
- **More noticeable stalls:** a buffet effect (`ac.buffet`, 0..1) starts about 3 deg of angle of attack before the stall-warning angle and reaches full at the stall: random-looking but deterministic shaking moments on all three axes (airframe physics) and camera shake, and a flashing red STALL banner. The airframe shake changes the physics slightly during a stall; all earlier tests still pass. Banner and shake seen in a screenshot (737 stall).
- **Crashes removed for now:** `CRASHES_ENABLED = false` in `sim/fdm/aircraft.ts`: hard landings, building and terrain impacts and ditching no longer destroy the aircraft or trigger the explosion. The crash tests are skipped (7 skipped), not deleted; set the flag to true to bring crashes back. Note: with crashes off, the aircraft can pass through objects without stopping (collision response was part of the crash path); not tested.
- **Marshal accuracy:** stop-mark tolerance and turn thresholds tightened (turn call at 3 deg instead of 7; stop if more than 0.8 m off the line within 8 m; "not lined up" if nose more than 6 deg off within 14 m). At the stop mark it now says NOT PARKED STRAIGHT (shows nose angle and offset) unless within 3 deg and 0.8 m, and only then asks for engines off and the bridge. Test: parked 29 deg sideways -> "NOT PARKED STRAIGHT - nose 29 deg right"; 9 unit tests pass. The jet bridge itself does not yet refuse a crooked park.
- **Stand lines:** every gate now has a yellow dashed lead-in line (70 m) ending in a 8 m stop bar at the stop mark, and taxiway centrelines are twice as wide (0.64 m) so they read from the air.
- **737 cockpit on phones:** the detailed cockpit model (same as desktop, animated yokes/levers, live displays) now loads on touch devices too, unless the LOW preset (render scale below 0.72) is chosen. Seen in a headless phone-size screenshot. **Real phone frame rate is NOT tested**: it adds about 235k triangles; if it is slow, use Settings -> Graphics -> LOW (simple cockpit). I could not make a lighter copy (the converter keeps ~200k triangles even at 0.02).
- Files: `src/sim/fdm/aircraft.ts`, `src/sim/aircraft/{c172,b738,glider}.ts`, `src/render/{tyreSmoke,b737Model,airportMesh}.ts`, `src/sim/marshal.ts`, `src/main.ts`, tests `marshal.test.ts`, `collision.test.ts`, `b738.test.ts`.

## Update 38 — "open roof" cause found, stall buffet softened
- **Cockpit roof:** the uploaded cockpit model does contain a roof/headliner; it was invisible from inside because its faces point outward and the renderer culls back faces. The cockpit material is now double-sided, so the full model's own roof shows (my earlier added fake roof is removed). Seen in headless screenshots (looking up and forward): the roof is a plain light-grey surface (the model has no textures); the overhead panel and glareshield are visible. This is the full converted cockpit (about 235k triangles, shown on desktop and on phones unless Settings -> Graphics -> LOW).
- **Lag:** I can only render in software here (no GPU), so I cannot tell you whether it lags on your device. Use the FPS overlay (debug key) in the cockpit view on your phone/PC; if it is slow, choose LOW (simple cockpit) and tell me the device and FPS so I can build a lighter copy.
- **Stall too early:** the buffet/shake now starts 0.5 deg of angle of attack before the stall-warning angle (was 3 deg), is weaker (shake moments ~45 % of before) and the red STALL banner only shows when really stalled (not at the early warning). Actual stall angle and speed are unchanged (aerodynamics untouched; stall test still passes).
- Files: `src/render/cockpit737.ts`, `src/sim/fdm/aircraft.ts`, `src/main.ts`.

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
