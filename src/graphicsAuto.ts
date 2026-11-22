// First-launch graphics choice: pick Low / High from the screen and the machine, so a player on a big sharp screen or a weak device does not start with a slideshow.
// (Ultra is never chosen automatically; the automatic resolution scale in pixelBudget.ts still protects the frame rate in flight.)
export interface Machine { cssWidth: number; cssHeight: number; dpr: number; cores: number; memoryGb: number | null; touch: boolean }
export type AutoPreset = 'low' | 'high';

/** Pixels the display has (not what the game draws): a 24-inch iMac is 11 million, a 1080p monitor 2 million, a phone about 1-2 million. */
export function displayPixels(m: Machine) { return m.cssWidth * m.cssHeight * m.dpr * m.dpr; }

export function recommendPreset(m: Machine): AutoPreset {
  if (m.touch && m.cssWidth < 1100) return 'low';                    // phones and small tablets
  if (m.memoryGb !== null && m.memoryGb <= 2) return 'low';
  if (m.cores > 0 && m.cores <= 2) return 'low';
  if (displayPixels(m) > 8e6) return 'low';                          // 4K and 5K screens: far more pixels than a mid-range graphics chip can fill
  return 'high';
}

export function currentMachine(): Machine {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return { cssWidth: window.innerWidth, cssHeight: window.innerHeight, dpr: window.devicePixelRatio || 1, cores: navigator.hardwareConcurrency || 0, memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null, touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0 };
}
