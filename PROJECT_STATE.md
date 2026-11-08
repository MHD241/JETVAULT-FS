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

## Update 42 — Clean 737 pilot view and nose gear alignment (2026-10-30)
- Detailed cockpit remains in use. The two separate animated yoke wheels are hidden in the *rendered* detailed cockpit to keep the PFD and forward view clear. This does not disable roll or pitch input. The static control columns in the third-party cockpit mesh have NOT been separated; some obstruction can remain. This is not a recreation of the GeoFS cockpit.
- 737 pilot-eye view set at body (14.47, -0.53, -0.93) vs the aircraft definition (14.2, -0.53, -0.72); default head pitch relaxed from -0.32 to -0.18 radians. These are presentation/camera changes only.
- Procedural 737 nose-gear mount lowered 0.07 m (body z 1.60 to 1.67), to align the tyre's lowest point with the flight-model 4.05 m contact plane. Main gear is unchanged: nominal wheel bottom = 1.50 + 1.99 + 0.56 = 4.05 m. The supplied glTF lacks gear geometry; true gear-to-fuselage visual alignment still requires an external side-view screenshot.
- Verification: static source review and arithmetic only. TypeScript, unit tests, build, and browser screenshot NOT RUN in this environment; Node modules unavailable. No claim of visual correctness. Full project packaged with existing internal paths preserved.
- Next: inspect visual result on user's machine/browser; adjust gear attachment positions in model frame if still offset; consider optional cockpit clean/detailed toggle once browser tested.

## Update 39 — new 737 exterior (supplied glTF)
- Your `b737.glb` is an old **glTF 1.0** file, which three.js cannot read, so I upgraded it to glTF 2.0 with `gltf-pipeline` and shipped it as `public/models/b738_geo.bin (a .glb renamed so it can be published)` (0.8 MB, 13k triangles, textured; the old `b738.fbx` stays in the repo and loads with `?oldmodel` in the address). The whole plane is one mesh: it is the **default 737 exterior now**.
- Fit: scaled to the 737's 35.79 m wingspan (the model is shorter than a real -800: 34.9 m long), nose and wing sit where the flight model expects, wheels touch the ground in screenshots. The file has a stray 1-triangle outlier below the plane, which I ignore.
- **What is lost compared with the previous model:** the file has **no separate control surfaces, flaps, spoilers or gear**, so ailerons, elevators, rudder, flaps and slats no longer move on the outside (the cockpit controls still move). I kept the procedural landing gear (it retracts, steers and compresses with the flight model) because the glTF has none; it looks plainer than the rest. The livery in the texture (a blue nose cone and blue cheat line) is whatever airline paint the file has; I did not repaint it. Engine fans do not spin.
- **Licence warning:** the file looks like it comes from a flight-simulator project (AC3D-style material names). I do not know its licence; before you publish or sell the game, confirm you may use it (as you did for the cockpit) and keep that on record.
- Files: `src/render/b737Model.ts` (`loadGlb`), `src/main.ts`, `public/models/b738_geo.bin (a .glb renamed so it can be published)`.

## Update 40 — 737 flight deck look and camera
- Flight-deck colours are remapped to a dark charcoal palette (light-grey trim and switch caps stay lighter), the material is darker and matt, so the deck reads as a real 737 instead of white. Eye point moved back/up (14.0, -0.53, -0.82 m body frame), cockpit field of view 82 deg and looking slightly down, to frame glareshield, both displays and the wheel like your GeoFS reference. Checked with headless screenshots (looking up); I did not capture the exact straight-ahead framing, so the camera match is approximate.
- Not done: your reference shows textured panel faces (printed labels, gauges); this model has no textures, so panels stay plain dark. No GeoFS assets are used. Also this update's small earlier changes (body lowered onto the gear, darker deck) are covered here.
- Files: `src/render/cockpit737.ts`, `src/sim/aircraft/b738.ts`, `src/main.ts`.

## Update 41 — cockpit camera and pillars
- Eye set to (13.75, -0.53, -0.74) body metres, field of view 76 deg, pitch -0.17, to match the layout of the GeoFS reference screenshot (both displays and pedestal in the lower half, runway through the windshield). The window pillars/roof-corner struts ahead of the pilot and outboard of 16 model units are deleted from the static mesh (`render/cockpit737.ts`), so the roof edge above the windshield is ragged where they were. Checked in one headless screenshot at the runway start.
- **Not "exactly" the reference:** GeoFS uses a textured, differently proportioned cockpit; this model has no textures, so panel labels, gauges and shading differ. The match is the camera framing and dark colour scheme only. The control wheels are hidden by the cleanView setting (added by another editor of the repo); say if you want them back.

## Update 42 — own flight deck replaces the third-party cockpit model
- New `src/render/cockpitOwn.ts`: an original 737 flight deck built in code (no third-party assets): glareshield, sloped main panel with six display bezels and a canvas-drawn panel texture (labels, standby gauges, gear panel, knobs, rows of lights), live PFD/ND/EICAS/MCP from the existing instrument canvas, overhead panel with texture and 96 instanced toggle switches, centre pedestal with CDUs/radio texture, windshield frame (header, two A-pillars, centre post), side-window frames, side consoles, seats, floor and ceiling. Animated from the simulation: both control wheels (pitch moves the column, roll turns the wheel), thrust levers, speedbrake, flap lever, gear lever, trim wheels.
- It is now the default 737 cockpit on desktop and phones (`?oldcockpit` in the address loads the previous third-party model). Camera eye 13.75/-0.53/-0.74 m, FOV 76 deg. Checked in one headless screenshot (forward view): displays show live data. Not checked: looking sideways/up at the overhead, the night look, frame rate on real devices (it is far lighter than the old model: a few thousand triangles).
- Honest limits: stylised proportions drawn from public 737NG layout knowledge and the GeoFS reference picture only for layout, not copied; no side-window glass, no seat detail, panels are simple; no clickable switches; overhead switches are static. Needs your feedback on proportions and what to add (more panels, chrome, lighting at night).
- Files: `src/render/cockpitOwn.ts`, `src/render/b737Cockpit.ts`.

## Update 43 — yokes
- The round steering-wheel rims are replaced by Boeing-style control yokes (U-shaped bar with upturned grips, hub and trim dial) on both sides, moved 0.3 m forward (column base x = 14.72 m) so they sit close to the panel and out of the pilot's face. Pitch still moves the column and roll turns the yoke. Seen in a headless screenshot looking down at the panel. File: `src/render/cockpitOwn.ts`.

## Update 44 — cockpit gaps closed, black colour scheme
- Gaps closed: filler panels between the main panel ends and the walls, a bulkhead behind the glareshield, a footwell board under the panel, and the side consoles and pedestal now extend to the panel face. Checked in headless screenshots looking forward and sideways; I did not re-check every angle after the last tweak (looking up at the overhead and straight down).
- Colours: all cockpit materials and textures changed to near-black (panel #14161a, trim #24272b, seats black) with minimal sky reflection, so the deck no longer looks white/light blue under the daytime sun. Tell me if it is now too dark and which parts to lift.
- File: `src/render/cockpitOwn.ts`.

## Update 45 — yokes, thrust levers, speed, stall, takeoff feel
- **Yokes** 1.55x bigger (seen in a screenshot). **Thrust levers** rebuilt: taller tapered levers with ribbed grips, a TOGA button, slotted quadrant, longer speedbrake and flap levers (`render/cockpitOwn.ts`). I could not get a clear screenshot of the new levers (the camera sits behind the panel edge), so their look is **not visually verified**.
- **Why it stopped at ~200 kt:** the hands-off auto-trim holds vertical speed, and the wing stalled at 12 deg with the engines at 131 kN each. Now: engines 172 kN each (737-800 CFM56-7B27 takeoff rating is about 121 kN, so this is deliberately stronger than real, as you asked), wing max lift raised (clMax 1.5 -> 1.78) so it stalls later, stall-warning angle 12 -> 15 deg. New test run, 3,000 ft, full power, auto-trim: 200 -> 546 KIAS in 150 s (before: stalled and shook at about 200). 
- **Speed ceiling:** added compressibility drag above Mach 0.72 for jets so it cannot reach silly speeds: at 30,000 ft full power it climbs to about 491 KTAS (Mach 0.84) in 250 s and keeps rising slowly. Not tuned to real Mach 0.82 cruise, and the low-altitude top speed (above the 340 kt design limit) is still unrealistically high: there is no structural over-speed warning.
- **Stall less sensitive:** later stall as above; shake/banner unchanged (they start at the stall).
- **Takeoff feel:** liftoff test now about 26 s (was 39 s; the old test limit of 28 s was lowered to 22 s). Taking off, the camera has a light, speed-scaled rumble and the field of view widens by up to 7 deg as you accelerate (`main.ts`). Amounts are small by design; not checked on a real device.
- Files: `src/sim/aircraft/b738.ts`, `src/sim/fdm/aircraft.ts`, `src/main.ts`, `src/render/cockpitOwn.ts`, `tests/b738.test.ts`.

## Update 46 — Cockpit Studio
- New 3D editor `studio.html` (+ `src/studio/studio.ts`, `src/studio/parts.ts`) for hand-building the flight deck. Shapes: rounded box (round edges and smoothness sliders), rounded cylinder (round edges), sphere, cone, ring, capsule/handle, flat panel, **live screen** (shows the game's PFD / ND / engine display / autopilot panel). **Connectors**: a tube joining two parts, follows them when moved. Tools: move/rotate/size gizmo (W/E/R), snap (1 cm / 5 cm / off), duplicate, mirror left-right, delete, undo/redo (Ctrl+Z / Ctrl+Y), part list and numeric fields, colour/roughness/metal/glow, save/load a `.json` file, export `.glb`, autosave in the browser. A blue dot marks the pilot's eye and an arrow the nose.
- **Use in the game:** the "Use in the game" button saves your design for the 737; the game (same browser) then builds it instead of the built-in cockpit (`src/render/cockpitCustom.ts`; turn it off again in the studio). Checked headlessly: added shapes, made a connector, switched it on, and the game showed the live PFD on my test screen part. Studio axes: X forward, Y up, Z right, origin on the floor at the pilot seat; mapped to the aircraft body frame in the game.
- **"Only me":** a passcode you choose on first visit (stored hashed in this browser). This is **not real security**: anyone who can open the page can bypass it, and a design lives in your browser's storage, so use "Save file" for backups and to move it to another device. Real protection would need a login on a server or private hosting.
- Not yet: parts do not animate (yokes, levers, gear lever stay still in your cockpit), no grouping, no extrude/lathe sketching, no textures/labels, no multi-select; the studio page itself is not linked from the game (open `studio.html` by its address).
- Open: how to open it on the published page (the artifact viewer serves it as a separate page).

## Update 47 — placeable eye in the Cockpit Studio
- The blue pilot-eye ball in the studio is now a real object: click it (or "Select eye (camera)"), drag it with the gizmo or type X forward / Y up / Z right, "Reset to default seat" undoes it, "View from eye" looks from it. It is saved in the design (`design.eye`) and the game uses it as the 737 cockpit camera when "In the game" is ON. Test: eye set to (1.2, 1.3, -0.53) in the studio -> game camera at body (14.7, -0.53, -0.85), exactly as converted. The look direction is unchanged (forward, with the normal head-look). Files: `src/studio/studio.ts`, `src/studio/parts.ts`, `src/main.ts`.

## Update 48 — studio shapes and credit
- Capsule is now free-form: the size snap on the resize gizmo is off for every shape, and the capsule has radius, length (0 allowed), and independent width/depth stretch with fine steps (0.0005 m).
- New shapes: **Hollow sphere** (radius, wall thickness, opening angle: 0 = closed shell) and **Hollow capsule** (radius, length, wall thickness; open at the top). Seen in a headless screenshot of the studio. Not checked: inner-wall shading in the game, and very thin walls at small sizes.
- Credit added to the game's About page, the studio's side panel and the third-party notes: "Boeing 737-800 Cockpit" (https://skfb.ly/oSGxK) by hakai315 is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/). CC BY 4.0 also asks you to say if changes were made: the model was converted, simplified and recoloured here; add that wording if you publish. The About text still says the 737 exterior's licence is unverified.
- Files: `src/studio/parts.ts`, `src/studio/studio.ts`, `src/ui/menu.ts`.

## Update 49 — import .glb into the studio
- Studio button **Import .glb**: pick a glTF-binary 2.0 file; it becomes a part (moved/rotated/sized like any other, Scale field and Size gizmo; first fit to about 40 cm). Models are stored in the browser's IndexedDB (`src/studio/modelStore.ts`), shared with the game; **Save file** embeds them in the `.json` (the file gets large), **Load file** restores them. Old glTF 1.0 files are refused with a message (your first 737 file was one; convert it in Blender or similar). Tested headlessly: imported a 0.8 MB glb, it appears and selects in the studio; the game loaded with it switched on and showed no errors. **Not verified:** that the model is visible from inside the cockpit view (my test used the chase view), animations inside the glb are ignored, textures are kept but not lit specially, very large files may be slow.
- Files: `src/studio/modelStore.ts`, `src/studio/parts.ts`, `src/studio/studio.ts`.

## Update 50 — easier to find an imported model
- After importing, the studio now reports meshes, triangles and the original size, refuses empty or compressed (Draco) files with a clear message, draws a blue bounding box around the selected part, and has **Focus selected (F)**. Headless test: a 13k-triangle model imports at 40 cm and F frames it. Likely reasons you could not see yours: it was only 40 cm at the pilot's right and small in a big grid, or the studio and the game were opened from different web addresses (browser storage is per address, so a model imported on one is not visible on the other; open both from the same site).
- Files: `src/studio/studio.ts`, `src/studio/modelStore.ts`.

## Update 51 — the supplied full cockpit (glb) is the game's 737 flight deck
- Your `boeing_737-800_cockpit.glb` (86 MB, 2,319 meshes, **1,746,324 triangles, none removed**, no textures) is now the default 737 cockpit in the game (`src/render/cockpitFull.ts`, file `public/models/cockpit_full.bin`, a renamed .glb). It is the same model as the original FBX at 0.01685 m per unit (my earlier conversion used 0.04 m, so that cockpit was 2.4 times too big). Colours are darkened (not black: the model has no textures), surfaces are double-sided (so the roof shows), the 2,319 meshes are merged per material (about 100 draw calls) and every triangle is kept. Yokes, thrust levers, speedbrake, flap lever, gear lever and trim wheels are separate groups and still move with the sim; live PFD/ND/engine/MCP screens are mapped onto its displays. Eye point (14.0, -0.53, -0.78) in the seat. Headless screenshot: runway through the windshield, glareshield, both screens and the yoke in view.
- **Performance NOT measured on a real GPU/phone:** about 1.75 M triangles in the cockpit alone plus the world; first load downloads 86 MB and takes several seconds to merge (memory roughly 200 MB). Use Settings -> Graphics -> LOW (render scale below 0.72) to get the simpler cockpit if it lags.
- **Hosting:** 86 MB is over the 15 MB limit of the Claude artifact page, so the published artifact does NOT contain it and falls back to my built-in deck. It works from the repository build (GitHub allows files under 100 MB; Git will warn above 50 MB) or any static host. Your own studio design is only used with `?mycockpit`; `?owncockpit` shows my deck; `?oldcockpit` the first converted model.
- Not done: the screens were placed from my earlier estimate, so they may be a little off the bezels (the captain's PFD is partly hidden behind the yoke in the default view); no CC-BY change notice beyond the About-page credit.
- Files: `src/render/cockpitFull.ts`, `src/render/b737Cockpit.ts`, `src/render/cockpitCustom.ts`, `src/main.ts`, `public/models/cockpit_full.bin`.

## Update 52 — original cockpit colours, whole-yoke movement, centre-soft controls
- **Original colours:** the full cockpit now uses the model's own material colours, roughness and metalness, unchanged (my darkening is removed), so it looks light grey / white-ish in daylight like the file itself. Tell me if you want it darker again: it is one line in `src/render/cockpitFull.ts`.
- **Whole yoke moves:** the control column (the stick below each wheel) is now part of the yoke: in pitch the whole column and wheel swing about the column's foot, in roll the wheel turns about its axle (checked in a screenshot with full pitch and roll). Both captain's and first officer's yokes. The column pieces were found by inspecting the model (meshes `Cylinder126` and `Cylinder129`); anything else attached to the columns is not moved.
- **Less sensitive near the centre:** mouse and touch-joystick pitch/roll now use a response curve (30 % linear + 70 % cubic): near the centre the aircraft moves much less per mouse movement, full deflection is still reached near the edge. This changes the feel of every aircraft. Not flown by hand; if it is now too dull or too twitchy at the edge tell me and I will retune the mix. Files: `src/input/simpleControls.ts`, `src/render/cockpitFull.ts`, `src/render/b737Cockpit.ts`.

## Update 53 — ground lines no longer sink under the apron
- Cause: with the logarithmic depth buffer, polygonOffset has no effect, and the terrain mesh at range is coarser than the real ground, so painted lines (stand lead-ins, stop bars, taxiway centrelines, runway paint) disappeared into the floor at a distance and from low angles. Fix: the line and runway materials now pull their fragments slightly towards the camera in depth (`paintOnTop` in `src/render/airportMesh.ts`, about 0.4 m at 100 m, more with distance). Checked in two headless screenshots at a gate: the lead-in line, stop bar and centreline are continuous. Not checked: other airports at night, or very long taxiway runs.

## Update 54 — real 737 cockpit colours
- The model has no textures, so its colours were plain light grey. I sampled the colours of a real 737NG flight-deck photo you showed (instrument panel #44484a, glareshield #43474e, overhead #42423e, pedestal #48443f, walls/trim #8a8883) plus a dark floor (#3a3835, my guess) and applied them by region to the model's large surfaces as vertex colours (`src/render/cockpitFull.ts`). Small parts (switch caps, labels, keys, yoke, displays) keep the model's own colours. Checked in one headless screenshot: charcoal panels, dark overhead, grey walls.
- **Limits, honestly:** this is a region-based approximation from one photo, not an exact copy: real cockpits have printed panel markings, painted panel sections and two tones that this untextured model cannot show; lighting in the sim and in a photo differ, so the on-screen result will not match pixel for pixel. If a region looks wrong (say which: overhead, panel, walls, floor) I can retune its hex colour. Only visible with the full cockpit file (repository build).

## Update 55 — build stamp
- A small "build <commit> <time>" label now shows at the bottom right of the game (and in the browser console) so we can tell which version a browser is really running (reports of a white cockpit after the colour update could be a cached old build). `vite.config.ts`, `src/main.ts`.

## Update 56 — glider cockpit and a packed Edinburgh
- **Glider cockpit** (`src/render/cockpitGlider.ts`, original): ASK-21-style front seat: white-grey fuselage sides and sill, black coaming, instrument panel with live airspeed (0-150 kt with white/green/yellow arcs and red line), altimeter (1,000 ft per turn), variometer (+-5 m/s), turning compass, slip ball, yellow cable-release knob, red canopy-jettison handle, canopy frame (front bow, side rails, rear hoop), seat with harness, control stick (moves with pitch and roll), blue airbrake handle (moves with the airbrakes), green trim lever, rudder pedals (move with yaw). Checked in headless screenshots in flight: dials read, panel clear. Not checked: needle directions against real indications over time (I saw plausible values only), the compass face looks dark, no second (rear) seat, no canopy glass, lighting at night.
- **Edinburgh city** (`src/world/city.ts`, `main.ts`): about 37,000 generated buildings fill the built-up land cover east of the airport out to 8.5 km from the city centre (Princes Street), on a street grid rotated 20 degrees, 28-50 m footprints, 98 % occupancy in the centre falling to 75 % at the edge, heights rising to the centre (24-104 m, with towers up to about 200 m), none on water or on the Firth of Forth, none within 3.2 km of the airport. 148,000 triangles, merged per 2 km tile with the existing window shader, drawn out to the building draw-distance setting (12 km high, 20 km ultra). Seen in a headless screenshot from 1,800 ft: dense blocks to the horizon with parks and the Firth clear. **These are not the real buildings** (the game's data only had the airport's), heights and layout are invented, and the tall towers are far taller than Edinburgh's real skyline; they have no collision (crashes are off anyway). Frame-rate cost on a real GPU/phone is not measured; the LOW preset reduces the draw distance to 6 km. Test: `tests/city.test.ts` (36,816 buildings, generation 140 ms headless, land-cover stubbed because the headless world has no land-cover image).
- Not done: Glasgow and other cities are not filled; real building footprints would need an OSM/Overture download (the sandbox build tool could not reach it this session, not tried).

## Update 57 — supplied glider model
- "UNDERPOLY: Free Sailplane Glider" (https://skfb.ly/oMDMu) by UNDERPOLY Project, CC BY 4.0, is now the glider's outside (`public/models/glider_underpoly.bin` = the .glb renamed, 0.6 MB, 8,032 triangles, textured; `GliderModel.loadGlb` in `src/render/gliderModel.ts`; `?oldglider` loads the old procedural one). Credit added to the About page. Direction, left/right and size are worked out from the model's named parts (canopy ahead of the rudder, ailerons left/right), and it is fitted to the flight model's 17 m span (its own span is 15 m, so it is scaled up 13 %) with the main wheel under the flight model's gear. Checked in two headless screenshots (on the runway at Portmoak): right way round, on its wheel, red/white livery from the file.
- Ailerons and the rudder are tied to the sim's deflections (rotating the model's own parts about their local X/Z axes): **I did not verify that they hinge in the right direction or at the right axis**. The airbrakes are part of the body mesh and do not move; the landing gear does not retract (a glider's is fixed here anyway); the canopy hides in the cockpit view. CC BY asks you to say if you changed the model: it was scaled and repositioned only.
- The file is small enough to ship on the artifact page.

## Update 58 — glider cockpit redone to match a modern glider (reference photo)
- The earlier glider cockpit was my plain placeholder (black box, white sides). Rebuilt (`src/render/cockpitGlider.ts`) after your reference (Aerofly-style): blue interior shell, black coaming, two large dials (airspeed, altimeter) with yellow rings, a centre glass display with a live artificial horizon, speed, altitude and vertical speed from the simulation, smaller vario and compass below, slip ball, cable-release and canopy handles, control stick, airbrake handle, pedals. Checked in headless screenshots. The new supplied glider exterior is now hidden in the cockpit view (it was filling the screen).
- Not matching the reference: it has no printed labels, no moving map on the screen, the interior is simple blocks (not the curved moulded shell), no rear seat, no canopy glass, the lower panel area is a plain black box. Needle directions on the dials were not verified over time.

## Update 59 — bungee launch (game invention)
- New glider launch: at a launch point press **N**. A giant elastic anchored 2.5 km ahead pulls with up to 45 kN (about 70 g on the glider; not a real or survivable procedure, crashes are off) and fades as the glider nears 340 m/s; the game lets go after 5-14 s or at about Mach 1. Release early with R. Physics test (`tests/bungee.test.ts`): reaches 345 m/s (Mach 1.01) in 5 s, then zooms to about 750 m AGL with a 12 degree climb attitude held. There is no wave drag for the glider, so it keeps its speed too well, and no sonic-boom, shaking or visual effect yet; no button on touch screens (key only); the HUD text and audio were not added. Files: `src/sim/simulation.ts`, `src/sim/fdm/aircraft.ts`, `src/input/simpleControls.ts`, `src/main.ts`, `src/ui/menu.ts`.
- Ideas for next: camera shake/blur and a sonic-boom effect, a countdown with the elastic visibly stretching, a "g-load" blackout vignette, scoring by altitude reached, a touch button.

## Update 60 — the Darter (fictional bungee-launch glider)
- New selectable aircraft **Darter** (`src/sim/aircraft/darter.ts`): fictional 6 m span, 5.6 m^2 wing, thin low-drag section, small tail, 480 kg, with wave drag above Mach 0.9 (new `wave` field in the aircraft definition; the 737 keeps its own). Same launch as the glider: N at a launch point (bungee) or the winch. Test (`tests/bungee.test.ts`): after an identical bungee launch the Darter is still doing 206 m/s (400 kt) 20 s later vs 127 m/s for the ASK-21, both peak at Mach 1.01. In my test the altitudes reached are similar (about 2,600 m vs 2,500 m) because my test pilot's climb was scripted; do not read that as "no gain".
- **Placeholders / not done:** it uses the ASK-21 model shrunk to 48 % and the same cockpit (no purpose-made model), no sonic boom or heat effects, landing speed and handling at this wing loading not flight-tested (landing at about 80+ kt is expected), no tuning pass for stability at Mach 1 (the test only shows it stays upright, not that it is pleasant to fly), the stall/buffet and stick curve are the glider's. Files: `src/sim/aircraft/darter.ts`, `src/sim/fdm/aircraft.ts`, `src/main.ts`, `src/ui/menu.ts`.

## Update 61 — Darter reworked into a sci-fi rocket plane
- New original model (`src/render/darterModel.ts`): needle-nosed fuselage, delta wing with elevons, twin canted fins, canopy, rocket nozzle with a flame during the launch. Seen in two headless screenshots on the runway: delta wing, nozzle and orange accents look right; the twin fins look a little flat and the flame was not seen.
- Handling retuned: delta wing with a high stall angle (clMax 1.7, stall warning at 24 deg), a large fin (3.2 m^2) and bigger tailplane, wave drag only above Mach 1.0 and weaker, and a yaw damper in the controls (like the 737). The bungee now pulls to 420 m/s and lets go at 400 m/s. Hands-off test (`tests/darter.test.ts`): sideslip 0.0 deg and yaw rate 0 through the whole launch (straight, no waving), peak angle of attack 6 deg, speed rising to 400 m/s (Mach 1.17) at release, then it coasts up to about 2,400 m while slowing from drag and climbing (that is physics after the rope lets go: nothing pulls it).
- Not done: low-speed landing behaviour, sonic boom, a real cockpit model for it (it still uses the glider cockpit), tuning by hand-flying.

## Update 62 — Darter waddle fixed
- Cause found by testing with a 12 kt crosswind and gusts (my earlier test had no wind): on the ground the Darter sat on one main wheel and a crosswind rocked it up to 24 degrees at launch start. Fixes: two outrigger wheels under the wings (`darter.ts`), and in the air a roll-rate damper plus automatic wings-level when the stick is released, applied always for the Darter (`simpleControls.ts`). Test (`tests/darter_gust.test.ts`): max bank 0.4 degrees (was 23.9), mean yaw rate 0.4 deg/s (was 1.1), through the whole launch in gusty crosswind. Not hand-flown; the mouse stick near the edge can still bank it, by design. The outrigger wheels are not drawn on the model.

## Update 63 — focus mode: only the 737 at Edinburgh
- `src/config.ts`: `FOCUS_MODE = true`. The game now offers only the Boeing 737-800 and only Edinburgh (EGPH): the Cessna, glider, Darter, Glasgow and Portmoak are hidden from the aircraft and airport menus and the world map, and Glasgow/Portmoak data is not loaded or streamed (checked in the running game: aircraft list `[b738]`, loaded patches `[egph]`, no errors). All their code, models and tests are still in the repository; set `FOCUS_MODE = false` to bring everything back. Working slowly from here on the 737 at EGPH only.
- Smaller notes: the rest of the Scotland map terrain is still there when you fly away; the glider-only buttons never show for the 737.

## Update 64 — visual realism, step 1: airport ground details (Edinburgh only)
- **Perimeter fence** along the whole airport boundary (about 12.8 km): 2.4 m chain-link mesh (diamond pattern, see-through) with a post every 8 m (`buildFence` in `src/render/airportMesh.ts`). Seen in a headless screenshot at the boundary.
- **Taxiway markings:** each taxiway now has a double solid yellow edge line on both sides plus the centreline (before: only a centreline). Seen in a headless screenshot.
- Not done yet in the ground/airport group: gates/stand numbers and signs, hold-short bars where taxiways meet the runway, runway-edge detail, blurry satellite texture close up, apron variation (stains, tyre marks), grass mowing pattern, service roads. Frame cost of the fence (about 1,600 posts and one mesh) not measured on a real GPU.
- Next candidates (your choice): hold-short bars and taxiway signs, stand numbers and apron paint, sharper ground close to the camera.

## Update 65 — overall look, step 1 (grading, sky, haze): modest result
- New full-frame colour grading (`src/render/grade.ts`): the scene renders to a 4x multisampled half-float buffer, then a grade (contrast +7 %, saturation +28 %, warm highlights, cool shadows, light vignette), then ACES tone mapping. `?nograde` in the address turns it off. Sky made clearer (lower turbidity, higher Rayleigh), distance haze made bluer, sun stronger (3.6) and sky fill weaker, clouds lit brighter (the post-process blends in linear light and made them grey at first).
- **Result: only a modest improvement.** Ground colours are richer and more contrasty; the sky is still pale near the horizon and the clouds are flat and soft, not like your photos. My first, stronger grading made the clouds dull grey, so I backed it off. Frame cost of the extra render pass on a real GPU/phone is not measured (a 4x multisampled float buffer is not cheap); `?nograde` lets you compare.
- What would make it much closer to the photos (not done): a proper sky model with a deeper-blue zenith and a bright sun glow, sunlit cloud tops with darker blue undersides and thickness (volumetric look), blue aerial perspective that scales with altitude, water with reflection and sun glitter, and real terrain/city detail that I cannot generate in a browser.

## Update 66 — "heavy realism" pass (sky, clouds, forests, runway, reflections, water, buildings)
Done (each checked in headless screenshots unless noted; speed is NOT a goal here and is NOT measured on a real GPU):
- **Sky:** deep-blue zenith fading to a hazy horizon (sky shader tweak in `render/environment.ts`).
- **Clouds:** sunlit tops (warm-white, brighter than before), cool blue-grey undersides and flanks, silver lining at the sunlit edge (`render/cloudField.ts`). Close-up undersides looked too blue and blotchy in the screenshot, softened afterwards (not re-checked).
- **Forests:** about 80,000 instanced conifers and broadleaf trees within 3.2 km of the camera on the land-cover tree class, scattered trees in shrub/built-up edges, stands of one species, re-centred every 450 m (`render/forest.ts`). Screenshot shows woodland blocks and hedgerows. `?noforest` turns it off, `?forestlite` cuts the radius to 1.3 km. It made my software-rendered test runs very slow; a real GPU's cost is unknown.
- **Runway texture:** 1024 x 8192 canvas with worn paint chips, repair patches, slab joints (25 m x 7.5 m), cracks, tyre-rubber streaks in both touchdown zones and oil stains (`render/airportMesh.ts`). Seen on runway 24.
- **Live reflections on the aircraft:** a 256 px cube map of the real surroundings (terrain, buildings, sky) captured at the aircraft every 5 frames, used as the aircraft's environment reflection. **I could not verify it visually** (the test renders were too slow with it on); `?noreflect` turns it off.
- **Water:** deeper blue, plus Fresnel sky reflection. Not seen in a screenshot yet (my test views had little water) and there is no sun glitter yet.
- **Buildings:** wider colour palette (14 wall colours, 7 roofs). Still plain boxes with procedural windows; no pitched roofs, no real facades.
- **Not done:** real photographed city, volumetric clouds, sun glitter on the sea, aerial haze that grows with altitude, aircraft paint/livery, terrain detail close up (the satellite image is still soft).
- **Known cost:** with grading + forest + reflection probe + 14 km of city the game is very heavy; if it is unplayable on your device use `?noreflect&noforest&nograde` or the LOW preset.

## Update 67 — shadows and ambient occlusion
- **Sun shadows** much larger and sharper: shadow area 520 m (was 280 m), 4096 map by default on HIGH, soft (PCF soft) edges, sun placed further out so the shadow volume reaches further. **Trees now cast and receive shadows** (they did not before). Checked in a headless screenshot with a late-afternoon sun: the 737 casts a long, soft shadow across the runway.
- **Ambient occlusion** (GTAO) added to the post-processing chain: contact darkening where surfaces meet (under the aircraft, between buildings, inside tree canopies). `?noao` turns it off.
- **Google Photorealistic 3D Tiles: NOT implemented.** It needs a Google Cloud API key with billing enabled, the key would be visible in the page source, and its terms restrict use. Tell me if you want it and will supply a key, and I will wire it up behind a settings field; otherwise the terrain stays Copernicus + Sentinel-2 + generated buildings.
- Already done earlier and not repeated here: horizon-gradient sky, drifting clouds with lit tops, distance fog, worn runway texture with centreline/touchdown markings, approach lights and emissive runway edge lights at night.

## Update 68 — shake removed, shadow/sky/ground tuning
- **Stall shake removed entirely** (the camera no longer shudders; the red STALL banner stays) and the airframe buffet moments in the physics cut to about a quarter, so the aircraft itself only trembles slightly instead of shaking.
- **Takeoff rumble** cut to about a quarter (camera movement 0.0065 -> 0.0016, roll 0.0035 -> 0.0008) and the field-of-view widening from 7 deg to 2 deg, so it no longer pumps.
- **Shadows:** depth bias retuned for the larger shadow volume (bias -0.00008, normal bias 0.35, 16 blur samples) to cut acne and detached shadows. Checked in a headless screenshot: the 737's shadow is attached and soft.
- **Sky:** stronger blue at the zenith (the horizon stays pale so terrain blends into it).
- **Ground:** local-contrast sharpening on the 6 m satellite imagery (it is pushed away from its own blurred neighbourhood), so fields and hedges read more crisply instead of looking smeared.
- Still open and NOT fixed because I do not know what is wrong: "reflections not perfect" — I cannot see the live aircraft reflection in my software renders. Tell me what looks wrong (too shiny / mirror-like / not updating / missing) and I will fix that specific thing.

## Update 69 — sun, glare, bloom
- **Sun**: tighter, brighter core (1.1 deg) with a wide warm halo (19 deg). It is the same light that casts the shadows, so the shadow direction always matches where you see it.
- **Glare**: looking towards the sun now adds a warm veil and a faint horizontal lens streak over the frame, fading as you look away (`uSunUv` in `render/grade.ts`, fed from the sun's screen position in `main.ts`).
- **Bloom**: bright highlights bleed light (UnrealBloomPass, strength 0.16, threshold 1.05). `?nobloom` turns it off, `?noao` turns off ambient occlusion.
- **Overall brightness** raised about 12 % (exposure 1.12, less at night).
- **Honest note:** my first settings whited out the whole screen when looking at the sun; I cut the glow, bloom and glare by roughly 3-4x. In my last check the sun reads as a soft bright halo, not a whiteout, but I could not get a test frame with ground and sun together, so **please look at it in flight and tell me if it is still too strong or now too weak.**

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

## Update 40 — new glTF 737 exterior control-surface rig (2026-10-30, ChatGPT local ZIP)
- Added `src/render/b737GlbRig.ts`, mapping 22 distinct source glTF primitives of `public/models/b738_geo.bin` to aileron, flap, elevator and rudder hinge groups; existing meshes/materials are reused, no other aircraft or flight-physics changes. `src/render/b737Model.ts` constructs the rig on `loadGlb()` and calls its existing `update(ac)` path every frame. The procedural landing gear remains in place.
- Rig only activates if the loader returns exactly 141 meshes (the number of source primitives); unexpected mesh transforms are skipped. The mapping is specific to this supplied asset and should not be reused blindly with a replacement aircraft.
- **Verification:** offline glTF 2.0 JSON inspection confirms 141 primitives and 22 unique, in-range selected primitive IDs; source wiring confirmed. **NOT VERIFIED:** glTFLoader runtime mesh count, which specific visible portions move, hinge placement, gaps/overlap, correct deflection direction, TypeScript compilation, Vitest suite, Vite build or browser screenshots. This is a prototype and NOT a verified visual fix.
- **Tool blocker:** `npm ci --offline` failed due to missing cached packages; attempted network `npm ci` timed out. No dependency installation completed. No changes committed or pushed to GitHub.
- **Next step:** run `npm ci && npm run typecheck && npm test && npm run build` where dependencies are accessible; open the simulator in a browser and inspect 737 with flaps 0/40, roll left/right, elevator and rudder; fix mapping/hinges after screenshots. Preserve source model and fall back to procedural exterior if necessary.


## Update 41 — GitHub Pages handoff (2026-10-30)
- Kept existing `.github/workflows/pages.yml` unchanged. It already deploys from `main` using Node 22, `npm ci`, `npm test`, `npm run build`, and `dist` to GitHub Pages. `vite.config.ts` already sets relative `base: './'`.
- Added `GITHUB_PAGES_SETUP.md` with browser-only setup and publishing instructions.
- No simulation source, assets, controls, or physics changed in this update.
- Validation: workflow inspected, full ZIP repack integrity checked. Local build attempt on the earlier extracted workspace failed with missing local Node/Vite TypeScript declaration dependencies; GitHub Actions run and actual browser deployment are NOT verified. Update 40 control-surface visuals remain unverified.
- Next: upload/commit complete project files to `main`, set Settings > Pages > GitHub Actions, trigger workflow, inspect its log, then perform a visual flight test of 737 moving surfaces.

## Update 70 — bloom/glare reduction (commit 1b1003b)
- Bloom 0.05/0.3/1.6, exposure 1.0, sun veil 0.025/0.08 after "too much bloom". Published; NOT visually checked.

## Update 71 — user-supplied "B737-800 Model" (hakai315, CC BY 4.0) trialled
- `public/models/b738_full.bin` (10.6 MB, 231 meshes, untextured) + `B737Model.loadFull`: scaled to 39.5 m, nose/fin orientation auto-detected, gear parts hidden when gear is up. Credit added to About.
- Headless check: fuselage, tail, winglets and gear render and sit on the ground, but the wing roots/centre section and the engines do NOT appear in the file (the 1762-triangle wing mesh only yields winglet-like tips; engines not found; frustum culling ruled out). The model is incomplete as supplied, so it is OPT-IN (`?fullmodel`), default stays the previous 737 (`b738_geo.bin`).
- Control surfaces unnamed and not animated. No real-GPU check.
- Next: ask for a different/complete 737 (or one with separate gear + engines), or merge this gear onto the existing model.

## Update 72 — boy737 American 737-800 (CGTrader) replaces the hakai315 model
- Old hakai315 glb deleted. New OBJ+MTL converted to `public/models/b738_full.bin` (7 MB glTF, 117k tris, flat MTL colours; textures were not supplied). Gear is a separate mesh ("gear", picked by position) and retracts with the gear lever. Credit changed to boy737 on CGTrader.
- Root cause of "missing wings/engines" (also affected the old file): `update()` already adds the (-1.5, 0, 4.05) placement, and `loadFull` added it again, sinking the model ~3 m under the runway. Fixed (offset moved out of restMatrix). Confirmed in a headless screenshot: wings, engines, winglets, livery and gear all render and sit on the runway. Control surfaces are not animated. No real-GPU check.

## Update 73 — gear retraction, fewer trees/buildings
- 737 gear split into nose/left/right meshes; each folds about the top of its leg with the gear lever (mains inboard, nose forward) and hides when fully up. The old procedural gear is no longer re-shown by update(). Retract view being checked by headless screenshot (see result in chat); not real-GPU tested.
- Forest radius 3200 -> 2300 m, tree step 9 -> 15 (about 3x fewer trees). Buildings: all large footprints kept, 1 in 3 of the small ones.
- Controls "feel bad": not started yet, waiting for specifics (which axis/phase).

## Update 74 — cockpit fallback on the live page
- User's GitHub Pages build showed the blue built-in cockpit instead of the full flight deck. Locally (headless, default URL) the full cockpit loads. Likely causes: the Low graphics preset (render scale 0.7 was below the 0.72 gate; gate lowered to 0.5) or the 86 MB `cockpit_full.bin` failing to download. Not confirmed; the console warning on the live page ("full cockpit model unavailable") would say.

## Update 75 — control feel
- Default (mouse) controls: stick now low-passed (tau 0.16 s on jets, 0.09 s others), dead zone 6% -> 8%, jet stick authority x0.8, softer gain; on the ground the 737 nosewheel steering fades with speed (1/(1+v/18)).
- Keyboard (input.ts path): rate x0.75, auto-centre 2.5 -> 1.8 /s, output curve 0.35 linear + 0.65 quadratic.
- Physics unchanged. 108 unit tests pass. Feel is NOT verified by hand (no real input in this environment): numbers are a first guess; tell me which axis still feels wrong and I will tune it.

## Update 76 — phase 1 of "close to GeoFS": lighten first
- Plan agreed with user: lighten the current three.js build first, then later move the ground to CesiumJS (worldwide streamed tiles; needs a free Cesium ion token).
- Done (cockpit lazy load confirmed in a headless run): the 86 MB / 1.75 M-triangle detailed cockpit is fetched only the first time the cockpit view is entered (was at startup); live reflection probe refresh 5 -> 12 frames.
- Pending: 737 triangle reduction (<50k), shadow/AO cost review, then measure frame times.

## Update 77 — 737 mesh reduced
- `b738_full.bin`: 117k -> 70k triangles, 7.0 -> 3.4 MB (meshoptimizer simplify on the large panels only, small detail parts such as lettering untouched; positions welded, so creases between panels are slightly softer). Headless screenshot checked: shape, livery, lettering, gear OK; the window row is thinner than before. Original kept out of the repo (can be regenerated from the supplied OBJ with the conversion script, not committed).
- Not yet done in phase 1: shadow/AO cost review, frame-time measurement (needs a real GPU; headless software rendering is not meaningful for fps).

## Update 78 — effects budget per preset
- Graphics presets now carry `fx`: Low = grading only; High = + bloom; Ultra = + ambient occlusion (AO was the most expensive pass). High shadow map 4096 -> 2048 (Ultra keeps 4096). Saved settings without `fx` derive it from terrain detail / render scale.
- Visible effect: AO contact darkening is now Ultra-only. Not measured on a real GPU; set via `Grade.setQuality`.

## Update 79 — full-detail 737 restored
- User feedback on the live build: windows, doors and engine casings missing. Cause: the Update 77 simplification (Prune/simplify) removed thin shells and cut-outs. `b738_full.bin` is back to the unsimplified 117k-triangle / 7 MB version. The plane is a small part of the frame cost; the cockpit lazy load and the effects budget stay.

## Update 80 — missing windows / doors / engine casings fixed
- Causes: (1) the gear-split rule (|x|<4.8 m) swept the lower engine nacelle skins into the folding gear meshes; tightened to |x|<3.5 m. (2) Window glass and dark trim were near-mirror smooth and reflected the white sky; their env-map reflection is now low (glass 0.2, dark trim 0.45) without changing the paint lighting.
- Verified in a headless screenshot: continuous window row, solid nacelles, door outline visible. Remaining plain-colour areas come from textures that were not in the download.

## Update 81 — yoke jump near neutral: fixed at the source (replaces the display-only patch)
- Cause: the beginner auto-trim servo was ADDED to `controls.pitch`. Its on/off threshold (|stick| 0.05) made the stick channel step, so crossing neutral with the mouse produced a pull-up and a reset, and the yoke followed it.
- Fix: `AutoTrim` no longer touches the stick channel at all. It drives the elevator through TRIM only (same rate-limited servo + slow absorption into trim as before), with its transient part weighted continuously over |stick| 0.02..0.12 so nothing steps. `controls.pitch` is now exactly the pilot's stick; the yoke needs no special-casing (the earlier display-only change was reverted).
- Existing auto-trim tests still pass (737 level-flight deviation 130 ft over 2 min vs 150 ft limit, C172 4 ft, glider airspeed hold); 108 unit tests pass. Feel on a real mouse NOT verified here.

## Update 82 — stick snapped to neutral when the pointer crossed an on-screen panel
- Measured with a scripted mouse sweep: the stick/yoke track the mouse smoothly, but `SimpleControls` listened for mouse movement only on the canvas, so when the pointer went over the HUD strip / any panel drawn on top, it stopped updating (and `mouseleave` set the stick to neutral). That gave a stick that "jumps and resets" part-way through the movement.
- Fix: the pointer is now tracked on the whole window (clamped to the canvas rectangle); the stick recentres only when the pointer leaves the page. Re-run of the sweep: the top rows (previously dead) now register and the response is continuous. Real-mouse feel is still unverified by hand.

## Update 83 — bloom removed
- The bloom pass is no longer created (identical to the old `?nobloom` look); `?bloom` re-enables it for comparison. Sun glare/veil in the grade shader, grading, AO (Ultra) unchanged. Presets: `mid` now equals `min` visually until bloom returns.

## Update 84 — all glow removed
- User still saw a halo around the plane/runway in build d31b96a, which pre-dates the bloom removal (01b47ab). Now also removed: the sun-glare veil and lens streak in the grade shader, and the wide 19 deg sun halo sprite (the small sun disc remains). Bloom pass stays off (`?bloom` re-enables it).
- Check the build stamp (bottom right of the page) after a hard refresh: it must be newer than d31b96a.

## Update 85 — centred stick after takeoff stalled the 737
- Reproduced in the simulator (737, runway 24, 100 % thrust, flaps 5, stick centred after rotation): with no assist the nose rises to >50 deg by +12 s and the aircraft stalls (matches the user's screenshot: 2000 fpm, 109 kt, STALL). With the old assist the hold target was "whatever climb rate you had at release" with no airspeed protection.
- Fix (AutoTrim, 737 branch): held climb/descent limited to +/-1500 fpm, reference pitch limited to -10..+12 deg, and the nose is lowered when CAS falls within 8 kt of 1.25 x Vs0 (stall margin). Re-run: after release at 13 or 22 deg pitch the 737 settles to ~2-3 deg pitch, 2000 fpm and accelerating, no stall, all through trim only (stick channel untouched).
- Mouse neutral band widened 8 % -> 10 % of the screen around the centre. 108 unit tests pass. The user's page may have "Realistic mode" (assists off) set: with assists off the aircraft will still pitch up on its own (takeoff trim + full thrust), which is the physics.

## Update 86 — centred stick = neutral; limit and speed protection removed
- User asked for no limit / no speed protection and a plain neutral yoke at the middle. Update 85's climb cap, pitch cap and airspeed protection are removed (AutoTrim is back to the trim-only hold from Update 81).
- Root cause of the takeoff pitch-up, found in the simulator: with the stick centred and takeoff power the 737's underslung engines pitch the nose up and the takeoff trim (+0.25) did not balance it (hands-off: >50 deg and stall within ~20 s even at trim -0.4). Scan at full thrust: trim -0.8 stays steady (3-8 deg, ~2000 fpm), -0.6 climbs gently at 85-100 % thrust. `takeoffTrim` set to -0.6.
- Takeoff test still passes (VR 148, liftoff 164 KIAS at 6.9 deg, gear up 8 s, 1500 ft AGL at 50 s); 108 tests pass. Not hand-flown with a real mouse.

## Update 87 — the 737 slid / rocked after braking to a stop
- Reproduced in the simulator: braking a 737 from 40 m/s ground roll overshot to -0.9 m/s (rolling backward) and then rocked +/-0.5 m/s for 30+ s ("shifts like ice and slides"). Cause: the low-speed tyre "hold still" (bristle) spring/damper (K 60 000 N/m, C 4 000 N s/m per wheel) was tuned for a ~1 t aircraft; on a 74 t jet the same hold is about 0.05 damped with a ~4 s period.
- Fix: spring and damper now scale with the wheel load (reference 3 600 N, never below 1x), giving jets the same natural frequency and damping as light aircraft. Re-run: stops at -0.12 m/s peak overshoot then holds at 0.00. 108 tests pass (incl. C172 and 737 landing/rollout). Not tried on a real keyboard/mouse.

## Update 88 — control surface 1 of N: elevators (737)
- The 737 model is one merged mesh, so the elevators are CUT out of the tailplane skin: hinge at 66 % chord (swept line, fitted from the root and tip vertex clusters), spanning 1.4..6.6 m off the centre line, triangles clipped exactly on the hinge and end lines (no gaps). User approved the cut from a top-view drawing. Generator: `conv2.py` (OBJ+MTL -> `public/models/b738_full.bin`, nodes elevL/elevR carry their hinge points in `extras`; not committed, regenerate from the supplied OBJ).
- Runtime: each elevator rotates about its hinge by the flight model's actual (lagged) elevator angle `-aircraft.elevator` (trailing edge up when pulling). Measured in the browser: full pull = trailing edge up to +0.39 m, full push = down to -0.27 m (22 deg / 15 deg travel), both sides together.
- Next, one at a time with sign-off on each cut: ailerons, rudder, flaps, spoilers (slats/trim optional). Not yet re-checked on a real GPU.

## Update 89 — control surface 2 of N: ailerons (737) + temporary orange tint
- Aileron cut approved by the user from a drawing: right-wing span x 10.2..15.6 m (model coordinates), hinge on the model's own engraved line moved 0.25 m forward, aft edge = the wing's real trailing edge (about 0.7-0.8 m deep); the other wing is the mirror image about the tailplane centre line (checked: the two wings' leading/trailing edges match). Generator `conv2.py` now also writes nodes ailL/ailR with their hinge in `extras`.
- NOTE on sides: the model's +x wing is the aircraft's LEFT wing (body y = -(x - centre)), so node `ailR` is driven by `aircraft.aileronL` and `ailL` by `aircraft.aileronR`. Angle = minus the simulator's angle (negative = trailing edge up).
- Measured (browser): roll left = left TE up 0.41 m (30 deg), right TE down 0.30 m (22 deg); the roll-right case was shown in screenshots (right TE up, left down). Both sides move opposite, as on the real aircraft.
- TEMPORARY: `TEMP_TINT_SURFACES = true` in `b737Model.ts` paints the built surfaces (elevators, ailerons) bright orange for checking; set it to false to remove.
- Next, one at a time with a drawing and sign-off before each cut: rudder, flaps, spoilers (slats/trim optional).

## Update 90 — "the ailerons didn't appear"
- The deploy of 1b63a3a had succeeded (checked with the Actions run list), and the ailerons render in the headless build, so the likely cause is the browser cache: `b738_full.bin` keeps the same URL across builds and GitHub Pages lets browsers cache it. The model URL now carries the build's commit hash (`?v=<sha>`), so every new build fetches the new model. The console line `737 full glb: ... control surfaces ...` now lists which surfaces were found (expect elevL,elevR,ailR,ailL).

## Update 91 — ailerons a bit smaller; tint made matte
- User: the ailerons appeared (after the cache fix) and should be a bit smaller. Now x 10.5..15.3 m on the right wing (4.8 m span, was 5.4), hinge 0.10 m forward of the model's engraved line (was 0.25), depth about 0.65-0.70 m (was 0.75). Left wing mirrors it. Checked in a headless render.
- The temporary orange tint was washing out on the glossy paint (roughness 0.05 reflecting the sky): it is now matte with a slight emissive glow (`TEMP_TINT_SURFACES`, still to be removed at the end).

## Update 92 — control surface 3 of N: rudder (737)
- Cut approved from a side-view drawing: hinge 28 % of the local fin chord forward of the trailing edge, y = 5.6..12.2 m (fixed tip cap above, tail cone below); depth about 1.6 m at the bottom, 0.5 m at the top. The hinge is two straight segments meeting at y = 6.3 m (where the fin base widens), so the cut is clipped against both; the rotation axis is the upper segment. Node `rud` in `b738_full.bin` (generator `conv2.py`).
- Runtime: swings about the hinge by `-aircraft.rudder` (sim rudder is negative for the right pedal = trailing edge toward the aircraft's right = model -x). Measured: 26 deg = 0.68 m each way, symmetric; confirmed in a rear-view render (orange rudder swings out with the right pedal).
- Surfaces built so far (tinted orange for checking): elevators, ailerons, rudder. Next: flaps, then spoilers (slats/trim optional); remove `TEMP_TINT_SURFACES` at the end.

## Update 93 — control surface 4 of N: flaps (737)
- Cut approved from drawings (second drawing corrected: the inboard flap starts at the fuselage side, x = 1.65 m, and no longer overlaps the wing-root parts). Per wing: F1 root x 1.65..4.9 (front edge level at z = -6.05), F2 inboard 4.9..7.3 and F3 outboard 7.3..10.15 (front edge along the grey strip, z -6.05 -> -8.12); aft edge = the wing's trailing edge; the other wing mirrors it. F2/F3 share one hinge axis; F1 has its own (the front edge has a bend at x = 4.9, so a thin crack can show between F1 and F2 when extended).
- The three flap-track fairings (pods, x = 3.75 / 6.10 / 8.69) stay FIXED on the wing (user's choice, as on the real aircraft); the flaps get a 0.56 m clearance slot around each pod so nothing passes through them.
- Runtime: all six sections follow the simulator's actual flap angle `aircraft.flap` (detents 0,1,2,5,10,15,25,30,40 deg): trailing edge down by the flap angle about the front edge, slid aft 0.012 m per degree. Measured: 15 deg = 0.15-0.26 m down and ~0.2 m aft; 40 deg = 0.39-0.63 m down and 0.44-0.60 m aft; left/right match. Rendered at 0/15/40 deg.
- Generator `conv2.py` now processes every triangle through one pipeline (flap pieces left over go on to the aileron and gear tests); ailerons unchanged (386/582 triangles).
- Still to do: spoilers (the notched panels in front of the flaps), then optionally leading-edge slats and the trim; remove `TEMP_TINT_SURFACES` at the end.

## Update 94 — flap gaps closed
- User saw gaps between the flap sections and the wing when the flaps moved ("there must be parts under that cover it"). Cause: the model's wing trailing edge is a hollow shell (upper + lower skin only), so every cut edge of a flap section is OPEN and shows the inside; the real aircraft has closed flap/wing ends and a fixed cover.
- Fix: end caps are built along every cut line (front edge, section ends, pod slot walls) as thin strips between the two skins, one copy on the flap piece and one on the fixed wing (214 triangles). The flap slide was also reduced to 0.006 m per degree (0.24 m at 40 deg) so the slit between wing and flap stays small. The grey strip moves with the flap again (keeping it fixed was tried and did not help).
- Checked in renders at 25 and 40 deg from above and behind: the sections read as continuous strips with only small notches at the pods. Not seen on a real GPU yet.

## Update 95 — flap slit and crack removed (user picked marks 2 and 3 of the marked close-up)
- Crack between sections: the two inboard pieces are merged into ONE inboard flap (x 1.65..7.3 m) with a single straight hinge; the outboard flap (7.3..10.15) keeps its own. Nodes are now `flapRI/flapRO/flapLI/flapLO`. The root part of the old front edge (flat, z = -6.05) is now part of the fixed wing.
- Slit at the front: no sliding aft any more (tilt only), and the hinge sits on the UPPER skin (mid-thickness + 0.12 m) so the top surface stays closed when the flap tilts; the open edges still have end caps (146 triangles).
- Measured: 25 deg = trailing edge 0.24-0.32 m down; 40 deg = 0.36-0.46 m down, left/right match. From above and behind there are no gaps; the flaps now look like a drooping trailing edge and are less conspicuous from above because they no longer extend aft. If that is too subtle, a short slide with a fixed cover lip is the alternative.
- User did not pick mark 1 (white interruptions at the pods): the pods still have clearance slots.

## Update 96 — chunkier flaps; pods slide out (telescoping)
- Flaps are deeper: the front edge moved 0.25 m forward (inboard 708/513 and outboard 249/204 triangles on right/left, was 607/216 and 447/175).
- User asked for the flap-track pods to "go backwards" and then "slide, not just move": each pod is now its own node (`podR1..3`, `podL1..3`, the part behind the flap front edge, below mid-thickness, in the 0.56 m slot column) and translates aft by `0.55 m x flap / 40 deg`. To make it a slide rather than a seam, the moving part carries a narrower inner "tube" (84 % scale, 0.75 m long) copied from the fixed pod just ahead of the cut: hidden inside the fixed pod at rest, it slides out of it as the flap extends (673 tube triangles) plus end caps on the cut (210). Measured in the browser: 0.55 m aft at 40 deg for all six pods; renders from above and below.
- Known roughness: the inboard flap's root end looks slightly jagged in the render; the left-wing pods have fewer triangles than the right (mesh differences), not checked on a real GPU.
- Still to do: spoilers; then optional slats/trim; remove `TEMP_TINT_SURFACES` at the end.

## Update 97 — clean flap panels; pods tilt and slide
- User: the flaps looked messy at 40 deg. Cause: the wing trailing edge in this model is a dense tangle (hinge notches, grey fittings, spoiler panel edges, fuselage window glass at the root, pods); cutting it and rotating it left shards. User chose "rebuild flaps as clean panels".
- Now: the old trailing-edge skin and grey strip in the flap zone are REMOVED and each flap (inboard x 1.65..7.3 m, outboard 7.3..10.15 m, left and right) is a simple closed wedge panel generated by `conv2.py` (front edge on the approved hinge line moved 0.6 m forward for chunkier flaps, trailing edge on the measured wing trailing edge, ~1.0-1.3 m deep, 0.18 m thick at the hinge, closed front edge, trailing edge and ends). The fixed wing's cut front edge and root/tip ends are capped. Cabin windows and hardware stay fixed. The notched spoiler-panel details that lay behind the new front edge are gone (spoilers will be rebuilt as clean panels too).
- Pods (flap-track fairings): the part behind the flap front edge is its own node and, driven by the flap angle, slides aft (0.6 m at 40 deg) and tilts its tail end down (0.45 x the flap angle, about 18 deg at 40 deg) about its front cut, with a narrower inner tube so it telescopes out of the fixed fairing without a seam.
- Flaps still hinge on the upper skin and tilt only (no slide), as chosen earlier. Rendered at 0 and 40 deg from above: clean orange bands (the tint is the temporary `TEMP_TINT_SURFACES` check). Not seen on a real GPU yet.
- Next: spoilers (to be built as clean panels), optional slats/trim; remove the orange tint at the end.

## Update 98 — flap panels: dark wing, stray slivers, long pods fixed
- User (build 2952a22): "still messy and worse than before". Found in their screenshots: (1) one wing's flap was dark maroon: the mirrored panel's triangle winding disagreed with its normal, so the double-sided material shaded it as a back face (fixed: winding now follows the normal); (2) thin vertical slivers across the flaps: leftover trim pieces of other materials that stayed fixed inside the flap area and poked through the moving panel (fixed: everything below the wing's top skin inside the flap area is now removed, only the cabin windows above it and the pods stay); (3) the pods stuck out as long spikes (pod slide 0.6 -> 0.3 m at 40 deg, tilt 0.45 -> 0.25 x the flap angle, about 10 deg).
- Re-rendered at 40 deg from above and 32 deg from the side: both wings evenly lit, solid bands, short pods. Not seen on a real GPU.

## Update 99 — flaps no longer stand proud of the wing; pod pivot moved
- User (build f9b1110): "the flaps go over and up the wing from above, and there are two pods in one". Measured the wing's real upper-skin height along the flap front edge: near the root it is 0.3-0.4 m LOWER than where the flap panel's top had been placed (a straight-line guess), so the panels stood proud there. The flap top now follows the measured skin height (table in `conv2.py`, 3 cm under it). Rendered from above at 40 deg: thin flush bands.
- Pods: the double pod was the telescoping inner tube swinging out of the fixed pod when the pod tilted about its FRONT CUT (the tube lies ahead of that point). The tilt pivot is now the tube's front end, tube scale 0.8. NOT verified up close (the chase camera cannot get a clean low view of the wing); the top view still shows the pods looking ragged.
- If the pods still look doubled: next step is to make each pod one simple rigid piece (no tube) that slides and tilts as a whole, with the hole in the wing underside capped.

## Update 100 — deploy timeouts: flight deck compressed 84 -> 16 MB
- GitHub Pages deploys of 9999f82 timed out twice at "syncing_files" (the site was 131 MB; the failure also hit earlier today), so the user's live page stayed on the previous build ("nothing changed"). Re-running the failed deploy did not help.
- Fix: `public/models/cockpit_full.bin` is now mesh-compressed with EXT_meshopt_compression (positions with the exponent filter at 16 bits, normals octahedral 8-bit, indices coded) and the unused TEXCOORD_0 data is dropped (the loader deleted it anyway): 83.8 -> 15.8 MB, same 1,746,324 triangles. `CockpitFull.load` now uses three's `MeshoptDecoder`. `dist` is 64 MB (was 131 MB). Headless render of the cockpit view looks identical (displays, overhead, yokes, pedestal). The original is kept in the scratchpad (not in the repo); regenerate with `packck.mjs` if the source flight deck changes.
- Positions are rounded to a 16-bit mantissa (about 0.001 % error), normals to 8-bit octahedral: not visible.

## Update 101 — flaps and pods FROZEN (paused on the user's request)
- User (build 6f3335c): "still messed up, keep flaps frozen, we do it later". Pods, flaps and their cuts are removed from the shipped model: `public/models/b738_full.bin` is back to the version of commit 8f50243 (original detailed trailing edge, grey strip, fixed pods; only the elevators, ailerons and rudder are cut out and animated). Flap lever / flap angle no longer move any geometry (the runtime flap/pod code stays but finds no nodes). Headless render at 40 deg: clean wing, nothing out of place; surfaces found: elevL, elevR, ailR, ailL, rud.
- Work kept for later: `tools/b738/conv2_with_flaps_wip.py` (generator including the flap panels, pods with telescoping tubes, end caps; input paths point at the upload location) and `tools/b738/packck.mjs` (flight-deck compression). Known open problems when we return: the model's trailing edge is a tangle of notches, grey fittings and pod parts; clean-panel flaps looked mostly right from above but the pods looked ragged and doubled; ideas: a simple rigid pod per fairing, or rebuild flap + spoilers + pods as one clean procedural trailing-edge assembly.
- Deploys: GitHub Pages timed out four times in a row (19:35-20:38 on 2026-11-07, also at ~16:00) even after the flight deck was compressed from 84 to 16 MB (site 131 -> 64 MB); a later re-run succeeded. A re-run of the failed deploy job (`gh run rerun <id> --failed`) is the cure; do not push while one is running (it cancels it).
- Next: spoilers (will use the same drawing-approval flow), optional slats/trim; remove `TEMP_TINT_SURFACES` at the end.

## Update 102 — control surface 5: spoilers (flaps and pods stay frozen)
- Approved from a drawing: five panels per wing between the model's own engraved lines, x = 4.75..5.85..6.85..7.90..8.90..10.15 m (right wing, mirrored for the left), front (hinge) line z = -5.65 -> -7.53, rear edge z = -6.10 -> -8.10 (about 0.5 m deep). Only the UPPER skin of that zone becomes the spoiler (a thin back face is added so a raised panel has a body); the lower skin stays. Generator: `tools/b738/conv3_spoilers.py` (flaps/pods disabled; nodes spoR1..5, spoL1..5 with hinge in `extras`).
- Runtime: each panel rotates about its hinge by 40 deg x `aircraft.spoiler` (0..1, the simulator's spoiler position, moved by the speedbrake lever over 1.5 s). Measured in a browser: spoR4's highest point 3.213 m at lever 0, 3.349 at 0.5, 3.506 at 1 (0.29 m = 40 deg). Rendered from behind: raised strips visible on both wings. All panels rise together (no separate ground-spoiler / roll-spoiler logic yet).
- Known: the dividers between panels are straight while the model's engraved ones slant slightly; raising leaves small side slits; the wing body mesh grew ~11k triangles from the clipping (108.8k -> 119.8k body triangles).
- Next: slats/trim optional; remove `TEMP_TINT_SURFACES` at the end; flaps + pods rebuild later.

## Update 103 — spoilers smaller, with gaps
- User approved a drawing: each spoiler 15 % shallower (about 0.42 m, was 0.50 m; hinge line unchanged, rear edge moved forward) and 12 cm narrower so there is a 12 cm gap between neighbouring panels (outer panels 6 cm in from the ends). `tools/b738/conv3_spoilers.py` has `SPO_GAP` and the new `SPO_RE`; triangles per panel 78-112, left and right similar.
- Rendered from above with the lever down and up: five separate strips per wing with clear gaps. The gap areas show the wing's own upper skin.

## Update 104 — FREE / PRO editions; PRO ground (first step of "build Edinburgh ourselves, hybrid")
- Decision (user): build the world ourselves as a HYBRID (real map as hidden skeleton: terrain heights, land cover, building footprints, roads; everything visible authored), starting with the ground; it must not lag. The current look is the FREE edition and is preserved on git branch `free-edition` (commit b9de91c; the tag `free-edition-v1` exists locally, pushing tags was refused by the connection). New work is PRO.
- Switch: `src/config.ts` `PRO`, on with `?pro` in the URL (remembered in localStorage until `?free`); default = free. Free behaviour unchanged (simple approach lights, satellite-photo ground).
- PRO ground (`terrainMesh.ts`, uniform `uPro`): no satellite-photo reads and no sharpening (that sharpening produced the purple/red/green blotches around the apron), instead authored fields from the land-cover class: ~130 m parcels with their own tone, crop/mowing stripes (near only), hedgerows along parcel borders (fade with distance), woodland-floor mottling; parcels/hedges are suppressed within ~1.7-2.6 km of the airport so the airfield stays clean. Fewer texture fetches per pixel than free, so it should not be slower (not measured on a real GPU).
- PRO airport lighting (Update before): ALSF-style approach lights with crossbars, red side rows, sequenced flashers, runway centreline and touchdown-zone lights, green taxiway centreline lights (not yet visually verified at night; the user asked to focus on DAY for now).
- Headless renders, pro vs free: approach view shows clean patchwork fields instead of blur; apron view shows clean concrete and no blotches. Known next items: field palette is too bright / lime, the "built-up" ground still shows brown/pink striped patches, buildings are still grey boxes, trees still low-poly, terminal/airport not yet hand-built.

## Update 105 — Inspection drone (TEMPORARY tool for building and checking the world)
- New aircraft `drone` (`src/sim/aircraft/drone.ts`, listed in the Aircraft menu next to the 737): the Darter airframe (bungee-launch rocket glider, fictional) recoloured safety yellow, plus a speed-hold motor (`AircraftDef.drone`, `droneSpeed()` and the thrust block in `fdm/aircraft.ts`). Keys 1..9 (the throttle keys): 1 = motor off, 2..9 = exponential steps 45 .. 400 m/s (87 .. 780 kt); a toast shows the chosen speed. It can take off under its own power or be bungee-launched with N (rope target speed 130 m/s for the drone, 420 for the Darter); release with R. Always spawns with the motor off (`readyControls` sets throttle 0.1, which would otherwise switch the motor on).
- Verified: unit test (`tests/drone.test.ts`: steps are exponential, it accelerates from 60 m/s to the 114 m/s target and settles at 115); in the real game (headless): key 5 held 114 m/s; bungee from rest gave 108 m/s after 2 s and about 300 m height after 12 s, no crash. Flight feel on a real keyboard not tried. All 110 tests pass.
- Not done: it keeps the Darter's high stall speed (it needs about 45 m/s to fly), so the lowest step is 87 kt; a slow hover-like inspection mode would need a different physics model; no dedicated drone cockpit/camera.

## Update 106 — Drone glass-ball cockpit + rocket engine (temporary tool)
- Cockpit view of the inspection drone is now a clear glass ball (faint tint + three rings) with the eye at its centre, the airframe hidden, and a flight stick on a small floor disc at the bottom that follows pitch/roll (`src/render/cockpitDrone.ts`).
- The drone model has a rocket engine: motor casing on the spine, nose cone, orange cooling rings, struts, flared bell and a flickering plume whenever the motor is on (`darterModel.ts`, drone only; the normal Darter is unchanged).
- Checked in headless screenshots only (outside view and ball view); not flown on a real GPU/keyboard. Tests unchanged (110 pass).
