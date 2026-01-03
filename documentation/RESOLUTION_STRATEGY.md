# Resolution & Resampling Strategy

## Overview

The backtester handles multiple indicators with different timeframes by:
1. Computing each indicator at its natural resolution
2. Resampling all signals to a common simulation resolution
3. Running the simulation loop at that common resolution

---

## The Problem

Different indicators use different timeframes based on their period parameters:

| Indicator | Period | Natural Resolution |
|-----------|--------|-------------------|
| EMA(1h)   | 3600s  | 300s (5m)         |
| RSI(15m)  | 900s   | 60s (1m)          |
| MACD(4h)  | 14400s | 300s (5m)         |

But the simulation needs consistent timestamps to:
- Check all entry/exit conditions together
- Track TP/SL at fine granularity
- Build accurate equity curves

---

## Resolution Determination

### Step 1: Indicator Resolution Calculation

Each indicator determines its resolution using `roundingRule()` from the indicators library:

```typescript
// From indicators/src/common.ts
CANDLE_BUCKETS = [15, 60, 300]  // 15s, 1m, 5m

roundingRule(minPeriod, boostFactor = 20):
  doubledPeriod = (minPeriod / boostFactor) * 2
  return largest bucket <= doubledPeriod
```

**Examples:**
- Period 3600s (1h): `(3600/20)*2 = 360` → bucket 300s (5m)
- Period 900s (15m): `(900/20)*2 = 90` → bucket 60s (1m)
- Period 300s (5m): `(300/20)*2 = 30` → bucket 15s (15s)

### Step 2: Simulation Resolution

```typescript
simulationResolution = max(60, nextLowerBucket(minIndicatorResolution))
```

- Find the minimum resolution across all indicators
- Get the next lower bucket for finer TP/SL tracking
- Floor at 60s (1m) - the minimum user-facing resolution

**Examples:**
- Min indicator res = 300s → simulation = 60s (1m)
- Min indicator res = 60s → simulation = 60s (1m, floored)

---

## Signal Resampling

### The Challenge

```
EMA computes at 5m resolution:
Time:    00:00   00:05   00:10   00:15   00:20
Signal:  [true]  [true]  [false] [false] [true]

Simulation runs at 1m resolution:
Time:    00:00  00:01  00:02  00:03  00:04  00:05  00:06  ...
Signal:    ?      ?      ?      ?      ?      ?      ?
```

### Solution: Forward-Fill (Sample-and-Hold)

For boolean signals, the value persists until the next indicator update:

```
EMA @ 5m:  [true]─────────────────[true]─────────────────[false]
              │                       │                       │
Sim @ 1m:  true  true  true  true  true  true  true  true  true  false...
           00:00 00:01 00:02 00:03 00:04 00:05 00:06 00:07 00:08 00:10
```

**Why forward-fill?**
- Semantically correct: "EMA is bullish" remains true until next calculation
- Simple and efficient
- No assumptions about intermediate values

### Implementation

```typescript
function resampleSignals(
  signals: boolean[],
  signalTimes: number[],      // Times at indicator resolution
  simulationTimes: number[]   // Times at simulation resolution
): boolean[] {
  const resampled: boolean[] = [];
  let signalIndex = 0;

  for (const simTime of simulationTimes) {
    // Advance to most recent signal at or before simTime
    while (signalIndex < signalTimes.length - 1 &&
           signalTimes[signalIndex + 1] <= simTime) {
      signalIndex++;
    }
    resampled.push(signals[signalIndex] ?? false);
  }

  return resampled;
}
```

---

## Price Data for TP/SL

For TP/SL checking, we use **price candles directly** at simulation resolution:

- If simulation is at 1m, we use 1m candles
- No interpolation needed - we have the actual price data
- TP/SL are checked against `candle.high` and `candle.low` for accuracy

### Intra-Candle Price Path (Optional Enhancement)

For even more accurate TP/SL detection, the indicators library provides `INTERP_SOURCE`:

```typescript
// Creates 4 points per candle: open → extreme → extreme → close
createChartPointsForSource(candles, "2_interpolated_x4", resolution)
```

This simulates the likely price path within a candle, useful for detecting if TP/SL would have been hit mid-candle.

---

## Visual Summary

```
┌────────────────────────────────────────────────────────────────────┐
│                    INDICATOR COMPUTATION                           │
├────────────────────────────────────────────────────────────────────┤
│  EMA(1h)  @ 5m:  ──●────────●────────●────────●────────●──         │
│  RSI(15m) @ 1m:  ─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─          │
│  MACD(4h) @ 5m:  ──●────────●────────●────────●────────●──         │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                    RESAMPLING TO 1m                                │
├────────────────────────────────────────────────────────────────────┤
│  EMA(1h)  @ 1m:  ─●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●─          │
│                   (forward-filled from 5m values)                  │
│  RSI(15m) @ 1m:  ─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─●─          │
│                   (already at 1m, no change)                       │
│  MACD(4h) @ 1m:  ─●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●─          │
│                   (forward-filled from 5m values)                  │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                    SIMULATION LOOP @ 1m                            │
├────────────────────────────────────────────────────────────────────┤
│  For each 1m candle:                                               │
│    - Check entry: all resampled signals available                  │
│    - Check TP/SL: use 1m price data (high/low)                     │
│    - Track equity: update at every 1m step                         │
└────────────────────────────────────────────────────────────────────┘
```

---

## Key Takeaways

1. **Indicators compute at natural resolutions** - determined by their period params
2. **Signals are forward-filled** to simulation resolution (boolean sample-and-hold)
3. **Simulation resolution = max(1m, next_lower_bucket)** - ensures TP/SL accuracy
4. **Price data used directly** at simulation resolution, no interpolation needed
5. **1m is the floor** for user-facing backtests

---

## Exit Priority Logic

### Same-Candle Exit Resolution

When multiple exit conditions trigger on the same candle, we need a deterministic priority:

```
Priority Order:
1. STOP_LOSS / TRAILING_STOP (highest - risk management)
2. TAKE_PROFIT
3. SIGNAL (indicator-based exit)
4. END_OF_BACKTEST (lowest)
```

### Rationale

- **SL first**: Risk management is paramount. If price hits SL, we exit regardless of other conditions.
- **TP second**: Profit target was hit, lock in gains.
- **Signal third**: Indicator-based exit after price-based exits.

### Implementation

```typescript
function determineExitReason(
  slTriggered: boolean,
  trailingTriggered: boolean,
  tpTriggered: boolean,
  signalTriggered: boolean,
  isLastCandle: boolean
): ExitReason | null {
  if (trailingTriggered) return "TRAILING_STOP";
  if (slTriggered) return "STOP_LOSS";
  if (tpTriggered) return "TAKE_PROFIT";
  if (signalTriggered) return "SIGNAL";
  if (isLastCandle) return "END_OF_BACKTEST";
  return null;
}
```
