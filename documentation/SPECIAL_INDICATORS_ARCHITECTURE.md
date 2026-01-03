# Special Indicators Architecture

This document describes the modular architecture of special indicators, aligned with the indicators library patterns.

---

## Overview

Special indicators are stateful objects created per-trade for TP/SL/Balance tracking. Unlike standard indicators (EMA, RSI) which use fixed sliding windows, special indicators use **expanding windows** from trade entry.

### Key Differences from Standard Indicators

| Aspect | Standard Indicators | Special Indicators |
|--------|---------------------------|-------------------|
| **Window Type** | Fixed sliding (last N points) | Expanding (entry → current) |
| **Lifecycle** | Continuous over dataset | Per-trade (created/destroyed) |
| **Output** | Signal + value | Trigger detection + levels |
| **Warmup** | Required (N periods) | None (start at entry) |

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    SPECIAL INDICATORS MODULE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      REGISTRY                              │  │
│  │  SpecialIndicatorRegistry, createSpecialIndicator()        │  │
│  │  Metadata, factory functions, tag-based lookup             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    INDICATORS                              │  │
│  │  StopLossIndicator, TakeProfitIndicator                   │  │
│  │  TrailingStopIndicator, BalanceIndicator                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│              ┌───────────────┴───────────────┐                  │
│              ▼                               ▼                   │
│  ┌────────────────────────┐   ┌────────────────────────────┐   │
│  │   BASE CLASS           │   │   EXPANDING OPERATORS      │   │
│  │   BaseSpecialIndicator │   │   ExpandingMaxOperator     │   │
│  │   - error handling     │   │   ExpandingMinOperator     │   │
│  │   - trigger tracking   │   │   ExpandingRangeOperator   │   │
│  │   - caching support    │   │   ExpandingPnLOperator     │   │
│  └────────────────────────┘   └────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    ZOD SCHEMAS                             │  │
│  │  StopLossConfigSchema, TakeProfitConfigSchema             │  │
│  │  TrailingStopConfigSchema, BalanceConfigSchema            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Pattern Alignment with Indicators Library

### 1. BaseOperator → BaseExpandingOperator

**Standard Pattern (sliding window):**
```typescript
abstract class BaseOperator {
  public readonly warmup: number;
  protected pointsConsumed: number = 0;

  public feed(data: number | number[]): number[];
  protected abstract consume(data: number[]): number[];
}
```

**Our Pattern (expanding window):**
```typescript
abstract class BaseExpandingOperator {
  public readonly warmup: number = 0;  // No warmup needed
  protected pointsConsumed: number = 0;

  public abstract reset(): void;       // Reset at trade entry
  public feed(data: number | number[]): number[];
  protected abstract consume(data: number[]): number[];
}
```

### 2. BaseIndicator → BaseSpecialIndicator

**Shared functionality:**
- `getCacheKey()` - for caching and deduplication
- `getClassName()` - for logging and debugging
- `withErrorHandling()` - contextual error handling
- Config validation via Zod schemas

**Special additions:**
- `reset(entryPrice, entryTime)` - lifecycle management
- `isTriggered()`, `getTriggerPrice()`, `getTriggerTime()` - trigger tracking
- `recordTrigger()` - shared trigger recording logic

### 3. IndicatorRegistry → SpecialIndicatorRegistry

```typescript
export const SpecialIndicatorRegistry = {
  StopLoss: {
    class: StopLossIndicator,
    name: "Fixed Stop Loss",
    tags: ["Risk Management"],
    description: "...",
    useCases: "...",
    schema: StopLossConfigSchema,
  },
  // ...
};
```

---

## Expanding Window Operators

### Why Expanding Windows?

Standard indicators look at the last N periods (sliding window). Special indicators need to track values from trade entry onwards (expanding window).

```
Standard MIN/MAX (sliding):  [────── fixed window ──────]
                                      ↓ slides forward

Special MIN/MAX (expanding): [entry────────expanding────────►current]
                             ↑ fixed start, window grows
```

### Available Operators

#### `ExpandingMaxOperator`
Tracks the maximum value seen since reset. Used by `TrailingStopIndicator` for LONG positions.

```typescript
const max = new ExpandingMaxOperator();
max.resetWithValue(100);  // Entry at $100
max.feed([105, 103, 110, 108]);  // Returns [105, 105, 110, 110]
max.getMax();  // 110
```

#### `ExpandingMinOperator`
Tracks the minimum value seen since reset. Used by `TrailingStopIndicator` for SHORT positions.

```typescript
const min = new ExpandingMinOperator();
min.resetWithValue(100);  // Entry at $100
min.feed([95, 97, 90, 92]);  // Returns [95, 95, 90, 90]
min.getMin();  // 90
```

#### `ExpandingRangeOperator`
Tracks both min and max since reset. Used by `BalanceIndicator` for intra-trade extremes.

```typescript
const range = new ExpandingRangeOperator();
range.resetWithValue(0);  // P&L starts at 0
range.feed([100, -50, 200, 150]);
range.getMax();    // 200 (max run-up)
range.getMin();    // -50 (max drawdown)
range.getRange();  // 250
```

#### `ExpandingPnLOperator`
Calculates unrealized P&L from entry price. Tracks P&L extremes automatically.

```typescript
const pnl = new ExpandingPnLOperator("LONG", 100, 10);  // Entry $100, qty 10
pnl.feed([105, 95, 110]);  // Returns [50, -50, 100] (P&L in USD)
pnl.getMaxPnL();  // 100
pnl.getMinPnL();  // -50
```

---

## Zod Schema Validation

All configs are validated using Zod schemas:

```typescript
const StopLossConfigSchema = z.object({
  direction: z.enum(["LONG", "SHORT"]),
  stopLoss: z.object({
    type: z.enum(["ABS", "REL"]),
    value: z.number().positive(),
  }),
});

// Usage
const config = StopLossConfigSchema.parse({
  direction: "LONG",
  stopLoss: { type: "REL", value: 0.02 }
});
```

---

## Usage Examples

### Using the Registry (Recommended)

```typescript
import { createSpecialIndicator } from "./special-indicators";

// Create by name with validated config
const sl = createSpecialIndicator("StopLoss", {
  direction: "LONG",
  stopLoss: { type: "REL", value: 0.02 }
});

// Use
sl.reset(50000, timestamp);
const results = sl.calculate([49000, 48000], [t1, t2]);
```

### Using Factory Functions

```typescript
import { createStopLoss, createTrailingStop } from "./special-indicators";

const sl = createStopLoss("LONG", { type: "REL", value: 0.02 });
const ts = createTrailingStop("LONG", { type: "REL", value: 0.03 });
```

### Direct Instantiation

```typescript
import { StopLossIndicator } from "./special-indicators";

const sl = new StopLossIndicator({
  direction: "LONG",
  stopLoss: { type: "REL", value: 0.02 }
});
```

---

## File Structure

```
src/simulation/special-indicators/
├── index.ts          # Barrel exports
├── types.ts          # Interface definitions
├── base.ts           # BaseSpecialIndicator + Zod schemas
├── operators.ts      # Expanding window operators
├── registry.ts       # SpecialIndicatorRegistry
├── stop-loss.ts      # StopLossIndicator
├── take-profit.ts    # TakeProfitIndicator
├── trailing-stop.ts  # TrailingStopIndicator
└── balance.ts        # BalanceIndicator
```

---

## Extension Guide

### Adding a New Special Indicator

1. **Create config type and schema** in `base.ts`:
```typescript
export const NewIndicatorConfigSchema = z.object({
  direction: DirectionSchema,
  // ... custom fields
});
```

2. **Create indicator class** extending `BaseSpecialIndicator`:
```typescript
export class NewIndicator extends BaseSpecialIndicator<NewConfig, ResultType> {
  protected onReset(): void { /* ... */ }
  calculate(prices: number[], times: number[]): ResultType[] { /* ... */ }
}
```

3. **Add to registry** in `registry.ts`:
```typescript
NewIndicator: {
  class: NewIndicator,
  name: "New Indicator",
  tags: ["..."],
  description: "...",
  useCases: "...",
  schema: NewIndicatorConfigSchema,
}
```

4. **Export from index.ts**

### Adding a New Expanding Operator

```typescript
export class ExpandingCustomOperator extends BaseExpandingOperator {
  private state: number = 0;

  reset(): void {
    this.state = 0;
    this.pointsConsumed = 0;
  }

  resetWithValue(initialValue: number): void {
    this.state = initialValue;
    this.pointsConsumed = 0;
  }

  protected consume(data: number[]): number[] {
    return data.map(value => {
      this.pointsConsumed++;
      // Custom logic
      return this.state;
    });
  }
}
```
