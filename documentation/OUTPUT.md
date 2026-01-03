# Output Module Documentation

The output module handles trade recording, equity curve processing, and performance metrics calculation.

---

## Files

### `src/output/types.ts`

Output type definitions organized into 4 categories matching the backtest results display.

#### Category 1: Summary

```typescript
interface SummaryMetrics {
  totalPnlUSD: number;
  maxEquityDrawdownPct: number;
  maxEquityRunupPct: number;
  numberOfTrades: number;
  winRate: number;              // 0.55 = 55%
  sharpeRatio: number;
  sortinoRatio: number;
  largestWinUSD: number;
  largestLossUSD: number;       // Positive number
}
```

#### Category 2: Performance

```typescript
interface PerformanceMetrics {
  netProfit: ByDirection;       // { total, long, short }
  grossProfit: ByDirection;     // Sum of winning trades
  grossLoss: ByDirection;       // Sum of losing trades (positive)
}
```

#### Category 3: List of Trades

```typescript
interface TradeRecord {
  tradeId: number;
  direction: Direction;

  // Entry/Exit
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;

  // Size & P&L
  qty: number;
  pnlUSD: number;
  pnlPct: number;

  // Intra-trade extremes
  runUpUSD: number;
  runUpPct: number;
  drawdownUSD: number;
  drawdownPct: number;

  // Duration
  durationSeconds: number;
  durationBars: number;

  // Cumulative
  cumulativePnlUSD: number;
  equityAfterTrade: number;

  // Exit info
  exitReason: ExitReason;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

type ExitReason =
  | "SIGNAL"
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "TRAILING_STOP"
  | "END_OF_BACKTEST";
```

#### Category 4: Trades Analysis

```typescript
interface TradesAnalysis {
  statistics: TradeStatistics;   // Win/loss counts by direction
  profitLoss: PnLAnalysis;       // Avg P&L, largest win/loss
  duration: DurationAnalysis;    // Avg trade durations
}
```

#### Equity Tracking

```typescript
interface EquityPoint {
  time: number;
  equity: number;
  drawdownPct: number;
  runupPct: number;
}
```

---

### `src/output/trade-recorder.ts`

Utilities for opening/closing positions and recording trades.

#### Opening a Position

```typescript
function openPosition(config: OpenPositionConfig): OpenPosition;
```

Creates an `OpenPosition` record with:
- Trade ID
- Entry details (time, price, effective price after slippage)
- Position size (USD and asset units)
- BalanceIndicator for tracking P&L
- SL/TP price levels

#### Closing a Position

```typescript
function closePosition(config: ClosePositionConfig): TradeRecord;
```

Calculates:
- Realized P&L (including fees)
- Duration (seconds and bars)
- Cumulative totals
- Intra-trade extremes from BalanceIndicator

#### Exit Reason Determination

```typescript
function determineExitReason(
  slTriggered: boolean,
  trailingTriggered: boolean,
  tpTriggered: boolean,
  signalTriggered: boolean,
  isLastCandle: boolean
): ExitReason | null;
```

**Priority order:**
1. TRAILING_STOP (highest - risk management)
2. STOP_LOSS
3. TAKE_PROFIT
4. SIGNAL
5. END_OF_BACKTEST (lowest)

#### Trade Accumulator

```typescript
class TradeAccumulator {
  getNextTradeId(): number;
  recordTrade(trade: TradeRecord): void;
  getCumulativePnl(): number;
  getCurrentEquity(): number;
  getTrades(): TradeRecord[];
}
```

Tracks trade sequence and cumulative values across the backtest.

---

### `src/output/equity-curve.ts`

Equity curve processing for storage.

```typescript
function processEquityCurve(
  rawCurve: EquityPoint[],
  config?: EquityCurveConfig
): EquityPoint[];
```

**Processing:**
1. Downsample to target points (default: 500)
2. Preserve drawdown peaks during downsampling

**Downsampling Strategies:**
- `downsampleWithPeaks`: Uses LTTB algorithm concept
- `downsamplePreserveDrawdownPeaks`: Always keeps local drawdown maxima

---

### `src/output/metrics.ts`

Performance metrics calculation.

#### Summary Metrics

```typescript
function calculateSummaryMetrics(
  trades: TradeRecord[],
  equityCurve: EquityPoint[]
): SummaryMetrics;
```

Calculates: Total P&L, win rate, Sharpe/Sortino ratios, largest win/loss, max drawdown.

#### Performance Metrics

```typescript
function calculatePerformanceMetrics(trades: TradeRecord[]): PerformanceMetrics;
```

Breaks down net profit, gross profit, and gross loss by direction.

#### Trades Analysis

```typescript
function calculateTradesAnalysis(trades: TradeRecord[]): TradesAnalysis;
```

Calculates statistics, P&L analysis, and duration analysis by direction.

#### Additional Metrics

```typescript
function calculateAdditionalMetrics(
  trades: TradeRecord[],
  equityCurve: EquityPoint[],
  startTime: number,
  endTime: number,
  initialCapital: number
): AdditionalMetrics;
```

Calculates:
- Calmar ratio (annual return / max drawdown)
- Profit factor (gross profit / gross loss)
- Expectancy (avg expected profit per trade)
- Volatility (daily and annualized)
- Trades per day
- Exit breakdown by reason

---

### `src/utils/downsampling.ts`

Data reduction utilities for storage efficiency.

```typescript
// Simple: take every Nth point
function downsample<T>(points: T[], factor: number): T[];

// Target count
function downsampleToCount<T>(points: T[], targetCount: number): T[];

// LTTB-style peak preservation
function downsampleWithPeaks(points: EquityPoint[], targetCount: number): EquityPoint[];

// Preserve drawdown peaks specifically
function downsamplePreserveDrawdownPeaks(points: EquityPoint[], targetCount: number): EquityPoint[];
```
