import { test, expect } from "@playwright/test";
import { startTestServer } from "./test-server.js";

test.describe("T017 [US1] Performance: Creation Action through Modal (FR-WM-01)", () => {
  let serverInstance: ReturnType<typeof startTestServer>;
  let baseUrl: string;

  test.beforeAll(async () => {
    serverInstance = startTestServer();
    baseUrl = await serverInstance.listen();
  });

  test.afterAll(async () => {
    await serverInstance.close();
  });

  test("PERF-02: creation action through modal / card renders within <= 1.0 s P95", async ({ page }) => {
    await page.goto(baseUrl);
    const newBtn = page.locator("#new-notebook-btn");
    await expect(newBtn).toBeVisible();

    const sampleCount = 10;
    const latencies: number[] = [];

    // Warm-up iteration
    await newBtn.click();
    await expect(page.locator(".notebook-card").first()).toBeVisible();

    // Measured samples
    for (let i = 0; i < sampleCount; i++) {
      const t0 = performance.now();
      await newBtn.click();
      await expect(page.locator(`.notebook-card:nth-child(${i + 2})`)).toBeVisible();
      const t1 = performance.now();
      latencies.push(t1 - t0);
    }

    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(sampleCount * 0.95);
    const p95Latency = latencies[p95Index] ?? latencies[latencies.length - 1]!;

    // Creation through UI modal/card must be <= 1.0 s (1000 ms) P95
    expect(p95Latency).toBeLessThan(1000);
  });
});
