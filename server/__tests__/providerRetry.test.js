// The shared transient-failure retry.
//
// Measured on 2026-08-24: SIX identical curls of the Open Food Facts URL this
// repo's provider builds answered `503 200 200 200 503 503`. The request shape
// is not what fails — the service is intermittent, and the same query succeeds
// on the next attempt. MusicBrainz had already grown this exact rule THREE
// times by hand (its 1/sec policy answers 503 rather than 429), which is the
// tell that it was never provider-specific.
//
// Sleep is INJECTED so these run at full speed. A test that actually waits a
// second per case is one nobody runs.
import { describe, it, expect, vi } from "vitest";
import { isTransientStatus, withRetry } from "../utils/searchProviders.js";

const noSleep = () => Promise.resolve();

describe("isTransientStatus", () => {
  it("retries the statuses that MEAN 'ask again'", () => {
    for (const s of [429, 502, 503, 504]) expect(isTransientStatus(s)).toBe(true);
  });
  it("does NOT retry a 500 — an ambiguous server error is not a promise of a different answer", () => {
    expect(isTransientStatus(500)).toBe(false);
  });
  it("does NOT retry a client error: a 404 or a 401 answers the same way forever", () => {
    for (const s of [400, 401, 403, 404, 200]) expect(isTransientStatus(s)).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the first answer when there is nothing to retry", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetry(fn, { sleep: noSleep })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and returns the SECOND answer — the live 503/200 case", async () => {
    const e = Object.assign(new Error("openfoodfacts 503"), { retryable: true });
    const fn = vi.fn().mockRejectedValueOnce(e).mockResolvedValue("ok");
    expect(await withRetry(fn, { sleep: noSleep })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after `attempts` and throws the LAST error, not a wrapper", async () => {
    const e = Object.assign(new Error("openfoodfacts 503"), { retryable: true });
    const fn = vi.fn().mockRejectedValue(e);
    await expect(withRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toThrow("openfoodfacts 503");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("NEVER retries a non-transient error — a bad query must fail on the first try", async () => {
    // The discriminating case: retrying a 404 turns one honest miss into three
    // requests against someone else's service and the same answer.
    const fn = vi.fn().mockRejectedValue(new Error("openfoodfacts 404"));
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow("404");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs every attempt through `run`, so a throttled provider keeps its spacing", async () => {
    // MusicBrainz's retry re-enters its 1.1s gate deliberately: an immediate
    // retry against a 1/sec limit is the thing that produced the 503.
    const seen = [];
    const run = (f) => { seen.push("gate"); return f(); };
    const e = Object.assign(new Error("musicbrainz 503"), { retryable: true });
    const fn = vi.fn().mockRejectedValueOnce(e).mockResolvedValue("tracks");
    expect(await withRetry(fn, { run, sleep: noSleep })).toBe("tracks");
    expect(seen).toEqual(["gate", "gate"]);
  });

  it("waits between attempts, and the wait GROWS", async () => {
    const waits = [];
    const sleep = (ms) => { waits.push(ms); return Promise.resolve(); };
    const e = Object.assign(new Error("503"), { retryable: true });
    const fn = vi.fn().mockRejectedValue(e);
    await expect(withRetry(fn, { attempts: 3, delayMs: 100, sleep })).rejects.toThrow();
    // One wait per RETRY, never after the last failure — a sleep nobody waits
    // on is latency charged to the user for nothing.
    expect(waits).toEqual([100, 200]);
  });
});
