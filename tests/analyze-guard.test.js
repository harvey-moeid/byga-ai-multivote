import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/lib/storage.js", () => ({
  getLatestAnalysisTimestamp: vi.fn(),
  cleanupOldAnalyses: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/orchestrator/analysis.js", () => ({
  runAnalysis: vi.fn().mockResolvedValue({ id: "test-analysis" }),
}));

import { onRequestPost } from "../functions/api/analyze.js";
import { getLatestAnalysisTimestamp } from "../src/lib/storage.js";
import { runAnalysis } from "../src/orchestrator/analysis.js";

// Fixed clock: 10:03:00Z sits inside the 10:00-10:05 M5 bucket.
const NOW = "2026-09-28T10:03:00.000Z";

function call(env = {}) {
  const request = new Request("http://localhost/api/analyze", { method: "POST" });
  return onRequestPost({ env: { DB: {}, TIMEFRAME: "5m", ...env }, request, waitUntil: undefined });
}

describe("POST /api/analyze run guards", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs when there is no previous analysis", async () => {
    getLatestAnalysisTimestamp.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(200);
    expect(runAnalysis).toHaveBeenCalledTimes(1);
  });

  it("blocks a second run inside the same M5 candle even after the cooldown", async () => {
    getLatestAnalysisTimestamp.mockResolvedValue("2026-09-28T10:01:00.000Z"); // 120s ago, same bucket
    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error_code).toBe("COOLDOWN_ACTIVE");
    expect(body.retry_after_seconds).toBe(120); // until 10:05:00
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("allows a run once the candle bucket has changed and the cooldown passed", async () => {
    getLatestAnalysisTimestamp.mockResolvedValue("2026-09-28T09:59:30.000Z"); // previous bucket, 210s ago
    const res = await call();

    expect(res.status).toBe(200);
    expect(runAnalysis).toHaveBeenCalledTimes(1);
  });

  it("still enforces the cooldown when the candle bucket changed", async () => {
    vi.setSystemTime(new Date("2026-09-28T10:05:10.000Z"));
    getLatestAnalysisTimestamp.mockResolvedValue("2026-09-28T10:04:30.000Z"); // 40s ago, new bucket
    const res = await call({ ANALYZE_COOLDOWN_SECONDS: "60" });
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.retry_after_seconds).toBe(20);
  });

  it("can disable the once-per-candle guard", async () => {
    getLatestAnalysisTimestamp.mockResolvedValue("2026-09-28T10:01:00.000Z");
    const res = await call({ ANALYZE_ONCE_PER_CANDLE: "0" });

    expect(res.status).toBe(200);
    expect(runAnalysis).toHaveBeenCalledTimes(1);
  });

  it("skips the D1 lookup entirely when both guards are disabled", async () => {
    const res = await call({ ANALYZE_COOLDOWN_SECONDS: "0", ANALYZE_ONCE_PER_CANDLE: "0" });

    expect(res.status).toBe(200);
    expect(getLatestAnalysisTimestamp).not.toHaveBeenCalled();
  });
});
