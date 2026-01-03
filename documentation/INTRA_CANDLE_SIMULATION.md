# Intra-Candle Price Simulation

## The Problem

OHLC (Open, High, Low, Close) candle data tells us four prices but not the **order** in which they occurred. For accurate TP/SL detection, we need to simulate the likely price path within each candle.

Consider a candle:
- Open: $100
- High: $105
- Low: $95
- Close: $102

Did the price go `100 → 95 → 105 → 102` or `100 → 105 → 95 → 102`? We don't know for certain.

---

## Why It Matters

If you have:
- **Stop Loss at $96**
- **Take Profit at $104**

The order matters:
- If Low came first: SL would NOT trigger (price hit $95, below SL)
- If High came first: TP would trigger at $104 before checking SL

Getting this wrong can significantly affect backtest results.

---

## Our Approach: Close-Based Heuristic

We use the candle's close relative to open to infer the likely price path:

### Bullish Candle (Close >= Open)

A bullish candle suggests price dipped before rallying:

```
Price
  ▲
  │     ┌─── High
  │    ╱
  │   ╱
  │  ●───── Close
  │ ╱
  │╱
  ●───────── Open
  │╲
  │ ╲
  │  └───── Low
  └────────────────► Time
```

**Path:** `Open → Low → High → Close`

### Bearish Candle (Close < Open)

A bearish candle suggests price rallied before dropping:

```
Price
  ▲
  │  ┌───── High
  │ ╱
  │╱
  ●───────── Open
  │╲
  │ ╲
  │  ●───── Close
  │   ╲
  │    ╲
  │     └── Low
  └────────────────► Time
```

**Path:** `Open → High → Low → Close`

---

## Implementation

```typescript
function getCandlePrices(candle: Candle): number[] {
  if (candle.close >= candle.open) {
    // Bullish candle: open → low → high → close
    return [candle.open, candle.low, candle.high, candle.close];
  } else {
    // Bearish candle: open → high → low → close
    return [candle.open, candle.high, candle.low, candle.close];
  }
}
```

Located in: `src/simulation/loop.ts`

---

## How It's Used

For each candle while in a position:

1. Generate the 4-point price path
2. Feed all 4 prices to special indicators (SL, TP, Trailing, Balance)
3. Check if any exit condition was triggered
4. The first triggered condition determines the exit

```typescript
const prices = getCandlePrices(candle);  // [open, low/high, high/low, close]
const times = [candle.bucket, candle.bucket, candle.bucket, candle.bucket];

slIndicator.calculate(prices, times);
tpIndicator.calculate(prices, times);
trailingIndicator.calculate(prices, times);
balanceIndicator.calculate(prices, times);

// Check which triggered first based on priority
```

---

## Trade-offs

### Advantages

- **Simple**: Only requires OHLC data, no tick data needed
- **Realistic**: Uses candle structure as proxy for intra-candle behavior
- **Deterministic**: Same candle always produces same path

### Limitations

- **Approximation**: Real price path could be different
- **No multiple touches**: Can't detect if price hit SL, bounced, then continued (would need tick data)
- **Equal highs/lows**: If High-Open = Open-Low, we still make a choice

---

## Alternative Approaches

### Distance-Based

Go to whichever extreme is closer to open first:

```typescript
const distToHigh = Math.abs(candle.high - candle.open);
const distToLow = Math.abs(candle.open - candle.low);

if (distToLow < distToHigh) {
  return [candle.open, candle.low, candle.high, candle.close];
} else {
  return [candle.open, candle.high, candle.low, candle.close];
}
```

**Why we didn't use this:** Distance from open doesn't necessarily indicate which extreme came first. A candle could immediately spike far then retrace.

### Direction-Based (Previous Implementation)

Always check adverse moves first based on position direction:

```typescript
if (direction === "LONG") {
  return [candle.open, candle.low, candle.high, candle.close];  // Low first (SL check)
} else {
  return [candle.open, candle.high, candle.low, candle.close];  // High first (SL check)
}
```

**Why we moved away:** This was conservative for risk management but didn't reflect likely price behavior. A bullish candle in a LONG position would still assume price dipped first, which may not be realistic.

### Using Tick Data

The most accurate approach would use actual tick data or sub-candle data to determine exact price path. This would require:
- Access to tick data
- Significantly more data storage and processing
- May not be available for all assets/timeframes

---

## Future Enhancements

If higher accuracy is needed:

1. **Sub-candle data**: Use 1-second or 5-second candles within each 1-minute candle
2. **Tick simulation**: Generate synthetic tick paths based on volatility models
3. **Multiple scenarios**: Run Monte Carlo simulations with different path orderings
