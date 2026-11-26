import * as React from 'react'
import { cn } from '@/lib/utils'

export interface Datum {
  label: string
  value: number
  /** Optional longer label for the tooltip. */
  title?: string
}

/**
 * Single-series column chart (magnitude). Columns ≤ 24px, 4px rounded data-end, square at the
 * baseline, recessive grid, hover tooltip per column, value label on hover/focus. Text uses text
 * tokens — never the series colour. A screen-reader table mirrors the data.
 */
export function ColumnChart({ data, format = (n) => n.toLocaleString('vi-VN'), height = 180, color = 'var(--series-1)', ariaLabel }: { data: Datum[]; format?: (n: number) => string; height?: number; color?: string; ariaLabel: string }) {
  const [hover, setHover] = React.useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const nice = niceMax(max)
  const ticks = [0, nice / 2, nice]
  const padL = 44
  const padB = 22
  const w = Math.max(240, data.length * 56)
  const plotH = height - padB - 8
  const band = (w - padL) / Math.max(1, data.length)
  const barW = Math.min(24, band * 0.5)
  return (
    <div className="relative w-full overflow-x-auto overflow-y-hidden">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full min-w-[240px]" role="img" aria-label={ariaLabel} style={{ height }}>
        {ticks.map((t) => {
          const y = 8 + plotH - (t / nice) * plotH
          return (
            <g key={t}>
              <line x1={padL} x2={w} y1={y} y2={y} stroke="var(--grid)" strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
                {format(t)}
              </text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const h = (d.value / nice) * plotH
          const x = padL + i * band + (band - barW) / 2
          const y = 8 + plotH - h
          const r = Math.min(4, h / 2)
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.title ?? d.label}: ${format(d.value)}`}>
              <rect x={padL + i * band} y={8} width={band} height={plotH} fill="transparent" />
              {h > 0 ? <path d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`} fill={color} opacity={hover === null || hover === i ? 1 : 0.45} /> : null}
              {hover === i ? (
                <text x={x + barW / 2} y={Math.max(16, y - 6)} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
                  {format(d.value)}
                </text>
              ) : null}
              <text x={padL + i * band + band / 2} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
      {hover !== null ? (
        <div className="pointer-events-none absolute top-1 right-1 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
          <span className="text-muted-foreground">{data[hover].title ?? data[hover].label}: </span>
          <span className="font-medium tabular-nums">{format(data[hover].value)}</span>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th>{d.title ?? d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Horizontal bars for ranked categories (labels left, value at the tip). */
export function BarList({ data, format = (n) => n.toLocaleString('vi-VN'), color = 'var(--series-1)' }: { data: Datum[]; format?: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" title={`${d.title ?? d.label}: ${format(d.value)}`}>
          <span className="truncate text-muted-foreground">{d.label}</span>
          <span className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: color }} />
          <span className="tabular-nums">{format(d.value)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Line chart for change over time — one series, 2px line, crosshair + tooltip on hover.
 */
export function LineChart({ data, format = (n) => n.toLocaleString('vi-VN'), height = 160, color = 'var(--series-1)', ariaLabel }: { data: Datum[]; format?: (n: number) => string; height?: number; color?: string; ariaLabel: string }) {
  const [hover, setHover] = React.useState<number | null>(null)
  const ref = React.useRef<SVGSVGElement>(null)
  const w = 600
  const padL = 44
  const padB = 20
  const plotH = height - padB - 10
  const nice = niceMax(Math.max(1, ...data.map((d) => d.value)))
  const x = (i: number) => padL + (data.length <= 1 ? (w - padL) / 2 : (i / (data.length - 1)) * (w - padL - 8))
  const y = (v: number) => 10 + plotH - (v / nice) * plotH
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ')
  const onMove = (e: React.MouseEvent) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box || !data.length) return
    const px = ((e.clientX - box.left) / box.width) * w
    let best = 0
    for (let i = 1; i < data.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    setHover(best)
  }
  const labelEvery = Math.max(1, Math.ceil(data.length / 8))
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[0, nice / 2, nice].map((t) => (
          <g key={t}>
            <line x1={padL} x2={w} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={height - 5} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {d.label}
            </text>
          ) : null,
        )}
        {data.length ? <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {hover !== null ? (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={10} y2={10 + plotH} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(data[hover].value)} r={4.5} fill={color} stroke="var(--background)" strokeWidth={2} />
          </>
        ) : null}
      </svg>
      {hover !== null ? (
        <div className="pointer-events-none absolute top-1 right-1 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
          <span className="text-muted-foreground">{data[hover].title ?? data[hover].label}: </span>
          <span className="font-medium tabular-nums">{format(data[hover].value)}</span>
        </div>
      ) : null}
      {data.length === 0 ? <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">Chưa có dữ liệu</p> : null}
    </div>
  )
}

/** Thin segmented bar for a whole split into parts (e.g. attendance breakdown), with a legend. */
export function SegmentBar({ parts, className }: { parts: { label: string; value: number; color: string }[]; className?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-muted" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {total > 0 ? parts.filter((p) => p.value > 0).map((p) => <span key={p.label} title={`${p.label}: ${p.value} (${Math.round((p.value / total) * 100)}%)`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />) : null}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {p.label} <span className="font-medium text-foreground tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function niceMax(v: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return n * exp
}
