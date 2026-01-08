# Trading State Machine

4-state machine for position management in backtesting simulations.

## States

| State | Description |
|-------|-------------|
| `CASH` | No position, looking for entries |
| `LONG` | In a long position |
| `SHORT` | In a short position |
| `TIMEOUT` | Cooldown after exit OR ambiguity resolution |

## State Diagram

```
                         long only
              ┌──────────────────────────┐
              │                          ▼
            CASH ──────────────────────► LONG
              │ ▲      short only          │
              │ │  ┌───────────────────────┤ exit (TP/SL/signal)
              │ │  │                       ▼
   both true  │ │  │                    TIMEOUT ───┐
              │ │  │                       ▲       │ regular + short=true
              ▼ │  │   exit                │       ▼
           TIMEOUT │                       │     SHORT
              │    │                       │       │
              │    ▼                       │       │
              │  SHORT ────────────────────┘       │
              │                                    │
              └────────────────────────────────────┘
                   ambiguity resolved / rules met
```

## TIMEOUT Context

TIMEOUT tracks why it was entered:

```typescript
interface TimeoutContext {
  reason: "POST_TRADE" | "AMBIGUITY";
  previousDirection?: "LONG" | "SHORT";  // only for POST_TRADE
  barsInTimeout: number;
}
```

## Timeout Modes

| Mode | Exit TIMEOUT when... |
|------|----------------------|
| `COOLDOWN_ONLY` | `bars >= cooldownBars` |
| `REGULAR` | `bars >= cooldownBars` AND `sameDirection = false` (opposite can fire immediately) |
| `STRICT` | `bars >= cooldownBars` AND `long = false` AND `short = false` |

## Transition Rules

### CASH →

| Condition | Next State |
|-----------|------------|
| long=true AND short=true | TIMEOUT (ambiguity) |
| long=true only | LONG |
| short=true only | SHORT |
| neither | CASH |

### LONG/SHORT →

| Condition | Next State |
|-----------|------------|
| exit triggers (TP/SL/signal) | TIMEOUT (post-trade) |
| no exit | stay |

### TIMEOUT (ambiguity) →

| Condition | Next State |
|-----------|------------|
| long=true, short=false | LONG |
| long=false, short=true | SHORT |
| both=false | CASH |
| both=true | stay in TIMEOUT |

### TIMEOUT (post-trade) →

**COOLDOWN_ONLY mode:**

| Condition | Next State |
|-----------|------------|
| bars >= cooldownBars | CASH |
| else | TIMEOUT |

**REGULAR mode:**

| Condition | Next State |
|-----------|------------|
| cooldown met, came from LONG, short=true | SHORT |
| cooldown met, came from SHORT, long=true | LONG |
| cooldown met, sameDirection=false | CASH |
| else | TIMEOUT |

**STRICT mode:**

| Condition | Next State |
|-----------|------------|
| cooldown met, long=false, short=false | CASH |
| else | TIMEOUT |

## Configuration

```typescript
interface TimeoutConfig {
  mode: "COOLDOWN_ONLY" | "REGULAR" | "STRICT";
  cooldownBars: number;  // 0 = no min cooldown
}
```

Part of `AlgoParams` in `src/core/types.ts` (strategy-level config).

## API Reference

### TradingStateMachine

```typescript
class TradingStateMachine {
  // State queries
  getState(): PositionState;
  isCash(): boolean;
  isLong(): boolean;
  isShort(): boolean;
  isInPosition(): boolean;
  isTimeout(): boolean;
  getTimeoutContext(): TimeoutContext | null;

  // Position entry (from CASH)
  enterLong(timestamp: number): void;
  enterShort(timestamp: number): void;

  // Position exit (to TIMEOUT)
  exitToTimeout(timestamp: number): void;

  // Ambiguity handling (from CASH)
  enterAmbiguityTimeout(timestamp: number): void;

  // Timeout management
  tickTimeout(): void;
  evaluateTimeoutExit(longSignal: boolean, shortSignal: boolean): PositionState;
  exitTimeout(newState: "CASH" | "LONG" | "SHORT", timestamp: number): void;

  // Utility
  getTransitions(): StateTransition[];
  reset(): void;
}
```

### Factory Function

```typescript
function createStateMachine(algoType: AlgoType, timeout: TimeoutConfig): TradingStateMachine;
```

## Example Scenarios

### Scenario 1: Simple Long Trade with Cooldown

```
Bar 0: CASH, long=true, short=false → LONG
Bar 5: LONG, exit triggered → TIMEOUT (POST_TRADE, previousDirection=LONG)
Bar 6: TIMEOUT, cooldown=2, barsInTimeout=1 → stay TIMEOUT
Bar 7: TIMEOUT, cooldown=2, barsInTimeout=2 → CASH (cooldown met)
```

### Scenario 2: Regular Mode - Immediate Opposite Entry

```
Bar 0: CASH, long=true → LONG
Bar 5: LONG, exit → TIMEOUT (POST_TRADE, previousDirection=LONG)
Bar 6: TIMEOUT (REGULAR), short=true → SHORT (opposite entry allowed immediately)
```

### Scenario 3: Strict Mode - Wait for Clear Signals

```
Bar 0: CASH, long=true → LONG
Bar 5: LONG, exit → TIMEOUT (POST_TRADE, previousDirection=LONG)
Bar 6: TIMEOUT (STRICT), short=true → stay TIMEOUT (signals not clear)
Bar 7: TIMEOUT (STRICT), long=false, short=false → CASH
```

### Scenario 4: Ambiguity Resolution

```
Bar 0: CASH, long=true, short=true → TIMEOUT (AMBIGUITY)
Bar 1: TIMEOUT (AMBIGUITY), long=true, short=false → LONG
```

## Cross-Direction Restrictions

The state machine enforces algo type restrictions:

- `LONG_ONLY`: Can only enter LONG positions
- `SHORT_ONLY`: Can only enter SHORT positions
- `BIDIRECTIONAL`: Can enter either direction

Attempting to enter a restricted direction throws an error.
