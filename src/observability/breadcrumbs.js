import fs from 'node:fs';
import path from 'node:path';

export class Breadcrumbs {
  constructor({ filePath, enabled = true }) {
    this.enabled = enabled;
    this.entries = [];
    this.filePath = filePath ? path.resolve(filePath) : null;

    if (this.enabled && this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
    }
  }

  record(type, summary, extra = {}) {
    const entry = {
      ts: new Date().toISOString(),
      type,
      summary,
      ...extra,
    };
    this.entries.push(entry);
    if (this.enabled && this.stream) {
      this.stream.write(JSON.stringify(entry) + '\n');
    }
    return entry;
  }

  all() {
    return [...this.entries];
  }

  async close() {
    if (this.stream) {
      await new Promise((resolve) => this.stream.end(resolve));
      this.stream = null;
    }
  }
}
