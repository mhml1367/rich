export type CitySeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type CityWeatherKind = 'sunny' | 'partly-cloudy' | 'rainy' | 'windy' | 'snowy';

export type CityWeather = {
  season: CitySeason;
  seasonLabel: string;
  kind: CityWeatherKind;
  weatherLabel: string;
};

const seasons: { id: CitySeason; label: string; conditions: CityWeatherKind[] }[] = [
  { id: 'spring', label: 'بهار', conditions: ['partly-cloudy', 'sunny', 'rainy', 'partly-cloudy'] },
  { id: 'summer', label: 'تابستان', conditions: ['sunny', 'sunny', 'partly-cloudy', 'windy'] },
  { id: 'autumn', label: 'پاییز', conditions: ['partly-cloudy', 'rainy', 'windy', 'rainy'] },
  { id: 'winter', label: 'زمستان', conditions: ['snowy', 'partly-cloudy', 'snowy', 'rainy'] },
];

const weatherLabels: Record<CityWeatherKind, string> = {
  sunny: 'آفتابی',
  'partly-cloudy': 'نیمه‌ابری',
  rainy: 'بارانی',
  windy: 'بادی',
  snowy: 'برفی',
};

// Each room receives a stable simulated forecast for the entire game month.
// The same room and period always produce the same result on every client.
export function getCityWeather(periodKey: string, roomId = ''): CityWeather {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periodKey);
  const month = match ? Number(match[2]) : 1;
  const season = seasons[Math.floor((month - 1) / 3)];
  let hash = 2166136261;
  for (const character of `${roomId}:${periodKey}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  const kind = season.conditions[(hash >>> 0) % season.conditions.length];
  return { season: season.id, seasonLabel: season.label, kind, weatherLabel: weatherLabels[kind] };
}

export function currentPersianPeriod(): string {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    year: 'numeric', month: '2-digit', timeZone: 'Asia/Tehran',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1405';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month.padStart(2, '0')}`;
}
