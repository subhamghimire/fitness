import { calculatePlates, DEFAULT_PLATE_CONFIG_KG, formatPlateStack } from '../plates';

describe('calculatePlates', () => {
  it('loads 100 kg with 20 kg bar', () => {
    const r = calculatePlates(100, DEFAULT_PLATE_CONFIG_KG);
    expect(r.achievable).toBe(true);
    expect(r.totalLoaded).toBe(100);
    expect(r.perSide).toEqual([
      { weight: 25, count: 1 },
      { weight: 15, count: 1 },
    ]);
  });

  it('reports below bar', () => {
    const r = calculatePlates(15, DEFAULT_PLATE_CONFIG_KG);
    expect(r.achievable).toBe(false);
    expect(r.message).toMatch(/below bar/);
  });

  it('formats plate stack', () => {
    const r = calculatePlates(100, DEFAULT_PLATE_CONFIG_KG);
    expect(formatPlateStack(r, 'kg')).toContain('25');
  });
});
