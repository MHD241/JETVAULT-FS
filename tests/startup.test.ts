import { describe, it, expect } from 'vitest';
import { recommendPreset, displayPixels } from '../src/graphicsAuto';
import { describeError } from '../src/fatal';

const m = (o: Partial<Parameters<typeof recommendPreset>[0]> = {}) => ({ cssWidth: 1920, cssHeight: 1080, dpr: 1, cores: 8, memoryGb: 8, touch: false, ...o });

describe('first-launch graphics', () => {
  it('chooses High for an ordinary computer and Low for big sharp screens and weak devices', () => {
    expect(recommendPreset(m())).toBe('high');                                              // 1080p desktop
    expect(recommendPreset(m({ cssWidth: 1440, cssHeight: 900, dpr: 2 }))).toBe('high');    // 13-inch laptop: 5.2 million pixels
    expect(recommendPreset(m({ cssWidth: 2240, cssHeight: 1260, dpr: 2 }))).toBe('low');    // 24-inch iMac: 11 million
    expect(recommendPreset(m({ cssWidth: 2560, cssHeight: 1440, dpr: 2 }))).toBe('low');    // 27-inch 5K
    expect(recommendPreset(m({ cssWidth: 390, cssHeight: 800, dpr: 3, touch: true }))).toBe('low');   // phone
    expect(recommendPreset(m({ memoryGb: 2 }))).toBe('low'); expect(recommendPreset(m({ cores: 2 }))).toBe('low');
    expect(recommendPreset(m({ memoryGb: null, cores: 0 }))).toBe('high');                  // unknown values do not force Low
    expect(displayPixels(m({ cssWidth: 100, cssHeight: 100, dpr: 2 }))).toBe(40000);
  });
});
describe('start-up errors', () => {
  it('explains the common failures in plain words', () => {
    expect(describeError(new Error('WebGL 2 is not available')).title).toMatch(/3D graphics/);
    expect(describeError(new TypeError('Failed to fetch')).title).toMatch(/downloaded/);
    expect(describeError(new Error('Array buffer allocation failed')).title).toMatch(/memory/);
    expect(describeError('something odd').title).toMatch(/could not start/);
    expect(describeError(undefined).hint.length).toBeGreaterThan(10);
  });
});
