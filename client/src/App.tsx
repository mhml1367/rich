import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { BuildingId } from './PixiCity';
import { AuthGate, type AuthResult } from './AuthGate';
import { CityWeatherIcon } from './CityWeatherIcon';
import { currentPersianPeriod, getCityWeather } from './cityWeather';

const PixiCity = lazy(() => import('./PixiCity').then((module) => ({ default: module.PixiCity })));
const MarketChart = lazy(() => import('./MarketChart').then((module) => ({ default: module.MarketChart })));

type Building = { id: BuildingId; name: string; kind: string; action: string; income: string; symbol: string; color: string; service?: boolean };
type FinancialProfile = {
  score: number;
  dimensions: { wealth: number; liquidity: number; debtHealth: number; incomeCoverage: number; qualityOfLife: number };
  status: 'building' | 'freedom' | 'restructure' | 'bankrupt';
  meetsFreedom: boolean;
  restructuringEligible: boolean;
  canRestructure: boolean;
  nextRestructurePeriod: string | null;
  freedomChecks: { incomeCoversExpenses: boolean; capitalGoalReached: boolean; debtRatioHealthy: boolean };
  assetsTomans: string;
  liabilitiesTomans: string;
  netWorthTomans: string;
  cashTomans: string;
  passiveIncomeTomans: string;
  monthlyObligationsTomans: string;
  arrearsTomans: string;
};
type ChatMessage = { id: string; playerId: string; displayName: string; message: string; createdAt: string };
type RivalAction = { playerId: string; displayName: string; style: string; action: string; category: string | null; amountTomans: string; status: string };
type LedgerDetail = { id: string; sourceKind: string; sourceId: string; amountTomans: string; businessModelId?: string; businessBranchNumber?: number; loanInstallmentNumber?: number };
type ReturnReport = { fromPeriod: string; toPeriod: string; periods: { periodKey: string; incomeTomans: string; expenseTomans: string; netCashChangeTomans: string; salaryTomans: string; cityIncomeTomans: string; transactions?: LedgerDetail[]; delegateAction: { action: string; category: string | null; amountTomans: string; status: string; reason: string | null } | null }[] };
type AutopilotPolicy = { enabled: boolean; strategy: 'reserve' | 'balanced' | 'growth'; reserve_months: number; invest_surplus_bps: number };
type BusinessModel = { id: string; name: string; startupCost: string; baseRevenue: string; materialsCost: string; payrollCost: string; overheadCost: string; salesIndex: string; materialsIndex: string };
type BusinessOwner = { playerId: string; displayName: string; isBot: boolean; shareBps: number; capitalTomans: string };
type BusinessBranch = { id: string; model_id: string; branch_number: number; level: number; manager_enabled: boolean; unpaid_expenses_tomans: string; retained_earnings_tomans: string; owners: BusinessOwner[]; last_period_key: string | null; revenue_tomans: string | null; materials_cost_tomans: string | null; payroll_cost_tomans: string | null; overhead_cost_tomans: string | null; manager_cost_tomans: string | null; net_profit_tomans: string | null; distributed_tomans: string | null };
type PartnershipOffer = { id: string; business_id: string; proposer_id: string; invitee_id: string; share_bps: number; contribution_tomans: string; period_key: string; model_id: string; proposer_name: string; invitee_name: string };
type RoomSnapshot = {
  room: { id: string; title: string; mode: string; scenario_id: string; invite_code: string; max_players: number; bot_count: number };
  turn: { period_key: string; deadline_at: string; status: string; turn_number: number; ready_count: number; human_count: number; is_ready: boolean } | null;
  members: { player_id: string; display_name: string; is_bot: boolean; bot_style: string | null; bot_difficulty?: string | null }[];
  playerId: string;
  account: { cash_tomans: string; monthly_salary_tomans: string; monthly_rent_tomans: string } | null;
  positions: { category: string; market_value_tomans: string }[];
  marketQuotes: Record<string, MarketQuote>;
  city: { buildingId: BuildingId; name: string; level: number; nextCostTomans: string | null; monthlyIncomeTomans: string; baseMonthlyIncomeTomans: string; maxLevel: number }[];
  financial: FinancialProfile | null;
  loans: { principalTomans: string; rateKind: string; annualRateBps: string; monthsRemaining: number; monthlyDueTomans: string; arrearsTomans: string }[];
  loanOffers: { fixedAnnualRateBps: string; variableAnnualRateBps: string; minMonths: number; maxMonths: number };
  checkRequests: { id: string; period_key: string; issuer_id: string; payee_id: string; guarantor_id: string; due_period: string; amount_tomans: string; issuer_name: string; payee_name: string; guarantor_name: string }[];
  checks: { id: string; issuer_id: string; payee_id: string; guarantor_id: string | null; due_period: string; amount_tomans: string; status: string; issuer_name: string; payee_name: string; guarantor_name: string | null }[];
  leaderboard: { playerId: string; displayName: string; isBot: boolean; netWorthTomans: string | null; cashTomans: string | null; rank: number }[];
  decision: { action_type: string; category: string | null; amount_tomans: string; status: string; reason?: string | null } | null;
  autopilot: AutopilotPolicy;
  chat: ChatMessage[];
  businessCatalog: BusinessModel[];
  businesses: BusinessBranch[];
  partnershipOffers: PartnershipOffer[];
  contractOffers: { id: string; proposer_id: string; proposer_name: string; contract_kind: 'loan' | 'asset_trade'; amount_tomans: string; interest_bps: number | null; months: number | null; asset_category: string | null; asset_value_tomans: string | null }[];
  businessMonthlyIncomeTomans: string;
  skills?: { management:number; negotiation:number; marketing:number; skill_points:number; experience_points:number };
  skillCatalog?: {id:string;name:string;description:string}[];
  eventCard?: {id:string;kind:string;title:string;description:string;choice:string|null}|null;
  funds?: {catalog:{id:string;name:string;annualFeeBps:number}[];positions:{fund_id:string;market_value_tomans:string}[]};
  insurance?: {catalog:{id:string;name:string;premiumTomans:string;coverageTomans:string}[];policies:{plan_id:string;active:boolean}[]};
  auctions?: {id:string;asset_category:string;reserve_price_tomans:string;highest_bid_tomans:string;bid_count:number}[];
  challenges?: {challenge_id:string;completed:boolean}[];
  wellbeing?: {free_time:number;health:number;security:number};
};
type Session = { roomId: string; token: string; displayName: string };
type MarketPoint = { periodKey: string; scenarioId: string; indices: Record<string, string> };
type MarketQuote = { name: string; unit: string; priceTomans: string; basePriceTomans: string; feeBps: number };
type Panel = 'connect' | 'market' | 'loan' | 'checks' | 'build' | 'business' | 'profile' | 'inventory' | 'chat' | 'autopilot' | 'report' | 'settings' | null;
type NoticeTarget = Exclude<Panel, 'connect' | null> | 'report';
type GameNotice = { text: string; target?: NoticeTarget };

const buildings: Building[] = [
  { id: 'workshop', name: 'کارگاه سازه', kind: 'تولید فعال • سطح ۲', action: 'ارتقای تولید', income: '۸۶۰ هزار تومان', symbol: '▰', color: '#3b82f6' },
  { id: 'market', name: 'بازار شهر', kind: 'تجارت • مرکز شهر', action: 'خرید تجهیزات', income: '۴۲۰ هزار تومان', symbol: '▤', color: '#f59e0b' },
  { id: 'homes', name: 'محلهٔ خانه‌ها', kind: 'مسکونی • ۱۲ خانوار', action: 'بهبود محله', income: '۳۲۰ هزار تومان', symbol: '⌂', color: '#0284c7' },
  { id: 'civic', name: 'ساختمان شهر', kind: 'خدمات شهری • سطح ۱', action: 'گسترش خدمات', income: '۲۱۰ هزار تومان', symbol: '✦', color: '#10b981' },
  { id: 'park', name: 'پارک محله', kind: 'فضای سبز • کیفیت زندگی', action: 'کاشت درخت', income: 'شادمانی شهر +۲', symbol: '✿', color: '#10b981' },
  { id: 'bank', name: 'بانک شهر', kind: 'تسهیلات و بازپرداخت', action: 'دیدن وام‌ها', income: 'وام ثابت و متغیر', symbol: '◆', color: '#f59e0b', service: true },
  { id: 'business', name: 'برج کسب‌وکار', kind: 'مرکز کارآفرینی', action: 'دیدن ساخت‌وساز', income: 'مدیریت توسعهٔ شهر', symbol: '▣', color: '#10b981', service: true },
  { id: 'realEstate', name: 'مشاور املاک', kind: 'ملک و محله', action: 'دیدن ساخت‌وساز', income: 'فرصت‌های محله', symbol: '⌂', color: '#ef7777', service: true },
  { id: 'academy', name: 'دانشکده مهارت‌ها', kind: 'آموزش شهری', action: 'دیدن ساختمان', income: 'مهارت‌های آینده', symbol: '✦', color: '#7588cf', service: true },
  { id: 'insurance', name: 'مرکز بیمه', kind: 'پوشش ریسک', action: 'دیدن ساختمان', income: 'پوشش‌های آینده', symbol: '✚', color: '#79a99a', service: true },
  { id: 'labor', name: 'بازار کار', kind: 'اشتغال و درآمد', action: 'دیدن ساختمان', income: 'فرصت‌های شغلی', symbol: '●', color: '#559cc5', service: true },
];
const npcGuides: Record<BuildingId, { name: string; role: string; line: string; tip: string; color: string }> = {
  bank: { name: 'آقای فرهمند', role: 'مدیر بانک شهر', line: 'قبل از وام، قسط را کنار اجاره و هزینه‌های ماهانه بسنج.', tip: 'پیشنهاد وام و بازپرداخت را در پنجرهٔ بانک ببین.', color: '#10b981' },
  market: { name: 'خانم بهمنی', role: 'کاسب بازار', line: 'قیمت کالاها با سناریوی اقتصادی این دوره تغییر می‌کند.', tip: 'برای خرید و فروش دارایی‌ها وارد بازار شو.', color: '#ef5959' },
  workshop: { name: 'استاد مرادی', role: 'مدیر کارگاه', line: 'ارتقای کارگاه، درآمد غیرفعال شهر را بیشتر می‌کند.', tip: 'هزینهٔ ساخت و درآمد ماهانه را پیش از اقدام بررسی کن.', color: '#3b82f6' },
  homes: { name: 'خانم نادری', role: 'نمایندهٔ محله', line: 'خانهٔ بهتر هم ارزش شهر را بالا می‌برد و هم کیفیت زندگی را.', tip: 'ارتقای محله را از گزینه‌های ساخت‌وساز انجام بده.', color: '#0284c7' },
  civic: { name: 'آقای کیانی', role: 'حسابدار شهر', line: 'درآمدهای پایدار را با تعهدهای ماهانه مقایسه کن.', tip: 'خلاصهٔ دخل‌وخرج در کارنامهٔ مالی توست.', color: '#10b981' },
  park: { name: 'باغبان بهار', role: 'نگهبان پارک', line: 'فضای سبز روی کیفیت زندگی شهر اثر می‌گذارد.', tip: 'پارک را در فهرست ساخت‌وساز گسترش بده.', color: '#10b981' },
  business: { name: 'خانم رستگار', role: 'مشاور کارآفرینی', line: 'برای رشد، اول ذخیرهٔ امن و هزینهٔ ثابت کسب‌وکار را حساب کن.', tip: 'از اینجا شعبه بساز، مدیر استخدام کن و با بازیکنان شهر شریک شو.', color: '#f59e0b' },
  realEstate: { name: 'آقای توکلی', role: 'مشاور املاک', line: 'پیش از خرید، روند مسکن و قدرت خرید واقعی را ببین.', tip: 'روند شاخص مسکن در پنجرهٔ بازار نمایش داده می‌شود.', color: '#ef7777' },
  academy: { name: 'استاد راد', role: 'مربی مهارت', line: 'تصمیم خوب از شناخت جریان نقدی و ریسک شروع می‌شود.', tip: 'امتیازها و نقاط قوت را در کارنامهٔ مالی بررسی کن.', color: '#8b5cf6' },
  insurance: { name: 'خانم ایمنی', role: 'کارشناس بیمه', line: 'پیش از پذیرفتن ضمانت، توان پرداخت خودت را بسنج.', tip: 'چک‌ها و ضمانت‌های فعال را در کوله‌پشتی ببین.', color: '#10b981' },
  labor: { name: 'آقای شریفی', role: 'کارگزار بازار کار', line: 'حقوق و اجاره هر دوره با وضعیت اقتصاد شهر تغییر می‌کنند.', tip: 'جزئیات حقوق و تعهدها را در کوله‌پشتی دنبال کن.', color: '#0284c7' },
};
const guideDestinations: Record<BuildingId, NoticeTarget> = {
  bank: 'loan', market: 'market', workshop: 'build', homes: 'build', civic: 'report', park: 'build',
  business: 'business', realEstate: 'market', academy: 'profile', insurance: 'inventory', labor: 'inventory',
};
const navItems = [
  { id: 'inventory', label: 'دارایی', symbol: '▣', tone: 'blue' },
  { id: 'profile', label: 'کارنامه', symbol: '◉', tone: 'red' },
  { id: 'turn', label: 'پایان ماه', symbol: '◷', tone: 'gold' },
  { id: 'chat', label: 'گفت‌وگو', symbol: '▰', tone: 'green' },
  { id: 'autopilot', label: 'نماینده', symbol: '✦', tone: 'violet' },
  { id: 'report', label: 'گزارش', symbol: '▤', tone: 'blue' },
  { id: 'settings', label: 'تنظیمات', symbol: '⚙', tone: 'gold' },
] as const;
const categories = [
  ['gold', 'طلا'], ['currency', 'ارز'], ['car', 'خودرو'], ['equipment', 'تجهیزات'], ['materials', 'مواد اولیه'],
] as const;
const scoreDimensions: [keyof FinancialProfile['dimensions'], string][] = [
  ['wealth', 'ثروت واقعی'], ['liquidity', 'نقدینگی'], ['debtHealth', 'سلامت بدهی'], ['incomeCoverage', 'پوشش هزینه با درآمد غیرفعال'], ['qualityOfLife', 'کیفیت زندگی'],
];
const apiBase = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const formatMoney = (value?: string | null) => value == null ? '—' : `${new Intl.NumberFormat('fa-IR').format(BigInt(value))} تومان`;
const parseMoneyInput = (value: string) => value
  .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
  .replace(/\D/g, '');
const formatMoneyInput = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const estimateLoanPayment = (principal: bigint, annualRateBps: bigint, months: number) => {
  if (principal <= 0n || months < 1) return 0n;
  const monthlyInterest = (balance: bigint) => (balance * annualRateBps + 60_000n) / 120_000n;
  const clears = (payment: bigint) => {
    let balance = principal;
    for (let month = 0; month < months && balance > 0n; month += 1) balance += monthlyInterest(balance) - payment;
    return balance <= 0n;
  };
  let low = 0n;
  let high = principal + monthlyInterest(principal);
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    if (clears(middle)) high = middle;
    else low = middle;
  }
  return high;
};
const ledgerLabels: Record<string, string> = {
  salary: 'حقوق ماهانه', city_income: 'درآمد ساختمان شهر', business_income: 'سهم درآمد کسب‌وکار', rent: 'اجارهٔ ماهانه',
  loan_payment: 'قسط وام', loan_arrears: 'بدهی و جریمهٔ دیرکرد', guarantee_claim_payment: 'بازپرداخت ضمانت',
  check_debit: 'پرداخت چک', check_credit: 'دریافت چک', check_guarantee_debit: 'پرداخت ضمانت چک', check_guarantee_credit: 'دریافت ضمانت چک',
  asset_buy: 'خرید دارایی', asset_sell: 'فروش دارایی', market_fee: 'کارمزد معاملهٔ بازار', event_opportunity_buy: 'خرید فرصت رویداد', insurance_premium: 'حق‌بیمه', insurance_claim: 'دریافت خسارت بیمه',
  auction_sale: 'فروش در مزایده', auction_purchase: 'خرید در مزایده', business_startup: 'سرمایهٔ آغاز کسب‌وکار', business_partner_capital: 'آوردهٔ شراکت',
  p2p_loan_funded: 'وام به بازیکن', p2p_loan_received: 'دریافت وام از بازیکن', p2p_loan_repayment_received: 'دریافت بازپرداخت وام',
  p2p_asset_sale: 'فروش دارایی به بازیکن', p2p_asset_purchase: 'خرید دارایی از بازیکن', asset_sent: 'انتقال دارایی', asset_received: 'دریافت دارایی',
};
const ledgerCategoryNames: Record<string, string> = { food: 'خوراک', housing: 'مسکن', car: 'خودرو', gold: 'طلا', currency: 'ارز', equipment: 'تجهیزات', materials: 'مواد اولیه', workshop: 'کارگاه', market: 'بازار', homes: 'محلهٔ مسکونی', civic: 'خدمات شهری', park: 'پارک' };
const ledgerDescription = (entry: LedgerDetail, businessCatalog: BusinessModel[] = []) => {
  const category = entry.sourceId.split(':').at(-1) || '';
  const categoryName = ledgerCategoryNames[category];
  if (entry.sourceKind === 'business_startup' && entry.businessModelId) {
    const businessName = businessCatalog.find((model) => model.id === entry.businessModelId)?.name || entry.businessModelId;
    return `${ledgerLabels.business_startup} · ${businessName}${entry.businessBranchNumber ? ` · شعبهٔ ${new Intl.NumberFormat('fa-IR').format(entry.businessBranchNumber)}` : ''}`;
  }
  if (entry.sourceKind === 'business_income' && entry.businessModelId) {
    const businessName = businessCatalog.find((model) => model.id === entry.businessModelId)?.name || entry.businessModelId;
    return `درآمد ${businessName}${entry.businessBranchNumber ? ` · شعبهٔ ${new Intl.NumberFormat('fa-IR').format(entry.businessBranchNumber)}` : ''}`;
  }
  if (entry.sourceKind === 'loan_payment' && entry.loanInstallmentNumber) {
    return `قسط شمارهٔ ${new Intl.NumberFormat('fa-IR').format(entry.loanInstallmentNumber)} وام`;
  }
  if (entry.sourceKind === 'city_income' && categoryName) return `درآمد ${categoryName}`;
  if (['asset_buy', 'asset_sell', 'market_fee', 'p2p_asset_sale', 'p2p_asset_purchase'].includes(entry.sourceKind) && categoryName) {
    return `${ledgerLabels[entry.sourceKind]} · ${categoryName}`;
  }
  return ledgerLabels[entry.sourceKind] || 'تراکنش مالی';
};
const monthName = (key?: string) => {
  if (!key) return 'اتاق محلی';
  const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const [, month] = key.split('-').map(Number);
  return `${months[(month || 1) - 1]} ${new Intl.NumberFormat('fa-IR').format(Number(key.slice(0, 4)))}`;
};
const nextMonthKey = (key?: string) => {
  if (!key) return '';
  let [year, month] = key.split('-').map(Number);
  if (month === 12) { year += 1; month = 1; } else month += 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};

export default function App() {
  const [selectedId, setSelectedId] = useState<BuildingId>('workshop');
  const [cardOpen, setCardOpen] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState<GameNotice | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [reportHistory, setReportHistory] = useState<ReturnReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem('masir-reduced-motion') === 'true');
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [monthReaction, setMonthReaction] = useState(false);
  const [balanceReaction, setBalanceReaction] = useState<{ kind: 'income' | 'expense'; amountTomans: string } | null>(null);
  const [balanceReactionId, setBalanceReactionId] = useState(0);
  const [rivalActions, setRivalActions] = useState<RivalAction[]>([]);
  const [returnReport, setReturnReport] = useState<ReturnReport | null>(null);
  const [reportDetails, setReportDetails] = useState(false);
  const [expandedReportPeriod, setExpandedReportPeriod] = useState<string | null>(null);
  const [resumeCheckNonce, setResumeCheckNonce] = useState(0);
  const [marketHistory, setMarketHistory] = useState<MarketPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState('');
  const [authUser, setAuthUser] = useState<AuthResult | null>(() => {
    try { return JSON.parse(localStorage.getItem('masir-auth') || 'null') as AuthResult | null; } catch { return null; }
  });
  const [session, setSession] = useState<Session | null>(() => {
    try { return JSON.parse(sessionStorage.getItem('masir-room') || 'null') as Session | null; } catch { return null; }
  });
  const [displayName, setDisplayName] = useState(authUser?.user.displayName || session?.displayName || 'بازیکن');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [roomTitle, setRoomTitle] = useState('شهر نوپا');
  const [mode, setMode] = useState<'solo' | 'live' | 'async'>('live');
  const [turnSeconds, setTurnSeconds] = useState(180);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [botCount, setBotCount] = useState(0);
  const [scenario, setScenario] = useState('recession');
  const [tradeAction, setTradeAction] = useState<'buy' | 'sell'>('buy');
  const [category, setCategory] = useState('gold');
  const [amount, setAmount] = useState('1000000');
  const [loanAmount, setLoanAmount] = useState('10000000');
  const [loanMonths, setLoanMonths] = useState(24);
  const [loanRateKind, setLoanRateKind] = useState<'fixed' | 'variable'>('fixed');
  const [checkAmount, setCheckAmount] = useState('1000000');
  const [checkPayeeId, setCheckPayeeId] = useState('');
  const [checkGuarantorId, setCheckGuarantorId] = useState('');
  const [chatDraft, setChatDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<AutopilotPolicy>({ enabled: true, strategy: 'balanced', reserve_months: 1, invest_surplus_bps: 2500 });
  const [policyBusy, setPolicyBusy] = useState(false);
  const [partnerId, setPartnerId] = useState('');
  const [partnerShare, setPartnerShare] = useState(20);
  const [partnerContribution, setPartnerContribution] = useState('1000000');
  const [contractPlayerId, setContractPlayerId] = useState('');
  const [contractKind, setContractKind] = useState<'loan' | 'asset_trade'>('loan');
  const [contractAmount, setContractAmount] = useState('1000000');
  const [contractInterestBps, setContractInterestBps] = useState(1800);
  const [contractMonths, setContractMonths] = useState(12);
  const [contractAssetCategory, setContractAssetCategory] = useState('gold');
  const [contractAssetValue, setContractAssetValue] = useState('1000000');
  const socketRef = useRef<Socket | null>(null);
  const returnReportSessionRef = useRef('');
  const previousHudRef = useRef<{ roomId: string; periodKey: string | null; cashTomans: string | null } | null>(null);
  const monthReactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const balanceReactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = buildings.find((building) => building.id === selectedId) ?? buildings[0];
  const financial = snapshot?.financial ?? null;
  const homeTier = !financial ? 0 : BigInt(financial.netWorthTomans) >= 100_000_000n ? 3 : BigInt(financial.netWorthTomans) >= 40_000_000n ? 2 : BigInt(financial.netWorthTomans) >= 15_000_000n ? 1 : 0;
  const monthlyCashFlow = snapshot?.account ? BigInt(snapshot.account.monthly_salary_tomans)
    + (snapshot.city ?? []).reduce((sum, item) => sum + BigInt(item.monthlyIncomeTomans), 0n)
    + BigInt(snapshot.businessMonthlyIncomeTomans || '0')
    - BigInt(snapshot.account.monthly_rent_tomans)
    - (snapshot.loans ?? []).reduce((sum, loan) => sum + BigInt(loan.monthlyDueTomans), 0n) : null;
  const selectedMarketQuote = snapshot?.marketQuotes?.[category];
  const heldMarketValue = BigInt(snapshot?.positions.find((position) => position.category === category)?.market_value_tomans || '0');
  const marketCash = BigInt(snapshot?.account?.cash_tomans || '0');
  const tradeAmount = /^\d+$/.test(amount) ? BigInt(amount) : 0n;
  const tradeFee = selectedMarketQuote ? (tradeAmount * BigInt(selectedMarketQuote.feeBps) + 5_000n) / 10_000n : 0n;
  const tradeNet = tradeAmount > tradeFee ? tradeAmount - tradeFee : 0n;
  const tradeLimit = tradeAction === 'buy' ? marketCash : heldMarketValue;
  const tradeAmountValid = tradeAmount > tradeFee && tradeAmount <= tradeLimit && amount.length <= 18;
  const latestMarketIndex = Number(marketHistory.at(-1)?.indices[category] || 0);
  const previousMarketIndex = Number(marketHistory.at(-2)?.indices[category] || 0);
  const marketMonthlyChange = previousMarketIndex > 0 ? (latestMarketIndex / previousMarketIndex - 1) * 100 : null;
  const estimatedUnits = selectedMarketQuote && BigInt(selectedMarketQuote.priceTomans) > 0n
    ? new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 4 }).format(Number(tradeAction === 'buy' ? tradeNet : tradeAmount) / Number(selectedMarketQuote.priceTomans))
    : '—';
  const loanRateBps = snapshot ? BigInt(loanRateKind === 'fixed' ? snapshot.loanOffers.fixedAnnualRateBps : snapshot.loanOffers.variableAnnualRateBps) : 0n;
  const loanPaymentEstimate = snapshot && /^\d+$/.test(loanAmount) ? estimateLoanPayment(BigInt(loanAmount), loanRateBps, loanMonths) : null;
  const existingLoanPayments = (snapshot?.loans ?? []).reduce((sum, loan) => sum + BigInt(loan.monthlyDueTomans), 0n);
  const loanPaymentLimit = snapshot?.account ? (() => {
    const income = BigInt(snapshot.account.monthly_salary_tomans) + (snapshot.city ?? []).reduce((sum, item) => sum + BigInt(item.monthlyIncomeTomans), 0n);
    const rent = BigInt(snapshot.account.monthly_rent_tomans);
    return (income > rent ? income - rent : 0n) * 4_000n / 10_000n;
  })() : null;
  const loanPaymentAllowed = loanPaymentEstimate !== null && loanPaymentLimit !== null && existingLoanPayments + loanPaymentEstimate <= loanPaymentLimit;
  const tokenHeaders = useMemo<Record<string, string>>(() => {
    if (!session) return {} as Record<string, string>;
    return { Authorization: `Bearer ${session.token}` };
  }, [session]);
  const cityLevels = useMemo(() => Object.fromEntries((snapshot?.city ?? []).map((item) => [item.buildingId, item.level])) as Partial<Record<BuildingId, number>>, [snapshot?.city]);
  const cityWeather = useMemo(
    () => getCityWeather(snapshot?.turn?.period_key ?? currentPersianPeriod(), snapshot?.room.id ?? ''),
    [snapshot?.turn?.period_key, snapshot?.room.id],
  );

  useEffect(() => {
    const current = snapshot ? {
      roomId: snapshot.room.id,
      periodKey: snapshot.turn?.period_key ?? null,
      cashTomans: snapshot.account?.cash_tomans ?? null,
    } : null;
    const previous = previousHudRef.current;
    previousHudRef.current = current;
    if (!current || !previous || previous.roomId !== current.roomId) {
      if (monthReactionTimerRef.current) clearTimeout(monthReactionTimerRef.current);
      if (balanceReactionTimerRef.current) clearTimeout(balanceReactionTimerRef.current);
      setMonthReaction(false);
      setBalanceReaction(null);
      return;
    }
    if (previous.periodKey && current.periodKey && current.periodKey > previous.periodKey) {
      if (monthReactionTimerRef.current) clearTimeout(monthReactionTimerRef.current);
      setMonthReaction(true);
      monthReactionTimerRef.current = setTimeout(() => setMonthReaction(false), 3200);
    }
    if (previous.cashTomans !== null && current.cashTomans !== null) {
      const change = BigInt(current.cashTomans) - BigInt(previous.cashTomans);
      if (change !== 0n) {
        if (balanceReactionTimerRef.current) clearTimeout(balanceReactionTimerRef.current);
        setBalanceReaction({ kind: change > 0n ? 'income' : 'expense', amountTomans: (change > 0n ? change : -change).toString() });
        setBalanceReactionId((value) => value + 1);
        balanceReactionTimerRef.current = setTimeout(() => setBalanceReaction(null), 3200);
      }
    }
  }, [snapshot?.room.id, snapshot?.turn?.period_key, snapshot?.account?.cash_tomans]);

  useEffect(() => () => {
    if (monthReactionTimerRef.current) clearTimeout(monthReactionTimerRef.current);
    if (balanceReactionTimerRef.current) clearTimeout(balanceReactionTimerRef.current);
  }, []);

  useEffect(() => {
    if (authUser && !session) {
      setDisplayName(authUser.user.displayName);
      setPanel('connect');
    }
  }, [authUser, session]);

  useEffect(() => {
    const period = snapshot?.turn?.period_key;
    if (!session || !period || returnReport) return;
    const sessionKey = `${session.roomId}:${session.token}:${period}`;
    if (returnReportSessionRef.current === sessionKey) return;
    returnReportSessionRef.current = sessionKey;
    const storageKey = `masir-last-period:${session.roomId}`;
    const previous = sessionStorage.getItem(storageKey);
    let active = true;
    const saveCurrent = () => sessionStorage.setItem(storageKey, period);
    if (!previous || previous >= period) { saveCurrent(); return; }
    void fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}/return-report?since=${encodeURIComponent(previous)}`, { headers: { Authorization: `Bearer ${session.token}` } })
      .then(async (response) => response.ok ? await response.json() as ReturnReport : null)
      .then((report) => {
        if (!active) return;
        if (report?.periods?.length) setReturnReport(report);
        else saveCurrent();
      })
      .catch(() => {});
    return () => { active = false; if (returnReportSessionRef.current === sessionKey) returnReportSessionRef.current = ''; };
  }, [session, snapshot?.turn?.period_key, returnReport, resumeCheckNonce]);

  const dismissReturnReport = () => {
    if (session && snapshot?.turn?.period_key) {
      sessionStorage.setItem(`masir-last-period:${session.roomId}`, snapshot.turn.period_key);
      returnReportSessionRef.current = `${session.roomId}:${session.token}:${snapshot.turn.period_key}`;
    }
    setReturnReport(null); setReportDetails(false);
  };

  const refreshSnapshot = useCallback(async (active: Session) => {
    const response = await fetch(`${apiBase}/rooms/${encodeURIComponent(active.roomId)}`, { headers: { Authorization: `Bearer ${active.token}` } });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'دسترسی اتاق معتبر نیست؛ دوباره وارد شو.' : 'گرفتن وضعیت شهر ناموفق بود.');
    setSnapshot(await response.json() as RoomSnapshot);
  }, []);

  useEffect(() => {
    if (!session) { setSnapshot(null); return; }
    let active = true;
    const socket: Socket = io(`${apiBase}/rooms`, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => { setResumeCheckNonce((value) => value + 1); socket.emit('room.join', { roomId: session.roomId, token: session.token }, (reply: { ok: boolean; snapshot?: RoomSnapshot }) => {
      if (!active) return;
      if (reply?.ok && reply.snapshot) setSnapshot(reply.snapshot);
      else setApiError('اتصال زنده به اتاق برقرار نشد.');
    }); });
    const updateEvents = ['room.members.changed', 'decision.updated', 'period.locked', 'period.result.published', 'period.ready.changed', 'city.building.changed', 'business.changed', 'player.contract.changed', 'debt.restructured', 'loan.issued', 'check.guarantee.requested', 'check.guarantee.responded','room.event.changed','player.progress.changed','fund.changed','insurance.changed','auction.changed'];
    const update = () => { if (active) void refreshSnapshot(session).catch((error: Error) => setApiError(error.message)); };
    updateEvents.forEach((event) => socket.on(event, update));
    socket.on('period.opened', (event: { periodKey?: string }) => {
      if (!active) return;
      if (event.periodKey) sessionStorage.setItem(`masir-last-period:${session.roomId}`, event.periodKey);
      update();
    });
    socket.on('disconnect', () => { returnReportSessionRef.current = ''; });
    socket.on('room.chat.message', (message: ChatMessage) => {
      if (!active) return;
      setSnapshot((current) => current ? { ...current, chat: [...current.chat.filter((item) => item.id !== message.id), message].slice(-40) } : current);
    });
    socket.on('city.rivals.acted', (event: { actions?: RivalAction[] }) => {
      if (!active || !event.actions?.length) return;
      setRivalActions(event.actions);
    });
    socket.on('connect_error', () => { if (active) setApiError('سرور بازی در دسترس نیست.'); });
    void refreshSnapshot(session).catch((error: Error) => { if (active) setApiError(error.message); });
    return () => { active = false; socketRef.current = null; socket.disconnect(); };
  }, [session, refreshSnapshot]);

  useEffect(() => {
    if (snapshot?.autopilot) setPolicyDraft(snapshot.autopilot);
  }, [snapshot?.autopilot]);

  useEffect(() => {
    if (panel !== 'market' || !session) return;
    let active = true;
    setHistoryLoading(true);
    void fetch(`${apiBase}/economy/rooms/${encodeURIComponent(session.roomId)}/history`, { headers: tokenHeaders })
      .then(async (response) => {
        if (!response.ok) throw new Error('گرفتن روند بازار ممکن نشد.');
        return await response.json() as MarketPoint[];
      })
      .then((history) => { if (active) setMarketHistory(history); })
      .catch(() => { if (active) setMarketHistory([]); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [panel, session, tokenHeaders]);

  const showNotice = (text: string, target?: NoticeTarget) => setNotice({ text, target });
  const selectBuilding = useCallback((id: BuildingId) => { setSelectedId(id); setCardOpen(true); setNotice(null); }, []);
  const persistSession = (next: Session) => { sessionStorage.setItem('masir-room', JSON.stringify(next)); setSession(next); setPanel(null); setApiError(''); };

  const connectRoom = async (joining: boolean) => {
    if (!authUser) { setApiError('برای ادامه ابتدا با شمارهٔ موبایل وارد شو.'); return; }
    setBusy(true); setApiError('');
    try {
      const response = await fetch(joining ? `${apiBase}/rooms/${encodeURIComponent(roomIdInput.trim())}/join` : `${apiBase}/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authUser.token}` },
        body: JSON.stringify(joining ? { displayName } : { title: roomTitle, displayName, mode, scenarioId: scenario, maxPlayers, botCount, turnSeconds }),
      });
      const data = await response.json().catch(() => ({})) as { roomId?: string; token?: string; message?: string | string[] };
      const serverMessage = Array.isArray(data.message) ? data.message[0] : data.message;
      if (!response.ok || !data.roomId || !data.token) {
        if (response.status >= 500 || serverMessage === 'Internal server error') throw new Error('سرور هنگام ساخت شهر خطا داد. سرور بازی را یک‌بار راه‌اندازی مجدد کن و دوباره تلاش کن.');
        throw new Error(serverMessage || 'ساخت یا ورود به شهر انجام نشد.');
      }
      persistSession({ roomId: data.roomId, token: data.token, displayName });
    } catch (error) { setApiError(error instanceof Error ? error.message : 'ارتباط با سرور ناموفق بود.'); }
    finally { setBusy(false); }
  };

  const completeAuthentication = (result: AuthResult) => {
    if (!authUser || authUser.user.id !== result.user.id) {
      sessionStorage.removeItem('masir-room');
      setSession(null); setSnapshot(null);
    }
    localStorage.setItem('masir-auth', JSON.stringify(result));
    setAuthUser(result); setDisplayName(result.user.displayName); setApiError(''); setPanel('connect');
  };

  const logout = () => {
    if (authUser?.token) void fetch(`${apiBase}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${authUser.token}` } }).catch(() => {});
    localStorage.removeItem('masir-auth'); sessionStorage.removeItem('masir-room');
    setAuthUser(null); setSession(null); setSnapshot(null); setPanel(null);
  };

  const submitDecision = async (input: { action: 'hold' | 'buy' | 'sell'; category?: string; amountTomans?: string }) => {
    if (!session || !snapshot?.turn) { setApiError('ابتدا وارد یک شهر بازی شو.'); return; }
    setBusy(true); setApiError('');
    try {
      const response = await fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}/decisions/${snapshot.turn.period_key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...tokenHeaders }, body: JSON.stringify(input),
      });
      const result = await response.json() as { message?: string; status?: string };
      if (!response.ok) throw new Error(result.message || 'ثبت تصمیم ممکن نشد.');
      showNotice(input.action === 'hold' ? 'تصمیم نگه‌داری نقدینگی ثبت شد' : 'سفارش بازار تا پایان نوبت ثبت شد', 'market');
      setPanel(null); await refreshSnapshot(session);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'ثبت تصمیم ناموفق بود.'); }
    finally { setBusy(false); }
  };

  const constructBuilding = async (buildingId: BuildingId) => {
    const owned = snapshot?.city.find((building) => building.buildingId === buildingId);
    if (!session || !snapshot?.turn || snapshot.turn.status !== 'open' || !owned || owned.level >= owned.maxLevel) return;
    const operation = owned.level === 0 ? 'build' : 'upgrade';
    setBusy(true); setApiError('');
    try {
      const response = await fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}/buildings/${buildingId}/${snapshot.turn.period_key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...tokenHeaders }, body: JSON.stringify({ operation }),
      });
      const result = await response.json() as { message?: string; costTomans?: string; level?: number };
      if (!response.ok) throw new Error(result.message === 'insufficient_cash' ? 'موجودی برای این ساخت یا ارتقا کافی نیست.' : result.message || 'ساخت ساختمان انجام نشد.');
      showNotice(`${owned.name} به سطح ${new Intl.NumberFormat('fa-IR').format(result.level || owned.level + 1)} رسید`, 'build');
      setPanel(null); await refreshSnapshot(session);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'ساخت ساختمان ناموفق بود.'); }
    finally { setBusy(false); }
  };

  const businessRequest = async (path: string, body: Record<string, unknown>, success: string) => {
    if (!session || !snapshot?.turn || snapshot.turn.status !== 'open') { setApiError('برای مدیریت کسب‌وکار باید در نوبت فعال باشی.'); return; }
    setBusy(true); setApiError('');
    try {
      const response = await fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...tokenHeaders }, body: JSON.stringify(body),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) {
        const message = result.message === 'insufficient_cash'
          ? 'موجودی برای این سرمایه‌گذاری کافی نیست.'
          : result.message === 'business branch limit reached'
            ? 'ظرفیت کسب‌وکارهای شما تکمیل است؛ حداکثر می‌توانید ۸ شعبه داشته باشید.'
            : result.message === 'this business model reached the room branch limit'
              ? 'ظرفیت این نوع کسب‌وکار تکمیل است؛ در هر شهر حداکثر ۳ شعبه از هر نوع ساخته می‌شود.'
              : result.message || 'اقدام کسب‌وکار انجام نشد.';
        throw new Error(message);
      }
      const target: NoticeTarget = path.startsWith('/business') ? 'business' : path.startsWith('/business-partnerships') || path.startsWith('/contracts') ? 'business' : 'inventory';
      showNotice(success, target); await refreshSnapshot(session);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'اقدام کسب‌وکار انجام نشد.'); }
    finally { setBusy(false); }
  };

  const openBusiness = (modelId: string) => {
    if (!snapshot?.turn) return;
    void businessRequest(`/businesses/${snapshot.turn.period_key}`, { modelId, managerEnabled: true }, 'شعبهٔ تازه در شهر ساخته شد.');
  };
  const toggleBusinessManager = (branch: BusinessBranch) => {
    if (!snapshot?.turn) return;
    void businessRequest(`/businesses/${branch.id}/${snapshot.turn.period_key}/manager`, { enabled: !branch.manager_enabled }, branch.manager_enabled ? 'مدیر شعبه آزاد شد.' : 'مدیر خودکار شعبه استخدام شد.');
  };
  const offerBusinessPartnership = (branch: BusinessBranch) => {
    if (!snapshot?.turn || !partnerId) { setApiError('بازیکن شریک را انتخاب کن.'); return; }
    void businessRequest(`/businesses/${branch.id}/${snapshot.turn.period_key}/partnerships`, {
      partnerId, shareBps: partnerShare * 100, contributionTomans: partnerContribution,
    }, 'پیشنهاد شراکت فرستاده شد.');
  };
  const proposeContract = () => {
    if (!snapshot?.turn || !contractPlayerId) { setApiError('بازیکن هم‌بازی را انتخاب کن.'); return; }
    const terms = contractKind === 'loan'
      ? { counterpartyId: contractPlayerId, kind: contractKind, amountTomans: contractAmount, interestBps: contractInterestBps, months: contractMonths }
      : { counterpartyId: contractPlayerId, kind: contractKind, amountTomans: contractAmount, assetCategory: contractAssetCategory, assetValueTomans: contractAssetValue };
    void businessRequest(`/contracts/${snapshot.turn.period_key}`, terms, contractKind === 'loan' ? 'پیشنهاد وام ارسال شد؛ پس از پذیرش، وجه جابه‌جا می‌شود.' : 'پیشنهاد معامله ارسال شد.');
  };
  const respondToContract = (contractId: string, accept: boolean) => {
    void businessRequest(`/contracts/${contractId}/respond`, { accept }, accept ? 'قرارداد پذیرفته و اجرا شد.' : 'قرارداد رد شد.');
  };
  const respondToBusinessOffer = (offerId: string, accept: boolean) => {
    void businessRequest(`/business-partnerships/${offerId}/respond`, { accept }, accept ? 'شراکت پذیرفته شد.' : 'پیشنهاد شراکت رد شد.');
  };

  const sendCheckRequest = async () => {
    if (!session || !snapshot?.turn || !checkPayeeId || !checkGuarantorId || snapshot.turn.status !== 'open') return;
    setBusy(true); setApiError('');
    try {
      const response = await fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}/check-requests/${snapshot.turn.period_key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...tokenHeaders },
        body: JSON.stringify({ payeeId: checkPayeeId, guarantorId: checkGuarantorId, duePeriod: nextMonthKey(snapshot.turn.period_key), amountTomans: checkAmount }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || 'ثبت درخواست ضمانت انجام نشد.');
      showNotice('درخواست ضمانت برای چک ارسال شد.', 'checks');
      await refreshSnapshot(session);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'ارسال درخواست ضمانت ناموفق بود.'); }
    finally { setBusy(false); }
  };

  const respondToCheck = async (requestId: string, accept: boolean) => {
    if (!session) return;
    setBusy(true); setApiError('');
    try {
      const response = await fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}/check-requests/${requestId}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...tokenHeaders }, body: JSON.stringify({ accept }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || 'پاسخ به درخواست چک ناموفق بود.');
      showNotice(accept ? 'ضمانت پذیرفته شد و چک صادر شد.' : 'درخواست ضمانت رد شد.', 'checks');
      await refreshSnapshot(session);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'پاسخ ناموفق بود.'); }
    finally { setBusy(false); }
  };

  const applyForLoan = async () => {
    if (!session || !snapshot?.turn || snapshot.turn.status !== 'open') { setApiError('ابتدا به یک نوبت فعال وارد شو.'); return; }
    setBusy(true); setApiError('');
    try {
      const response = await fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}/loans/${snapshot.turn.period_key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...tokenHeaders },
        body: JSON.stringify({ amountTomans: loanAmount, months: loanMonths, rateKind: loanRateKind }),
      });
      const result = await response.json() as { message?: string; amountTomans?: string; monthlyPaymentTomans?: string };
      if (!response.ok) throw new Error(result.message === 'monthly payment exceeds the 40% affordability limit' ? 'قسط این وام از سقف توان بازپرداخت شهر بیشتر است.' : result.message || 'درخواست وام انجام نشد.');
      showNotice(`وام ${formatMoney(result.amountTomans)} ثبت شد · قسط ${formatMoney(result.monthlyPaymentTomans)} در ماه`, 'inventory');
      await refreshSnapshot(session);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'درخواست وام ناموفق بود.'); }
    finally { setBusy(false); }
  };

  const performRestructure = async () => {
    if (!session || !snapshot?.turn || !financial?.canRestructure) return;
    setBusy(true); setApiError('');
    try {
      const response = await fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}/restructure/${snapshot.turn.period_key}`, { method: 'POST', headers: tokenHeaders });
      const result = await response.json() as { message?: string; months?: number };
      if (!response.ok) throw new Error(result.message || 'Debt restructuring failed.');
      showNotice(`بدهی در قالب وام ثابت ${new Intl.NumberFormat('fa-IR').format(result.months || 36)}ماهه تجمیع شد.`, 'inventory');
      await refreshSnapshot(session);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'Debt restructuring failed.'); }
    finally { setBusy(false); }
  };

  const endTurn = async () => {
    if (!session || !snapshot?.turn || snapshot.turn.status !== 'open') return;
    setBusy(true);
    setApiError('');
    try {
      if (!snapshot.decision) {
        const decisionResponse = await fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}/decisions/${snapshot.turn.period_key}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...tokenHeaders }, body: JSON.stringify({ action: 'hold' }),
        });
        if (!decisionResponse.ok) throw new Error('ثبت تصمیم این دوره انجام نشد.');
      }
      const response = await fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}/turns/${snapshot.turn.period_key}/ready`, { method: 'POST', headers: tokenHeaders });
      const result = await response.json() as { readyCount: number; humanCount: number; settling: boolean; message?: string };
      if (!response.ok) throw new Error(result.message || 'ثبت پایان نوبت انجام نشد.');
      showNotice(result.settling ? 'همه آماده‌اند؛ تسویهٔ دوره آغاز شد.' : `آمادگی ثبت شد · ${new Intl.NumberFormat('fa-IR').format(result.readyCount)} از ${new Intl.NumberFormat('fa-IR').format(result.humanCount)} بازیکن`, 'report');
      await refreshSnapshot(session);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'ثبت پایان نوبت انجام نشد.'); }
    finally { setBusy(false); }
  };

  const sendChat = async () => {
    const message = chatDraft.trim();
    if (!session || !message || message.length > 280) return;
    if (!socketRef.current?.connected) { setApiError('اتصال زندهٔ اتاق برقرار نیست؛ دوباره تلاش کن.'); return; }
    setChatBusy(true);
    socketRef.current.emit('room.chat.send', { roomId: session.roomId, token: session.token, message }, (reply: { ok: boolean; error?: string }) => {
      setChatBusy(false);
      if (!reply?.ok) setApiError(reply?.error || 'ارسال پیام انجام نشد.');
      else { setChatDraft(''); setApiError(''); }
    });
  };

  const saveAutopilot = async () => {
    if (!session) return;
    setPolicyBusy(true); setApiError('');
    try {
      const response = await fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}/autopilot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...tokenHeaders },
        body: JSON.stringify({ enabled: policyDraft.enabled, strategy: policyDraft.strategy, reserveMonths: policyDraft.reserve_months, investSurplusBps: policyDraft.invest_surplus_bps }),
      });
      const result = await response.json() as AutopilotPolicy & { message?: string };
      if (!response.ok) throw new Error(result.message || 'ذخیرهٔ سیاست نماینده انجام نشد.');
      setPolicyDraft(result); showNotice('سیاست نمایندهٔ خودکار ذخیره شد.', 'autopilot'); await refreshSnapshot(session);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'ذخیرهٔ سیاست نماینده انجام نشد.'); }
    finally { setPolicyBusy(false); }
  };

  const renderLedgerBreakdown = (period: ReturnReport['periods'][number]) => {
    const entries = period.transactions ?? [];
    const incomes = entries.filter((entry) => BigInt(entry.amountTomans) > 0n);
    const expenses = entries.filter((entry) => BigInt(entry.amountTomans) < 0n);
    const renderRows = (title: string, rows: LedgerDetail[], expense = false) => {
      const total = rows.reduce((sum, entry) => sum + (expense ? -BigInt(entry.amountTomans) : BigInt(entry.amountTomans)), 0n);
      return <section className="ledger-detail-group" key={title}>
      <h4>{title} <span>{new Intl.NumberFormat('fa-IR').format(rows.length)} مورد</span></h4>
      <div className={`ledger-subtotal ${expense ? 'expense-amount' : 'income-amount'}`}><span>مجموع {expense ? 'هزینه‌ها' : 'درآمدها'}</span><b>{formatMoney(total.toString())}</b></div>
      {rows.length ? rows.map((entry) => {
        const amount = BigInt(entry.amountTomans);
        return <div className="ledger-detail-row" key={entry.id}><span>{ledgerDescription(entry, snapshot?.businessCatalog)}</span><b className={expense ? 'expense-amount' : 'income-amount'}>{expense ? '−' : '+'}{formatMoney((expense ? -amount : amount).toString())}</b></div>;
      }) : <p className="empty-state">موردی ثبت نشده است.</p>}
      </section>;
    };
    return <div className="period-breakdown" aria-label={`ریز تراکنش‌های ${monthName(period.periodKey)}`}>
      {entries.length ? <>{renderRows('درآمدها', incomes)}{renderRows('هزینه‌ها', expenses, true)}</> : <p className="empty-state">برای این ماه تراکنشی ثبت نشده است.</p>}
    </div>;
  };

  const performAction = (id: (typeof navItems)[number]['id']) => {
    if (id === 'turn') { void endTurn(); return; }
    if (id === 'report') {
      if (!session || !snapshot?.turn) { setPanel('connect'); return; }
      const [year,month]=snapshot.turn.period_key.split('-').map(Number);
      const prev=`${year-1}-${String(month).padStart(2,'0')}`;
      setReportHistory(null); setReportError(''); setReportLoading(true); setPanel('report');
      void fetch(`${apiBase}/rooms/${encodeURIComponent(session.roomId)}/return-report?since=${prev}`,{headers:{Authorization:`Bearer ${session.token}`}})
        .then(async response=>{if(!response.ok)throw new Error('گزارش دریافت نشد؛ اتصال را بررسی و دوباره تلاش کن.');setReportHistory(await response.json() as ReturnReport);})
        .catch((error:Error)=>setReportError(error.message)).finally(()=>setReportLoading(false));
      return;
    }
    if (id === 'settings') { setPanel('settings'); return; }
    if (id === 'inventory' || id === 'profile' || id === 'chat' || id === 'autopilot') { setPanel(snapshot ? id : 'connect'); return; }
  };

  const visitSelected = () => {
    if (selected.id === 'bank') setPanel('loan');
    else if (selected.id === 'market') setPanel('market');
    else if (selected.id === 'business') setPanel('business');
    else if (selected.id === 'academy' || selected.id === 'insurance' || selected.id === 'labor') showNotice(npcGuides[selected.id].tip, guideDestinations[selected.id]);
    else setPanel('build');
  };

  const openNoticeTarget = (target: NoticeTarget) => {
    setNotice(null);
    setApiError('');
    if (target === 'report') { performAction('report'); return; }
    setPanel(target);
  };

  const openGuide = (id: BuildingId) => openNoticeTarget(guideDestinations[id]);

  if (!authUser) return <AuthGate onAuthenticated={completeAuthentication} />;

  return (
    <main className="game-frame" dir="rtl" data-reduced-motion={reducedMotion}>
      <Suspense fallback={<div className="pixi-world" aria-label="در حال بارگذاری شهر" />}>
        <PixiCity selected={selectedId} levels={cityLevels} homeTier={homeTier} zoom={zoom} reducedMotion={reducedMotion} rivalActions={rivalActions} onSelect={selectBuilding} />
      </Suspense>
      <header className={`top-hud${monthReaction ? ' month-reaction' : ''}`} aria-label="وضعیت بازی">
        <button className={`player-mark${monthReaction ? ' month-reaction' : ''}`} onClick={() => setPanel('connect')} aria-label={`شهر ${snapshot?.room.title || 'نوپا'}، ${cityWeather.seasonLabel}، هوای ${cityWeather.weatherLabel}؛ ورود به اتاق شهر`} title={`${cityWeather.seasonLabel} · ${cityWeather.weatherLabel} (آب‌وهوای شبیه‌سازی‌شدهٔ شهر)`}><CityWeatherIcon weather={cityWeather} /></button>
        {monthReaction && <span className="month-fx" aria-hidden="true"><i className="month-page">۱</i><i className="month-spark"/><i className="month-spark"/><i className="month-spark"/></span>}
        <div className={`player-info${monthReaction ? ' month-reaction' : ''}`}><span className="eyebrow" aria-live="polite">{monthReaction ? `✦ ماه جدید! ${monthName(snapshot?.turn?.period_key)}` : `${monthName(snapshot?.turn?.period_key)} · نوبت ${new Intl.NumberFormat('fa-IR').format(snapshot?.turn?.turn_number ?? 1)}`}</span><strong>{snapshot?.room.title || 'شهر نوپا'}</strong></div>
        <span className="hud-divider" />
        <div className={`balance-icon${balanceReaction ? ` ${balanceReaction.kind}` : ''}`} aria-hidden="true">ت{balanceReaction && <span className="balance-ripple" />}</div>
        <div className={`balance-info${balanceReaction ? ` ${balanceReaction.kind}` : ''}`}><span className="eyebrow" aria-live="polite" title={balanceReaction ? `${balanceReaction.kind === 'income' ? 'افزایش موجودی' : 'کاهش موجودی'} ${formatMoney(balanceReaction.amountTomans)}` : undefined}>{balanceReaction ? `${balanceReaction.kind === 'income' ? '+' : '−'}${new Intl.NumberFormat('fa-IR').format(BigInt(balanceReaction.amountTomans))} تومان` : snapshot ? `بازیکن: ${session?.displayName}` : 'موجودی آزمایشی'}</span><strong key={balanceReactionId} aria-live="polite">{snapshot?.account ? formatMoney(snapshot.account.cash_tomans) : '۱۲٫۴۸ میلیون'}</strong>{balanceReaction && <span className="balance-fx" aria-hidden="true"><i/><i/><i/></span>}</div>
      </header>
      {snapshot && <div className="room-ribbon"><span>● {snapshot.room.mode === 'live' ? 'هم‌زمان' : snapshot.room.mode === 'async' ? 'غیرهم‌زمان' : 'تک‌نفره'}</span><span>{new Intl.NumberFormat('fa-IR').format(snapshot.members.length)} / {new Intl.NumberFormat('fa-IR').format(snapshot.room.max_players)} بازیکن</span><span>{new Intl.NumberFormat('fa-IR').format(snapshot.turn?.ready_count ?? 0)}/{new Intl.NumberFormat('fa-IR').format(snapshot.turn?.human_count ?? 0)} آماده</span><button onClick={() => { navigator.clipboard?.writeText(snapshot.room.invite_code); showNotice(`کد دعوت ${snapshot.room.invite_code} کپی شد`); }}>دعوت · {snapshot.room.invite_code}</button></div>}
      {rivalActions.length > 0 && <div className="rival-news" role="status" dir="rtl"><b>خبر شهر</b><span>{rivalActions.filter((action) => action.status !== 'rejected').map((action) => action.action === 'buy' ? `${action.displayName} ${action.category} خرید` : `${action.displayName} نقدینگی را حفظ کرد`).join('  ·  ')}</span></div>}
      {snapshot && <div className="asset-ribbon" aria-label="وضعیت مالی"><div><span>دارایی واقعی</span><b>{formatMoney(financial?.assetsTomans)}</b></div><div><span>درآمد غیرفعال</span><b>{formatMoney(financial?.passiveIncomeTomans)}</b></div><div><span>بدهی واقعی</span><b>{formatMoney(financial?.liabilitiesTomans)}</b></div><div className={monthlyCashFlow !== null && monthlyCashFlow >= 0n ? 'cashflow positive' : 'cashflow negative'}><span>جریان ماهانه</span><b>{monthlyCashFlow !== null && monthlyCashFlow >= 0n ? '↗ ' : '↘ '}{monthlyCashFlow === null ? '—' : formatMoney(monthlyCashFlow.toString())}</b></div></div>}
      <div className="map-controls" aria-label="بزرگ‌نمایی نقشه"><button aria-label="بزرگ‌نمایی" onClick={() => setZoom((value) => Math.min(2.65, value + 0.2))}>+</button><button aria-label="کوچک‌نمایی" onClick={() => setZoom((value) => Math.max(0.88, value - 0.2))}>−</button></div>
      {cardOpen && <section className="building-card" key={selected.id} aria-live="polite" aria-label={`اطلاعات ${selected.name}`}>
        <div className="card-topline" /><button className="close-card" aria-label="بستن اطلاعات ساختمان" onClick={() => setCardOpen(false)}>×</button>
        <div className="building-avatar" style={{ '--avatar-color': selected.color } as React.CSSProperties} aria-hidden="true"><span>{selected.symbol}</span></div>
        <div className="building-heading"><h1>{selected.name}</h1><p>{selected.service ? selected.kind : snapshot ? `${(snapshot.city.find((item) => item.buildingId === selected.id)?.level || 0) === 0 ? 'ساخته‌نشده' : `سطح ${new Intl.NumberFormat('fa-IR').format(snapshot.city.find((item) => item.buildingId === selected.id)?.level || 0)}`} • ${selected.kind}` : selected.kind}</p></div>
        <div className="npc-speech" key={selected.id}><div className="npc-portrait" style={{ '--npc-color': npcGuides[selected.id].color } as React.CSSProperties} aria-hidden="true"><i /><b /></div><div className="npc-copy"><strong>{npcGuides[selected.id].name} <small>{npcGuides[selected.id].role}</small></strong><span>«{npcGuides[selected.id].line}»</span><button className="npc-tip" onClick={() => openGuide(selected.id)}>{npcGuides[selected.id].tip} ←</button></div></div>
        <div className="building-stats"><div className="stat action-stat"><span>اقدام بعدی</span><strong>{selected.action}</strong></div><div className="stat income-stat"><span>{selected.service ? 'خدمت شهری' : snapshot ? 'درآمد پایهٔ ماهانه' : 'درآمد هر دوره'}</span><strong>{selected.service ? selected.income : snapshot ? formatMoney(snapshot.city.find((item) => item.buildingId === selected.id)?.monthlyIncomeTomans || '0') : selected.income}</strong></div></div>
        <button className="building-visit" onClick={visitSelected}>ورود به {selected.name} ←</button>
      </section>}
      {notice && (notice.target
        ? <button className="toast toast-link" role="status" onClick={() => openNoticeTarget(notice.target!)}>{notice.text}<span aria-hidden="true">↗</span></button>
        : <div className="toast" role="status">{notice.text}</div>)}
      <nav className="action-rail" aria-label="ابزارهای بازی"><div className="action-list">{navItems.map((item) => <button className={`action-button ${item.tone} ${item.id === 'turn' ? 'turn-action' : ''}`} key={item.id} onClick={() => performAction(item.id)} disabled={item.id === 'turn' && (busy || !snapshot?.turn || snapshot.turn.status !== 'open' || snapshot.turn.is_ready)}><span className="action-symbol" aria-hidden="true">{item.symbol}</span><span>{item.id === 'turn' ? snapshot?.turn?.is_ready ? 'منتظر' : 'پایان ماه' : item.label}</span></button>)}</div></nav>

      {panel && <div className="game-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && (panel !== 'connect' || session)) { setPanel(null); setApiError(''); } }}>
        {panel === 'report' ? <section className="game-modal" role="dialog" aria-modal="true" aria-labelledby="report-title"><button className="modal-close" onClick={()=>setPanel(null)} aria-label="بستن">×</button><span className="modal-kicker">کارنامهٔ شهر</span><h2 id="report-title">گزارش دوازده‌ماهه</h2><p className="modal-copy">خلاصهٔ جریان نقدی، دستمزد، درآمد شهر و تصمیم‌های مالی دوره‌های گذشته.</p>{reportLoading ? <div className="market-chart-empty" role="status">در حال دریافت گزارش شهر…</div> : reportError ? <div className="form-error" role="alert"><p>{reportError}</p><button className="modal-primary" onClick={()=>{setPanel(null);performAction('report');}}>تلاش دوباره</button></div> : !reportHistory?.periods.length ? <p className="empty-state">هنوز دورهٔ تسویه‌شده‌ای برای گزارش وجود ندارد.</p> : <><div className="profile-summary"><div><span>درآمد تجمعی</span><strong>{formatMoney(reportHistory.periods.reduce((s,p)=>s+BigInt(p.incomeTomans),0n).toString())}</strong></div><div><span>هزینهٔ تجمعی</span><strong>{formatMoney(reportHistory.periods.reduce((s,p)=>s+BigInt(p.expenseTomans),0n).toString())}</strong></div><div><span>تغییر خالص وجه</span><strong>{formatMoney(reportHistory.periods.reduce((s,p)=>s+BigInt(p.netCashChangeTomans),0n).toString())}</strong></div></div><section className="inventory-group"><h3>دوره‌ها</h3>{reportHistory.periods.map(period=><div className="period-entry" key={period.periodKey}><button className="period-summary" aria-expanded={expandedReportPeriod===period.periodKey} onClick={()=>setExpandedReportPeriod(value=>value===period.periodKey?null:period.periodKey)}><span>{monthName(period.periodKey)} · درآمد {formatMoney(period.incomeTomans)} · هزینه {formatMoney(period.expenseTomans)}</span><b>{formatMoney(period.netCashChangeTomans)}</b></button>{expandedReportPeriod===period.periodKey&&renderLedgerBreakdown(period)}</div>)}</section></>}</section> : panel === 'settings' ? <section className="game-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><button className="modal-close" onClick={()=>setPanel(null)} aria-label="بستن">×</button><span className="modal-kicker">تنظیمات بازی</span><h2 id="settings-title">نمای شهر و دسترس‌پذیری</h2><p className="modal-copy">تنظیم‌های نمایش روی همین دستگاه ذخیره می‌شوند.</p><label>بزرگ‌نمایی نقشه <div className="modal-two"><button className="loan-entry" onClick={()=>setZoom(v=>Math.max(.88,v-.2))}>− کوچک‌تر</button><button className="loan-entry" onClick={()=>setZoom(v=>Math.min(2.65,v+.2))}>+ بزرگ‌تر</button></div></label><label className="toggle-row"><span><b>کاهش حرکت</b><small>انیمیشن‌های رابط را برای راحتی دیداری محدود می‌کند.</small></span><input type="checkbox" checked={reducedMotion} onChange={e=>{localStorage.setItem('masir-reduced-motion',String(e.target.checked));setReducedMotion(e.target.checked);}} /></label><p className="real-value-note">تقویم بازی شمسی است و همهٔ مبالغ با تومان نمایش داده می‌شوند.</p></section> : panel === 'connect' ? <section className="game-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title">
          <button className="modal-close" onClick={() => { setPanel(null); setApiError(''); }} aria-label="بستن">×</button><span className="modal-kicker">اتاق چندنفره</span><h2 id="connect-title">ورود به شهر زنده</h2><p className="modal-copy">اتاق را بساز یا با شناسهٔ دعوت وارد شو. وضعیت و نوبت از سرور همگام می‌شود.</p>
          <label>نام بازیکن<input value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label>عنوان شهر<input value={roomTitle} maxLength={80} onChange={(event) => setRoomTitle(event.target.value)} /></label>
          <div className="modal-two"><label>حالت بازی<select value={mode} onChange={(event) => { const value = event.target.value as typeof mode; setMode(value); setTurnSeconds(value === 'async' ? 86400 : 180); }}>{/* controlled modes */}<option value="live">هم‌زمان</option><option value="async">غیرهم‌زمان</option><option value="solo">تک‌نفره</option></select></label><label>سناریو<select value={scenario} onChange={(event) => setScenario(event.target.value)}><option value="recession">رکود</option><option value="boom">رونق</option><option value="high_inflation">تورم بالا</option><option value="market_shock">شوک بازار</option></select></label><label>ظرفیت کل اتاق<select value={maxPlayers} onChange={(event) => { const value = Number(event.target.value); setMaxPlayers(value); if (botCount >= value) setBotCount(value - 1); }}>{[2,3,4,5,6,7,8].map((value) => <option key={value} value={value}>{new Intl.NumberFormat('fa-IR').format(value)} بازیکن</option>)}</select></label><label>رقیب ربات<select value={botCount} onChange={(event) => { const value = Number(event.target.value); setBotCount(value); if (maxPlayers <= value) setMaxPlayers(value + 1); }}>{[0,1,2,3,4,5,6].map((value) => <option key={value} value={value}>{new Intl.NumberFormat('fa-IR').format(value)} ربات</option>)}</select></label><label>مدت هر نوبت<select value={turnSeconds} onChange={(event) => setTurnSeconds(Number(event.target.value))}><option value={180}>۳ دقیقه</option><option value={900}>۱۵ دقیقه</option><option value={3600}>۱ ساعت</option><option value={86400}>۲۴ ساعت</option></select></label></div>
          <button className="modal-primary" disabled={busy || !displayName.trim() || !roomTitle.trim()} onClick={() => void connectRoom(false)}>{busy ? 'در حال اتصال…' : 'ساخت شهر'}</button>
          <div className="join-row"><input aria-label="کد دعوت" placeholder="کد دعوت ۸ رقمی" value={roomIdInput} onChange={(event) => setRoomIdInput(event.target.value.toUpperCase())} /><button disabled={busy || !roomIdInput.trim() || !displayName.trim()} onClick={() => void connectRoom(true)}>ورود</button></div>
          {session && <button className="disconnect-button" onClick={() => { sessionStorage.removeItem('masir-room'); setSession(null); setSnapshot(null); setPanel(null); }}>خروج از {snapshot?.room.title || 'اتاق فعلی'}</button>}
          <button className="account-logout" onClick={logout}>خروج از حساب {authUser.user.phone}</button>
          {apiError && <p className="form-error" role="alert">{apiError}</p>}
        </section> : panel === 'business' ? <section className="game-modal business-modal" role="dialog" aria-modal="true" aria-labelledby="business-title">
          <button className="modal-close" onClick={() => { setPanel(null); setApiError(''); }} aria-label="بستن">×</button><span className="modal-kicker">کارآفرینی و تولید شهر</span><h2 id="business-title">برج کسب‌وکار</h2><p className="modal-copy">شعبه انتخاب کن؛ دخل‌وخرج، حقوق کارکنان و مواد اولیه با شاخص‌های اقتصادی هر ماه تغییر می‌کنند.</p>
          <div className="business-income"><span>درآمد توزیع‌شدهٔ آخرین دوره</span><b>{formatMoney(snapshot?.businessMonthlyIncomeTomans || '0')}</b></div>
          <section className="inventory-group"><h3>شعبه‌های من</h3>{snapshot?.businesses.length ? snapshot.businesses.map((branch) => {
            const model = snapshot.businessCatalog.find((item) => item.id === branch.model_id);
            const result = branch.net_profit_tomans == null ? null : BigInt(branch.net_profit_tomans);
            return <article className="business-card" key={branch.id}>
              <div className="business-card-heading"><span className="business-emblem">▣</span><div><b>{model?.name || branch.model_id} · شعبهٔ {new Intl.NumberFormat('fa-IR').format(branch.branch_number)}</b><small>سطح {new Intl.NumberFormat('fa-IR').format(branch.level)} · {branch.manager_enabled ? 'مدیر خودکار فعال' : 'بدون مدیر'}</small></div></div>
              {branch.last_period_key ? <div className="business-numbers"><span>فروش {formatMoney(branch.revenue_tomans)}</span><span>مواد {formatMoney(branch.materials_cost_tomans)}</span><span>حقوق {formatMoney(branch.payroll_cost_tomans)}</span><b className={result !== null && result >= 0n ? 'positive-text' : 'negative-text'}>{result !== null && result >= 0n ? 'سود ' : 'زیان '}{formatMoney(result?.toString())}</b></div> : <p className="real-value-note">حساب اولین دوره پس از تسویه ثبت می‌شود.</p>}
              <div className="business-owners">{branch.owners.map((owner) => <span key={owner.playerId}>{owner.displayName}{owner.isBot ? ' · ربات' : ''} <b>{new Intl.NumberFormat('fa-IR').format(owner.shareBps / 100)}٪</b></span>)}</div>
              <div className="business-card-foot"><span>هزینهٔ پرداخت‌نشده {formatMoney(branch.unpaid_expenses_tomans)}</span><button className="small-action" disabled={!session || busy || snapshot?.turn?.status !== 'open'} onClick={() => toggleBusinessManager(branch)}>{branch.manager_enabled ? 'آزادکردن مدیر' : 'استخدام مدیر'}</button></div>
              {snapshot?.members.some((member) => member.player_id !== snapshot.playerId) && <div className="business-partner-form"><select aria-label="انتخاب شریک" value={partnerId} onChange={(event) => setPartnerId(event.target.value)}><option value="">بازیکن شریک</option>{snapshot.members.filter((member) => member.player_id !== snapshot.playerId && !branch.owners.some((owner) => owner.playerId === member.player_id)).map((member) => <option key={member.player_id} value={member.player_id}>{member.display_name}{member.is_bot ? ' · ربات' : ''}</option>)}</select><select aria-label="سهم شریک" value={partnerShare} onChange={(event) => setPartnerShare(Number(event.target.value))}><option value={10}>۱۰٪ سهم</option><option value={20}>۲۰٪ سهم</option><option value={30}>۳۰٪ سهم</option><option value={40}>۴۰٪ سهم</option></select><input aria-label="آوردهٔ شریک به تومان" inputMode="numeric" dir="ltr" value={formatMoneyInput(partnerContribution)} onChange={(event) => setPartnerContribution(parseMoneyInput(event.target.value))} /><button className="small-action" disabled={!session || busy || snapshot?.turn?.status !== 'open' || !partnerId} onClick={() => offerBusinessPartnership(branch)}>پیشنهاد شراکت</button></div>}
            </article>;
          }) : <p className="empty-state">هنوز شعبه‌ای نساخته‌ای. برای شروع، یکی از کسب‌وکارهای شهر را انتخاب کن.</p>}</section>
          {snapshot?.partnershipOffers.length ? <section className="inventory-group"><h3>پیشنهادهای شراکت</h3>{snapshot.partnershipOffers.map((offer) => <div className="business-offer" key={offer.id}><span><b>{offer.proposer_name}</b> برای {offer.model_id} · سهم {new Intl.NumberFormat('fa-IR').format(offer.share_bps / 100)}٪ · آورده {formatMoney(offer.contribution_tomans)}</span><div><button className="small-action accept" disabled={busy || snapshot.turn?.status !== 'open'} onClick={() => respondToBusinessOffer(offer.id, true)}>پذیرش</button><button className="small-action reject" disabled={busy || snapshot.turn?.status !== 'open'} onClick={() => respondToBusinessOffer(offer.id, false)}>رد</button></div></div>)}</section> : null}
          <section className="inventory-group"><h3>سرمایه‌گذاری تازه <span>{new Intl.NumberFormat('fa-IR').format(snapshot?.businesses.length || 0)} از ۸ شعبه</span></h3>{(snapshot?.businesses.length || 0) >= 8 && <p className="real-value-note">ظرفیت کسب‌وکارهای شما تکمیل شده است.</p>}<div className="business-catalog">{snapshot?.businessCatalog.map((model) => {
            const cash = BigInt(snapshot.account?.cash_tomans || '0'); const cost = BigInt(model.startupCost);
            const existingCount = snapshot.businesses.filter((branch) => branch.model_id === model.id).length;
            return <button className="business-model" key={model.id} disabled={!session || busy || snapshot.turn?.status !== 'open' || cash < cost || existingCount >= 3 || snapshot.businesses.length >= 8} onClick={() => openBusiness(model.id)}><span><b>{model.name}</b><small>هزینهٔ آغاز {formatMoney(model.startupCost)}</small></span><span><b>فروش پایه</b><small>{formatMoney(model.baseRevenue)} / ماه</small></span></button>;
          })}</div></section>
          {!session && <button className="modal-primary" onClick={() => setPanel('connect')}>ورود به شهر بازی</button>}{apiError && <p className="form-error" role="alert">{apiError}</p>}
        </section> : panel === 'market' ? <section className="game-modal" role="dialog" aria-modal="true" aria-labelledby="market-title">
          <button className="modal-close" onClick={() => { setPanel(null); setApiError(''); }} aria-label="بستن">×</button><span className="modal-kicker">تصمیم این دوره</span><h2 id="market-title">بازار شهر</h2><p className="modal-copy">سفارش خرید یا فروش برای پایان نوبت ثبت می‌شود؛ قیمت‌ها در مرحلهٔ تسویهٔ اقتصادی اعمال می‌شوند.</p>
          <button className="loan-entry" onClick={() => { setPanel('loan'); setApiError(''); }}>درخواست وام برای رشد شهر</button>
          <button className="loan-entry check-entry" onClick={() => { setPanel('checks'); setApiError(''); }}>درخواست چک ضمانت‌دار</button>
          {snapshot?.eventCard && <section className="inventory-group"><h3>رویداد این دوره · {snapshot.eventCard.title}</h3><p>{snapshot.eventCard.description}</p>{snapshot.eventCard.kind === 'skill' ? (snapshot.skillCatalog ?? []).map(skill => <button className="small-action accept" key={skill.id} disabled={busy || !!snapshot.eventCard?.choice} onClick={() => void businessRequest('/event-cards/' + snapshot.turn?.period_key,{choice:skill.id},'انتخاب رویداد ثبت شد.')}>{skill.name}</button>) : <><button className="small-action accept" disabled={busy || !!snapshot.eventCard.choice} onClick={() => void businessRequest('/event-cards/' + snapshot.turn?.period_key,{choice:'accept'},'پذیرش رویداد ثبت شد.')}>پذیرش</button><button className="small-action reject" disabled={busy || !!snapshot.eventCard.choice} onClick={() => void businessRequest('/event-cards/' + snapshot.turn?.period_key,{choice:'decline'},'رد رویداد ثبت شد.')}>رد کردن</button></>}</section>}
          {snapshot?.skills && <section className="inventory-group"><h3>مهارت‌ها · امتیاز آزاد {snapshot.skills.skill_points}</h3>{(snapshot.skillCatalog ?? []).map(skill => <button className="small-action accept" key={skill.id} disabled={busy || !snapshot.skills?.skill_points || snapshot.turn?.status !== 'open'} onClick={() => void businessRequest('/skills/' + snapshot.turn?.period_key,{skillId:skill.id},'مهارت ارتقا یافت.')}>{skill.name} {snapshot.skills?.[skill.id as 'management'|'negotiation'|'marketing']}/۱۰</button>)}</section>}
                    {snapshot?.funds && <section className="inventory-group"><h3>صندوق‌های سرمایه‌گذاری</h3>{snapshot.funds.catalog.map(fund => { const holding=snapshot.funds?.positions.find(item=>item.fund_id===fund.id); return <div className="business-offer" key={fund.id}><span><b>{fund.name}</b><small> ارزش {formatMoney(holding?.market_value_tomans ?? '0')} تومان · کارمزد {fund.annualFeeBps/100}% سالانه</small></span><div><button className="small-action accept" disabled={busy||snapshot.turn?.status!=='open'} onClick={()=>void businessRequest('/funds/'+snapshot.turn?.period_key,{fundId:fund.id,action:'buy',amountTomans:'100000'},'۱۰۰ هزار تومان به صندوق افزوده شد.')}>خرید</button>{holding&&BigInt(holding.market_value_tomans)>=100000n&&<button className="small-action reject" disabled={busy||snapshot.turn?.status!=='open'} onClick={()=>void businessRequest('/funds/'+snapshot.turn?.period_key,{fundId:fund.id,action:'sell',amountTomans:'100000'},'۱۰۰ هزار تومان از صندوق فروخته شد.')}>فروش</button>}</div></div>; })}</section>}
          {snapshot?.insurance && <section className="inventory-group"><h3>پوشش بیمهٔ شهر</h3>{snapshot.insurance.catalog.map(plan => {const active=snapshot.insurance?.policies.some(policy=>policy.plan_id===plan.id&&policy.active); return <div className="business-offer" key={plan.id}><span><b>{plan.name}</b><small>حق‌بیمهٔ ماهانه {formatMoney(plan.premiumTomans)} · سقف پوشش {formatMoney(plan.coverageTomans)} تومان</small></span><button className="small-action accept" disabled={busy||snapshot.turn?.status!=='open'} onClick={()=>void businessRequest('/insurance/'+snapshot.turn?.period_key,{planId:plan.id,active:!active},active?'بیمه لغو شد.':'بیمه فعال شد.')}>{active?'لغو':'فعال‌سازی'}</button></div>;})}</section>}
          {snapshot?.auctions?.length ? <section className="inventory-group"><h3>مزایده‌های باز</h3>{snapshot.auctions.map(auction=><div className="business-offer" key={auction.id}><span><b>{auction.asset_category}</b><small>پیشنهاد فعلی {formatMoney(auction.highest_bid_tomans)} تومان · {auction.bid_count} پیشنهاد</small></span><button className="small-action accept" disabled={busy||snapshot.turn?.status!=='open'} onClick={()=>void businessRequest('/auctions/'+auction.id+'/bids/'+snapshot.turn?.period_key,{amountTomans:(BigInt(auction.highest_bid_tomans)>0n?BigInt(auction.highest_bid_tomans):BigInt(auction.reserve_price_tomans)).toString()},'پیشنهاد مزایده ثبت شد.')}>پیشنهاد قیمت</button></div>)}</section> : null}
                    <section className="inventory-group p2p-contracts"><h3>قرارداد با بازیکنان</h3><p className="real-value-note">در وام مستقیم، تو وام‌دهنده هستی. معاملهٔ دارایی با قیمت توافقی و انتقال هم‌زمان ثبت می‌شود.</p>
            <label>هم‌بازی<select value={contractPlayerId} onChange={(event) => setContractPlayerId(event.target.value)}><option value="">انتخاب بازیکن</option>{snapshot?.members.filter((member) => member.player_id !== snapshot.playerId && !member.is_bot).map((member) => <option key={member.player_id} value={member.player_id}>{member.display_name}</option>)}</select></label>
            <label>نوع قرارداد<select value={contractKind} onChange={(event) => setContractKind(event.target.value as typeof contractKind)}><option value="loan">وام مستقیم</option><option value="asset_trade">معاملهٔ دارایی</option></select></label>
            <label>{contractKind === 'loan' ? 'مبلغ وام به تومان' : 'قیمت خرید به تومان'}<input inputMode="numeric" dir="ltr" value={formatMoneyInput(contractAmount)} onChange={(event) => setContractAmount(parseMoneyInput(event.target.value))} /></label>
            {contractKind === 'loan' ? <div className="modal-two"><label>سود سالانه<select value={contractInterestBps} onChange={(event) => setContractInterestBps(Number(event.target.value))}><option value={0}>بدون سود</option><option value={1200}>۱۲٪</option><option value={1800}>۱۸٪</option><option value={2400}>۲۴٪</option><option value={3600}>۳۶٪</option></select></label><label>مدت بازپرداخت<select value={contractMonths} onChange={(event) => setContractMonths(Number(event.target.value))}><option value={6}>۶ ماه</option><option value={12}>۱۲ ماه</option><option value={24}>۲۴ ماه</option><option value={36}>۳۶ ماه</option></select></label></div>
              : <div className="modal-two"><label>دارایی فروشی<select value={contractAssetCategory} onChange={(event) => setContractAssetCategory(event.target.value)}>{categories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>ارزش دارایی منتقل‌شده<input inputMode="numeric" dir="ltr" value={formatMoneyInput(contractAssetValue)} onChange={(event) => setContractAssetValue(parseMoneyInput(event.target.value))} /></label></div>}
            <button className="modal-primary" disabled={!session || busy || !contractPlayerId || snapshot?.turn?.status !== 'open'} onClick={proposeContract}>ارسال پیشنهاد</button>
            {snapshot?.contractOffers.map((offer) => <div className="business-offer" key={offer.id}><span><b>{offer.proposer_name}</b> · {offer.contract_kind === 'loan' ? `وام ${formatMoney(offer.amount_tomans)} · سود ${new Intl.NumberFormat('fa-IR').format((offer.interest_bps || 0) / 100)}٪ · ${offer.months} ماه` : `${offer.asset_category} · ارزش ${formatMoney(offer.asset_value_tomans)} · قیمت ${formatMoney(offer.amount_tomans)}`}</span><div><button className="small-action accept" disabled={busy || snapshot.turn?.status !== 'open'} onClick={() => respondToContract(offer.id, true)}>پذیرش</button><button className="small-action reject" disabled={busy || snapshot.turn?.status !== 'open'} onClick={() => respondToContract(offer.id, false)}>رد</button></div></div>)}
          </section>
          <label>دارایی<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <section className="market-history"><div className="market-history-heading"><b>روند قیمت · {selectedMarketQuote?.name || categories.find(([id]) => id === category)?.[1]}</b><small>بازار شبیه‌سازی‌شدهٔ شهر</small></div>
            {selectedMarketQuote && <div className="market-quote"><span>قیمت هر {selectedMarketQuote.unit}</span><strong>{formatMoney(selectedMarketQuote.priceTomans)}</strong><small className={marketMonthlyChange === null ? '' : marketMonthlyChange >= 0 ? 'positive-text' : 'negative-text'}>{marketMonthlyChange === null ? 'نرخ مرجع این دوره' : `${marketMonthlyChange >= 0 ? '+' : '−'}${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(Math.abs(marketMonthlyChange))}٪ نسبت به ماه قبل`}</small></div>}
            {historyLoading ? <div className="market-chart-empty">در حال دریافت روند بازار…</div> : selectedMarketQuote ? <Suspense fallback={<div className="market-chart-empty">در حال آماده‌سازی نمودار…</div>}><MarketChart points={marketHistory} category={category} basePriceTomans={selectedMarketQuote.basePriceTomans} unit={selectedMarketQuote.unit} /></Suspense> : <div className="market-chart-empty">در حال دریافت قیمت بازار…</div>}
          </section>
          <div className="trade-toggle"><button className={tradeAction === 'buy' ? 'active' : ''} onClick={() => setTradeAction('buy')}>خرید</button><button className={tradeAction === 'sell' ? 'active' : ''} onClick={() => setTradeAction('sell')}>فروش</button></div>
          <div className="market-available"><span>{tradeAction === 'buy' ? 'موجودی نقد' : `ارزش ${selectedMarketQuote?.name || 'دارایی'} شما`}</span><b>{formatMoney(tradeLimit.toString())}</b></div>
          <label>{tradeAction === 'buy' ? 'بودجهٔ خرید به تومان' : 'ارزش دارایی برای فروش به تومان'}<input inputMode="numeric" dir="ltr" value={formatMoneyInput(amount)} onChange={(event) => setAmount(parseMoneyInput(event.target.value))} /></label>
          <button className="market-max" type="button" disabled={tradeLimit <= 0n} onClick={() => setAmount(tradeLimit.toString())}>انتخاب تمام موجودی</button>
          <div className="market-trade-preview"><div><span>کارمزد معامله ({new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format((selectedMarketQuote?.feeBps || 0) / 100)}٪)</span><b>{formatMoney(tradeFee.toString())}</b></div><div><span>مقدار تقریبی</span><b>{estimatedUnits} {selectedMarketQuote?.unit || ''}</b></div><div className="market-trade-total"><span>{tradeAction === 'buy' ? 'ارزش دارایی پس از کارمزد' : 'دریافتی پس از کارمزد'}</span><strong>{formatMoney(tradeNet.toString())}</strong></div></div>
          {tradeAmount > tradeLimit && <p className="market-validation" role="alert">مبلغ از {tradeAction === 'buy' ? 'موجودی نقد' : 'ارزش دارایی شما'} بیشتر است.</p>}
          <p className="market-settlement-note">سفارش در پایان ماه با قیمت همان دوره تسویه می‌شود؛ مقدار نهایی ممکن است تغییر کند.</p>
          {snapshot?.decision && <div className="current-order"><span>تصمیم این ماه: {snapshot.decision.action_type === 'hold' ? 'نگه‌داری نقدینگی' : `${snapshot.decision.action_type === 'buy' ? 'خرید' : 'فروش'} ${categories.find(([id]) => id === snapshot.decision?.category)?.[1] || 'دارایی'} به ارزش ${formatMoney(snapshot.decision.amount_tomans)}`} · {snapshot.decision.status === 'pending' ? 'در انتظار تسویه' : snapshot.decision.status === 'delegated' ? 'نمایندهٔ خودکار' : snapshot.decision.status === 'rejected' ? 'اجرا نشد' : snapshot.decision.status === 'executed' ? 'اجرا شد' : snapshot.decision.status}</span>{snapshot.decision.action_type !== 'hold' && snapshot.turn?.status === 'open' && !snapshot.turn.is_ready && <button type="button" disabled={busy} onClick={() => void submitDecision({ action: 'hold' })}>لغو سفارش</button>}</div>}
          <button className="modal-primary" disabled={busy || !snapshot?.turn || snapshot.turn.status !== 'open' || snapshot.turn.is_ready || !selectedMarketQuote || !tradeAmountValid} onClick={() => void submitDecision({ action: tradeAction, category, amountTomans: amount })}>{busy ? 'در حال ثبت…' : `ثبت سفارش ${tradeAction === 'buy' ? 'خرید' : 'فروش'}`}</button>
          {!session && <p className="form-error">برای ثبت معامله، ابتدا به یک شهر بازی وصل شو.</p>}{apiError && <p className="form-error" role="alert">{apiError}</p>}
        </section> : panel === 'loan' ? <section className="game-modal loan-modal" role="dialog" aria-modal="true" aria-labelledby="loan-title">
          <button className="modal-close" onClick={() => { setPanel(null); setApiError(''); }} aria-label="بستن">×</button><span className="modal-kicker">تأمین مالی شهر</span><h2 id="loan-title">وام سرمایه‌گذاری</h2><p className="modal-copy">وام را برای ساخت یا خرید دارایی بگیر. درخواست با توجه به درآمد، اجاره و اقساط فعلی سنجیده می‌شود.</p>
          <label>مبلغ وام به تومان<input inputMode="numeric" dir="ltr" value={formatMoneyInput(loanAmount)} onChange={(event) => setLoanAmount(parseMoneyInput(event.target.value))} /></label>
          <div className="modal-two"><label>مدت بازپرداخت<select value={loanMonths} onChange={(event) => setLoanMonths(Number(event.target.value))}>{[6, 12, 24, 36, 48, 60].map((months) => <option key={months} value={months}>{new Intl.NumberFormat('fa-IR').format(months)} ماه</option>)}</select></label><label>نوع نرخ سود<select value={loanRateKind} onChange={(event) => setLoanRateKind(event.target.value as typeof loanRateKind)}><option value="fixed">ثابت</option><option value="variable">متغیر</option></select></label></div>
          <div className="loan-terms"><div className={`loan-estimate ${loanPaymentAllowed ? 'allowed' : 'over-limit'}`}><span>قسط ماهانهٔ این وام</span><strong>{loanPaymentEstimate === null ? '—' : formatMoney(loanPaymentEstimate.toString())}</strong><small>{loanPaymentLimit === null ? 'در حال محاسبهٔ توان بازپرداخت…' : `سقف اقساط شما: ${formatMoney(loanPaymentLimit.toString())}`}</small></div><p>نرخ ثابت سالانه: <b>{new Intl.NumberFormat('fa-IR').format(Number(snapshot?.loanOffers.fixedAnnualRateBps || 0) / 100)}٪</b></p><p>نرخ متغیر فعلی: <b>{new Intl.NumberFormat('fa-IR').format(Number(snapshot?.loanOffers.variableAnnualRateBps || 0) / 100)}٪</b></p><small>مجموع اقساط ماهانه باید حداکثر ۴۰٪ درآمد پس از اجاره باشد. نرخ و قسط وام متغیر ممکن است در دوره‌های بعد تغییر کند.</small></div>
          {snapshot?.loans?.length ? <div className="active-loans"><h3>وام‌های فعال</h3>{snapshot.loans.map((loan, index) => <p key={`${loan.rateKind}-${index}`}>{formatMoney(loan.principalTomans)} · قسط {formatMoney(loan.monthlyDueTomans)} · {new Intl.NumberFormat('fa-IR').format(loan.monthsRemaining)} ماه باقی‌مانده</p>)}</div> : null}
          <button className="modal-primary" disabled={busy || !session || !snapshot?.turn || snapshot.turn.status !== 'open' || !/^\d+$/.test(loanAmount) || BigInt(loanAmount || '0') < 500000n || BigInt(loanAmount || '0') > 100000000n} onClick={() => void applyForLoan()}>{busy ? 'در حال بررسی توان بازپرداخت…' : 'ثبت درخواست و دریافت وام'}</button>
          {apiError && <p className="form-error" role="alert">{apiError}</p>}
        </section> : panel === 'checks' ? <section className="game-modal checks-modal" role="dialog" aria-modal="true" aria-labelledby="checks-title">
          <button className="modal-close" onClick={() => { setPanel(null); setApiError(''); }} aria-label="بستن">×</button><span className="modal-kicker">اعتبار شهری</span><h2 id="checks-title">چک و ضمانت</h2><p className="modal-copy">برای چک مدت‌دار، یک بازیکن را به‌عنوان گیرنده و بازیکن دیگری را برای ضمانت انتخاب کن. چک پس از پذیرش ضامن صادر می‌شود و ماه آینده سررسید دارد.</p>
          {snapshot?.members.filter((member) => !member.is_bot && member.player_id !== snapshot.playerId).length ? <>
            <label>گیرندهٔ چک<select value={checkPayeeId} onChange={(event) => setCheckPayeeId(event.target.value)}><option value="">انتخاب بازیکن</option>{snapshot.members.filter((member) => !member.is_bot && member.player_id !== snapshot.playerId).map((member) => <option key={member.player_id} value={member.player_id}>{member.display_name}</option>)}</select></label>
            <label>ضامن چک<select value={checkGuarantorId} onChange={(event) => setCheckGuarantorId(event.target.value)}><option value="">انتخاب ضامن</option>{snapshot.members.filter((member) => !member.is_bot && member.player_id !== snapshot.playerId && member.player_id !== checkPayeeId).map((member) => <option key={member.player_id} value={member.player_id}>{member.display_name}</option>)}</select></label>
            <label>مبلغ چک به تومان<input inputMode="numeric" dir="ltr" value={formatMoneyInput(checkAmount)} onChange={(event) => setCheckAmount(parseMoneyInput(event.target.value))} /></label>
            <p className="check-due">سررسید: {monthName(nextMonthKey(snapshot?.turn?.period_key))} · ضمانت کامل مبلغ چک</p>
            <button className="modal-primary" disabled={busy || !session || !snapshot?.turn || snapshot.turn.status !== 'open' || !checkPayeeId || !checkGuarantorId || !/^\d+$/.test(checkAmount) || BigInt(checkAmount || '0') < 100000n || BigInt(checkAmount || '0') > 100000000n} onClick={() => void sendCheckRequest()}>{busy ? 'در حال ارسال…' : 'ارسال درخواست به ضامن'}</button>
          </> : <p className="form-error">برای درخواست ضمانت، دست‌کم دو بازیکن انسانی دیگر باید در اتاق باشند.</p>}
          {snapshot?.checkRequests?.length ? <section className="check-requests"><h3>درخواست‌های در انتظار</h3>{snapshot.checkRequests.map((request) => <article className="check-request" key={request.id}><p><b>{request.issuer_name}</b> ← {request.payee_name}</p><p>{formatMoney(request.amount_tomans)} · سررسید {monthName(request.due_period)}</p>{request.guarantor_id === snapshot.playerId ? <div><small>درخواست ضمانت از طرف {request.issuer_name}</small><div className="check-actions"><button disabled={busy} onClick={() => void respondToCheck(request.id, true)}>پذیرش</button><button disabled={busy} onClick={() => void respondToCheck(request.id, false)}>رد</button></div></div> : <small>ضامن پیشنهادی: {request.guarantor_name} · در انتظار پاسخ</small>}</article>)}</section> : null}
          {apiError && <p className="form-error" role="alert">{apiError}</p>}
        </section> : panel === 'build' ? <section className="game-modal build-modal" role="dialog" aria-modal="true" aria-labelledby="build-title">
          <button className="modal-close" onClick={() => { setPanel(null); setApiError(''); }} aria-label="بستن">×</button><span className="modal-kicker">مدیریت شهر</span><h2 id="build-title">ساخت و ارتقای محله</h2><p className="modal-copy">هر اقدام هزینه را از موجودی همین حالا کم می‌کند. ارتقاها تا سطح ۵ باز هستند.</p>
          <div className="building-options">{buildings.filter((building) => !building.service).map((building) => {
            const owned = snapshot?.city.find((item) => item.buildingId === building.id);
            const level = owned?.level ?? 0;
            const nextCost = owned?.nextCostTomans;
            const cash = snapshot?.account?.cash_tomans;
            const canAfford = nextCost !== null && nextCost !== undefined && cash !== undefined && BigInt(cash) >= BigInt(nextCost);
            return <button className="building-option" key={building.id} onClick={() => { setSelectedId(building.id); void constructBuilding(building.id); }} disabled={busy || !session || snapshot?.turn?.status !== 'open' || !owned || level >= (owned?.maxLevel || 5) || !canAfford}>
              <span className="option-icon" style={{ '--avatar-color': building.color } as React.CSSProperties}>{building.symbol}</span><span className="option-copy"><b>{level === 0 ? `ساخت ${building.name}` : `ارتقای ${building.name}`}</b><small className="option-meta"><span>سطح {new Intl.NumberFormat('fa-IR').format(level)} از {new Intl.NumberFormat('fa-IR').format(owned?.maxLevel || 5)}</span><span>هزینه <bdi dir="auto">{owned?.nextCostTomans ? formatMoney(owned.nextCostTomans) : 'حداکثر سطح'}</bdi></span><span>درآمد ماهانه <bdi dir="auto">{owned ? formatMoney((BigInt(owned.monthlyIncomeTomans) + (level > 0 ? BigInt(owned.monthlyIncomeTomans) / BigInt(level) : BigInt(owned.baseMonthlyIncomeTomans))).toString()) : '—'}</bdi></span></small></span><span className="option-arrow" aria-hidden="true">←</span>
            </button>;
          })}</div>
          {!session && <><p className="form-error">برای ساخت، ابتدا باید وارد یک شهر بازی شوی.</p><button className="modal-primary" onClick={() => { setPanel('connect'); setApiError(''); }}>ساخت یا ورود به شهر بازی</button></>}{apiError && <p className="form-error" role="alert">{apiError}</p>}
        </section> : panel === 'inventory' ? <section className="game-modal inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-title">
          <button className="modal-close" onClick={() => setPanel(null)} aria-label="بستن">×</button><span className="modal-kicker">کوله‌پشتی شهر</span><h2 id="inventory-title">دارایی‌ها و تعهدها</h2><p className="modal-copy">ارزش دارایی‌ها از آخرین snapshot اتاق خوانده می‌شود.</p>
          <div className="inventory-summary"><div><span>موجودی نقد</span><b>{formatMoney(snapshot?.account?.cash_tomans)}</b></div><div><span>ارزش دارایی واقعی</span><b>{formatMoney(financial?.assetsTomans)}</b></div><div><span>بدهی واقعی</span><b>{formatMoney(financial?.liabilitiesTomans)}</b></div></div>
          <section className="inventory-group"><h3>سرمایه‌گذاری‌ها</h3>{snapshot?.positions.length ? snapshot.positions.map((position) => <div className="inventory-row" key={position.category}><span>{categories.find(([id]) => id === position.category)?.[1] || position.category}</span><b>{formatMoney(position.market_value_tomans)}</b></div>) : <p className="empty-state">هنوز دارایی سرمایه‌گذاری‌شده‌ای نداری.</p>}</section>
          <section className="inventory-group"><h3>ساختمان‌های تو</h3>{snapshot?.city.filter((item) => item.level > 0).length ? snapshot.city.filter((item) => item.level > 0).map((item) => <div className="inventory-row" key={item.buildingId}><span>{item.name} · سطح {new Intl.NumberFormat('fa-IR').format(item.level)}</span><b>{formatMoney(item.monthlyIncomeTomans)} / ماه</b></div>) : <p className="empty-state">هنوز ساختمانی نساخته‌ای.</p>}</section>
          <section className="inventory-group"><h3>وام‌های فعال</h3>{snapshot?.loans.length ? snapshot.loans.map((loan, index) => <div className="inventory-row" key={`${loan.rateKind}-${index}`}><span>{loan.rateKind === 'fixed' ? 'وام با نرخ ثابت' : 'وام با نرخ متغیر'} · {new Intl.NumberFormat('fa-IR').format(loan.monthsRemaining)} ماه</span><b>{formatMoney(loan.principalTomans)}</b></div>) : <p className="empty-state">وام فعالی نداری.</p>}</section>
          <section className="inventory-group"><h3>چک‌ها و ضمانت‌ها</h3>{snapshot?.checks.length || snapshot?.checkRequests.length ? <>{snapshot?.checks.map((check) => <div className="inventory-row" key={check.id}><span>{check.issuer_id === snapshot.playerId ? 'چک صادرشده' : check.payee_id === snapshot.playerId ? 'چک دریافتی' : 'ضمانت چک'} · {check.status === 'pending' ? 'در انتظار سررسید' : check.status === 'paid' ? 'پرداخت‌شده' : 'برگشتی'} · {monthName(check.due_period)}</span><b>{formatMoney(check.amount_tomans)}</b></div>)}{snapshot?.checkRequests.map((request) => <div className="inventory-row" key={request.id}><span>درخواست ضمانت · سررسید {monthName(request.due_period)}</span><b>{formatMoney(request.amount_tomans)}</b></div>)}</> : <p className="empty-state">چک یا ضمانتی ثبت نشده.</p>}</section>
        </section> : panel === 'chat' ? <section className="game-modal chat-modal" role="dialog" aria-modal="true" aria-labelledby="chat-title">
          <button className="modal-close" onClick={() => { setPanel(null); setApiError(''); }} aria-label="بستن">×</button><span className="modal-kicker">گفت‌وگوی شهر</span><h2 id="chat-title">چت بازیکنان</h2><p className="modal-copy">پیام‌ها برای اعضای همین اتاق فرستاده می‌شوند؛ هر پیام حداکثر ۲۸۰ نویسه است.</p>
          <div className="chat-messages" aria-live="polite">{snapshot?.chat?.length ? snapshot.chat.map((message) => <article className={message.playerId === snapshot.playerId ? 'chat-message mine' : 'chat-message'} key={message.id}><b>{message.displayName}</b><p>{message.message}</p><small>{new Date(message.createdAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</small></article>) : <p className="empty-state">هنوز پیامی ردوبدل نشده. شروع گفت‌وگو با توست.</p>}</div>
          <form className="chat-compose" onSubmit={(event) => { event.preventDefault(); void sendChat(); }}><input value={chatDraft} maxLength={280} onChange={(event) => setChatDraft(event.target.value)} placeholder="پیامت را بنویس…" aria-label="پیام جدید" /><button className="modal-primary" disabled={!session || !chatDraft.trim() || chatBusy}>{chatBusy ? 'در حال ارسال…' : 'ارسال'}</button></form>
          {!session && <p className="empty-state">برای گفت‌وگو ابتدا وارد یک اتاق شو.</p>}{apiError && <p className="form-error" role="alert">{apiError}</p>}
        </section> : panel === 'autopilot' ? <section className="game-modal autopilot-modal" role="dialog" aria-modal="true" aria-labelledby="autopilot-title">
          <button className="modal-close" onClick={() => { setPanel(null); setApiError(''); }} aria-label="بستن">×</button><span className="modal-kicker">همراه مالی تو</span><h2 id="autopilot-title">تنظیم نمایندهٔ خودکار</h2><p className="modal-copy">اگر تا پایان مهلت تصمیمی ثبت نکنی، نماینده قبض‌ها و تعهدهای ضروری را اولویت می‌دهد و طبق این سیاست دربارهٔ مازاد تصمیم می‌گیرد.</p>
          <label className="toggle-row"><span><b>نماینده فعال باشد</b><small>در صورت نداشتن تصمیم تا پایان نوبت، سیاست ذخیره و سرمایه‌گذاری اجرا می‌شود.</small></span><input type="checkbox" checked={policyDraft.enabled} onChange={(event) => setPolicyDraft((value) => ({ ...value, enabled: event.target.checked }))} /></label>
          <label>سبک تصمیم‌گیری<select value={policyDraft.strategy} onChange={(event) => setPolicyDraft((value) => ({ ...value, strategy: event.target.value as AutopilotPolicy['strategy'] }))}><option value="reserve">محتاط · تمرکز بر دارایی پوششی</option><option value="balanced">متعادل · تنوع و ذخیره</option><option value="growth">رشد · سرمایه‌گذاری بیشتر</option></select></label>
          <div className="modal-two"><label>ذخیرهٔ هزینهٔ چند ماه<select value={policyDraft.reserve_months} onChange={(event) => setPolicyDraft((value) => ({ ...value, reserve_months: Number(event.target.value) }))}>{[0, 1, 2, 3, 4, 6].map((months) => <option key={months} value={months}>{new Intl.NumberFormat('fa-IR').format(months)} ماه</option>)}</select></label><label>سرمایه‌گذاری از مازاد<select value={policyDraft.invest_surplus_bps} onChange={(event) => setPolicyDraft((value) => ({ ...value, invest_surplus_bps: Number(event.target.value) }))}>{[0, 1000, 2500, 4000, 5000].map((bps) => <option key={bps} value={bps}>{new Intl.NumberFormat('fa-IR').format(bps / 100)}٪</option>)}</select></label></div>
          <p className="real-value-note">حقوق، اجاره، چک‌های سررسیدشده و اقساط پیش از سرمایه‌گذاری در محاسبه لحاظ می‌شوند.</p><button className="modal-primary" disabled={!session || policyBusy} onClick={() => void saveAutopilot()}>{policyBusy ? 'در حال ذخیره…' : 'ذخیرهٔ سیاست نماینده'}</button>{apiError && <p className="form-error" role="alert">{apiError}</p>}
        </section> : <section className="game-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
          <button className="modal-close" onClick={() => setPanel(null)} aria-label="بستن">×</button><span className="modal-kicker">کارنامهٔ مالی</span><h2 id="profile-title">مسیر آزادی مالی</h2>
          {!financial ? <p className="modal-copy">برای دیدن امتیاز و شرایط مالی، به یک شهر بازی متصل شو.</p> : <>
            <div className={`score-hero ${financial.status}`}><div className="score-number">{new Intl.NumberFormat('fa-IR').format(financial.score)}<small> / ۱۰۰</small></div><div><span>امتیاز شهر</span><strong>{financial.status === 'freedom' ? 'آزادی مالی' : financial.status === 'bankrupt' ? 'ورشکستگی' : financial.status === 'restructure' ? 'نیازمند بازسازی بدهی' : 'در مسیر رشد'}</strong></div></div>
            <div className="profile-summary"><div><span>ثروت خالص واقعی</span><strong>{formatMoney(financial.netWorthTomans)}</strong></div><div><span>دارایی واقعی</span><strong>{formatMoney(financial.assetsTomans)}</strong></div><div><span>بدهی واقعی</span><strong>{formatMoney(financial.liabilitiesTomans)}</strong></div><div><span>درآمد غیرفعال ماهانه</span><strong>{formatMoney(financial.passiveIncomeTomans)}</strong></div><div><span>تعهد ماهانه</span><strong>{formatMoney(financial.monthlyObligationsTomans)}</strong></div><div><span>معوقه‌ها</span><strong>{formatMoney(financial.arrearsTomans)}</strong></div></div>
            {snapshot?.wellbeing && <section className="freedom-checks"><h3>کیفیت زندگی</h3><p>وقت آزاد: <b>{snapshot.wellbeing.free_time}/۱۰۰</b> · سلامت: <b>{snapshot.wellbeing.health}/۱۰۰</b> · امنیت روانی: <b>{snapshot.wellbeing.security}/۱۰۰</b></p></section>}
            {snapshot?.challenges && <section className="freedom-checks"><h3>چالش‌های مالی</h3>{snapshot.challenges.map(challenge=><p className={challenge.completed?'passed':''} key={challenge.challenge_id}>{challenge.completed?'✓':'○'} {challenge.challenge_id==='financial_freedom'?'آزادی مالی':'خروج از بدهی'}</p>)}</section>}
            <div className="score-dimensions">{scoreDimensions.map(([key, label]) => <div className="score-row" key={key}><div><span>{label}</span><b>{new Intl.NumberFormat('fa-IR').format(financial.dimensions[key])}</b></div><div className="score-track"><i style={{ width: `${financial.dimensions[key]}%` }} /></div></div>)}</div>
            <section className="freedom-checks"><h3>شرایط آزادی مالی</h3><p className={financial.freedomChecks.incomeCoversExpenses ? 'passed' : ''}><span>{financial.freedomChecks.incomeCoversExpenses ? '✓' : '○'}</span> درآمد غیرفعال پوشش‌دهندهٔ تعهد ماهانه</p><p className={financial.freedomChecks.capitalGoalReached ? 'passed' : ''}><span>{financial.freedomChecks.capitalGoalReached ? '✓' : '○'}</span> ثروت خالص واقعی حداقل ۲۴ ماه تعهد</p><p className={financial.freedomChecks.debtRatioHealthy ? 'passed' : ''}><span>{financial.freedomChecks.debtRatioHealthy ? '✓' : '○'}</span> بدهی حداکثر ۳۵٪ دارایی‌ها</p></section>
            {financial.restructuringEligible && (financial.canRestructure
              ? <button className="modal-primary" disabled={busy || !snapshot?.turn || snapshot.turn.status !== 'open'} onClick={() => void performRestructure()}>{busy ? 'در حال بازسازی…' : 'تبدیل معوقه‌ها به وام ثابت ۳۶ ماهه'}</button>
              : <p className="real-value-note">بازسازی دوباره پس از مهلت سه‌ماهه ممکن است.</p>)}
            {apiError && <p className="form-error" role="alert">{apiError}</p>}            <p className="real-value-note">ارزش‌های واقعی بر مبنای شاخص ترکیبی قیمت‌ها محاسبه شده‌اند.</p>
            {snapshot?.leaderboard?.length ? <section className="leaderboard"><h3>رقابت شهر</h3>{snapshot.leaderboard.map((entry) => <div className={entry.playerId === snapshot.playerId ? 'leader-row current' : 'leader-row'} key={entry.playerId}><span><b>{new Intl.NumberFormat('fa-IR').format(entry.rank)}.</b> {entry.displayName}{entry.isBot ? ' · رقیب هوشمند' : ''}</span><strong>{entry.netWorthTomans === null ? 'اطلاعات مالی خصوصی' : formatMoney(entry.netWorthTomans)}</strong></div>)}</section> : null}          </>}
        </section>}
      </div>}
      {returnReport && <div className="return-overlay" role="presentation"><section className="return-newspaper" role="dialog" aria-modal="true" aria-labelledby="return-title" dir="rtl">
        <div className="newspaper-ribbon">ویژه‌نامهٔ بازگشت به شهر <span>●</span></div><h2 id="return-title">خبرهای مهم شهرت</h2>
        <p className="newspaper-subtitle">در نبود تو، {new Intl.NumberFormat('fa-IR').format(returnReport.periods.length)} دورهٔ مالی سپری شد.</p>
        <div className="newspaper-headlines"><article><b>حقوق و درآمد شهر</b><strong>{formatMoney(returnReport.periods.reduce((sum, item) => sum + BigInt(item.salaryTomans) + BigInt(item.cityIncomeTomans), 0n).toString())}</strong><small>واریزی طی دوره‌های سپری‌شده</small></article>
          <article><b>تصمیم نماینده</b><strong>{(() => { const action = [...returnReport.periods].reverse().find((item) => item.delegateAction)?.delegateAction; return action?.action === 'buy' ? `خرید ${action.category}` : 'حفظ نقدینگی و پرداخت تعهدها'; })()}</strong><small>طبق اولویت‌های مالی ثبت‌شده</small></article></div>
        <div className="newspaper-net">تغییر خالص وجه نقد: <b>{formatMoney(returnReport.periods.reduce((sum, item) => sum + BigInt(item.netCashChangeTomans), 0n).toString())}</b></div>
        {reportDetails && <div className="return-period-list">{returnReport.periods.map((item) => <article className="return-period-entry" key={item.periodKey}><button className="return-period-summary" aria-expanded={expandedReportPeriod===item.periodKey} onClick={()=>setExpandedReportPeriod(value=>value===item.periodKey?null:item.periodKey)}><b>{monthName(item.periodKey)}</b><span>درآمد {formatMoney(item.incomeTomans)}</span><span>هزینه {formatMoney(item.expenseTomans)}</span><span>{item.delegateAction?.action === 'buy' ? `نماینده: خرید ${item.delegateAction.category}` : 'نماینده: نگهداری وجه'}</span></button>{expandedReportPeriod===item.periodKey&&renderLedgerBreakdown(item)}</article>)}</div>}
        <div className="newspaper-actions"><button onClick={() => setReportDetails((value) => !value)}>{reportDetails ? 'بستن جزئیات' : 'دیدن جزئیات'}</button><button className="modal-primary" onClick={dismissReturnReport}>ادامهٔ بازی</button></div>
      </section></div>}
    </main>
  );
}
