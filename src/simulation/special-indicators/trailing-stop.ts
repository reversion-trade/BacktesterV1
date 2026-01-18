/** @deprecated Use StopLossIndicator with trailing=true instead. This file provides backward compatibility. */

import type { Direction, ValueConfig } from "../../core/types.ts";
import { StopLossIndicator, createStopLoss } from "./stop-loss.ts";
import type { TrailingStopResult, TrailingStopConfig, StopLossResult } from "./types.ts";

export type { TrailingStopConfig };

/** @deprecated Use StopLossIndicator with trailing=true instead */
export class TrailingStopIndicator {
    private readonly sl: StopLossIndicator;

    constructor(config: TrailingStopConfig) {
        this.sl = createStopLoss(config.direction, config.trailingOffset, true);  // Delegate to unified SL with trailing=true
    }

    reset(entryPrice: number, entryTime: number, dynamicFactor?: number): void { this.sl.reset(entryPrice, entryTime, dynamicFactor); }
    isTriggered(): boolean { return this.sl.isTriggered(); }
    getTriggerPrice(): number | undefined { return this.sl.getTriggerPrice(); }
    getTriggerTime(): number | undefined { return this.sl.getTriggerTime(); }
    getEntryPrice(): number { return this.sl.getEntryPrice(); }
    getEntryTime(): number { return this.sl.getEntryTime(); }
    getCurrentLevel(): number { return this.sl.getStopLossPrice(); }
    getExtremePrice(): number { return this.sl.getExtremePrice(); }

    calculate(prices: number[], times: number[]): TrailingStopResult[] {
        const results = this.sl.calculate(prices, times);
        return results.map((r: StopLossResult) => ({ hit: r.hit, currentLevel: r.currentLevel, extremePrice: r.extremePrice ?? this.sl.getEntryPrice() }));
    }
}

/** @deprecated Use createStopLoss(direction, stopLoss, true) instead */
export function createTrailingStop(direction: Direction, trailingOffset: ValueConfig): TrailingStopIndicator {
    return new TrailingStopIndicator({ direction, trailingOffset });
}
