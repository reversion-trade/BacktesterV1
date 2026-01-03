# Simulation Module Documentation

The simulation module contains the core trading logic: state machine, simulation loop, and special indicators.

---

## Files

### `src/simulation/state-machine.ts`

Simple plug-and-play state machine for position lifecycle management.

#### States & Transitions

```
        ┌──────────────────────────────────────┐
        │                                      │
        ▼                                      │
┌──────────────┐    enterLong()    ┌──────────────┐
│     FLAT     │ ───────────────► │     LONG     │
│  (no position)│                  │   (bought)   │
└──────────────┘ ◄─────────────── └──────────────┘
        │              exit()              │
        │                                  │
        │    enterShort()                  │
        ▼                                  │
┌──────────────┐                           │
│    SHORT     │ ──────────────────────────┘
│    (sold)    │         exit()
└──────────────┘
```

**Note:** Direct LONG ↔ SHORT transitions are not allowed. Must exit to FLAT first.

#### API

```typescript
class TradingStateMachine {
  getState(): PositionState;
  isFlat(): boolean;
  isInPosition(): boolean;
  getCurrentDirection(): Direction | undefined;

  canEnterLong(): boolean;   // FLAT + algoType !== "SHORT"
  canEnterShort(): boolean;  // FLAT + algoType !== "LONG"
  canExit(): boolean;        // Not FLAT

  enterLong(timestamp: number): void;
  enterShort(timestamp: number): void;
  exit(timestamp: number): void;
  reset(): void;
}
```

---

### `src/simulation/loop.ts`

The core forward-pass simulation engine.

#### Main Function

```typescript
function runSimulation(config: SimulationConfig): SimulationResult;
```

#### Algorithm

```
For each candle:
  │
  ├─ If IN POSITION:
  │    ├─ Simulate intra-candle price path
  │    ├─ Feed prices to special indicators (SL, TP, Trailing, Balance)
  │    ├─ Check exit conditions (signal-based)
  │    ├─ Determine exit reason by priority:
  │    │    TRAILING_STOP > STOP_LOSS > TAKE_PROFIT > SIGNAL > END_OF_BACKTEST
  │    ├─ If exit triggered:
  │    │    ├─ Record trade
  │    │    ├─ Exit position
  │    │    └─ Destroy special indicators
  │    └─ Update equity curve
  │
  ├─ If FLAT (and past warmup):
  │    ├─ Check long entry condition (edge detection)
  │    ├─ Check short entry condition (edge detection)
  │    └─ If entry triggered:
  │         ├─ Create special indicators (SL, TP, Trailing, Balance)
  │         └─ Enter position
  │
  └─ Record equity point
```

#### Intra-Candle Price Simulation

See [INTRA_CANDLE_SIMULATION.md](./INTRA_CANDLE_SIMULATION.md) for details on how price paths within a candle are simulated for accurate TP/SL detection.

---

### `src/simulation/special-indicators/`

Stateful indicators created per-trade for TP/SL/Balance tracking.

#### Why "Special"?

Unlike regular indicators (EMA, RSI) that use a **fixed sliding window**, special indicators use an **expanding window** from trade entry onwards:

```
Standard MIN/MAX:  [────fixed window────]
                         ↑ slides forward

Special SL:        [entry──────────expanding──────────►current]
                   ↑ fixed start, window grows
```

#### `types.ts` - Interfaces

```typescript
interface SpecialIndicator<TResult> {
  reset(entryPrice: number, entryTime: number): void;
  calculate(prices: number[], times: number[]): TResult[];
  isTriggered(): boolean;
  getTriggerPrice(): number | undefined;
  getTriggerTime(): number | undefined;
}
```

#### `stop-loss.ts` - StopLossIndicator

Fixed stop loss that triggers when price moves against position.

- **LONG**: Triggers when `price <= entry - offset`
- **SHORT**: Triggers when `price >= entry + offset`
- **Output**: Boolean (hit/not hit)

```typescript
const sl = new StopLossIndicator({
  direction: "LONG",
  stopLoss: { type: "REL", value: 0.02 }  // 2% stop loss
});
sl.reset(50000, timestamp);  // Entry at $50,000
// SL level = $49,000
```

#### `take-profit.ts` - TakeProfitIndicator

Fixed take profit that triggers when price moves in favor of position.

- **LONG**: Triggers when `price >= entry + offset`
- **SHORT**: Triggers when `price <= entry - offset`
- **Output**: Boolean (hit/not hit)

#### `trailing-stop.ts` - TrailingStopIndicator

Dynamic stop loss that ratchets with favorable price movement.

- Tracks extreme price (highest for LONG, lowest for SHORT)
- SL level = extreme - offset (ratchets up as price improves)
- **Output**: `{ hit: boolean, currentLevel: number, extremePrice: number }`

```typescript
// LONG trade: Entry at $50,000, 3% trailing
// Price rises to $55,000 → SL ratchets to $53,350
// Price drops to $53,000 → Trailing stop HIT
```

#### `balance.ts` - BalanceIndicator

Tracks portfolio value and unrealized P&L during a position.

- **Output**: `{ balance: number, unrealizedPnL: number, unrealizedPnLPct: number }`
- Applies slippage to entry price
- Applies entry fee
- Tracks intra-trade max run-up and max drawdown

```typescript
const balance = new BalanceIndicator({
  direction: "LONG",
  initialCapital: 10000,
  positionSize: { type: "REL", value: 1.0 },
  feeBps: 10,
  slippageBps: 10
});
```

---

## Special Indicator Lifecycle

```
State: FLAT (no special indicators)
         │
         ▼ Entry condition triggers
State: LONG/SHORT
         ├─ Create: StopLossIndicator
         ├─ Create: TakeProfitIndicator
         ├─ Create: TrailingStopIndicator (if enabled)
         ├─ Create: BalanceIndicator
         ├─ Feed price data in batches
         └─ Monitor for exit events
         │
         ▼ Exit event (TP/SL/Signal)
         ├─ Record trade
         ├─ Store balance/equity data
         ├─ Destroy all special indicators
         └─ State: FLAT
```
