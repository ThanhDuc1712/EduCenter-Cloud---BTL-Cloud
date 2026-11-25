const TZ = 'Asia/Ho_Chi_Minh'

/** VND amounts arrive as decimal strings (BIGINT, D-12). */
export function vnd(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? BigInt(value) : BigInt(Math.round(value))
  return `${n.toLocaleString('vi-VN')} ₫`
}

export function vndShort(value: string | number): string {
  const n = Number(value)
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ`
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}k`
  return n.toLocaleString('vi-VN')
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return '—'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-')
    return `${d}/${m}/${y}`
  }
  return new Date(value).toLocaleDateString('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function time(value: string | Date): string {
  return new Date(value).toLocaleTimeString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
}

export function relative(value: string | Date): string {
  const diff = (Date.now() - new Date(value).getTime()) / 1000
  if (diff < 60) return 'vừa xong'
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} ngày trước`
  return date(value)
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function ms(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`
}

/** Local calendar date (YYYY-MM-DD) in the center's time zone. */
export function todayYmd(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function localYmd(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: TZ })
}

export const WEEKDAYS = ['', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']

export function score(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })
}

/** Weekday name of an instant in the center's time zone. */
export function weekday(value: string | Date): string {
  const d = new Date(`${localYmd(value)}T00:00:00Z`).getUTCDay()
  return WEEKDAYS[d === 0 ? 7 : d]
}
