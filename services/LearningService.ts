import { SavedPrediction } from '../types';

interface LearningStats {
    totalLosses: number;
    highRsiFailures: number;      // Failure count when RSI > 70
    lowRsiFailures: number;       // Failure count when RSI < 30
    lowVolFailures: number;       // Failure count when Volume was normal (no spike)
    divergenceFailures: number;   // Failure count when Divergence was present (Fakeout)
}

/**
 * Aggregates failure statistics from the local prediction history.
 * Looks for patterns in 'LOSS' outcomes.
 */
export const getLearningStats = (): LearningStats => {
    try {
        const existing = localStorage.getItem('crypto_predictions');
        if (!existing) return { totalLosses: 0, highRsiFailures: 0, lowRsiFailures: 0, lowVolFailures: 0, divergenceFailures: 0 };

        const predictions: SavedPrediction[] = JSON.parse(existing);
        const losses = predictions.filter(p => p.status === 'LOSS');

        const stats: LearningStats = {
            totalLosses: losses.length,
            highRsiFailures: 0,
            lowRsiFailures: 0,
            lowVolFailures: 0,
            divergenceFailures: 0
        };

        if (stats.totalLosses === 0) return stats;

        losses.forEach(loss => {
            // We rely on the 'failureReason' or saved metadata if available.
            // Since early versions didn't save full snapshot, we infer from what we have or add metadata in future.
            // For now, we simulate "context" if it was saved, or we use the 'failureReason' string analysis.

            // NOTE: In a real DB, we would save the snapshot { rsi: 75, vol: low } with the prediction.
            // For this Implementation, we will parse the 'failureReason' if AI provided it, 
            // OR we assume future predictions will save this context.
            // For immediate utility, let's look for keywords in failureReason if available.

            const reason = loss.failureReason?.toLowerCase() || '';

            if (reason.includes('rsi') && reason.includes('high')) stats.highRsiFailures++;
            if (reason.includes('rsi') && reason.includes('low')) stats.lowRsiFailures++;
            if (reason.includes('volume')) stats.lowVolFailures++;
            if (reason.includes('fakeout') || reason.includes('divergence')) stats.divergenceFailures++;
        });

        return stats;
    } catch (e) {
        console.error("Failed to load learning stats", e);
        return { totalLosses: 0, highRsiFailures: 0, lowRsiFailures: 0, lowVolFailures: 0, divergenceFailures: 0 };
    }
};

/**
 * Adjusts the technical Confidence Score based on historical failure patterns.
 * @param baseScore The mathematically calculated technical score.
 * @param context Current market conditions (RSI, Volume, etc.)
 */
export const adjustScoreWithLearning = (
    baseScore: number,
    context: { rsi: number | null, volumeSpike: boolean, divergence: boolean }
): { adjustedScore: number, penalties: string[] } => {

    // 1. Get Stats
    // const stats = getLearningStats(); // In a real app we might cache this
    // For now, we'll assume we can read it fast enough or pass it in.

    // Auto-Learning Simulation:
    // If we don't have enough data yet, we don't penalized.
    // The user needs to mark trades as LOSS for this to activate.

    let score = baseScore;
    const penalties: string[] = [];

    // NOTE: Accessing localStorage here is synchronous.
    // In a heavy app, pass stats as argument.
    const stats = getLearningStats();

    if (stats.totalLosses < 3) return { adjustedScore: score, penalties }; // Need minimal sample size

    // Pattern 1: High RSI Failure Rate
    // If > 40% of losses were due to High RSI, and we have High RSI now -> Penalize
    if (context.rsi !== null && context.rsi > 70) {
        const rate = stats.highRsiFailures / stats.totalLosses;
        if (rate > 0.4) {
            score -= 10;
            penalties.push(`Historic Failure Rate with High RSI is ${(rate * 100).toFixed(0)}%`);
        }
    }

    // Pattern 2: Low Volume Failure Rate (Fakeouts)
    if (!context.volumeSpike) {
        const rate = stats.lowVolFailures / stats.totalLosses;
        if (rate > 0.4) {
            score -= 15;
            penalties.push(`Historic Failure Rate on Low Volume is ${(rate * 100).toFixed(0)}%`);
        }
    }

    // Pattern 3: Divergence Fakeout Rate
    if (context.divergence) {
        const rate = stats.divergenceFailures / stats.totalLosses;
        if (rate > 0.5) {
            score -= 10; // Reduce the Divergence Boost
            penalties.push(`Historic Divergence Fakeout Rate is ${(rate * 100).toFixed(0)}%`);
        }
    }

    return {
        adjustedScore: Math.max(0, score),
        penalties
    };
};
