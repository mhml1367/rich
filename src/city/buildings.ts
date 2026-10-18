import type { Category } from '../economy/math';

export const CITY_BUILDINGS = [
  { id: 'workshop', name: 'کارگاه سازه', baseCost: 4_000_000n, monthlyIncome: 860_000n, indexCategory: 'materials' },
  { id: 'market', name: 'بازار شهر', baseCost: 5_500_000n, monthlyIncome: 420_000n, indexCategory: 'equipment' },
  { id: 'homes', name: 'محلهٔ خانه‌ها', baseCost: 3_000_000n, monthlyIncome: 320_000n, indexCategory: 'housing' },
  { id: 'civic', name: 'ساختمان شهر', baseCost: 6_000_000n, monthlyIncome: 210_000n, indexCategory: null },
  { id: 'park', name: 'پارک محله', baseCost: 1_500_000n, monthlyIncome: 0n, indexCategory: null },
] as const satisfies readonly { id: string; name: string; baseCost: bigint; monthlyIncome: bigint; indexCategory: Category | null }[];

export type CityBuildingId = (typeof CITY_BUILDINGS)[number]['id'];
