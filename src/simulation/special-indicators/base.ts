/** Base Special Indicator - Abstract class providing shared functionality for SL/TP/Trailing/Balance indicators. */

import { z } from "zod";
import type { Direction, ValueConfig } from "../../core/types.ts";

export const RuntimeValueSchema = z.object({
    type: z.enum(["ABS", "REL", "DYN"]),       // Absolute USD, relative percentage, or dynamic indicator-based
    value: z.number().positive(),              // USD for ABS, decimal for REL/DYN base
    inverted: z.boolean().optional(),          // Whether to invert the indicator modulation
});

export const DirectionSchema = z.enum(["LONG", "SHORT"]);

export const StopLossConfigSchema = z.object({ direction: DirectionSchema, stopLoss: RuntimeValueSchema, trailing: z.boolean().optional() });
export const TakeProfitConfigSchema = z.object({ direction: DirectionSchema, takeProfit: RuntimeValueSchema });
export const TrailingStopConfigSchema = z.object({ direction: DirectionSchema, trailingOffset: RuntimeValueSchema });
export const BalanceConfigSchema = z.object({
    direction: DirectionSchema,
    initialCapital: z.number().positive(),
    positionSize: RuntimeValueSchema,
    feeBps: z.number().min(0).max(1000),       // Trading fee in basis points
    slippageBps: z.number().min(0).max(1000),  // Slippage in basis points
});

export type StopLossConfigInput = z.input<typeof StopLossConfigSchema>;
export type TakeProfitConfigInput = z.input<typeof TakeProfitConfigSchema>;
export type TrailingStopConfigInput = z.input<typeof TrailingStopConfigSchema>;
export type BalanceConfigInput = z.input<typeof BalanceConfigSchema>;

function formatParams(params: Record<string, unknown>): string { return JSON.stringify(params, null, 0); }

function withErrorHandling<T>(fn: () => T, context: string, params?: Record<string, unknown>): T {
    try {
        return fn();
    } catch (error) {
        const paramStr = params ? formatParams(params) : "";
        const message = `${context}${paramStr}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(message);
        throw new Error(message);
    }
}

export interface BaseSpecialIndicatorConfig { direction: Direction; [key: string]: unknown; }

export abstract class BaseSpecialIndicator<TConfig extends BaseSpecialIndicatorConfig, TResult> {
    protected readonly config: TConfig;
    protected triggered: boolean = false;
    protected triggerPrice: number | undefined = undefined;
    protected triggerTime: number | undefined = undefined;
    protected entryPrice: number = 0;
    protected entryTime: number = 0;
    protected dynamicFactor: number = 1;       // 0-1 range, used when ValueConfig.type === "DYN"

    constructor(config: TConfig) { this.config = config; }

    public getCacheKey(): string { return `${this.constructor.name}:${JSON.stringify(this.config)}`; }
    public getClassName(): string { return this.constructor.name.replace(/Indicator$/, ""); }
    public getDirection(): Direction { return this.config.direction; }
    public getConfig(): TConfig { return this.config; }

    protected throwError(message: string): never {
        const prefix = `${this.getClassName()}${formatParams(this.config as Record<string, unknown>)}`;
        const fullMessage = `${prefix}:\n${message}`;
        console.error(fullMessage);
        throw new Error(fullMessage);
    }

    protected withErrorHandling<T>(fn: () => T, context: string): T {
        return withErrorHandling(fn, `${context} in ${this.getClassName()}`, this.config as Record<string, unknown>);
    }

    public isTriggered(): boolean { return this.triggered; }
    public getTriggerPrice(): number | undefined { return this.triggerPrice; }
    public getTriggerTime(): number | undefined { return this.triggerTime; }
    public getEntryPrice(): number { return this.entryPrice; }
    public getEntryTime(): number { return this.entryTime; }
    public getDynamicFactor(): number { return this.dynamicFactor; }

    public reset(entryPrice: number, entryTime: number, dynamicFactor?: number): void {
        this.entryPrice = entryPrice;
        this.entryTime = entryTime;
        this.triggered = false;
        this.triggerPrice = undefined;
        this.triggerTime = undefined;
        this.dynamicFactor = dynamicFactor !== undefined ? dynamicFactor / 100 : 1;  // Normalize 0-100 to 0-1
        this.onReset();
    }

    public updateDynamicFactor(newFactor: number): void {                          // Update factor mid-position, triggers level recalculation
        this.dynamicFactor = newFactor / 100;
        this.onDynamicFactorUpdate();
    }

    protected abstract onReset(): void;
    public abstract calculate(prices: number[], times: number[]): TResult[];
    protected onDynamicFactorUpdate(): void {}                                     // Override in subclasses to recalculate levels

    protected recordTrigger(price: number, time: number): void {
        if (!this.triggered) {
            this.triggered = true;
            this.triggerPrice = price;
            this.triggerTime = time;
        }
    }

    protected calculateOffset(valueConfig: ValueConfig): number {                  // Calculate offset from entry, handles ABS/REL/DYN
        let effectiveValue = valueConfig.value;
        if (valueConfig.type === "DYN") {                                          // Apply dynamic modulation
            const factor = valueConfig.inverted ? 1 - this.dynamicFactor : this.dynamicFactor;
            effectiveValue = valueConfig.value * factor;
        }
        if (valueConfig.type === "REL" || valueConfig.type === "DYN") {            // REL/DYN: percentage of entry price
            return this.entryPrice * effectiveValue;
        }
        return effectiveValue;                                                     // ABS: absolute amount
    }
}

export const SPECIAL_INDICATOR_TAGS = ["Risk Management", "Profit Target", "Dynamic", "Balance Tracking"] as const;
export type SpecialIndicatorTag = (typeof SPECIAL_INDICATOR_TAGS)[number];

export interface SpecialIndicatorMetadata<TConfig, TResult> {
    class: new (config: TConfig) => BaseSpecialIndicator<TConfig & BaseSpecialIndicatorConfig, TResult>;
    name: string;
    tags: SpecialIndicatorTag[];
    description: string;
    useCases: string;
    schema: z.ZodSchema<TConfig>;
}
