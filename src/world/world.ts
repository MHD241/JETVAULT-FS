import { Terrain, HeightGrid } from './terrain';
import { AirportData, PavementIndex } from './airport';
import { Building, ObstacleIndex, parseBuildings, styleAirportBuildings, findGateSites, spacedStands } from './obstacles';
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

export interface LoadedPatch {
  meta: PatchMeta;
  grid: HeightGrid;
  lc: LandCover | null;
  buildings: Building[];
}

export class World implements GroundQuery {
  pavement: PavementIndex;
  private pavements: PavementIndex[];
  wetRunway = false;
  /** All airports in the world; `airport` is the current one (spawn position, runways, cockpit map). */
  airports: AirportData[];
  /** Detail patches currently in memory (streamed in near the aircraft, out when it has left). */
  loaded = new Map<string, LoadedPatch>();
  private loading = new Map<string, Promise<LoadedPatch>>();
  /** Called after a patch has been added or removed (the renderer follows). */
  onPatchLoaded: ((p: LoadedPatch) => Promise<void> | void) | null = null;
  onPatchUnloaded: ((id: string) => void) | null = null;
  loader: { base: string; fetcher: Fetcher; decodeLandcover?: (buf: ArrayBuffer, n: number) => Promise<Uint8Array> } | null = null;
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

  patchOf(icao: string): PatchMeta | undefined { return this.meta.patches?.find((p) => p.icao === icao); }

  /** Distance (m) from a point to a patch's terrain square (0 inside). */
  patchDistance(p: PatchMeta, east: number, north: number) {
    return Math.hypot(Math.max(0, Math.abs(east - p.cx) - p.half), Math.max(0, Math.abs(north - p.cy) - p.half));
  }

  /** Loads a patch (terrain, land cover, buildings) if it is not in memory yet. */
  loadPatch(id: string): Promise<LoadedPatch> {
    const have = this.loaded.get(id);
    if (have) return Promise.resolve(have);
    const pending = this.loading.get(id);
    if (pending) return pending;
    const run = (async () => {
      const L = this.loader!;
      const idx = this.meta.patches.findIndex((p) => p.id === id);
      const pm = this.meta.patches[idx];
      const [hb, bb] = await Promise.all([L.fetcher(`${L.base}/${id}/terrain_hi.bin`), L.fetcher(`${L.base}/${id}/buildings.bin`)]);
      const grid = new HeightGrid({ n: Math.round(2 * pm.half / 30) + 1, half: pm.half, step: 30, scale: 0.1, cx: pm.cx, cy: pm.cy }, new Int16Array(hb));
      this.terrain.addPatch(id, grid, idx);
      const airport = this.airports[idx];
      const blds = styleAirportBuildings(parseBuildings(bb, (e, n) => this.terrain.heightAt(e, n)), airport.gates ?? []);
      for (const b of blds) this.obstacles.add(b, id);
      // Airliner stands at the gates (nose-in, front-left door at the boarding bridge); replaces the derived apron stands.
      const gateStands = spacedStands(findGateSites(airport.gates ?? [], blds));
      if (gateStands.length) airport.standsJet = gateStands;
      let lc: LandCover | null = null;
      if (L.decodeLandcover) {
        const n = Math.round(2 * pm.half / 20) + 1;
        lc = new LandCover(await L.decodeLandcover(await L.fetcher(`${L.base}/${id}/landcover_hi.png`), n), n, pm.half, 20, pm.cx, pm.cy);
        this.landcovers.set(id, lc);
      }
      const lp: LoadedPatch = { meta: pm, grid, lc, buildings: blds };
      this.loaded.set(id, lp);
      if (this.onPatchLoaded) await this.onPatchLoaded(lp);
      return lp;
    })();
    this.loading.set(id, run);
    run.finally(() => this.loading.delete(id));
    return run;
  }

  unloadPatch(id: string) {
    if (!this.loaded.has(id)) return;
    this.loaded.delete(id);
    this.terrain.removePatch(id);
    this.obstacles.removeTag(id);
    this.landcovers.delete(id);
    if (this.onPatchUnloaded) this.onPatchUnloaded(id);
  }

  /** Land cover of each loaded patch (20 m). */
  landcovers = new Map<string, LandCover>();

  heightAt(east: number, north: number, normalOut?: { e: number; n: number; u: number }) {
    return this.terrain.heightAt(east, north, normalOut);
  }

  isPaved(east: number, north: number) {
    for (const p of this.pavements) if (p.isPaved(east, north)) return true;
    return false;
  }

  landAt(east: number, north: number): number {
    for (const l of this.landcovers.values()) if (l.contains(east, north)) return l.at(east, north);
    return this.landcover ? this.landcover.at(east, north) : 0;
  }

  surfaceAt(east: number, north: number): SurfaceInfo {
    if (this.isPaved(east, north)) return this.wetRunway ? ASPHALT_WET : ASPHALT;
    if (this.landcover || this.landcovers.size) {
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
  /** Patches to load straight away; default is the first one (Edinburgh). Others stream in on demand. */
  initial: string[] | 'all' = ['egph'],
): Promise<World> {
  const text = async (p: string) => new TextDecoder().decode(await fetcher(`${base}/${p}`));
  onProgress?.('Region metadata');
  const meta = JSON.parse(await text('meta.json')) as RegionMeta;
  onProgress?.('Terrain elevation (Copernicus DEM)');
  const loBuf = await fetcher(`${base}/${meta.terrainLo.file}`);
  const lo = new HeightGrid({ ...meta.terrainLo, scale: meta.terrainLo.scale ?? 0.1 }, new Int16Array(loBuf));
  const terrain = new Terrain(null, lo);
  const airports: AirportData[] = [];
  for (const p of meta.patches) airports.push(JSON.parse(await text(`${p.id}/airport.json`)) as AirportData);
  let landcover: LandCover | null = null;
  if (decodeLandcover) {
    onProgress?.('Land cover (ESA WorldCover)');
    const lc = await fetcher(`${base}/${meta.landcoverLo.file}`);
    landcover = new LandCover(await decodeLandcover(lc, meta.landcoverLo.n), meta.landcoverLo.n, meta.landcoverLo.half, meta.landcoverLo.step);
  }
  const w = new World(meta, terrain, airports[0], new ObstacleIndex(100), landcover, airports);
  w.loader = { base, fetcher, decodeLandcover };
  const ids = initial === 'all' ? meta.patches.map((p) => p.id) : initial;
  for (const id of ids) {
    onProgress?.(`${meta.patches.find((p) => p.id === id)?.name ?? id}: terrain, imagery and buildings`);
    await w.loadPatch(id);
  }
  return w;
}
