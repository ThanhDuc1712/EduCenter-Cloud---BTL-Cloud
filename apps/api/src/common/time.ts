/**
 * Time helpers. The center operates in Asia/Ho_Chi_Minh (UTC+07:00, no DST); the database stores UTC.
 * Calendar dates (`@db.Date`) are represented as `YYYY-MM-DD` strings at the API boundary and as
 * `Date` at UTC midnight inside Prisma.
 */
export const CENTER_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const CENTER_UTC_OFFSET_MINUTES = 7 * 60;
const MINUTE = 60_000;
const DAY = 86_400_000;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** `YYYY-MM-DD` → Date at UTC midnight (for `@db.Date` columns). */
export function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

/** Date from a `@db.Date` column → `YYYY-MM-DD`. */
export function dateToYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Local (center) calendar date of an instant. */
export function localYmd(instant: Date = new Date()): string {
  return new Date(instant.getTime() + CENTER_UTC_OFFSET_MINUTES * MINUTE).toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, days: number): string {
  return dateToYmd(new Date(ymdToDate(ymd).getTime() + days * DAY));
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(ymd: string): number {
  const d = ymdToDate(ymd).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Local date + minutes after local midnight → UTC instant. */
export function localToUtc(ymd: string, minuteOfDay: number): Date {
  return new Date(ymdToDate(ymd).getTime() + (minuteOfDay - CENTER_UTC_OFFSET_MINUTES) * MINUTE);
}

/** UTC half-open range [start, end) covering local days `fromYmd` … `toYmd` inclusive. */
export function localDayRange(fromYmd: string, toYmd: string = fromYmd): { start: Date; end: Date } {
  return { start: localToUtc(fromYmd, 0), end: localToUtc(addDaysYmd(toYmd, 1), 0) };
}

/** Monday of the ISO week containing `ymd`. */
export function startOfIsoWeek(ymd: string): string {
  return addDaysYmd(ymd, 1 - isoWeekday(ymd));
}

export function minutesToHhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function hhmmToMinutes(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new RangeError('time must be HH:mm');
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface SlotPattern {
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  roomId?: string | null;
}

export interface Occurrence {
  startsAt: Date;
  endsAt: Date;
  roomId: string | null;
}

/** Expands a weekly timetable into concrete session instants between two local dates (inclusive). */
export function expandWeeklySlots(fromYmd: string, toYmd: string, slots: SlotPattern[], maxOccurrences = 400): Occurrence[] {
  const out: Occurrence[] = [];
  for (let day = fromYmd; day <= toYmd && out.length < maxOccurrences; day = addDaysYmd(day, 1)) {
    const weekday = isoWeekday(day);
    for (const slot of slots) {
      if (slot.dayOfWeek !== weekday) continue;
      const startsAt = localToUtc(day, slot.startMinute);
      out.push({ startsAt, endsAt: new Date(startsAt.getTime() + slot.durationMinutes * MINUTE), roomId: slot.roomId ?? null });
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** True when [aStart, aEnd) and [bStart, bEnd) overlap. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}
