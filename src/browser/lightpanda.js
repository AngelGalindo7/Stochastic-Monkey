export class NotImplementedError extends Error {
  constructor(message, decision) {
    super(message);
    this.name = 'NotImplementedError';
    this.decision = decision;
  }
}

export async function launchLightpanda(_opts = {}) {
  if (process.platform === 'win32') {
    throw new NotImplementedError(
      'Lightpanda has no native Windows build (DECISION_LOG 002). Falling back to Puppeteer.',
      '002',
    );
  }
  if (!process.env.LIGHTPANDA_BIN) {
    throw new NotImplementedError(
      'LIGHTPANDA_BIN env var not set; no Lightpanda binary path provided.',
      '002',
    );
  }
  throw new NotImplementedError(
    'Lightpanda integration is stubbed in v1 (DECISION_LOG 002). Real adapter pending Linux deploy.',
    '002',
  );
}
