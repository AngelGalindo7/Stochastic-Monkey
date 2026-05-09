import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
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

  const exporter = new FileSpanExporter({ filePath: otelConfig.path });
  const processor = new SimpleSpanProcessor(exporter);

  provider = new BasicTracerProvider({
    resource,
    spanProcessors: [processor],
  });
  provider.register();

  tracer = trace.getTracer(SERVICE_NAME);
  return tracer;
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
