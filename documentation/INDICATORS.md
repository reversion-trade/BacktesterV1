# Indicators Module Documentation

The indicators module handles pre-computation of indicator signals and evaluation of entry/exit conditions.

---

## Files

### `src/indicators/calculator.ts`

Pre-calculates all indicator signals for the entire dataset upfront.

#### SignalCache

```typescript
interface SignalCache {
  get(key: string): boolean[] | undefined;
  has(key: string): boolean;
  keys(): string[];
}
```

A cache mapping indicator cache keys to their boolean signal arrays.

#### Main Function

```typescript
function calculateIndicators(
  candles: Candle[],
  configs: IndicatorConfig[]
): CalculationResult;
```

**Process:**
1. Deduplicate configs by cache key (same indicator in multiple conditions)
2. For each unique indicator:
   - Get warmup requirements
   - Convert candles to ChartPoints for the indicator's source type
   - Calculate indicator over all data
   - Extract boolean signals (padded with `false` for warmup period)
3. Return SignalCache + max warmup candles

#### Helper

```typescript
function collectIndicatorConfigs(algoParams: AlgoParams): IndicatorConfig[];
```

Extracts all indicator configs from entry/exit conditions (required + optional).

---

### `src/indicators/evaluator.ts`

Evaluates entry/exit conditions at specific candle indices.

#### Condition Evaluation

```typescript
function evaluateCondition(
  condition: EntryCondition | ExitCondition,
  candleIndex: number,
  cache: SignalCache
): boolean;
```

**Logic:**
- ALL required indicators must signal (AND)
- If optional is not empty, at least ONE must signal (OR)
- If optional is empty, required alone is sufficient

#### Edge Detection

```typescript
function detectConditionEdge(
  condition: EntryCondition | ExitCondition,
  candleIndex: number,
  cache: SignalCache
): boolean;
```

Detects when a condition transitions from `false → true` (the "edge"). Used to avoid firing multiple entry signals while a condition remains true.

---

### `src/indicators/resampler.ts`

Handles resolution management for multi-timeframe strategies.

#### Constants

```typescript
const MIN_SIMULATION_RESOLUTION = 60;  // 1 minute floor
const RESOLUTION_BUCKETS = [15, 60, 300];  // 15s, 1m, 5m
```

#### Key Functions

```typescript
function determineSimulationResolution(
  configs: IndicatorConfig[]
): SimulationResolutionResult;
```

**Strategy:**
1. Find minimum resolution across all indicators
2. Get next lower bucket for finer TP/SL tracking
3. Floor at 60s (1m) for user-facing backtests

```typescript
function resampleSignals(
  signals: boolean[],
  signalTimes: number[],
  simulationTimes: number[]
): boolean[];
```

Resamples signals using forward-fill (sample-and-hold). The signal value persists until the next indicator update.

**Example:**
```
EMA @ 5m:  [true]─────────────────[false]
              │                       │
Sim @ 1m:  true  true  true  true  true  false...
```

---

## Resolution Strategy

Different indicators compute at different resolutions based on their period:

| Indicator | Period | Resolution |
|-----------|--------|------------|
| EMA(1h)   | 3600s  | 300s (5m)  |
| RSI(15m)  | 900s   | 60s (1m)   |
| MACD(4h)  | 14400s | 300s (5m)  |

The simulation runs at the finest resolution among all indicators (floored at 1m), and signals from coarser indicators are forward-filled.
