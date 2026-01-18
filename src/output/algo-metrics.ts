/**
 * Algo Metrics Calculation - Diagnostic metrics for algorithm tuning (indicator analysis, near-miss, state distribution, exit reasons).
 */

import type { AlgoEvent, AlgoMetrics, IndicatorAnalysis, NearMissAnalysis, ApproachSequence, ConditionType, IndicatorFlipEvent, ConditionChangeEvent, StateTransitionEvent, SpecialIndicatorEvent } from "../events/types.ts";
import { sum, mean } from "../utils/math.ts";

// MAIN CALCULATION

export function calculateAlgoMetrics(algoEvents: AlgoEvent[], totalBars: number): AlgoMetrics {
    const flipEvents = algoEvents.filter((e): e is IndicatorFlipEvent => e.type === "INDICATOR_FLIP");
    const conditionEvents = algoEvents.filter((e): e is ConditionChangeEvent => e.type === "CONDITION_CHANGE");
    const stateEvents = algoEvents.filter((e): e is StateTransitionEvent => e.type === "STATE_TRANSITION");
    const specialEvents = algoEvents.filter((e): e is SpecialIndicatorEvent => e.type === "SL_SET" || e.type === "TP_SET" || e.type === "TRAILING_SET" || e.type === "TRAILING_UPDATE" || e.type === "SL_HIT" || e.type === "TP_HIT" || e.type === "TRAILING_HIT");

    return {
        indicatorAnalysis: calculateIndicatorAnalysis(flipEvents, conditionEvents, totalBars),
        nearMissAnalysis: calculateNearMissAnalysis(flipEvents),
        stateDistribution: calculateStateDistribution(stateEvents, totalBars),
        exitReasonBreakdown: calculateExitReasonBreakdown(stateEvents),
        conditionTriggerCounts: calculateConditionTriggerCounts(conditionEvents),
        eventCounts: { indicatorFlips: flipEvents.length, conditionChanges: conditionEvents.length, stateTransitions: stateEvents.length, specialIndicatorEvents: specialEvents.length },
    };
}

// INDICATOR ANALYSIS

function calculateIndicatorAnalysis(flipEvents: IndicatorFlipEvent[], conditionEvents: ConditionChangeEvent[], totalBars: number): IndicatorAnalysis[] {
    const flipsByIndicator = new Map<string, IndicatorFlipEvent[]>();
    for (const flip of flipEvents) {
        const existing = flipsByIndicator.get(flip.indicatorKey) ?? [];
        existing.push(flip);
        flipsByIndicator.set(flip.indicatorKey, existing);
    }

    const triggeringCounts = new Map<string, number>();
    for (const change of conditionEvents) {
        if (change.newState && change.triggeringIndicatorKey) {
            triggeringCounts.set(change.triggeringIndicatorKey, (triggeringCounts.get(change.triggeringIndicatorKey) ?? 0) + 1);
        }
    }

    const analyses: IndicatorAnalysis[] = [];
    for (const [indicatorKey, flips] of flipsByIndicator) {
        if (flips.length === 0) continue;

        const firstFlip = flips[0]!;
        const { avgDurationTrueBars, avgDurationFalseBars, pctTimeTrue } = calculateDurationStats(flips, totalBars);
        const triggeringFlipCount = triggeringCounts.get(indicatorKey) ?? 0;
        const blockingCount = calculateBlockingCount(flips);

        analyses.push({
            indicatorKey,
            indicatorType: firstFlip.indicatorType,
            conditionType: firstFlip.conditionType,
            isRequired: firstFlip.isRequired,
            flipCount: flips.length,
            avgDurationTrueBars,
            avgDurationFalseBars,
            pctTimeTrue,
            triggeringFlipCount,
            blockingCount,
            usefulnessScore: calculateUsefulnessScore(flips.length, pctTimeTrue, triggeringFlipCount, blockingCount, totalBars, firstFlip.isRequired),
        });
    }

    return analyses.sort((a, b) => b.usefulnessScore - a.usefulnessScore);
}

function calculateDurationStats(flips: IndicatorFlipEvent[], totalBars: number): { avgDurationTrueBars: number; avgDurationFalseBars: number; pctTimeTrue: number } {
    if (flips.length === 0) return { avgDurationTrueBars: 0, avgDurationFalseBars: 0, pctTimeTrue: 0 };

    const sortedFlips = [...flips].sort((a, b) => a.barIndex - b.barIndex);
    const trueDurations: number[] = [];
    const falseDurations: number[] = [];

    let lastFlipBar = 0;
    let lastValue = sortedFlips[0]!.previousValue; // Initial state from first flip's previousValue

    for (const flip of sortedFlips) {
        const duration = flip.barIndex - lastFlipBar;
        if (duration > 0) (lastValue ? trueDurations : falseDurations).push(duration);
        lastFlipBar = flip.barIndex;
        lastValue = flip.newValue;
    }

    const finalDuration = totalBars - lastFlipBar;
    if (finalDuration > 0) (lastValue ? trueDurations : falseDurations).push(finalDuration);

    const totalTrue = sum(trueDurations);
    const totalFalse = sum(falseDurations);
    const totalTime = totalTrue + totalFalse;

    return {
        avgDurationTrueBars: trueDurations.length > 0 ? mean(trueDurations) : 0,
        avgDurationFalseBars: falseDurations.length > 0 ? mean(falseDurations) : 0,
        pctTimeTrue: totalTime > 0 ? totalTrue / totalTime : 0,
    };
}

function calculateBlockingCount(flips: IndicatorFlipEvent[]): number { // How often this indicator was the only one blocking a condition
    let blockingCount = 0;
    for (const flip of flips) {
        if (!flip.newValue && flip.conditionSnapshot.distanceFromTrigger === 1) blockingCount++;
    }
    return blockingCount;
}

function calculateUsefulnessScore(flipCount: number, pctTimeTrue: number, triggeringFlipCount: number, blockingCount: number, totalBars: number, isRequired: boolean): number {
    let score = 50; // Low score = always true (useless), never flips (too strict), or no impact

    const flipRate = flipCount / Math.max(totalBars, 1);
    if (flipRate > 0.5) score -= 10;
    else if (flipRate > 0.01 && flipRate < 0.2) score += 15;
    else if (flipRate < 0.001) score -= 15;

    if (pctTimeTrue > 0.95 || pctTimeTrue < 0.05) score -= 20;
    else if (pctTimeTrue > 0.3 && pctTimeTrue < 0.7) score += 15;

    if (isRequired) {
        if (triggeringFlipCount > 0) score += Math.min(15, triggeringFlipCount * 3);
        if (blockingCount > 0) score += Math.min(15, blockingCount * 2);
    }

    return Math.max(0, Math.min(100, score));
}

// NEAR-MISS ANALYSIS

function calculateNearMissAnalysis(flipEvents: IndicatorFlipEvent[]): NearMissAnalysis[] {
    const byCondition = new Map<ConditionType, IndicatorFlipEvent[]>();
    for (const flip of flipEvents) {
        const existing = byCondition.get(flip.conditionType) ?? [];
        existing.push(flip);
        byCondition.set(flip.conditionType, existing);
    }

    const analyses: NearMissAnalysis[] = [];
    for (const [conditionType, flips] of byCondition) {
        const sortedFlips = [...flips].sort((a, b) => a.barIndex - b.barIndex);
        const distanceHistogram: Record<number, number> = {};
        let closestApproachWithoutTrigger = Infinity;
        let triggerCount = 0;
        const approachSequences: ApproachSequence[] = [];
        let currentApproach: ApproachSequence | null = null;

        for (const flip of sortedFlips) {
            const distance = flip.conditionSnapshot.distanceFromTrigger;
            distanceHistogram[distance] = (distanceHistogram[distance] ?? 0) + 1;

            if (distance === 0) {
                triggerCount++;
                if (currentApproach) {
                    currentApproach.endBar = flip.barIndex;
                    currentApproach.triggered = true;
                    approachSequences.push(currentApproach);
                    currentApproach = null;
                }
            } else {
                if (distance < closestApproachWithoutTrigger) closestApproachWithoutTrigger = distance;

                if (!currentApproach) {
                    currentApproach = { startBar: flip.barIndex, endBar: flip.barIndex, startDistance: distance, minDistance: distance, triggered: false, conditionType };
                } else if (distance < currentApproach.minDistance) {
                    currentApproach.minDistance = distance;
                } else if (distance > currentApproach.minDistance + 1) {
                    currentApproach.endBar = flip.barIndex;
                    approachSequences.push(currentApproach);
                    currentApproach = { startBar: flip.barIndex, endBar: flip.barIndex, startDistance: distance, minDistance: distance, triggered: false, conditionType };
                }
            }
        }

        if (currentApproach) approachSequences.push(currentApproach); // Don't forget incomplete approach

        analyses.push({
            conditionType,
            distanceHistogram,
            closestApproachWithoutTrigger: closestApproachWithoutTrigger === Infinity ? 0 : closestApproachWithoutTrigger,
            approachSequences,
            totalEvaluations: flips.length,
            triggerCount,
        });
    }

    return analyses;
}

// STATE DISTRIBUTION

function calculateStateDistribution(stateEvents: StateTransitionEvent[], totalBars: number): AlgoMetrics["stateDistribution"] {
    if (stateEvents.length === 0 || totalBars === 0) {
        return { pctTimeFlat: 1, pctTimeLong: 0, pctTimeShort: 0, avgTimeFlatBars: totalBars, avgTimeLongBars: 0, avgTimeShortBars: 0 };
    }

    const sortedEvents = [...stateEvents].sort((a, b) => a.barIndex - b.barIndex);
    const stateDurations: Record<string, number[]> = { CASH: [], LONG: [], SHORT: [], TIMEOUT: [] };

    let lastBar = 0;
    let currentState = "CASH";
    for (const event of sortedEvents) {
        const duration = event.barIndex - lastBar;
        if (duration > 0 && currentState in stateDurations) stateDurations[currentState]!.push(duration);
        lastBar = event.barIndex;
        currentState = event.toState;
    }

    const finalDuration = totalBars - lastBar;
    if (finalDuration > 0 && currentState in stateDurations) stateDurations[currentState]!.push(finalDuration);

    const totalCash = sum(stateDurations["CASH"]!);
    const totalLong = sum(stateDurations["LONG"]!);
    const totalShort = sum(stateDurations["SHORT"]!);
    const totalTimeout = sum(stateDurations["TIMEOUT"]!);
    const totalTime = totalCash + totalLong + totalShort + totalTimeout;
    const totalFlat = totalCash + totalTimeout; // TIMEOUT merged with CASH for backward compatibility

    return {
        pctTimeFlat: totalTime > 0 ? totalFlat / totalTime : 1,
        pctTimeLong: totalTime > 0 ? totalLong / totalTime : 0,
        pctTimeShort: totalTime > 0 ? totalShort / totalTime : 0,
        avgTimeFlatBars: stateDurations["CASH"]!.length > 0 ? mean(stateDurations["CASH"]!) : 0,
        avgTimeLongBars: stateDurations["LONG"]!.length > 0 ? mean(stateDurations["LONG"]!) : 0,
        avgTimeShortBars: stateDurations["SHORT"]!.length > 0 ? mean(stateDurations["SHORT"]!) : 0,
    };
}

// EXIT REASON BREAKDOWN

function calculateExitReasonBreakdown(stateEvents: StateTransitionEvent[]): AlgoMetrics["exitReasonBreakdown"] {
    const breakdown = { signal: 0, stopLoss: 0, takeProfit: 0, trailingStop: 0, endOfBacktest: 0 };

    for (const event of stateEvents) {
        if (event.toState === "CASH" || event.toState === "TIMEOUT") { // Position closed
            switch (event.reason) {
                case "EXIT_SIGNAL": breakdown.signal++; break;
                case "STOP_LOSS": breakdown.stopLoss++; break;
                case "TAKE_PROFIT": breakdown.takeProfit++; break;
                case "TRAILING_STOP": breakdown.trailingStop++; break;
                case "END_OF_BACKTEST": breakdown.endOfBacktest++; break;
            }
        }
    }
    return breakdown;
}

// CONDITION TRIGGER COUNTS

function calculateConditionTriggerCounts(conditionEvents: ConditionChangeEvent[]): Record<ConditionType, number> {
    const counts: Record<ConditionType, number> = { LONG_ENTRY: 0, LONG_EXIT: 0, SHORT_ENTRY: 0, SHORT_EXIT: 0 };
    for (const event of conditionEvents) {
        if (event.newState) counts[event.conditionType]++;
    }
    return counts;
}
