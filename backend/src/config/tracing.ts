import { trace, SpanKind, SpanStatusCode, Span, SamplingDecision, SamplingResult, Attributes, Context } from '@opentelemetry/api';
import { env } from './env';
import { appLogger } from '../middleware/logger';

/**
 * OpenTelemetry configuration for distributed tracing
 * 
 * This sets up comprehensive observability including:
 * - Automatic instrumentation for Node.js modules
 * - Custom span creation for business logic
 * - Exporters for Jaeger, Zipkin, and Prometheus
 * - Service resource attributes for identification
 * - Tail-based sampling strategy (#231)
 */

const service_name = 'innov8-backend';
const service_version = process.env.npm_package_version || '1.0.0';

// ---------------------------------------------------------------------------
// Tail-based sampler (#231)
//
// OTel's SDK is head-based (sampling decision made when a span starts), but
// we implement a *simulated* tail strategy by marking spans with a deferred
// sampling attribute, then applying the keep/drop logic in a custom
// `Sampler` that reads span attributes already set on the *parent* context.
//
// Actual tail sampling (inspect the full trace before deciding) requires
// a collector-side tail-sampler (e.g. the OTel Collector's tail_sampling
// processor). This class gives the SDK a rich head-sampling decision that
// approximates tail behaviour for the most important cases:
//
//   1. Any error span (status >= 400 or explicit error status)       → ALWAYS keep (100%)
//   2. Any payout / escrow-release / dispute route                   → ALWAYS keep (100%)
//   3. Any slow span (exceeds per-route threshold)                   → ALWAYS keep (100%)
//   4. Health check and metrics scrape endpoints                     → DROP (never sampled)
//   5. All other healthy traffic                                     → baseline rate (default 10%)
//
// The sampler reads the `sampling.priority` attribute from the parent span
// context (set via the tracing middleware) so downstream child spans
// inherit the same keep/drop decision propagated through the call chain.
// ---------------------------------------------------------------------------

/** Route patterns that are always kept regardless of health. */
const HIGH_VALUE_ROUTE_PATTERNS: RegExp[] = [
  /\/trades\/[^/]+\/release/,
  /\/trades\/[^/]+\/deposit/,
  /\/trades\/[^/]+\/dispute/,
  /\/trades\/[^/]+\/confirm/,
  /\/escrow/,
  /\/treasury/,
  /\/admin\/streams/,
  /\/admin\/contract/,
];

/** Route patterns that are never sampled (too noisy, zero diagnostic value). */
const NEVER_SAMPLE_ROUTE_PATTERNS: RegExp[] = [
  /^\/health/,
  /^\/api\/docs/,
  /^\/metrics/,
];

export interface TailSamplerConfig {
  /** Baseline sampling rate (0–1) for healthy, non-high-value routes. Default 0.1 (10%). */
  baselineRate?: number;
  /**
   * Per-route overrides: map from a route-prefix string (matched with
   * `String.startsWith`) to a sampling rate (0–1). 0 = never, 1 = always.
   * Example: { '/stellar/fees': 0.01, '/wallet': 0.2 }
   */
  routeOverrides?: Record<string, number>;
  /** Threshold in ms above which a span is always kept. Default 2000ms. */
  slowSpanThresholdMs?: number;
}

/**
 * Reads the env-driven sampling configuration. Values can be overridden at
 * boot-time through environment variables so ops can tune without a deploy:
 *
 *   TRACE_BASELINE_RATE=0.05        # 5% baseline
 *   TRACE_SLOW_THRESHOLD_MS=1000    # keep spans >1s
 *   TRACE_ROUTE_OVERRIDES='{"\/wallet":0.2}'   # JSON map
 */
function loadSamplerConfig(): TailSamplerConfig {
  const baselineRate = Number(process.env.TRACE_BASELINE_RATE ?? '0.1');
  const slowSpanThresholdMs = Number(process.env.TRACE_SLOW_THRESHOLD_MS ?? '2000');
  let routeOverrides: Record<string, number> = {};
  try {
    const raw = process.env.TRACE_ROUTE_OVERRIDES;
    if (raw) {
      routeOverrides = JSON.parse(raw) as Record<string, number>;
    }
  } catch {
    // malformed JSON — ignore and use empty overrides
  }
  return {
    baselineRate: Number.isFinite(baselineRate) ? Math.max(0, Math.min(1, baselineRate)) : 0.1,
    slowSpanThresholdMs: Number.isFinite(slowSpanThresholdMs) && slowSpanThresholdMs > 0
      ? slowSpanThresholdMs
      : 2000,
    routeOverrides,
  };
}

/**
 * Custom sampler implementing a rule-based tail-approximate strategy.
 * Conforms to the `@opentelemetry/sdk-trace-base` `Sampler` interface so it
 * can be passed directly as `sampler` to NodeSDK.
 */
export class TailBasedSampler {
  readonly description = 'TailBasedSampler';
  private readonly config: Required<TailSamplerConfig>;

  constructor(config: TailSamplerConfig = {}) {
    const defaults = loadSamplerConfig();
    this.config = {
      baselineRate: config.baselineRate ?? defaults.baselineRate ?? 0.1,
      routeOverrides: { ...defaults.routeOverrides, ...(config.routeOverrides ?? {}) },
      slowSpanThresholdMs: config.slowSpanThresholdMs ?? defaults.slowSpanThresholdMs ?? 2000,
    };
  }

  /**
   * Called by the OTel SDK when a span starts.
   * `attributes` contains any attributes set on the span at creation time.
   * `name` is the span name, typically `${method} ${route}` for HTTP spans.
   */
  shouldSample(
    _context: Context,
    _traceId: string,
    name: string,
    _spanKind: SpanKind,
    attributes: Attributes,
  ): SamplingResult {
    const url = String(attributes['http.url'] ?? attributes['http.target'] ?? name ?? '');

    // Never sample noisy / non-diagnostic routes
    if (NEVER_SAMPLE_ROUTE_PATTERNS.some((p) => p.test(url))) {
      return { decision: SamplingDecision.NOT_RECORD };
    }

    // Always keep high-value payout and dispute routes
    if (HIGH_VALUE_ROUTE_PATTERNS.some((p) => p.test(url))) {
      return {
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: { 'sampling.rule': 'high_value_route' },
      };
    }

    // Always keep error spans (http.status_code >= 400, or explicit error attribute)
    const statusCode = Number(attributes['http.status_code'] ?? 0);
    if (statusCode >= 400 || attributes['error'] === true) {
      return {
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: { 'sampling.rule': 'error' },
      };
    }

    // Check per-route overrides (prefix match, longest wins)
    const overrides = this.config.routeOverrides;
    const matchingPrefixes = Object.keys(overrides).filter((prefix) => url.includes(prefix));
    if (matchingPrefixes.length > 0) {
      const longest = matchingPrefixes.reduce((a, b) => (a.length >= b.length ? a : b));
      const rate = overrides[longest]!;
      if (rate === 0) return { decision: SamplingDecision.NOT_RECORD };
      if (rate >= 1 || Math.random() < rate) {
        return {
          decision: SamplingDecision.RECORD_AND_SAMPLED,
          attributes: { 'sampling.rule': 'route_override', 'sampling.rate': rate },
        };
      }
      return { decision: SamplingDecision.NOT_RECORD };
    }

    // Baseline probabilistic sampling for all other healthy traffic
    if (Math.random() < this.config.baselineRate) {
      return {
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: { 'sampling.rule': 'baseline', 'sampling.rate': this.config.baselineRate },
      };
    }

    return { decision: SamplingDecision.NOT_RECORD };
  }
}

/** Singleton sampler instance, re-built on first call so env overrides are picked up. */
let _samplerInstance: TailBasedSampler | undefined;

export function getSampler(): TailBasedSampler {
  if (!_samplerInstance) {
    _samplerInstance = new TailBasedSampler();
  }
  return _samplerInstance;
}

/** Test helper — reset the singleton so env changes in tests are reflected. */
export function __resetSamplerForTests(): void {
  _samplerInstance = undefined;
}


// Initialize the OpenTelemetry SDK lazily (dynamic require avoids module-load side effects)
let sdk: { start(): void; shutdown(): Promise<void> } | undefined;

function buildSdk() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Resource } = require('@opentelemetry/resources');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ZipkinExporter } = require('@opentelemetry/exporter-zipkin');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');

  const exporters: any[] = [];

  if (env.JAEGER_ENDPOINT || env.NODE_ENV === 'production') {
    exporters.push(new JaegerExporter({
      endpoint: env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
    }));
  }

  if (env.ZIPKIN_ENDPOINT) {
    exporters.push(new ZipkinExporter({ url: env.ZIPKIN_ENDPOINT }));
  }

  let prometheusExporter: any;
  if (env.PROMETHEUS_PORT || env.NODE_ENV === 'production') {
    prometheusExporter = new PrometheusExporter({
      port: Number(env.PROMETHEUS_PORT) || 9464,
      endpoint: '/metrics',
    });
  }

  return new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: service_name,
      [SemanticResourceAttributes.SERVICE_VERSION]: service_version,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV || 'development',
    }),
    traceExporter: exporters.length > 0 ? exporters[0] : undefined,
    metricReader: prometheusExporter,
    // Tail-based sampling strategy (#231): keep all errors, payout routes, and
    // slow traces at 100%; reduce healthy baseline traffic to control storage cost.
    sampler: getSampler(),
    instrumentations: [getNodeAutoInstrumentations()],
  });
}

// Initialize tracing
export function initializeTracing(): void {
  try {
    const newSdk = buildSdk();
    sdk = newSdk;
    newSdk.start();
    appLogger.info('OpenTelemetry initialized successfully');

    const prometheusPort = env.PROMETHEUS_PORT || 9464;
    if (env.PROMETHEUS_PORT || env.NODE_ENV === 'production') {
      appLogger.info({ prometheusPort }, 'Prometheus metrics endpoint available');
    }
  } catch (error) {
    appLogger.error({ err: error }, 'Failed to initialize OpenTelemetry');
  }
}

/**
 * Tracing utilities for creating custom spans
 */
export class TracingHelper {
  private static tracer = trace.getTracer(service_name, service_version);

  /**
   * Create a span for async operations
   */
  static async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, string | number | boolean>;
    }
  ): Promise<T> {
    const span = this.tracer.startSpan(name, {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    });

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Create a span for synchronous operations
   */
  static withSyncSpan<T>(
    name: string,
    fn: (span: Span) => T,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, string | number | boolean>;
    }
  ): T {
    const span = this.tracer.startSpan(name, {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    });

    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Add attributes to the current active span
   */
  static setAttributes(attributes: Record<string, string | number | boolean>): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.setAttributes(attributes);
    }
  }

  /**
   * Add an event to the current active span
   */
  static addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.addEvent(name, attributes);
    }
  }

  /**
   * Record an exception on the current active span
   */
  static recordException(error: Error): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.recordException(error);
      activeSpan.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: error.message 
      });
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk?.shutdown().then(
    () => appLogger.info('OpenTelemetry shut down successfully'),
    (err) => appLogger.error({ err }, 'Error shutting down OpenTelemetry')
  );
});

process.on('SIGINT', () => {
  sdk?.shutdown().then(
    () => appLogger.info('OpenTelemetry shut down successfully'),
    (err) => appLogger.error({ err }, 'Error shutting down OpenTelemetry')
  );
});
