import { applyBasisPoints, fixedPayment, loanInterest, nonNegative } from './math';

export interface LoanBalance {
  principal: bigint;
  arrearsInterest: bigint;
  arrearsPrincipal: bigint;
  arrearsFee: bigint;
  monthsRemaining: number;
  monthlyPenaltyBps: bigint;
}

export function settleLoan(balance: LoanBalance, annualRateBps: bigint, cashAvailable: bigint) {
  nonNegative(cashAvailable, 'cash');
  if (balance.monthsRemaining < 0 || balance.arrearsPrincipal > balance.principal) throw new RangeError('invalid loan balance');
  const fee = applyBasisPoints(balance.arrearsInterest + balance.arrearsPrincipal + balance.arrearsFee, balance.monthlyPenaltyBps);
  const interest = loanInterest(balance.principal, annualRateBps);
  const regularPrincipal = balance.monthsRemaining === 1
    ? balance.principal - balance.arrearsPrincipal
    : balance.monthsRemaining > 1
      ? ((payment) => payment > interest ? payment - interest : 0n)(fixedPayment(balance.principal - balance.arrearsPrincipal, annualRateBps, balance.monthsRemaining))
      : 0n;
  const scheduledPrincipal = regularPrincipal > balance.principal - balance.arrearsPrincipal
    ? balance.principal - balance.arrearsPrincipal : regularPrincipal;
  const due = balance.arrearsFee + fee + balance.arrearsInterest + balance.arrearsPrincipal + interest + scheduledPrincipal;
  let remaining = cashAvailable < due ? cashAvailable : due;
  const paid = remaining;
  const take = (amount: bigint): bigint => { const used = remaining < amount ? remaining : amount; remaining -= used; return used; };
  const feePaid = take(balance.arrearsFee + fee);
  const oldInterestPaid = take(balance.arrearsInterest);
  const currentInterestPaid = take(interest);
  const oldPrincipalPaid = take(balance.arrearsPrincipal);
  const currentPrincipalPaid = take(scheduledPrincipal);
  return {
    due, paid, interest, fee,
    next: {
      principal: balance.principal - oldPrincipalPaid - currentPrincipalPaid,
      arrearsInterest: balance.arrearsInterest - oldInterestPaid + interest - currentInterestPaid,
      arrearsPrincipal: balance.arrearsPrincipal - oldPrincipalPaid + scheduledPrincipal - currentPrincipalPaid,
      arrearsFee: balance.arrearsFee + fee - feePaid,
      monthsRemaining: balance.monthsRemaining > 0 ? balance.monthsRemaining - 1 : 0,
      monthlyPenaltyBps: balance.monthlyPenaltyBps,
    },
  };
}
