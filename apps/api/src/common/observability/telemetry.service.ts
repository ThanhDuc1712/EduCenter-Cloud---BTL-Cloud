import { Injectable } from '@nestjs/common';
import { appInsightsClient } from './appinsights-bootstrap';
import { MetricsService } from './metrics.service';

export interface DependencyCall {
  /** Metric name, e.g. `oss.put`, `callback.material`, `local.processor`. */
  name: string;
  type: 'OSS' | 'HTTP' | 'PostgreSQL' | 'LocalStorage' | 'LocalProcessor' | 'Callback' | 'Azure' | 'Aliyun';
  target: string;
  durationMs: number;
  success: boolean;
  resultCode?: string | number;
}

/**
 * Single entry point for custom telemetry: always feeds the in-process MetricsService and, when
 * Application Insights is configured, sends a dependency/metric/event to it as well.
 */
@Injectable()
export class TelemetryService {
  constructor(private readonly metrics: MetricsService) {}

  get appInsightsEnabled(): boolean {
    return appInsightsClient() !== undefined;
  }

  dependency(call: DependencyCall): void {
    this.metrics.record(call.name, call.durationMs, call.success);
    appInsightsClient()?.trackDependency({
      name: call.name,
      dependencyTypeName: call.type,
      target: call.target,
      data: call.name,
      duration: call.durationMs,
      success: call.success,
      resultCode: String(call.resultCode ?? (call.success ? 0 : 1)),
    });
  }

  metric(name: string, value: number, ok = true): void {
    this.metrics.record(name, value, ok);
    appInsightsClient()?.trackMetric({ name, value });
  }

  event(name: string, properties: Record<string, string | number | boolean | undefined> = {}): void {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(properties)) if (v !== undefined) clean[k] = String(v);
    appInsightsClient()?.trackEvent({ name, properties: clean });
  }

  exception(err: unknown): void {
    if (err instanceof Error) appInsightsClient()?.trackException({ exception: err });
  }

  /** Measures an async call as a dependency. */
  async measure<T>(name: string, type: DependencyCall['type'], target: string, fn: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      const result = await fn();
      this.dependency({ name, type, target, durationMs: performance.now() - started, success: true });
      return result;
    } catch (err) {
      this.dependency({ name, type, target, durationMs: performance.now() - started, success: false });
      throw err;
    }
  }
}
