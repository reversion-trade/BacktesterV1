/**
 * Backtest Configuration
 *
 * Defines Zod schemas for validating backtest input.
 * Aligns with the new AlgoConfig + RunSettings architecture.
 */

import { z } from "zod";
import { DEFAULT_FEE_BPS, DEFAULT_SLIPPAGE_BPS } from "./constants.ts";
import type {
    AlgoParams,
    AlgoConfig,
    RunSettings,
    ValueConfig,
    LadderParams,
    EntryCondition,
    ExitCondition,
    TimeoutConfig,
} from "./types.ts";

export type { RunSettings };

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

/**
 * Schema for LadderParams validation
 * Note: z.record uses string keys, but TypeScript Record<number, number>
 * also has string keys at runtime (JS object keys are always strings)
 */
export const LadderParamsSchema = z.object({
    levels: z.record(z.string(), z.number()),
    direction: z.enum(["UP", "DOWN", "CENTER"]),
    method: z.enum(["CLAMP", "SCALE"]),
    normalize: z.boolean(),
});

/**
 * Schema for ValueConfig validation
 * Supports ABS, REL, and DYN types with optional modulation
 */
export const ValueConfigSchema = z
    .object({
        type: z.enum(["ABS", "REL", "DYN"]),
        value: z.number(),
        valueFactor: z.custom<import("@indicators/factory.ts").IndicatorConfig>().optional(),
        inverted: z.boolean().optional(),
        ladder: LadderParamsSchema.optional(),
    })
    .refine(
        (data) => {
            // If type is DYN, valueFactor should be provided
            if (data.type === "DYN" && !data.valueFactor) {
                return false;
            }
            return true;
        },
        { message: "valueFactor is required when type is DYN" }
    );

/**
 * Schema for EntryCondition validation
 */
export const EntryConditionSchema = z.object({
    required: z.array(z.custom<import("@indicators/factory.ts").IndicatorConfig>()),
    optional: z.array(z.custom<import("@indicators/factory.ts").IndicatorConfig>()),
});

/**
 * Schema for ExitCondition validation
 */
export const ExitConditionSchema = z
    .object({
        required: z.array(z.custom<import("@indicators/factory.ts").IndicatorConfig>()),
        optional: z.array(z.custom<import("@indicators/factory.ts").IndicatorConfig>()),
        stopLoss: ValueConfigSchema.optional(),
        takeProfit: ValueConfigSchema.optional(),
        trailingSL: z.boolean().optional(),
    })
    .refine(
        (data) => {
            // trailingSL requires stopLoss to be set
            if (data.trailingSL && !data.stopLoss) {
                return false;
            }
            return true;
        },
        { message: "trailingSL requires stopLoss to be set" }
    );

/**
 * Schema for TimeoutConfig validation
 * Controls behavior after trade exits
 */
export const TimeoutConfigSchema = z.object({
    mode: z.enum(["COOLDOWN_ONLY", "REGULAR", "STRICT"]),
    cooldownBars: z.number().int().nonnegative(),
});

/**
 * Schema for AlgoParams validation
 */
export const AlgoParamsSchema = z
    .object({
        type: z.enum(["LONG", "SHORT", "BOTH"]),
        longEntry: EntryConditionSchema.optional(),
        longExit: ExitConditionSchema.optional(),
        shortEntry: EntryConditionSchema.optional(),
        shortExit: ExitConditionSchema.optional(),
        coinSymbol: z.string().optional(),
        positionSize: ValueConfigSchema,
        orderType: z.enum(["MARKET", "TWAP", "SMART", "LIMIT"]),
        startingCapitalUSD: z.number().positive(),
        timeout: TimeoutConfigSchema,
    })
    .refine(
        (data) => {
            // LONG type requires longEntry
            if (data.type === "LONG" && !data.longEntry) {
                return false;
            }
            // SHORT type requires shortEntry
            if (data.type === "SHORT" && !data.shortEntry) {
                return false;
            }
            // BOTH type requires both entries
            if (data.type === "BOTH" && (!data.longEntry || !data.shortEntry)) {
                return false;
            }
            return true;
        },
        { message: "Entry conditions must match algo type" }
    );

/**
 * Schema for AlgoConfig validation
 */
export const AlgoConfigSchema = z.object({
    userID: z.string().min(1),
    algoID: z.string().min(1),
    algoName: z.string().min(1),
    version: z.number().int().positive(),
    params: AlgoParamsSchema,
});

/**
 * Schema for RunSettings validation
 */
export const RunSettingsSchema = z
    .object({
        userID: z.string().min(1),
        algoID: z.string().min(1),
        version: z.string().min(1),
        runID: z.string().min(1),
        isBacktest: z.boolean(),
        coinSymbol: z.string().min(1),
        capitalScaler: z.number().positive().default(1),
        startTime: z.number().int().positive().optional(),
        endTime: z.number().int().positive().optional(),
        tradesLimit: z.number().int().positive().optional(),
        closePositionOnExit: z.boolean(),
        launchTime: z.number().int().positive(),
        status: z.enum(["NEW", "RUNNING", "DONE"]),
        exchangeID: z.string().min(1),
    })
    .refine(
        (data) => {
            // Backtest requires both startTime and endTime
            if (data.isBacktest && (!data.startTime || !data.endTime)) {
                return false;
            }
            // endTime must be after startTime if both provided
            if (data.startTime && data.endTime && data.endTime <= data.startTime) {
                return false;
            }
            return true;
        },
        { message: "Backtest requires startTime and endTime, with endTime > startTime" }
    );

/**
 * Schema for complete backtest input
 * Combines AlgoConfig with RunSettings for backtest execution
 */
export const BacktestInputSchema = z.object({
    // Algorithm configuration
    algoConfig: AlgoConfigSchema,

    // Run settings (must be a backtest)
    runSettings: RunSettingsSchema.refine((data) => data.isBacktest === true, {
        message: "runSettings.isBacktest must be true for backtesting",
    }),

    // Trading costs (optional - defaults provided)
    feeBps: z.number().nonnegative().default(DEFAULT_FEE_BPS),
    slippageBps: z.number().nonnegative().default(DEFAULT_SLIPPAGE_BPS),
});

// =============================================================================
// TYPES (derived from schemas)
// =============================================================================

export type BacktestInput = z.infer<typeof BacktestInputSchema>;

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

export function validateBacktestInput(input: unknown): BacktestInput {
    return BacktestInputSchema.parse(input);
}
