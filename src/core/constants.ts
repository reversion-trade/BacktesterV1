// To convert: decimal = bps / 10000
export const BPS_DIVISOR = 10000;

// Default trading fee in basis points. 10 bps = 0.1% per trade (matches Hyperliquid builder fee)
export const DEFAULT_FEE_BPS = 10;

// Default slippage in 10 BPS but user can select
export const DEFAULT_SLIPPAGE_BPS = 10;

// Convert basis points to decimal
export function bpsToDecimal(bps: number): number {
    return bps / BPS_DIVISOR;
}
