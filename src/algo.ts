import { type IndicatorConfig } from '../'
import { type DexType } from './dex'

export interface LadderParams {
    levels: Record<number, number>, // <offset, weight> in percent
    direction: 'UP' | 'DOWN' | 'CENTER'; // Expected offset sign(s)
    method: 'CLAMP' | 'SCALE'; // Whether to remove any level beyond limit or scale them proportionally to fit all
    normalize: boolean; // Whether to require all weights to be normalized (false for pyramiding)
    // Provided via PersistentLadder constructor
    // reference: number; // Reference (0 offset) level
    // limit?: number; // Clamping/scaling level
}

export class PersistentLadder {
    public readonly params: LadderParams;
    public readonly reference: number;
    public readonly limit: number | undefined;
    public activeLevels: Record<number, number>;
    
    constructor(reference: number, params: LadderParams, limit?: number)
    {
        this.reference = reference;
        this.params = params;
        this.limit = limit;
        // TODO: Prep level based on params and reference/limit values
        this.activeLevels = {};
    }
}

export type ValueType = 'ABS' | 'REL' | 'DYN'; // DYN is modulated by select indicator's value (0-100 range)
export type AlgoType = 'LONG' | 'SHORT' | 'BOTH';
export type RunStatus = 'NEW' | 'RUNNING' | 'DONE';

export interface ValueConfig {
    type: ValueType; // Applicable to both price levels and position sizes
    value: number; // USD price or amount if type=ABS, percent otherwise
    valueFactor?: IndicatorConfig; // Single-use value-modulating indicator (if type=DYN)
    inverted?: boolean; // Might want to scale up (position size) or down (stop loss) based on indicator's value
    ladder?: LadderParams; // Persistent set of levels generated after value * valueFactor evaluation
}

export interface EntryCondition {
    required: IndicatorConfig[]; // All required indicators must be true so the condition can be true
    optional: IndicatorConfig[]; // At least one of optional indicators must be true so the condition can be true
}

export interface ExitCondition {
    required: IndicatorConfig[];
    optional: IndicatorConfig[];
    stopLoss?: ValueConfig; // Relative to the entry price if type=REL/DYN
    takeProfit?: ValueConfig; // Relative to the entry price if type=REL/DYN
    trailingSL?: boolean; // Available only when stopLoss is set
}

export interface AlgoParams {
    // Start with buying/selling logic section (defines win rate through backtesting)
    type: AlgoType;
    longEntry?: EntryCondition;
    longExit?: ExitCondition;
    shortEntry?: EntryCondition;
    shortExit?: ExitCondition;
    coinSymbol?: string; // Becomes mandatory (and non-overridable) if stopLoss/takeProfit.type=ABS or limitLevel is set
    // Position sizing section below (depends on backtested win rate for risk management)
    positionSize: ValueConfig; // Relative to the currentCapitalUSD if type=REL/DYN (start with startingCapitalUSD)
    // pyramidingLadder?: LadderParams; // Turned into PersistentLadder upon CASH -> LONG/SHORT transition for top-ups
    orderType: 'MARKET' | 'TWAP' | 'SMART' | 'LIMIT'; // Speed vs fill rate/probability trade-off
    // currentCapitalUSD: number; // Part of running algo's status (different table/interface)
    startingCapitalUSD: number; // Single-use initial capital when positionSize.type=REL/DYN (compounding) or
}                               // minimal capital required to sustain any loosing streaks when positionSize.type=ABS

export interface AlgoConfig {
    userID: string;
    algoID: string;
    algoName: string;
    version: number; // AlgoParams are read-only, so new versions need to be created to record changes
    params: AlgoParams; // All risk/win rate defining parameters are stored together
}

export interface RunSettings {
    userID: string;
    algoID: string; // A pair of algoID + version reference a (unique) read-only AlgoConfig
    version: string;
    runID: string;
    isBacktest: boolean; // Whether this is a live trading algo or a backtest simulation
    coinSymbol: string; // Autofilled with AlgoParams.coinSymbol and cannot be overridden if set there
    capitalScaler: number; // Defaults to 1 and scales AlgoParams.startingCapitalUSD (with positionSize too if type=ABS)
    startTime?: number; // Unix timestamp (in seconds) if isBacktest=true or assumePositionImmediately=false (expiry)
    endTime?: number; // Unix timestamp (in seconds) if isBacktest=true or closePositionOnExit=true (deadline)
    tradesLimit?: number; // Auto-stop the algo (or backtest) after reaching certain number of trades (like expiry time)
    assumePositionImmediately: boolean; // Single-use option/condition related to RunStatus NEW -> RUNNING transition
    closePositionOnExit: boolean; // Single-use option/condition related to RunStatus RUNNING -> DONE transition
    launchTime: number;// Unix timestamp (in seconds) of when the Run was submitted for processing
    status: RunStatus; // Algo and Backtesting services (see isBacktest) are responsible for progressing the run status
    dex: DexType;
    // Part of running algo's status (different table/interface):
    // latestTrade: number; // Unix timestamp (in seconds) for auto-termination due to inactivity (if isBacktest=false)
}
