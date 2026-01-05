/**
 * Constants for Backtester-v2
 *
 * Fixed values used throughout the backtester.
 * Change these once here, updates everywhere.
 */

// =============================================================================
// BASIS POINTS (BPS)
// =============================================================================

/**
 * 1 basis point = 0.01% = 0.0001
 * 100 basis points = 1%
 *
 * We use BPS because it's industry standard for fees/slippage.
 * To convert: decimal = bps / 10000
 */
export const BPS_DIVISOR = 10000;

// =============================================================================
// TRADING COSTS
// =============================================================================

/**
 * Default trading fee in basis points.
 * 10 bps = 0.1% per trade (matches Hyperliquid builder fee)
 *
 * Applied to both entry and exit.
 */
export const DEFAULT_FEE_BPS = 10;

/**
 * Default slippage in basis points.
 * 10 bps = 0.1% (realistic for liquid markets like Hyperliquid)
 *
 * Slippage = difference between expected price and actual fill price.
 * For backtesting, we simulate this as a cost on entry/exit.
 */
export const DEFAULT_SLIPPAGE_BPS = 10;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert basis points to decimal.
 * Example: bpsToDecimal(10) = 0.001 (0.1%)
 */
export function bpsToDecimal(bps: number): number {
    return bps / BPS_DIVISOR;
}

/**
 * Convert decimal to basis points.
 * Example: decimalToBps(0.001) = 10
 */
export function decimalToBps(decimal: number): number {
    return decimal * BPS_DIVISOR;
}
