export const LOAN_PRODUCTS = {
  fixed: { spreadBps: 500n, monthlyPenaltyBps: 100n, minMonths: 6, maxMonths: 60 },
  variable: { marginBps: 200n, monthlyPenaltyBps: 150n, minMonths: 6, maxMonths: 60 },
} as const;
