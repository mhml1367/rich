import { createHash } from 'node:crypto';
import { divRound, INDEX_SCALE, type Category } from './math';

export const MARKET_PRODUCTS = {
  gold: { name: 'طلای ۱۸ عیار', unit: 'گرم', basePriceTomans: 8_000_000n, feeBps: 50n, volatilityBps: 450n },
  currency: { name: 'ارز', unit: 'دلار', basePriceTomans: 80_000n, feeBps: 50n, volatilityBps: 400n },
  car: { name: 'سبد خودرو', unit: 'واحد سرمایه‌گذاری', basePriceTomans: 1_000_000n, feeBps: 50n, volatilityBps: 350n },
  equipment: { name: 'سبد تجهیزات', unit: 'واحد سرمایه‌گذاری', basePriceTomans: 1_000_000n, feeBps: 50n, volatilityBps: 250n },
  materials: { name: 'سبد مواد اولیه', unit: 'واحد سرمایه‌گذاری', basePriceTomans: 1_000_000n, feeBps: 50n, volatilityBps: 300n },
} as const;

export type MarketCategory = keyof typeof MARKET_PRODUCTS;

export function marketQuote(category: MarketCategory, index: bigint) {
  const product = MARKET_PRODUCTS[category];
  return {
    name: product.name,
    unit: product.unit,
    priceTomans: divRound(product.basePriceTomans * index, INDEX_SCALE).toString(),
    basePriceTomans: product.basePriceTomans.toString(),
    feeBps: Number(product.feeBps),
  };
}

// Stable per room and month, so retries and parallel workers settle at the same price.
export function marketChangeBps(roomId: string, periodKey: string, category: Category, baselineBps: bigint): bigint {
  const product = MARKET_PRODUCTS[category as MarketCategory];
  if (!product) return baselineBps;
  const hash = createHash('sha256').update(`${roomId}:${periodKey}:${category}`).digest();
  const range = product.volatilityBps * 2n + 1n;
  const variation = BigInt(hash.readUInt32BE(0)) % range - product.volatilityBps;
  return baselineBps + variation;
}
