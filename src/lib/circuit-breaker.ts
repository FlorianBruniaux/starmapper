// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Simple in-memory circuit breaker (per Vercel instance).
 * Opens after `threshold` consecutive errors and auto-resets after `resetMs`.
 */
export class CircuitBreaker {
  private errorCount = 0;
  private openAt = 0;

  constructor(
    private readonly threshold: number,
    private readonly resetMs: number,
    private readonly name: string,
  ) {}

  isAvailable(): boolean {
    if (this.errorCount < this.threshold) return true;
    if (Date.now() - this.openAt > this.resetMs) {
      this.errorCount = 0;
      this.openAt = 0;
      return true;
    }
    return false;
  }

  recordError(): void {
    this.errorCount++;
    if (this.errorCount >= this.threshold && this.openAt === 0) {
      this.openAt = Date.now();
      console.warn(`[circuit-breaker] ${this.name} circuit open`);
    }
  }
}
