export type FinancialStatus = 'building' | 'freedom' | 'restructure' | 'bankrupt';

export interface FinancialScoreInput {
  realNetWorth: bigint;
  realAssets: bigint;
  realLiabilities: bigint;
  realCash: bigint;
  realPassiveIncome: bigint;
  realMonthlyObligations: bigint;
  lifeQuality: number;
  arrears: bigint;
}

const ratio = (value: bigint, target: bigint): number => {
  if (target <= 0n) return value > 0n ? 100 : 0;
  if (value <= 0n) return 0;
  const points = value * 100n / target;
  return Number(points > 100n ? 100n : points);
};

export function scoreFinancialState(input: FinancialScoreInput) {
  const { realNetWorth, realAssets, realLiabilities, realCash, realPassiveIncome, realMonthlyObligations } = input;
  const wealth = ratio(realNetWorth, realMonthlyObligations * 24n);
  const liquidity = ratio(realCash, realMonthlyObligations * 6n);
  const debtHealth = realAssets <= 0n
    ? (realLiabilities === 0n ? 100 : 0)
    : Math.max(0, Math.min(100, Number((realAssets - realLiabilities) * 100n / realAssets)));
  const incomeCoverage = ratio(realPassiveIncome, realMonthlyObligations);
  const qualityOfLife = Math.max(0, Math.min(100, Math.floor(input.lifeQuality)));
  const total = Math.round(wealth * 0.25 + liquidity * 0.15 + debtHealth * 0.2 + incomeCoverage * 0.3 + qualityOfLife * 0.1);
  const freedomChecks = {
    incomeCoversExpenses: realMonthlyObligations > 0n && realPassiveIncome >= realMonthlyObligations,
    capitalGoalReached: realMonthlyObligations > 0n && realNetWorth >= realMonthlyObligations * 24n,
    debtRatioHealthy: realAssets > 0n && realLiabilities * 100n <= realAssets * 35n,
  };
  const meetsFreedom = Object.values(freedomChecks).every(Boolean);
  const bankrupt = realNetWorth < 0n;
  const restructuring = !bankrupt && input.arrears >= realMonthlyObligations * 3n && input.arrears > 0n;
  const status: FinancialStatus = bankrupt ? 'bankrupt' : restructuring ? 'restructure' : meetsFreedom ? 'freedom' : 'building';

  return {
    score: total,
    dimensions: { wealth, liquidity, debtHealth, incomeCoverage, qualityOfLife },
    status,
    meetsFreedom,
    freedomChecks,
    restructuringEligible: bankrupt || restructuring,
    assetsTomans: input.realAssets.toString(),
    liabilitiesTomans: input.realLiabilities.toString(),
    netWorthTomans: realNetWorth.toString(),
    cashTomans: realCash.toString(),
    passiveIncomeTomans: realPassiveIncome.toString(),
    monthlyObligationsTomans: realMonthlyObligations.toString(),
    arrearsTomans: input.arrears.toString(),
  };
}
