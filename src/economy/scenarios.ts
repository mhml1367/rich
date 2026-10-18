import { CATEGORIES, type Category } from './math';

export type ScenarioId = 'recession' | 'boom' | 'high_inflation' | 'market_shock';
export interface Scenario {
  id: ScenarioId;
  label: string;
  monthlyChangeBps: Record<Category, bigint>;
  wageChangeBps: bigint;
  referenceAnnualRateBps: bigint;
}

// Fictional game parameters, not observations or forecasts of Iran's economy.
export const SCENARIOS: Record<ScenarioId, Scenario> = {
  recession: {
    id: 'recession', label: 'رکود',
    monthlyChangeBps: { food: 120n, housing: 80n, car: -150n, gold: 40n, currency: 50n, equipment: -60n, materials: -100n },
    wageChangeBps: 30n, referenceAnnualRateBps: 2100n,
  },
  boom: {
    id: 'boom', label: 'رونق',
    monthlyChangeBps: { food: 90n, housing: 140n, car: 160n, gold: 70n, currency: 40n, equipment: 130n, materials: 180n },
    wageChangeBps: 180n, referenceAnnualRateBps: 1800n,
  },
  high_inflation: {
    id: 'high_inflation', label: 'تورم بالا',
    monthlyChangeBps: { food: 550n, housing: 430n, car: 650n, gold: 720n, currency: 760n, equipment: 610n, materials: 700n },
    wageChangeBps: 220n, referenceAnnualRateBps: 3000n,
  },
  market_shock: {
    id: 'market_shock', label: 'شوک بازار',
    monthlyChangeBps: { food: 240n, housing: 100n, car: -900n, gold: 1100n, currency: 1400n, equipment: 850n, materials: 950n },
    wageChangeBps: 40n, referenceAnnualRateBps: 3200n,
  },
};

export function scenarioById(id: string): Scenario {
  if (!(id in SCENARIOS)) throw new RangeError('unknown scenario');
  const scenario = SCENARIOS[id as ScenarioId];
  for (const category of CATEGORIES) {
    if (scenario.monthlyChangeBps[category] <= -10_000n) throw new RangeError('index change must exceed -100%');
  }
  return scenario;
}
