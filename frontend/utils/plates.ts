export interface PlateConfig {
  barWeight: number;
  plates: number[];
  unit: 'kg' | 'lb';
}

export const DEFAULT_PLATE_CONFIG_KG: PlateConfig = {
  barWeight: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
  unit: 'kg',
};

export const DEFAULT_PLATE_CONFIG_LB: PlateConfig = {
  barWeight: 45,
  plates: [45, 35, 25, 10, 5, 2.5],
  unit: 'lb',
};

export interface PlateResult {
  achievable: boolean;
  target: number;
  perSide: { weight: number; count: number }[];
  totalLoaded: number;
  remainder: number;
  message?: string;
}

/**
 * Calculate plates per side for a barbell load.
 * Offline, pure, instant.
 */
export function calculatePlates(target: number, config: PlateConfig): PlateResult {
  if (target < config.barWeight) {
    return {
      achievable: false,
      target,
      perSide: [],
      totalLoaded: config.barWeight,
      remainder: target - config.barWeight,
      message: `Target is below bar weight (${config.barWeight} ${config.unit}).`,
    };
  }

  let remainingPerSide = (target - config.barWeight) / 2;
  const sorted = [...config.plates].sort((a, b) => b - a);
  const perSide: { weight: number; count: number }[] = [];

  for (const plate of sorted) {
    const count = Math.floor(remainingPerSide / plate + 1e-9);
    if (count > 0) {
      perSide.push({ weight: plate, count });
      remainingPerSide -= count * plate;
    }
  }

  remainingPerSide = Math.round(remainingPerSide * 1000) / 1000;
  const used = perSide.reduce((a, p) => a + p.weight * p.count, 0);
  const totalLoaded = config.barWeight + used * 2;
  const achievable = remainingPerSide < 0.01;

  return {
    achievable,
    target,
    perSide,
    totalLoaded: Math.round(totalLoaded * 100) / 100,
    remainder: achievable ? 0 : Math.round(remainingPerSide * 2 * 100) / 100,
    message: achievable
      ? undefined
      : `Closest: ${totalLoaded} ${config.unit} (${remainingPerSide * 2} ${config.unit} short).`,
  };
}

export function formatPlateStack(result: PlateResult, unit: string): string {
  if (result.perSide.length === 0) return `Bar only (${result.totalLoaded} ${unit})`;
  return result.perSide.map((p) => `${p.count}×${p.weight}`).join(' + ');
}
