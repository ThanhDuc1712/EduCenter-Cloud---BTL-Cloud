import { Injectable } from '@nestjs/common';

const BUCKET_MS = 60_000;
const KEEP_BUCKETS = 120; // 2 hours
const MAX_SAMPLES_PER_BUCKET = 500;

interface Bucket {
  start: number;
  count: number;
  errors: number;
  sum: number;
  max: number;
  samples: number[];
}

export interface SeriesPoint {
  at: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface MetricSummary {
  name: string;
  count: number;
  errors: number;
  errorRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  series: SeriesPoint[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * In-process metrics of THIS instance (since process start, 2-hour window, per-minute buckets):
 * API request latency/error rate and dependency latencies (OSS, callback, local worker).
 * Shown in Cloud Monitoring next to Application Insights / Azure Monitor data when configured.
 */
@Injectable()
export class MetricsService {
  readonly startedAt = new Date();
  private readonly metrics = new Map<string, Bucket[]>();

  record(name: string, durationMs: number, ok = true): void {
    const now = Date.now();
    const start = now - (now % BUCKET_MS);
    let buckets = this.metrics.get(name);
    if (!buckets) {
      buckets = [];
      this.metrics.set(name, buckets);
    }
    let bucket = buckets[buckets.length - 1];
    if (!bucket || bucket.start !== start) {
      bucket = { start, count: 0, errors: 0, sum: 0, max: 0, samples: [] };
      buckets.push(bucket);
      if (buckets.length > KEEP_BUCKETS) buckets.shift();
    }
    bucket.count += 1;
    if (!ok) bucket.errors += 1;
    bucket.sum += durationMs;
    bucket.max = Math.max(bucket.max, durationMs);
    if (bucket.samples.length < MAX_SAMPLES_PER_BUCKET) bucket.samples.push(durationMs);
  }

  names(): string[] {
    return [...this.metrics.keys()].sort();
  }

  summary(name: string, windowMinutes = 60): MetricSummary {
    const since = Date.now() - windowMinutes * BUCKET_MS;
    const buckets = (this.metrics.get(name) ?? []).filter((b) => b.start >= since);
    const all = buckets.flatMap((b) => b.samples).sort((a, b) => a - b);
    const count = buckets.reduce((s, b) => s + b.count, 0);
    const errors = buckets.reduce((s, b) => s + b.errors, 0);
    const sum = buckets.reduce((s, b) => s + b.sum, 0);
    return {
      name,
      count,
      errors,
      errorRate: count ? round((errors / count) * 100) : 0,
      avgMs: count ? round(sum / count) : 0,
      p50Ms: round(percentile(all, 50)),
      p95Ms: round(percentile(all, 95)),
      maxMs: round(buckets.reduce((m, b) => Math.max(m, b.max), 0)),
      series: buckets.map((b) => {
        const sorted = [...b.samples].sort((x, y) => x - y);
        return { at: new Date(b.start).toISOString(), count: b.count, errors: b.errors, avgMs: round(b.sum / b.count), p95Ms: round(percentile(sorted, 95)), maxMs: round(b.max) };
      }),
    };
  }
}
