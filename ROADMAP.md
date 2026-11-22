# JetVault Flight Simulator: plan to a public release

Goal: a public release for everyone, on the jetvault.net website. Areas to cover: polish and speed, more places, aircraft, Career and Challenges.
Sizes: S = under a day, M = a few days, L = about a week or more. Every item is checked on a real browser and pushed to `main` only when its tests pass.

## Where we are
Live: Free Flight (aircraft, globe and UK map location, weather, summary), 737 / A320 / A340 / A350 / C-17, Edinburgh, Heathrow and Gatwick with roads, road markings, cars and a lit night city, replay, Director (Pro), peer-to-peer multiplayer, JetCoins shop, new home menu. Career and Challenges are greyed out.
Not yet: anything below.

## Phase 0: release blockers (do first; nothing public until these are done)
| # | Item | Size |
|---|---|---|
| 0.1 | **Licences.** The 737 exterior model's licence is unverified; the C-17 is CC BY-NC-SA (non-commercial, share-alike); the City Buildings pack is unverified. Decide for each: get written permission, replace with a model we can use, or remove. If the game ever takes real money (the JetCoins shop must stay free-to-earn), NC models cannot ship. | M |
| 0.2 | **Data credits and terms.** OpenStreetMap / Overture (ODbL), Copernicus DEM, ESA WorldCover, Sentinel-2, OurAirports: a visible credits page with the exact required wording (partly there), plus the share-alike rule for derived map data. | S |
| 0.3 | **Privacy.** Multiplayer shows IP addresses to the other players and to the PeerJS broker; write a short privacy notice, a first-time consent for multiplayer, no analytics without consent. | S |
| 0.4 | **Names and legal lines.** "Not affiliated with Boeing, Airbus, Lockheed Martin, Microsoft or any airport" (partly there), the JetWire / JetVault trademarks, a terms and contact page. | S |
| 0.5 | **Hosting and domain.** Confirm jetvault.net serves this build (we deploy to GitHub Pages at mhd241.github.io/jetvault-fs): custom domain, HTTPS, caching of the ~80 MB of data, a download size budget. | S |
| 0.6 | **Error handling.** A friendly message when WebGL is missing or the data fails to load; a crash report path that does not collect personal data. | S |
| 0.7 | **Free and Pro editions.** Decide what is free for everyone and what Pro is (Director, extra aircraft, Heathrow/Gatwick?), and how Pro is unlocked. Today `?pro` in the address bar unlocks it. | M |

## Phase 1: polish and speed (everyone's first impression)
| # | Item | Size |
|---|---|---|
| 1.1 | **Auto graphics.** Pick Low / Medium / High from the screen size and a measured frame rate on first launch, and remember it. (The M1 iMac was fine on Low.) | S |
| 1.2 | **Performance pass on High.** Measure the real costs (London's buildings, far shadows, grass, post-processing) on an M1, an older Intel Mac, a Windows laptop with integrated graphics and a phone; cut the worst. | M |
| 1.3 | **Browser and device test matrix.** Chrome, Safari, Firefox, Edge; macOS, Windows, iPad; touch controls; small screens. | M |
| 1.4 | **First 5 minutes.** A short guided first flight, clearer controls help, a "reset flight" button, a tip when stuck. | M |
| 1.5 | **Menus.** Finish the Marketplace (liveries later), Help, Settings behind the gear; remove leftovers (World Map, Airports pages). | S |
| 1.6 | **Known bugs.** Inverted left/right look (view not identified), gate stars only in the terminal clusters, runway lights on the ground (unreproduced), 4 km Director landings. | M |
| 1.7 | **Save data.** JetCoins and settings live only in the browser; add export/import or an account so progress is not lost. | M |
| 1.8 | **Sound check.** Engine, wind, gear and ground sounds exist but need a pass on balance and a mute control. | S |

## Phase 2: more places
| # | Item | Size |
|---|---|---|
| 2.1 | **More UK airports,** one at a time with the same pipeline: Manchester, Birmingham, Glasgow (built, hidden), Stansted, Luton, Newcastle, Bristol. About a day each including checking by eye. | S each |
| 2.2 | **Central London** (Westminster, City, Canary Wharf, the Thames): a second detailed area with tall buildings and landmarks. | L |
| 2.3 | **Gates and stands** for every airport (clearance data per stand so big aircraft only get stands they fit). | M |
| 2.4 | **Navigation data.** Runway lighting and approach aids, radio frequencies and ILS where a licence-clean source exists (no invented values). | M |
| 2.5 | **Streaming.** Load the nearest airport data in the background so flying between airports works; floating origin for long flights. | L |
| 2.6 | **Traffic and life.** Cars that stop and turn, ground vehicles, airport traffic, boats on water. | M |

## Phase 3: aircraft
| # | Item | Size |
|---|---|---|
| 3.1 | **Moving parts** for A320 / A340 / A350 / C-17: ailerons, elevators, rudder, flaps, spoilers, gear animation (737 flaps, slats, pods still missing). | M |
| 3.2 | **Cockpits** for the A340, A350 and the 737 (own models; today they share the A320 deck). | L |
| 3.3 | **Flight model check** against published numbers for each aircraft (takeoff, climb, landing speeds), tuned like the 737. | M |
| 3.4 | **Remote players** drawn with the right model (737, Cessna) and moving gear and flaps. | S |
| 3.5 | **Liveries** (paint schemes) as a Marketplace item. | M |

## Phase 4: Career and Challenges (first version small, then grow)
| # | Item | Size |
|---|---|---|
| 4.1 | **Challenges v1:** landing challenges (touch down in the zone, sink rate and centreline score), a night approach, a crosswind approach, each with fixed weather, a best score and a JetCoins reward. Scoring already exists in the landing analysis. | M |
| 4.2 | **Career v1:** a flight log (hours, distance, landings), ranks, and simple jobs between the airports we have (passengers or cargo) paying JetCoins; unlock aircraft by rank or by buying. | L |
| 4.3 | **Progression and shop balance:** earn rates, prices, no real money in the game. | S |
| 4.4 | **Leaderboards** (optional, needs a server and abuse control; decide later). | L |

## Phase 5: launch and after
- Soft launch to friends and the JetWire audience, collect feedback and crashes, fix, then open up.
- A short trailer from your Director footage.
- Regular updates: an airport and a challenge pack every few weeks.

## Decisions I need from you
1. **Date.** You said the game is on the jetvault.net website. Is it already public there, or should the plan lead to a public launch there? (This decides whether Phase 0 is urgent.)
2. **Money.** Will the game ever charge real money (Pro, aircraft, liveries)? That changes the licence rules (0.1) and adds payments and consumer law.
3. **Pro versus free** (0.7).
4. **Order.** My suggestion: Phase 0 and 1.1 to 1.4 first, then Challenges v1 (4.1), then more airports (2.1), then aircraft (3.1), then Career v1 and central London.
5. **Accounts.** Is a login acceptable, or must it stay free of accounts?
