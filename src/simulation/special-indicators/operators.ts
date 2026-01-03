/**
 * Expanding Window Operators for Special Indicators
 *
 * These operators follow the BaseOperator pattern but use EXPANDING windows
 * instead of fixed sliding windows. They track values from trade entry to current
 * price, never forgetting old values until reset.
 *
 * Pattern alignment with indicators/src/operators/operators.ts:
 * - BaseOperator interface with warmup, feed(), consume()
 * - Reset capability for per-trade lifecycle
 * - Batch processing of price arrays
 */

// =============================================================================
// BASE OPERATOR (aligned with indicators library pattern)
// =============================================================================

/**
 * Abstract base class for expanding window operators.
 * Unlike standard sliding window operators, these track values from
 * a reset point (trade entry) indefinitely until the next reset.
 */
export abstract class BaseExpandingOperator {
  public readonly warmup: number = 0; // No warmup for expanding operators
  protected pointsConsumed: number = 0;

  /**
   * Get the number of points consumed since last reset.
   */
  public getPointsConsumed(): number {
    return this.pointsConsumed;
  }

  /**
   * Reset the operator state. Called at trade entry.
   */
  public abstract reset(): void;

  /**
   * Feed data through the operator.
   * @param data - Single value or array of values
   * @returns Array of output values (one per input)
   */
  public feed(data: number | number[]): number[] {
    const inputs = Array.isArray(data) ? data : [data];
    if (inputs.length === 0) {
      return [];
    }
    return this.consume(inputs);
  }

  /**
   * Process input data and produce outputs.
   * @param data - Array of input values
   * @returns Array of output values
   */
  protected abstract consume(data: number[]): number[];
}

// =============================================================================
// EXPANDING MAX OPERATOR
// =============================================================================

/**
 * Tracks the maximum value seen since last reset.
 * Used for trailing stops in LONG positions.
 *
 * @example
 * const max = new ExpandingMaxOperator();
 * max.reset();
 * max.feed([100, 105, 103, 110, 108]); // Returns [100, 105, 105, 110, 110]
 */
export class ExpandingMaxOperator extends BaseExpandingOperator {
  private maxValue: number = -Infinity;

  /**
   * Reset the operator, clearing the tracked maximum.
   */
  reset(): void {
    this.maxValue = -Infinity;
    this.pointsConsumed = 0;
  }

  /**
   * Initialize with a starting value (typically entry price).
   * @param initialValue - The starting value for the maximum
   */
  resetWithValue(initialValue: number): void {
    this.maxValue = initialValue;
    this.pointsConsumed = 0;
  }

  /**
   * Get the current maximum value.
   */
  getMax(): number {
    return this.maxValue;
  }

  protected consume(data: number[]): number[] {
    const results: number[] = [];

    for (const value of data) {
      this.pointsConsumed++;
      if (value > this.maxValue) {
        this.maxValue = value;
      }
      results.push(this.maxValue);
    }

    return results;
  }
}

// =============================================================================
// EXPANDING MIN OPERATOR
// =============================================================================

/**
 * Tracks the minimum value seen since last reset.
 * Used for trailing stops in SHORT positions.
 *
 * @example
 * const min = new ExpandingMinOperator();
 * min.reset();
 * min.feed([100, 95, 97, 90, 92]); // Returns [100, 95, 95, 90, 90]
 */
export class ExpandingMinOperator extends BaseExpandingOperator {
  private minValue: number = Infinity;

  /**
   * Reset the operator, clearing the tracked minimum.
   */
  reset(): void {
    this.minValue = Infinity;
    this.pointsConsumed = 0;
  }

  /**
   * Initialize with a starting value (typically entry price).
   * @param initialValue - The starting value for the minimum
   */
  resetWithValue(initialValue: number): void {
    this.minValue = initialValue;
    this.pointsConsumed = 0;
  }

  /**
   * Get the current minimum value.
   */
  getMin(): number {
    return this.minValue;
  }

  protected consume(data: number[]): number[] {
    const results: number[] = [];

    for (const value of data) {
      this.pointsConsumed++;
      if (value < this.minValue) {
        this.minValue = value;
      }
      results.push(this.minValue);
    }

    return results;
  }
}

// =============================================================================
// EXPANDING RANGE OPERATOR
// =============================================================================

/**
 * Tracks both min and max values since last reset.
 * Useful for calculating intra-trade run-up and drawdown.
 *
 * @example
 * const range = new ExpandingRangeOperator();
 * range.reset();
 * range.feed([100, 110, 95, 105]);
 * range.getMax(); // 110
 * range.getMin(); // 95
 * range.getRange(); // 15
 */
export class ExpandingRangeOperator extends BaseExpandingOperator {
  private minValue: number = Infinity;
  private maxValue: number = -Infinity;

  /**
   * Reset the operator, clearing both min and max.
   */
  reset(): void {
    this.minValue = Infinity;
    this.maxValue = -Infinity;
    this.pointsConsumed = 0;
  }

  /**
   * Initialize with a starting value for both min and max.
   * @param initialValue - The starting value (typically entry price)
   */
  resetWithValue(initialValue: number): void {
    this.minValue = initialValue;
    this.maxValue = initialValue;
    this.pointsConsumed = 0;
  }

  /**
   * Get the current minimum value.
   */
  getMin(): number {
    return this.minValue;
  }

  /**
   * Get the current maximum value.
   */
  getMax(): number {
    return this.maxValue;
  }

  /**
   * Get the current range (max - min).
   */
  getRange(): number {
    return this.maxValue - this.minValue;
  }

  protected consume(data: number[]): number[] {
    const results: number[] = [];

    for (const value of data) {
      this.pointsConsumed++;
      if (value < this.minValue) {
        this.minValue = value;
      }
      if (value > this.maxValue) {
        this.maxValue = value;
      }
      // Return the range as output
      results.push(this.maxValue - this.minValue);
    }

    return results;
  }
}

// =============================================================================
// EXPANDING P&L OPERATOR
// =============================================================================

/**
 * Tracks unrealized P&L from an entry price.
 * Handles both LONG and SHORT directions.
 *
 * @example
 * const pnl = new ExpandingPnLOperator("LONG", 100, 10); // entry $100, qty 10
 * pnl.feed([105, 95, 110]); // Returns [50, -50, 100] (P&L in USD)
 */
export class ExpandingPnLOperator extends BaseExpandingOperator {
  private readonly direction: "LONG" | "SHORT";
  private readonly entryPrice: number;
  private readonly quantity: number;

  private maxPnL: number = 0;
  private minPnL: number = 0;
  private currentPnL: number = 0;

  constructor(direction: "LONG" | "SHORT", entryPrice: number, quantity: number) {
    super();
    this.direction = direction;
    this.entryPrice = entryPrice;
    this.quantity = quantity;
  }

  reset(): void {
    this.maxPnL = 0;
    this.minPnL = 0;
    this.currentPnL = 0;
    this.pointsConsumed = 0;
  }

  /**
   * Get current unrealized P&L.
   */
  getCurrentPnL(): number {
    return this.currentPnL;
  }

  /**
   * Get maximum P&L seen (run-up).
   */
  getMaxPnL(): number {
    return this.maxPnL;
  }

  /**
   * Get minimum P&L seen (drawdown).
   */
  getMinPnL(): number {
    return this.minPnL;
  }

  protected consume(data: number[]): number[] {
    const results: number[] = [];

    for (const price of data) {
      this.pointsConsumed++;

      // Calculate unrealized P&L
      const priceDiff = price - this.entryPrice;
      this.currentPnL =
        this.direction === "LONG"
          ? priceDiff * this.quantity
          : -priceDiff * this.quantity;

      // Track extremes
      if (this.currentPnL > this.maxPnL) {
        this.maxPnL = this.currentPnL;
      }
      if (this.currentPnL < this.minPnL) {
        this.minPnL = this.currentPnL;
      }

      results.push(this.currentPnL);
    }

    return results;
  }
}
