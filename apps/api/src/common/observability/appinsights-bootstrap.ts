/**
 * Application Insights must start before http/pg modules are loaded so auto-instrumentation can
 * patch them: main.ts imports this file first. Reads the connection string directly from the
 * environment (App Service setting / Key Vault reference). The SDK (OpenTelemetry, heavy) is only
 * loaded when a connection string exists, so LOCAL mode starts fast.
 * Collected automatically: incoming requests (duration, failure rate), exceptions, outgoing HTTP
 * (OSS, Azure APIs) and PostgreSQL dependencies.
 */
import type * as AppInsights from 'applicationinsights';

let client: AppInsights.TelemetryClient | undefined;

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
if (connectionString) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appInsights = require('applicationinsights') as typeof AppInsights;
    appInsights.setup(connectionString).start();
    appInsights.defaultClient.context.tags[appInsights.defaultClient.context.keys.cloudRole] = 'educenter-api';
    client = appInsights.defaultClient;
  } catch (err) {
    process.stderr.write(JSON.stringify({ time: new Date().toISOString(), level: 'warn', msg: 'appinsights.start.failed', errorName: (err as Error)?.name }) + '\n');
  }
}

export function appInsightsClient(): AppInsights.TelemetryClient | undefined {
  return client;
}
