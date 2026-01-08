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

// ZOD SCHEMAS
// Schema for LadderParams validation
export const LadderParamsSchema = z.object({
    levels: z.record(z.string(), z.number()),
    direction: z.enum(["UP", "DOWN", "CENTER"]),
    method: z.enum(["CLAMP", "SCALE"]),
    normalize: z.boolean(),
});

//Schema for ValueConfig validation
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
            // Checks that valuefactor is provided when type is DYN
            if (data.type === "DYN" && !data.valueFactor) {
                return false;
            }
            return true;
        },
        { message: "valueFactor is required when type is DYN" }
    );

//Schema for EntryCondition validation
export const EntryConditionSchema = z.object({
    required: z.array(z.custom<import("@indicators/factory.ts").IndicatorConfig>()),
    optional: z.array(z.custom<import("@indicators/factory.ts").IndicatorConfig>()),
});

//Schema for ExitCondition validation
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
            // Ensures that if trailingSL is true, stopLoss must be set
            if (data.trailingSL && !data.stopLoss) {
                return false;
            }
            return true;
        },
        { message: "trailingSL requires stopLoss to be set" }
    );

//Schema for TimeoutConfig validation 
export const TimeoutConfigSchema = z.object({
    mode: z.enum(["COOLDOWN_ONLY", "REGULAR", "STRICT"]),
    cooldownBars: z.number().int().nonnegative(),
});

//Schema for AlgoParams validation 
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
        startingCapitalUSD: z.number().positive().min(100, { message: "Starting capital must be at least $100" }),
        timeout: TimeoutConfigSchema,
    })
    .refine(
        (data) => {
            if (data.type === "LONG" && !data.longEntry) {
                return false;
            }
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

//Schema for AlgoConfig validation
export const AlgoConfigSchema = z.object({
    userID: z.string().min(1, { message: "User ID is required" }),
    algoID: z.string().min(1, { message: "Algo ID is required" }),
    algoName: z.string().min(1, { message: "Algo name is required" }),
    version: z.number().int().positive({ message: "Version must be a positive integer" }),
    params: AlgoParamsSchema,
});

//Schema for RunSettings validation
export const RunSettingsSchema = z
    .object({
        userID: z.string().min(1, { message: "User ID is required" }),
        algoID: z.string().min(1, { message: "Algo ID is required" }),
        version: z.string().min(1, { message: "Version is required" }),
        runID: z.string().min(1, { message: "Run ID is required" }),
        isBacktest: z.boolean(),
        coinSymbol: z.string().min(1, { message: "Coin symbol is required" }),
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

//Schema for complete backtest input
export const BacktestInputSchema = z.object({
    algoConfig: AlgoConfigSchema,
    runSettings: RunSettingsSchema.refine((data) => data.isBacktest === true, {
        message: "runSettings.isBacktest must be true for backtesting",
    }),
    feeBps: z.number().nonnegative().default(DEFAULT_FEE_BPS),
    slippageBps: z.number().nonnegative().default(DEFAULT_SLIPPAGE_BPS),
});

// TYPES (derived from schemas)
export type BacktestInput = z.infer<typeof BacktestInputSchema>;

// VALIDATION FUNCTIONS
export function validateBacktestInput(input: unknown): BacktestInput {
    return BacktestInputSchema.parse(input);
}
