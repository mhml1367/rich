export const INDEX_SCALE = 1_000_000n;
export const RATE_SCALE = 10_000n; // basis points: 10000 = 100%

export type Category = 'food' | 'housing' | 'car' | 'gold' | 'currency' | 'equipment' | 'materials';
export const CATEGORIES: Category[] = ['food', 'housing', 'car', 'gold', 'currency', 'equipment', 'materials'];
export type Indices = Record<Category, bigint>;

export function nonNegative(value: bigint, label: string): bigint {
  if (value < 0n) throw new RangeError(`${label} must be non-negative`);
  return value;
}

// Integer rounding, half away from zero. All amounts are integer tomans.
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((absolute + denominator / 2n) / denominator);
}

export function applyBasisPoints(value: bigint, basisPoints: bigint): bigint {
  return divRound(value * basisPoints, RATE_SCALE);
}

export function nextIndex(current: bigint, monthlyChangeBps: bigint): bigint {
  if (current <= 0n || monthlyChangeBps <= -RATE_SCALE) throw new RangeError('invalid index or change');
  return divRound(current * (RATE_SCALE + monthlyChangeBps), RATE_SCALE);
}

// Real value in base-period tomans. For a basket, pass its weighted index.
export function realValue(nominalTomans: bigint, currentIndex: bigint, baseIndex: bigint = INDEX_SCALE): bigint {
  if (currentIndex <= 0n || baseIndex <= 0n) throw new RangeError('indices must be positive');
  return divRound(nominalTomans * baseIndex, currentIndex);
}

export function purchasingPower(nominalTomans: bigint, categoryIndex: bigint, baseIndex: bigint = INDEX_SCALE): bigint {
  return realValue(nominalTomans, categoryIndex, baseIndex);
}

export function nominalRequired(baseTomans: bigint, currentIndex: bigint, baseIndex: bigint = INDEX_SCALE): bigint {
  if (baseIndex <= 0n || currentIndex <= 0n) throw new RangeError('indices must be positive');
  return divRound(baseTomans * currentIndex, baseIndex);
}

export function weightedIndex(indices: Indices, weights: Record<Category, bigint>): bigint {
  const total = CATEGORIES.reduce((sum, category) => sum + weights[category], 0n);
  if (total !== RATE_SCALE) throw new RangeError('basket weights must total 10000 bps');
  return divRound(CATEGORIES.reduce((sum, category) => sum + indices[category] * weights[category], 0n), RATE_SCALE);
}

export function loanInterest(principal: bigint, annualRateBps: bigint): bigint {
  nonNegative(principal, 'principal');
  nonNegative(annualRateBps, 'annual rate');
  return divRound(principal * annualRateBps, 12n * RATE_SCALE);
}

// Finds the smallest fixed monthly payment that clears principal in N months.
// Periodic interest rounds to the nearest toman, identically to settlement.
export function fixedPayment(principal: bigint, annualRateBps: bigint, months: number): bigint {
  nonNegative(principal, 'principal');
  if (!Number.isSafeInteger(months) || months < 1 || months > 600) throw new RangeError('months must be 1..600');
  if (annualRateBps < 0n || annualRateBps > 1_000_000n) throw new RangeError('invalid annual rate');
  if (principal === 0n) return 0n;
  const clears = (payment: bigint): boolean => {
    let balance = principal;
    for (let month = 0; month < months && balance > 0n; month++) {
      balance = balance + loanInterest(balance, annualRateBps) - payment;
    }
    return balance <= 0n;
  };
  let low = 0n;
  let high = principal + loanInterest(principal, annualRateBps);
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    if (clears(middle)) high = middle;
    else low = middle;
  }
  return high;
}

export function lateFee(overdueTomans: bigint, monthlyPenaltyBps: bigint, monthsLate: number): bigint {
  nonNegative(overdueTomans, 'overdue');
  nonNegative(monthlyPenaltyBps, 'penalty rate');
  if (!Number.isSafeInteger(monthsLate) || monthsLate < 0) throw new RangeError('invalid months late');
  return applyBasisPoints(overdueTomans, monthlyPenaltyBps * BigInt(monthsLate));
}

export function installment(principal: bigint, annualRateBps: bigint, monthsRemaining: number, available: bigint) {
  const interest = loanInterest(principal, annualRateBps);
  const due = monthsRemaining === 1 ? principal + interest : fixedPayment(principal, annualRateBps, monthsRemaining);
  const paid = available < due ? available : due;
  const interestPaid = paid < interest ? paid : interest;
  const principalPaid = paid - interestPaid;
  return { due, paid, interest, interestPaid, principalPaid, overdue: due - paid, principalRemaining: principal - principalPaid };
}
