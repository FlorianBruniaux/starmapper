// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, afterEach } from "vitest";
import { CircuitBreaker } from "@/lib/circuit-breaker";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CircuitBreaker", () => {
  describe("isAvailable()", () => {
    it("is available immediately after construction", () => {
      const cb = new CircuitBreaker(3, 60_000, "Test");
      expect(cb.isAvailable()).toBe(true);
    });

    it("remains available below the error threshold", () => {
      const cb = new CircuitBreaker(3, 60_000, "Test");
      cb.recordError();
      cb.recordError();
      expect(cb.isAvailable()).toBe(true); // 2 errors < threshold of 3
    });

    it("opens (returns false) at exactly the error threshold", () => {
      const cb = new CircuitBreaker(3, 60_000, "Test");
      cb.recordError();
      cb.recordError();
      cb.recordError(); // 3rd error — circuit opens
      expect(cb.isAvailable()).toBe(false);
    });

    it("stays open when called again before resetMs elapses", () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker(3, 60_000, "Test");
      cb.recordError();
      cb.recordError();
      cb.recordError();

      vi.advanceTimersByTime(59_999); // just under 1 minute
      expect(cb.isAvailable()).toBe(false);
    });

    it("auto-resets and returns true after resetMs elapses", () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker(3, 60_000, "Test");
      cb.recordError();
      cb.recordError();
      cb.recordError();
      expect(cb.isAvailable()).toBe(false);

      vi.advanceTimersByTime(60_001);
      expect(cb.isAvailable()).toBe(true);
    });

    it("resets error count after auto-reset so further errors can open again", () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker(3, 60_000, "Test");
      cb.recordError();
      cb.recordError();
      cb.recordError();

      vi.advanceTimersByTime(60_001); // trigger reset
      cb.isAvailable(); // calling isAvailable() performs the reset

      // After reset: 2 more errors should not open the circuit
      cb.recordError();
      cb.recordError();
      expect(cb.isAvailable()).toBe(true);

      // 3rd error opens it again
      cb.recordError();
      expect(cb.isAvailable()).toBe(false);
    });
  });

  describe("recordError()", () => {
    it("logs a console warning when the circuit opens", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const cb = new CircuitBreaker(3, 60_000, "Jawg");
      cb.recordError();
      cb.recordError();
      cb.recordError(); // opens here

      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[circuit-breaker] Jawg circuit open"),
      );
    });

    it("does not log again for subsequent errors after circuit is open", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const cb = new CircuitBreaker(3, 60_000, "Test");
      cb.recordError();
      cb.recordError();
      cb.recordError(); // opens + logs once
      cb.recordError(); // open already — no additional log

      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("does not log when errors stay below threshold", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const cb = new CircuitBreaker(3, 60_000, "Test");
      cb.recordError();
      cb.recordError(); // 2 < 3

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("recordSuccess()", () => {
    it("resets error count after partial errors so circuit stays closed", () => {
      const cb = new CircuitBreaker(3, 60_000, "Test");
      cb.recordError();
      cb.recordError();
      cb.recordSuccess(); // reset — counter back to 0
      cb.recordError();
      cb.recordError();
      expect(cb.isAvailable()).toBe(true); // still 2 < 3
    });

    it("is a no-op on a healthy circuit with no prior errors", () => {
      const cb = new CircuitBreaker(3, 60_000, "Test");
      cb.recordSuccess();
      expect(cb.isAvailable()).toBe(true);
    });

    it("requires full threshold of new errors to re-open after reset", () => {
      const cb = new CircuitBreaker(3, 60_000, "Test");
      cb.recordError();
      cb.recordError();
      cb.recordSuccess(); // reset
      cb.recordError();
      cb.recordError();
      cb.recordError(); // 3rd after reset — opens again
      expect(cb.isAvailable()).toBe(false);
    });

    it("resets a half-open circuit (2 of 3 errors) to zero", () => {
      const cb = new CircuitBreaker(3, 60_000, "Test");
      cb.recordError();
      cb.recordError(); // 2 errors, circuit still open-able
      cb.recordSuccess();
      // Now need 3 fresh errors to open
      cb.recordError();
      cb.recordError();
      expect(cb.isAvailable()).toBe(true); // only 2 after reset
    });
  });

  describe("threshold and resetMs customisation", () => {
    it("respects a threshold of 1 (opens on first error)", () => {
      const cb = new CircuitBreaker(1, 60_000, "Strict");
      expect(cb.isAvailable()).toBe(true);
      cb.recordError();
      expect(cb.isAvailable()).toBe(false);
    });

    it("respects a very short resetMs (resets quickly)", () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker(3, 100, "Fast");
      cb.recordError();
      cb.recordError();
      cb.recordError();
      expect(cb.isAvailable()).toBe(false);

      vi.advanceTimersByTime(101);
      expect(cb.isAvailable()).toBe(true);
    });
  });
});
