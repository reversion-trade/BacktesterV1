/** Expanding Window Operators - Track values from trade entry with expanding (not sliding) windows. */

export abstract class BaseExpandingOperator {
    public readonly warmup: number = 0;                                           // No warmup for expanding operators
    public abstract reset(): void;                                                // Reset state at trade entry
    public feed(data: number | number[]): number[] {                              // Feed single value or array
        const inputs = Array.isArray(data) ? data : [data];
        return inputs.length === 0 ? [] : this.consume(inputs);
    }
    protected abstract consume(data: number[]): number[];                         // Process inputs, produce outputs
}

/** Tracks maximum value since reset. Used for trailing stops in LONG positions. */
export class ExpandingMaxOperator extends BaseExpandingOperator {
    private maxValue: number = -Infinity;

    reset(): void { this.maxValue = -Infinity; }
    resetWithValue(initialValue: number): void { this.maxValue = initialValue; }  // Initialize with entry price
    getMax(): number { return this.maxValue; }

    protected consume(data: number[]): number[] {
        const results: number[] = [];
        for (const value of data) {
            if (value > this.maxValue) this.maxValue = value;
            results.push(this.maxValue);
        }
        return results;
    }
}

/** Tracks minimum value since reset. Used for trailing stops in SHORT positions. */
export class ExpandingMinOperator extends BaseExpandingOperator {
    private minValue: number = Infinity;

    reset(): void { this.minValue = Infinity; }
    resetWithValue(initialValue: number): void { this.minValue = initialValue; }  // Initialize with entry price
    getMin(): number { return this.minValue; }

    protected consume(data: number[]): number[] {
        const results: number[] = [];
        for (const value of data) {
            if (value < this.minValue) this.minValue = value;
            results.push(this.minValue);
        }
        return results;
    }
}

/** Tracks both min and max since reset. Used for intra-trade run-up and drawdown in BalanceIndicator. */
export class ExpandingRangeOperator extends BaseExpandingOperator {
    private minValue: number = Infinity;
    private maxValue: number = -Infinity;

    reset(): void { this.minValue = Infinity; this.maxValue = -Infinity; }
    resetWithValue(initialValue: number): void { this.minValue = initialValue; this.maxValue = initialValue; }
    getMin(): number { return this.minValue; }
    getMax(): number { return this.maxValue; }

    protected consume(data: number[]): number[] {
        const results: number[] = [];
        for (const value of data) {
            if (value < this.minValue) this.minValue = value;
            if (value > this.maxValue) this.maxValue = value;
            results.push(this.maxValue - this.minValue);                          // Return range as output
        }
        return results;
    }
}
