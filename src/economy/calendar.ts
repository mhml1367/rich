export interface JalaliDate { year: number; month: number; day: number }

const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric', day: 'numeric',
});

export function jalaliDate(instant: Date): JalaliDate {
  if (Number.isNaN(instant.getTime())) throw new RangeError('invalid date');
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

export function periodKey(date: JalaliDate): string {
  if (!Number.isSafeInteger(date.year) || date.year < 1 || !Number.isSafeInteger(date.month) || date.month < 1 || date.month > 12) {
    throw new RangeError('invalid Jalali period');
  }
  return `${date.year}-${String(date.month).padStart(2, '0')}`;
}

export function nextPeriod(key: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (!match) throw new RangeError('invalid Jalali period key');
  const year = Number(match[1]);
  const month = Number(match[2]);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`;
}
