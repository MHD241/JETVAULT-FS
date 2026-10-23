import { Terrain, HeightGrid } from './terrain';
import { AirportData, PavementIndex } from './airport';
import { ObstacleIndex, parseBuildings, styleAirportBuildings, findGateSites, spacedStands } from './obstacles';
import { GroundQuery, SurfaceInfo } from '../sim/fdm/gear';

export interface GridFile { file: string; n: number; half: number; step: number; scale?: number }
export interface PatchMeta {
  id: string; icao: string; name: string;
  cx: number; cy: number; half: number; imgHalf: number;
  buildings: number;
}
export interface RegionMeta {
  projection: string;
  origin: { lat: number; lon: number };
  /** Low-resolution regional terrain and land cover (square, centred on the origin). */
  terrainLo: GridFile;
  landcoverLo: GridFile;
  /** High-resolution patches around each airport (files in <id>/). */
  patches: PatchMeta[];
  attribution: string[];
}

/** ESA WorldCover class codes. */
export const LC = {
  TREE: 10, SHRUB: 20, GRASS: 30, CROP: 40, BUILT: 50, BARE: 60, SNOW: 70, WATER: 80, WETLAND: 90,
  MANGROVE: 95, MOSS: 100,
} as const;

export class LandCover {
  constructor(public data: Uint8Array, public n: number, public half: number, public step: number, public cx = 0, public cy = 0) {}
  contains(east: number, north: number) { return Math.abs(east - this.cx) <= this.half && Math.abs(north - this.cy) <= this.half; }
  at(east: number, north: number): number {
    const c = Math.round((east - this.cx + this.half) / this.step);
    const r = Math.round((this.cy + this.half - north) / this.step);
    if (c < 0 || r < 0 || c >= this.n || r >= this.n) return 0;
    return this.data[r * this.n + c];
  }
}

const ASPHALT: SurfaceInfo = { friction: 0.8, rolling: 0.015, kind: 'asphalt' };
const ASPHALT_WET: SurfaceInfo = { friction: 0.5, rolling: 0.015, kind: 'asphalt' };
const GRASS: SurfaceInfo = { friction: 0.45, rolling: 0.06, kind: 'grass' };
const GROUND: SurfaceInfo = { friction: 0.5, rolling: 0.08, kind: 'ground' };
const WATER: SurfaceInfo = { friction: 0.05, rolling: 0.5, kind: 'water' };

export class World implements GroundQuery {
  pavement: PavementIndex;
  private pavements: PavementIndex[];
  wetRunway = false;
  /** All airports in the world; `airport` is the current one (spawn position, runways, cockpit map). */
  airports: AirportData[];
  /** Land cover of each patch (20 m) and the regional one (500 m). */
  landcovers: LandCover[] = [];
  constructor(
    public meta: RegionMeta, public terrain: Terrain, public airport: AirportData,
    public obstacles: ObstacleIndex, public landcover: LandCover | null = null,
    airports: AirportData[] = [airport],
  ) {
    this.airports = airports;
    this.pavements = airports.map((a) => new PavementIndex(a));
    this.pavement = this.pavements[0];
  }

  setAirport(icao: string) {
    const a = this.airports.find((x) => x.icao === icao);
    if (a) this.airport = a;
  }

  heightAt(east: number, north: number, normalOut?: { e: number; n: number; u: number }) {
    return this.terrain.heightAt(east, north, normalOut);
  }

  isPaved(east: number, north: number) {
    for (const p of this.pavements) if (p.isPaved(east, north)) return true;
    return false;
  }

  landAt(east: number, north: number): number {
    for (const l of this.landcovers) if (l.contains(east, north)) return l.at(east, north);
    return this.landcover ? this.landcover.at(east, north) : 0;
  }

  surfaceAt(east: number, north: number): SurfaceInfo {
    if (this.isPaved(east, north)) return this.wetRunway ? ASPHALT_WET : ASPHALT;
    if (this.landcover || this.landcovers.length) {
      const c = this.landAt(east, north);
      if (c === LC.WATER && this.terrain.heightAt(east, north) < 3) return WATER;
      if (c === LC.GRASS || c === LC.CROP || c === LC.WETLAND || c === LC.MOSS) return GRASS;
      return GROUND;
    }
    return GRASS;
  }
}

export type Fetcher = (path: string) => Promise<ArrayBuffer>;

/**
 * Loads the region. `decodeLandcover` is supplied by the browser (PNG decode via canvas);
 * headless tests omit it.
 */
export async function loadWorld(
  base: string, fetcher: Fetcher,
  decodeLandcover?: (buf: ArrayBuffer, n: number) => Promise<Uint8Array>,
  onProgress?: (msg: string) => void,
): Promise<World> {
  const text = async (p: string) => new TextDecoder().decode(await fetcher(`${base}/${p}`));
  onProgress?.('Region metadata');
  const meta = JSON.parse(await text('meta.json')) as RegionMeta;
  onProgress?.('Terrain elevation (Copernicus DEM)');
  const loBuf = await fetcher(`${base}/${meta.terrainLo.file}`);
  const lo = new HeightGrid({ ...meta.terrainLo, scale: meta.terrainLo.scale ?? 0.1 }, new Int16Array(loBuf));
  const grids: HeightGrid[] = [];
  const airports: AirportData[] = [];
  const obstacles = new ObstacleIndex(100);
  const landcovers: LandCover[] = [];
  const terrainRef: { t: Terrain | null } = { t: null };
  for (const p of meta.patches) {
    onProgress?.(`${p.name}: terrain`);
    const hb = await fetcher(`${base}/${p.id}/terrain_hi.bin`);
    grids.push(new HeightGrid({ n: Math.round(2 * p.half / 30) + 1, half: p.half, step: 30, scale: 0.1, cx: p.cx, cy: p.cy }, new Int16Array(hb)));
  }
  const terrain = new Terrain(grids, lo);
  terrainRef.t = terrain;
  for (const p of meta.patches) {
    onProgress?.(`${p.name}: airport and buildings`);
    const airport = JSON.parse(await text(`${p.id}/airport.json`)) as AirportData;
    const bbuf = await fetcher(`${base}/${p.id}/buildings.bin`);
    const blds = styleAirportBuildings(parseBuildings(bbuf, (e, n) => terrain.heightAt(e, n)), airport.gates ?? []);
    for (const b of blds) obstacles.add(b);
    // Airliner stands at the gates (nose-in, front-left door at the boarding bridge); replaces the derived apron stands.
    const gateStands = spacedStands(findGateSites(airport.gates ?? [], blds));
    if (gateStands.length) airport.standsJet = gateStands;
    airports.push(airport);
    if (decodeLandcover) {
      const lcb = await fetcher(`${base}/${p.id}/landcover_hi.png`);
      const n = Math.round(2 * p.half / 20) + 1;
      landcovers.push(new LandCover(await decodeLandcover(lcb, n), n, p.half, 20, p.cx, p.cy));
    }
  }
  let landcover: LandCover | null = null;
  if (decodeLandcover) {
    onProgress?.('Land cover (ESA WorldCover)');
    const lc = await fetcher(`${base}/${meta.landcoverLo.file}`);
    landcover = new LandCover(await decodeLandcover(lc, meta.landcoverLo.n), meta.landcoverLo.n, meta.landcoverLo.half, meta.landcoverLo.step);
  }
  const w = new World(meta, terrain, airports[0], obstacles, landcover, airports);
  w.landcovers = landcovers;
  return w;
}
