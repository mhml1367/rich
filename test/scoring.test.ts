import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreFinancialState } from '../src/game/scoring';

test('financial freedom requires passive coverage, two years of real expenses, and controlled debt', () => {
  const result = scoreFinancialState({
    realNetWorth: 24_000_000n, realAssets: 30_000_000n, realLiabilities: 6_000_000n,
    realCash: 6_000_000n, realPassiveIncome: 1_000_000n, realMonthlyObligations: 1_000_000n,
    lifeQuality: 80, arrears: 0n,
  });
  assert.equal(result.status, 'freedom');
  assert.equal(result.meetsFreedom, true);
  assert.equal(result.score, 94);
  assert.deepEqual(result.freedomChecks, { incomeCoversExpenses: true, capitalGoalReached: true, debtRatioHealthy: true });
});

test('negative real net worth signals bankruptcy and blocks financial freedom', () => {
  const result = scoreFinancialState({
    realNetWorth: -1n, realAssets: 10_000_000n, realLiabilities: 10_000_001n,
    realCash: 0n, realPassiveIncome: 2_000_000n, realMonthlyObligations: 1_000_000n,
    lifeQuality: 20, arrears: 4_000_000n,
  });
  assert.equal(result.status, 'bankrupt');
  assert.equal(result.meetsFreedom, false);
  assert.equal(result.restructuringEligible, true);
});
