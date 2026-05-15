import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { FileSpanExporter } from './fileExporter.js';

const SERVICE_NAME = 'heuristic-monkey';

let provider = null;
let tracer = null;

export function initTelemetry({ runId, seed, otelConfig }) {
  if (provider) return tracer;
  if (!otelConfig?.enabled) {
    tracer = noopTracer();
    return tracer;
  }

  const resource = new Resource({
    'service.name': SERVICE_NAME,
    'run.id': runId,
    'run.seed': seed,
  });

  const mode = otelConfig.exporter ?? 'file';
  const processors = buildProcessors(mode, otelConfig);

  if (processors.length === 0) {
    tracer = noopTracer();
    return tracer;
  }

  provider = new BasicTracerProvider({
    resource,
    spanProcessors: processors,
  });
  provider.register();

  tracer = trace.getTracer(SERVICE_NAME);
  return tracer;
}

function buildProcessors(mode, otelConfig) {
  const processors = [];

  if (mode === 'file' || mode === 'both') {
    processors.push(new SimpleSpanProcessor(
      new FileSpanExporter({ filePath: otelConfig.path }),
    ));
  }

  if (mode === 'otlp' || mode === 'both') {
    const otlp = buildOtlpExporter();
    if (otlp) processors.push(new BatchSpanProcessor(otlp));
  }

  return processors;
}

function buildOtlpExporter() {
  const endpoint = process.env.GRAFANA_OTLP_ENDPOINT;
  const instanceId = process.env.GRAFANA_INSTANCE_ID;
  const apiToken = process.env.GRAFANA_API_TOKEN;

  if (!endpoint || !instanceId || !apiToken) {
    console.warn(
      '[otel] OTLP exporter requested but GRAFANA_OTLP_ENDPOINT / GRAFANA_INSTANCE_ID / GRAFANA_API_TOKEN missing; skipping OTLP',
    );
    return null;
  }

  const auth = Buffer.from(`${instanceId}:${apiToken}`).toString('base64');
  return new OTLPTraceExporter({
    url: endpoint,
    headers: { Authorization: `Basic ${auth}` },
  });
}

export async function shutdownTelemetry() {
  if (!provider) return;
  await provider.shutdown();
  provider = null;
  tracer = null;
}

export function getTracer() {
  return tracer ?? noopTracer();
}

function noopTracer() {
  const noopSpan = {
    setAttribute() { return this; },
    setAttributes() { return this; },
    setStatus() { return this; },
    addEvent() { return this; },
    recordException() { return this; },
    end() {},
  };
  return {
    startActiveSpan(_name, _attrsOrFn, fn) {
      const handler = typeof _attrsOrFn === 'function' ? _attrsOrFn : fn;
      return handler(noopSpan);
    },
    startSpan() {
      return noopSpan;
    },
  };
}
