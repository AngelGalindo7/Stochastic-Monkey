import fs from 'node:fs';
import path from 'node:path';

export class FileSpanExporter {
  constructor({ filePath }) {
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
  }

  export(spans, resultCallback) {
    try {
      for (const span of spans) {
        const obj = this.#serializeSpan(span);
        this.stream.write(JSON.stringify(obj) + '\n');
      }
      resultCallback({ code: 0 });
    } catch (err) {
      resultCallback({ code: 1, error: err });
    }
  }

  shutdown() {
    return new Promise((resolve) => this.stream.end(resolve));
  }

  forceFlush() {
    return Promise.resolve();
  }

  #serializeSpan(span) {
    const ctx = span.spanContext();
    const start = hrTimeToISO(span.startTime);
    const end = hrTimeToISO(span.endTime);
    return {
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      kind: span.kind,
      startTime: start,
      endTime: end,
      durationMs: hrToMs(span.duration),
      attributes: span.attributes,
      status: span.status,
      events: span.events,
    };
  }
}

function hrTimeToISO([sec, nano]) {
  return new Date(sec * 1000 + Math.floor(nano / 1e6)).toISOString();
}

function hrToMs([sec, nano]) {
  return sec * 1000 + nano / 1e6;
}
