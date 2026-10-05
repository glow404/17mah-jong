import { chromium } from '@playwright/test';

const baseUrl = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:3000';
const samples = Math.max(5, Number(process.env.PERF_SAMPLES ?? 20));

function percentile(values, ratio) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

function summarize(values) {
  return {
    samples: values.length,
    p50_ms: Number(percentile(values, 0.5).toFixed(2)),
    p95_ms: Number(percentile(values, 0.95).toFixed(2)),
    p99_ms: Number(percentile(values, 0.99).toFixed(2)),
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const navigation = [];
const healthRtt = [];
const warmupSamples = Math.min(3, samples);

try {
  for (let index = 0; index < samples + warmupSamples; index += 1) {
    const page = await context.newPage();
    const response = await page.goto(baseUrl, { waitUntil: 'load', timeout: 30_000 });
    if (!response?.ok()) throw new Error(`Page returned ${response?.status() ?? 'no response'}`);
    const timing = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0];
      return entry ? entry.loadEventEnd : 0;
    });
    if (index >= warmupSamples) navigation.push(timing);
    const health = await page.evaluate(async () => {
      const started = performance.now();
      const response = await fetch('/api/health', { cache: 'no-store' });
      await response.arrayBuffer();
      return { durationMs: performance.now() - started, status: response.status };
    });
    if (health.status !== 200) throw new Error(`/api/health returned ${health.status}`);
    if (index >= warmupSamples) healthRtt.push(health.durationMs);
    await page.close();
  }
} finally {
  await context.close();
  await browser.close();
}

console.log(
  JSON.stringify(
    {
      benchmark: 'browser performance baseline (page load plus same-origin health request)',
      baseUrl,
      capturedAt: new Date().toISOString(),
      warmupSamples,
      note: 'Reports warm browser-context samples only. Health RTT is a network-sync proxy, not authenticated room polling.',
      pageLoad: summarize(navigation),
      healthRequestRtt: summarize(healthRtt),
    },
    null,
    2,
  ),
);
