export const SKILLS = [
  { id: 'management', name: 'مدیریت مالی', description: 'کاهش هزینهٔ حقوق شعبه‌ها' },
  { id: 'negotiation', name: 'مذاکره', description: 'کاهش نرخ وام هم‌بازی' },
  { id: 'marketing', name: 'بازاریابی', description: 'افزایش فروش کسب‌وکار' },
] as const;

export type SkillId = (typeof SKILLS)[number]['id'];

export const FUNDS = [
  { id: 'balanced', name: 'صندوق متعادل', allocations: { gold: 2000n, currency: 1000n, equipment: 1500n, materials: 2500n, food: 1500n, housing: 1500n }, annualFeeBps: 80 },
  { id: 'growth', name: 'صندوق رشد شهر', allocations: { gold: 500n, currency: 500n, equipment: 2500n, materials: 2500n, food: 1500n, housing: 2500n }, annualFeeBps: 120 },
  { id: 'hedge', name: 'صندوق پوشش تورم', allocations: { gold: 3500n, currency: 2500n, equipment: 1000n, materials: 1500n, food: 750n, housing: 750n }, annualFeeBps: 100 },
] as const;

export const INSURANCE_PLANS = [
  { id: 'crisis', name: 'پوشش شوک اقتصادی', premiumTomans: 120_000n, coverageTomans: 1_500_000n },
  { id: 'business', name: 'پوشش توقف کسب‌وکار', premiumTomans: 220_000n, coverageTomans: 2_500_000n },
] as const;

export const EVENT_CARDS = [
  { id: 'supply_shock', kind: 'crisis', title: 'اختلال زنجیرهٔ تأمین', description: 'هزینهٔ تجهیزات این دوره ۱۰٪ بیشتر است.', effect: { category: 'equipment', changeBps: 1000 } },
  { id: 'business_disruption', kind: 'crisis', title: 'تعطیلی کوتاه‌مدت بازار', description: 'شعبه‌های زیان‌ده بخشی از خسارت را از بیمهٔ کسب‌وکار می‌گیرند.', effect: { businessLossCoverBps: 5000 } },
  { id: 'city_contract', kind: 'opportunity', title: 'قرارداد خرید گروهی', description: 'با پرداخت ۵۰۰ هزار تومان، ۵۵۰ هزار تومان دارایی طلا بگیر.', effect: { category: 'gold', cashTomans: '500000', assetTomans: '550000' } },
  { id: 'mentor_visit', kind: 'skill', title: 'دیدار با مربی کسب‌وکار', description: 'یک مهارت را یک سطح ارتقا بده.', effect: { skillLevels: 1 } },
] as const;

export function clampScore(value: number) { return Math.max(0, Math.min(100, Math.floor(value))); }
