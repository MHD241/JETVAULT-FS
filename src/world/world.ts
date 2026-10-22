import { Terrain, HeightGrid } from './terrain';
import { AirportData, PavementIndex } from './airport';
import { ObstacleIndex, parseBuildings, styleAirportBuildings } from './obstacles';
import { GroundQuery, SurfaceInfo } from '../sim/fdm/gear';

export interface RegionMeta {
  projection: string;
  origin: { lat: number; lon: number };
  terrainHi: { file: string; n: number; half: number; step: number; scale: number };
  terrainLo: { file: string; n: number; half: number; step: number; scale: number };
  landcoverHi: { file: string; n: number; half: number; step: number };
  landcoverLo: { file: string; n: number; half: number; step: number };
  buildings: { file: string; count: number };
  attribution: string[];
}

/** ESA WorldCover class codes. */
export const LC = {
  TREE: 10, SHRUB: 20, GRASS: 30, CROP: 40, BUILT: 50, BARE: 60, SNOW: 70, WATER: 80, WETLAND: 90,
  MANGROVE: 95, MOSS: 100,
} as const;

export class LandCover {
  constructor(public data: Uint8Array, public n: number, public half: number, public step: number) {}
  at(east: number, north: number): number {
    const c = Math.round((east + this.half) / this.step);
    const r = Math.round((this.half - north) / this.step);
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
  wetRunway = false;
  constructor(
    public meta: RegionMeta, public terrain: Terrain, public airport: AirportData,
    public obstacles: ObstacleIndex, public landcover: LandCover | null = null,
  ) {
    this.pavement = new PavementIndex(airport);
  }

  heightAt(east: number, north: number, normalOut?: { e: number; n: number; u: number }) {
    return this.terrain.heightAt(east, north, normalOut);
  }

  surfaceAt(east: number, north: number): SurfaceInfo {
    if (this.pavement.isPaved(east, north)) return this.wetRunway ? ASPHALT_WET : ASPHALT;
    if (this.landcover) {
      const c = this.landcover.at(east, north);
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
  const [hiBuf, loBuf] = await Promise.all([fetcher(`${base}/${meta.terrainHi.file}`), fetcher(`${base}/${meta.terrainLo.file}`)]);
  const hi = new HeightGrid(meta.terrainHi, new Int16Array(hiBuf));
  const lo = new HeightGrid(meta.terrainLo, new Int16Array(loBuf));
  const terrain = new Terrain(hi, lo);
  onProgress?.('Airport data');
  const airport = JSON.parse(await text('airport.json')) as AirportData;
  onProgress?.('Buildings');
  const obstacles = new ObstacleIndex(100);
  const bbuf = await fetcher(`${base}/${meta.buildings.file}`);
  const blds = styleAirportBuildings(parseBuildings(bbuf, (e, n) => terrain.heightAt(e, n)), airport.gates ?? []);
  for (const b of blds) obstacles.add(b);
  let landcover: LandCover | null = null;
  if (decodeLandcover) {
    onProgress?.('Land cover (ESA WorldCover)');
    const lc = await fetcher(`${base}/${meta.landcoverHi.file}`);
    landcover = new LandCover(await decodeLandcover(lc, meta.landcoverHi.n), meta.landcoverHi.n, meta.landcoverHi.half, meta.landcoverHi.step);
  }
  return new World(meta, terrain, airport, obstacles, landcover);
}
