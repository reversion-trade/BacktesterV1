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
        assumePositionImmediately: z.boolean(),
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
// LEGACY SCHEMA (for backward compatibility)
// =============================================================================

/**
 * Legacy BacktestConfig schema for backward compatibility
 * @deprecated Use BacktestInputSchema instead
 */
export const BacktestConfigSchema = z
    .object({
        // Identification
        backtestId: z.string().min(1),
        algoId: z.string().min(1),
        version: z.number().int().positive(),

        // Algorithm parameters
        algoParams: z.custom<AlgoParams>(),

        // Market & Time Range
        symbol: z.string().min(1),
        startTime: z.number().int().positive(),
        endTime: z.number().int().positive(),

        // Capital & Position Sizing
        startingCapitalUSD: z.number().positive(),
        positionSize: z.object({
            type: z.enum(["ABS", "REL"]),
            value: z.number().positive(),
        }),

        // Run settings (moved from AlgoParams)
        assumePositionImmediately: z.boolean().default(false),
        closePositionOnExit: z.boolean().default(true),

        // Trading Costs (optional - defaults provided)
        feeBps: z.number().nonnegative().default(DEFAULT_FEE_BPS),
        slippageBps: z.number().nonnegative().default(DEFAULT_SLIPPAGE_BPS),
    })
    .refine((data) => data.endTime > data.startTime, { message: "endTime must be after startTime" });

// =============================================================================
// TYPES (derived from schemas)
// =============================================================================

/**
 * New backtest input type (preferred)
 */
export type BacktestInput = z.infer<typeof BacktestInputSchema>;

/**
 * Legacy backtest config type (for backward compatibility)
 * @deprecated Use BacktestInput instead
 */
export type BacktestConfig = z.infer<typeof BacktestConfigSchema>;

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate and parse backtest input (new format)
 */
export function validateBacktestInput(input: unknown): BacktestInput {
    return BacktestInputSchema.parse(input);
}

/**
 * Validate and parse backtest config (legacy format)
 * @deprecated Use validateBacktestInput instead
 */
export function validateBacktestConfig(input: unknown): BacktestConfig {
    return BacktestConfigSchema.parse(input);
}

// =============================================================================
// CONVERSION HELPERS
// =============================================================================

/**
 * Convert new BacktestInput to legacy BacktestConfig format
 * Useful for gradual migration
 */
export function backfillLegacyConfig(input: BacktestInput): BacktestConfig {
    const { algoConfig, runSettings, feeBps, slippageBps } = input;

    return {
        backtestId: runSettings.runID,
        algoId: algoConfig.algoID,
        version: algoConfig.version,
        algoParams: algoConfig.params,
        symbol: runSettings.coinSymbol,
        startTime: runSettings.startTime!,
        endTime: runSettings.endTime!,
        startingCapitalUSD: algoConfig.params.startingCapitalUSD * runSettings.capitalScaler,
        positionSize: {
            type: algoConfig.params.positionSize.type === "DYN" ? "REL" : algoConfig.params.positionSize.type,
            value: algoConfig.params.positionSize.value,
        },
        assumePositionImmediately: runSettings.assumePositionImmediately,
        closePositionOnExit: runSettings.closePositionOnExit,
        feeBps,
        slippageBps,
    };
}

/**
 * Convert legacy BacktestConfig to new BacktestInput format
 * Useful for migrating existing code
 */
export function convertToBacktestInput(legacy: BacktestConfig): BacktestInput {
    const now = Math.floor(Date.now() / 1000);

    return {
        algoConfig: {
            userID: "legacy",
            algoID: legacy.algoId,
            algoName: legacy.algoId,
            version: legacy.version,
            params: {
                ...legacy.algoParams,
                orderType: "MARKET",
                startingCapitalUSD: legacy.startingCapitalUSD,
            },
        },
        runSettings: {
            userID: "legacy",
            algoID: legacy.algoId,
            version: String(legacy.version),
            runID: legacy.backtestId,
            isBacktest: true,
            coinSymbol: legacy.symbol,
            capitalScaler: 1,
            startTime: legacy.startTime,
            endTime: legacy.endTime,
            assumePositionImmediately: legacy.assumePositionImmediately,
            closePositionOnExit: legacy.closePositionOnExit,
            launchTime: now,
            status: "NEW",
            exchangeID: "backtest",
        },
        feeBps: legacy.feeBps,
        slippageBps: legacy.slippageBps,
    };
}
