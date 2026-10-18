import type { Category } from '../economy/math';

export const BUSINESS_MODELS = [
  { id: 'grocery', name: 'خواربار محله', startupCost: 8_000_000n, baseRevenue: 2_800_000n, materialsCost: 1_550_000n, payrollCost: 620_000n, overheadCost: 260_000n, salesIndex: 'food', materialsIndex: 'food' },
  { id: 'cafe', name: 'کافهٔ شهری', startupCost: 12_000_000n, baseRevenue: 2_500_000n, materialsCost: 880_000n, payrollCost: 820_000n, overheadCost: 330_000n, salesIndex: 'food', materialsIndex: 'food' },
  { id: 'workshop', name: 'کارگاه تولیدی', startupCost: 15_000_000n, baseRevenue: 3_800_000n, materialsCost: 1_720_000n, payrollCost: 1_180_000n, overheadCost: 420_000n, salesIndex: 'materials', materialsIndex: 'materials' },
  { id: 'tailoring', name: 'خیاطی و پوشاک', startupCost: 9_000_000n, baseRevenue: 2_100_000n, materialsCost: 740_000n, payrollCost: 650_000n, overheadCost: 270_000n, salesIndex: 'materials', materialsIndex: 'materials' },
  { id: 'transport', name: 'حمل‌ونقل شهری', startupCost: 20_000_000n, baseRevenue: 4_100_000n, materialsCost: 1_450_000n, payrollCost: 1_520_000n, overheadCost: 720_000n, salesIndex: 'car', materialsIndex: 'car' },
  { id: 'rental', name: 'اجاره‌داری مسکن', startupCost: 25_000_000n, baseRevenue: 2_400_000n, materialsCost: 180_000n, payrollCost: 300_000n, overheadCost: 620_000n, salesIndex: 'housing', materialsIndex: 'housing' },
  { id: 'clinic', name: 'درمانگاه کوچک', startupCost: 18_000_000n, baseRevenue: 3_400_000n, materialsCost: 760_000n, payrollCost: 1_500_000n, overheadCost: 390_000n, salesIndex: 'equipment', materialsIndex: 'equipment' },
  { id: 'academy', name: 'آموزشگاه مهارت', startupCost: 10_000_000n, baseRevenue: 2_000_000n, materialsCost: 340_000n, payrollCost: 900_000n, overheadCost: 260_000n, salesIndex: 'equipment', materialsIndex: 'equipment' },
  { id: 'farm', name: 'گلخانه و مزرعه', startupCost: 13_000_000n, baseRevenue: 3_100_000n, materialsCost: 1_400_000n, payrollCost: 780_000n, overheadCost: 300_000n, salesIndex: 'food', materialsIndex: 'food' },
  { id: 'digital', name: 'خدمات دیجیتال', startupCost: 11_000_000n, baseRevenue: 2_900_000n, materialsCost: 560_000n, payrollCost: 1_050_000n, overheadCost: 300_000n, salesIndex: 'equipment', materialsIndex: 'equipment' },
] as const satisfies readonly { id: string; name: string; startupCost: bigint; baseRevenue: bigint; materialsCost: bigint; payrollCost: bigint; overheadCost: bigint; salesIndex: Category; materialsIndex: Category }[];

export type BusinessModelId = (typeof BUSINESS_MODELS)[number]['id'];
