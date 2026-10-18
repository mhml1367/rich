import assert from 'node:assert/strict';
import test from 'node:test';
import { jalaliDate, nextPeriod, periodKey } from '../src/economy/calendar';
import { INDEX_SCALE, fixedPayment, nextIndex, nominalRequired, purchasingPower, realValue, weightedIndex, type Indices } from '../src/economy/math';
import { settleLoan } from '../src/economy/loan';
import { SCENARIOS } from '../src/economy/scenarios';
import { marketChangeBps, marketQuote } from '../src/economy/market';

test('Jalali month transition and Tehran calendar', () => {
  assert.equal(periodKey(jalaliDate(new Date('2026-03-21T12:00:00Z'))), '1405-01');
  assert.equal(nextPeriod('1405-12'), '1406-01');
  assert.throws(() => nextPeriod('1405-13'));
});

test('nominal versus real purchasing power uses the chosen price index', () => {
  const inflated = nextIndex(INDEX_SCALE, 2500n);
  assert.equal(inflated, 1_250_000n);
  assert.equal(realValue(1_250_000n, inflated), 1_000_000n);
  assert.equal(purchasingPower(1_000_000n, inflated), 800_000n);
  assert.equal(nominalRequired(1_000_000n, inflated), 1_250_000n);
  const indices = Object.fromEntries(['food','housing','car','gold','currency','equipment','materials'].map(x => [x, INDEX_SCALE])) as Indices;
  indices.food = inflated;
  assert.equal(weightedIndex(indices, { food: 4000n, housing: 3000n, car: 0n, gold: 0n, currency: 0n, equipment: 1000n, materials: 2000n }), 1_100_000n);
});

test('all category indices move by their scenario rates and convert nominal values back to real tomans', () => {
  for (const scenario of Object.values(SCENARIOS)) {
    for (const category of ['food', 'housing', 'car', 'gold', 'currency', 'equipment', 'materials'] as const) {
      const index = nextIndex(INDEX_SCALE, scenario.monthlyChangeBps[category]);
      assert.ok(index > 0n, `${scenario.id}/${category} must keep a positive price index`);
      const nominal = nominalRequired(2_000_000n, index);
      const real = realValue(nominal, index);
      assert.ok(real >= 1_999_998n && real <= 2_000_002n, `${scenario.id}/${category} real-value rounding`);
    }
  }
});

test('fixed installment clears the loan and keeps unpaid principal outstanding', () => {
  const principal = 12_000_000n;
  const payment = fixedPayment(principal, 2400n, 12);
  let balance = { principal, arrearsInterest: 0n, arrearsPrincipal: 0n, arrearsFee: 0n, monthsRemaining: 12, monthlyPenaltyBps: 100n };
  for (let i = 0; i < 12; i++) balance = settleLoan(balance, 2400n, payment + 1_000_000n).next;
  assert.equal(balance.principal, 0n);
  assert.equal(balance.arrearsInterest, 0n);

  const missed = settleLoan({ principal, arrearsInterest: 0n, arrearsPrincipal: 0n, arrearsFee: 0n, monthsRemaining: 12, monthlyPenaltyBps: 100n }, 2400n, 0n);
  assert.equal(missed.next.principal, principal);
  assert.ok(missed.next.arrearsInterest > 0n);
  assert.ok(missed.next.arrearsPrincipal > 0n);
  const recovered = settleLoan(missed.next, 2400n, principal * 2n);
  assert.ok(recovered.fee > 0n);
  assert.equal(recovered.next.arrearsPrincipal, 0n);
});

test('variable rate can reprice while fixed rate is stable', () => {
  const original = fixedPayment(10_000_000n, 1800n, 12);
  const shock = fixedPayment(10_000_000n, SCENARIOS.market_shock.referenceAnnualRateBps + 200n, 12);
  assert.ok(shock > original);
  assert.equal(SCENARIOS.recession.monthlyChangeBps.car < 0n, true);
});

test('simulated gold quotes are stable for retries and can move in both directions', () => {
  const changes = Array.from({ length: 24 }, (_, month) => marketChangeBps('city-1', `${1405 + Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, '0')}`, 'gold', 40n));
  assert.ok(changes.some(change => change < 0n));
  assert.ok(changes.some(change => change > 0n));
  assert.equal(marketChangeBps('city-1', '1405-01', 'gold', 40n), changes[0]);
  assert.equal(marketQuote('gold', 1_250_000n).priceTomans, '10000000');
});
