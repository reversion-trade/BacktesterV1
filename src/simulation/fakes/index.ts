/**
 * Fakes Module
 *
 * @module simulation/fakes
 * @description
 * Central export point for fake (backtest) implementations.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Updated: 2026-01-09 (Bar-by-bar removal - only FakeSubBarProvider remains)
 */

// =============================================================================
// FAKE SUB-BAR PROVIDER
// =============================================================================

export { FakeSubBarProvider } from "./fake-subbar-provider.ts";
