import { ChartPoint } from '../types';
import { calculateRSI, calculateADX, calculateStochRSI, detectRSIDivergence, analyzeMarketStructure, calculateTechnicalScore, ScoreWeights } from './cryptoApi';

export interface BacktestResult {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    equityCurve: { time: string; equity: number }[];
    trades: TradeLog[];
}

export interface TradeLog {
    entryTime: string;
    exitTime: string;
    type: 'LONG' | 'SHORT';
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    reason: string;
}

export interface SensitivityReport {
    baseWinRate: number;
    variations: {
        factor: string; // e.g., 'Momentum'
        change: string; // '+10%' or '-10%'
        winRate: number;
        profitFactor: number;
        impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    }[];
    mostSensitiveFactor: string;
}

export const runBacktest = (
    strategy: 'TREND_FOLLOWING' | 'MEAN_REVERSION' | 'SCORE_BASED',
    history: ChartPoint[],
    initialCapital: number = 1000,
    weights?: ScoreWeights // Optional weights for SCORE_BASED strategy
): BacktestResult => {

    // Need at least 50 candles to calculate indicators
    if (history.length < 50) {
        return {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            profitFactor: 0,
            maxDrawdown: 0,
            equityCurve: [],
            trades: []
        };
    }

    const trades: TradeLog[] = [];
    let equity = initialCapital;
    let maxEquity = initialCapital;
    let maxDrawdown = 0;
    const equityCurve = [{ time: history[0].time, equity }];

    let position: { type: 'LONG' | 'SHORT', entry: number, time: string, sl: number, tp: number } | null = null;

    // Prepare Data Arrays
    const prices = history.map(h => h.price);
    const highs = history.map(h => h.price); // Approximation if high/low missing
    const lows = history.map(h => h.price); // Approximation

    // Calculate Indicators for whole series potentially (optimized) or step-by-step
    // For simplicity, we step through and calculate sufficient history

    // We will simulate purely on Close prices for speed, using a sliding window
    for (let i = 50; i < history.length; i++) {
        const currentPrice = prices[i];
        const candle = history[i];

        // Update Position if open
        if (position) {
            let closed = false;
            let pnl = 0;
            let reason = '';

            const H = candle.high !== undefined ? candle.high : currentPrice;
            const L = candle.low !== undefined ? candle.low : currentPrice;

            // Check Stops/Targets
            // STRICT MODE: Check Low (SL) first, then High (TP)
            // If both happen in same candle, ASSUME LOSS (Pessimistic)
            if (position.type === 'LONG') {
                if (L <= position.sl) {
                    pnl = (position.sl - position.entry) / position.entry * 100; // Loss
                    closed = true;
                    reason = 'Stop Loss';
                } else if (H >= position.tp) {
                    pnl = (position.tp - position.entry) / position.entry * 100; // Win
                    closed = true;
                    reason = 'Take Profit';
                }
            } else if (position.type === 'SHORT') {
                if (H >= position.sl) {
                    pnl = (position.entry - position.sl) / position.entry * 100; // Loss
                    closed = true;
                    reason = 'Stop Loss';
                } else if (L <= position.tp) {
                    pnl = (position.entry - position.tp) / position.entry * 100; // Win
                    closed = true;
                    reason = 'Take Profit';
                }
            }

            if (closed) {
                // For PnL calculation, assume 100% equity used (Compounding) or Fixed Risk
                // Let's use Fixed Risk 2% per trade for realistic results
                const riskPerTrade = equity * 0.02;
                // If SL hit, we lose 2%. If TP hit, we gain (Risk * R:R)
                // R:R is implied by TP distance vs SL distance
                const riskDistance = Math.abs(position.entry - position.sl);
                const rewardDistance = Math.abs(position.tp - position.entry);
                const rr = rewardDistance / (riskDistance || 1); // Avoid div/0

                if (pnl > 0) equity += riskPerTrade * rr;
                else equity -= riskPerTrade;

                trades.push({
                    entryTime: position.time,
                    exitTime: candle.time,
                    type: position.type,
                    entryPrice: position.entry,
                    exitPrice: pnl > 0 ? position.tp : position.sl,
                    pnl: equity - (equity - (pnl > 0 ? riskPerTrade * rr : -riskPerTrade)), // Absolute PnL
                    pnlPercent: pnl,
                    reason
                });

                position = null;

                // Drawdown calc
                if (equity > maxEquity) maxEquity = equity;
                const dd = (maxEquity - equity) / maxEquity * 100;
                if (dd > maxDrawdown) maxDrawdown = dd;

                equityCurve.push({ time: candle.time, equity });
                continue; // Wait for next candle to look for new setups
            }
        }

        // Logic for Entry
        if (!position) {
            const lookbackPrices = prices.slice(0, i + 1);

            // Strategy 3: SCORE BASED (New)
            if (strategy === 'SCORE_BASED') {
                const rsi = calculateRSI(lookbackPrices);
                const structure = analyzeMarketStructure(lookbackPrices);
                const adx = calculateADX([], [], lookbackPrices); // High/Low ignored in simple calc
                const stoch = calculateStochRSI(lookbackPrices);
                const divergence = detectRSIDivergence(lookbackPrices, []); // Simplified

                // Calculate Score with custom weights if provided
                const score = calculateTechnicalScore(
                    lookbackPrices, rsi, adx, stoch, structure.trend, divergence, undefined, weights
                );

                // Buy Threshold
                if (score > 75) {
                    // Buy
                    const sl = currentPrice * 0.98; // 2% fixed for simplicity in sensitivty check
                    const tp = currentPrice * 1.04;
                    position = { type: 'LONG', entry: currentPrice, time: candle.time, sl, tp };
                }
            }
            // Re-adding Legacy Trend/Mean for compatibility:
            else if (strategy === 'TREND_FOLLOWING') {
                const rsi = calculateRSI(lookbackPrices);
                const structure = analyzeMarketStructure(lookbackPrices);
                if (structure.trend === 'UPTREND' && rsi && rsi < 40) {
                    // Buy Signal
                    // Static Risk: 2% SL, 4% TP
                    const sl = currentPrice * 0.98;
                    const tp = currentPrice * 1.04;
                    position = { type: 'LONG', entry: currentPrice, time: candle.time, sl, tp };
                }
            }

            // Strategy 2: Mean Reversion (Buy Oversold, Sell Overbought in Range)
            else if (strategy === 'MEAN_REVERSION') {
                const rsi = calculateRSI(lookbackPrices);
                const structure = analyzeMarketStructure(lookbackPrices);
                if (structure.trend === 'RANGING') {
                    if (rsi && rsi < 30) {
                        const sl = currentPrice * 0.97;
                        const tp = currentPrice * 1.03;
                        position = { type: 'LONG', entry: currentPrice, time: candle.time, sl, tp };
                    }
                }
            }
        }
    }

    const wins = trades.filter(t => t.pnl > 0).length;
    const losses = trades.filter(t => t.pnl <= 0).length;
    const totalTrades = trades.length;

    // Profit Factor
    const grossProfit = trades.filter(t => t.pnl > 0).reduce((a, b) => a + b.pnl, 0);
    const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, b) => a + b.pnl, 0));
    const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss;

    return {
        totalTrades,
        wins,
        losses,
        winRate: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
        profitFactor,
        maxDrawdown,
        equityCurve,
        trades
    };
};

export const runSensitivityAnalysis = (history: ChartPoint[]): SensitivityReport => {
    // 1. Run Base Score Backtest
    const baseResult = runBacktest('SCORE_BASED', history);

    // 2. Define Variations
    const factors: (keyof ScoreWeights)[] = ['momentum', 'trend', 'rsiOverbought', 'rsiOversold', 'adx', 'stoch', 'div'];
    const variations: SensitivityReport['variations'] = [];

    const baseWeights: ScoreWeights = {
        momentum: 10, trend: 10, rsiOverbought: 20, rsiOversold: 10,
        adx: 5, stoch: 10, div: 15, orderBook: 10
    };

    factors.forEach(factor => {
        // Test +20% Weight (More Sensitive)
        const weightsHigh = { ...baseWeights, [factor]: baseWeights[factor] * 1.2 };
        const resHigh = runBacktest('SCORE_BASED', history, 1000, weightsHigh);

        variations.push({
            factor, change: '+20%',
            winRate: resHigh.winRate,
            profitFactor: resHigh.profitFactor,
            impact: resHigh.winRate > baseResult.winRate ? 'POSITIVE' : resHigh.winRate < baseResult.winRate ? 'NEGATIVE' : 'NEUTRAL'
        });

        // Test -20% Weight (Less Sensitive)
        const weightsLow = { ...baseWeights, [factor]: baseWeights[factor] * 0.8 };
        const resLow = runBacktest('SCORE_BASED', history, 1000, weightsLow);

        variations.push({
            factor, change: '-20%',
            winRate: resLow.winRate,
            profitFactor: resLow.profitFactor,
            impact: resLow.winRate > baseResult.winRate ? 'POSITIVE' : resLow.winRate < baseResult.winRate ? 'NEGATIVE' : 'NEUTRAL'
        });
    });

    // Determine Most Sensitive Factor (Max variance in Win Rate)
    // Simple heuristic: Find factor with largest gap between High and Low result
    let maxDiff = 0;
    let mostSensitive = 'None';

    factors.forEach(factor => {
        const vHigh = variations.find(v => v.factor === factor && v.change === '+20%');
        const vLow = variations.find(v => v.factor === factor && v.change === '-20%');
        if (vHigh && vLow) {
            const diff = Math.abs(vHigh.winRate - vLow.winRate);
            if (diff > maxDiff) {
                maxDiff = diff;
                mostSensitive = factor;
            }
        }
    });

    return {
        baseWinRate: baseResult.winRate,
        variations,
        mostSensitiveFactor: mostSensitive
    };
};

export interface WalkForwardResult {
    periodResults: {
        windowIndex: number;
        train: BacktestResult;
        test: BacktestResult;
    }[];
    overallStability: number; // 0-100
    averageWinRate: number;
}

export const runWalkForwardAnalysis = (
    strategy: 'TREND_FOLLOWING' | 'MEAN_REVERSION',
    history: ChartPoint[],
    trainSize: number = 200, // Candles for optimization/training
    testSize: number = 50     // Candles for validation
): WalkForwardResult => {
    const results = [];
    let step = testSize;

    // Sliding Window
    for (let i = 0; i < history.length - (trainSize + testSize); i += step) {
        const trainWindow = history.slice(i, i + trainSize);
        const testWindow = history.slice(i + trainSize, i + trainSize + testSize);

        if (testWindow.length < testSize) break;

        // Run Strategy on Train (Ideally we would optimize params here, but we check consistency for now)
        const trainResult = runBacktest(strategy, trainWindow);

        // Run Strategy on Test (Out of Sample)
        const testResult = runBacktest(strategy, testWindow, trainResult.equityCurve[trainResult.equityCurve.length - 1]?.equity || 1000);

        results.push({
            windowIndex: i,
            train: trainResult,
            test: testResult
        });
    }

    // Calculate Stability (How much does Test performance deviate from Train?)
    let stabilitySum = 0;
    let totalWinRate = 0;

    results.forEach(r => {
        const trainWR = r.train.winRate;
        const testWR = r.test.winRate;

        // 100% stability if results are identical. 
        // Penalize large deviations.
        const diff = Math.abs(trainWR - testWR);
        const periodStability = Math.max(0, 100 - diff);
        stabilitySum += periodStability;
        totalWinRate += testWR;
    });

    return {
        periodResults: results,
        overallStability: results.length > 0 ? stabilitySum / results.length : 0,
        averageWinRate: results.length > 0 ? totalWinRate / results.length : 0
    };
};

