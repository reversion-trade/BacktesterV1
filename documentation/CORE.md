# Core Module Documentation

The core module contains fundamental types, configuration schemas, and constants used throughout the backtester.

---

## Files

### `src/core/types.ts`

Central type definitions for the backtester.

#### Position States

```typescript
type PositionState = "FLAT" | "LONG" | "SHORT";
type Direction = "LONG" | "SHORT";
type AlgoType = "LONG" | "SHORT" | "BOTH";
```

- **FLAT**: No open position (waiting for entry signal)
- **LONG**: Bought asset, profit when price goes UP
- **SHORT**: Sold borrowed asset, profit when price goes DOWN

#### Value Configuration

```typescript
type ValueType = "ABS" | "REL";

interface ValueConfig {
  type: ValueType;
  value: number;
}
```

Used for position sizing, stop loss, and take profit:
- `ABS`: Absolute value in USD (e.g., `{ type: "ABS", value: 100 }` = $100)
- `REL`: Relative/percentage (e.g., `{ type: "REL", value: 0.02 }` = 2%)

#### Entry/Exit Conditions

```typescript
interface EntryCondition {
  required: IndicatorConfig[];  // All must signal (AND)
  optional: IndicatorConfig[];  // At least one must signal (OR)
  limitLevel: number;           // Limit order offset
}

interface ExitCondition {
  required: IndicatorConfig[];
  optional: IndicatorConfig[];
  stopLoss?: ValueConfig;
  takeProfit?: ValueConfig;
  trailingSL?: boolean;
}
```

Logic: `ALL(required) AND (optional.length === 0 OR ANY(optional))`

#### Algorithm Parameters

```typescript
interface AlgoParams {
  type: AlgoType;
  longEntry?: EntryCondition;
  longExit?: ExitCondition;
  shortEntry?: EntryCondition;
  shortExit?: ExitCondition;
  positionSize: ValueConfig;
  assumePositionImmediately: boolean;
  closePositionOnExit: boolean;
}
```

---

### `src/core/config.ts`

Backtest configuration with Zod validation.

```typescript
interface BacktestConfig {
  coinSymbol: string;
  startTime: number;           // Unix timestamp (seconds)
  endTime: number;
  startingCapitalUSD: number;
  feeBps: number;              // Basis points (10 = 0.1%)
  slippageBps: number;
  algoParams: AlgoParams;
}
```

The `BacktestConfigSchema` provides runtime validation of all config fields.

---

### `src/core/constants.ts`

Fixed constants for the backtester.

```typescript
const BPS_DIVISOR = 10000;      // 1 basis point = 0.01%
const DEFAULT_FEE_BPS = 10;     // 0.1% per trade
const DEFAULT_SLIPPAGE_BPS = 10; // 0.1% slippage

// Helper functions
function bpsToDecimal(bps: number): number;   // 10 → 0.001
function decimalToBps(decimal: number): number; // 0.001 → 10
```

**Why basis points?**
- Industry standard for expressing small percentages
- Avoids floating point confusion (10 bps is clearer than 0.001)
- 100 bps = 1%
