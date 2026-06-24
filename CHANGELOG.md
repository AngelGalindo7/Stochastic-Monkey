# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MCTS-driven SPA exploration with UCB1 selection and backpropagation
- Accessibility tree state abstraction for browser-agnostic node fingerprinting
- Deterministic hard-signal detection: HTTP 500 responses, JS errors, broken images
- Multi-oracle detection suite:
  - Authorization replay (IDOR / BOLA detection)
  - Cross-layer persistence verification
  - Idempotency key replay
  - Security headers audit
  - Cookie security flags audit
  - Information disclosure pattern matching
- Optional LLM surprise scoring via OpenAI for guided exploration (detection remains deterministic without it)
- Puppeteer support as default Chromium engine
- Playwright support as alternative browser engine
- Seed-deterministic reproducibility: every run emits a `repro.js` that replays the exact action sequence
- OpenTelemetry JSONL trace export for offline span inspection
