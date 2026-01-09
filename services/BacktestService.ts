
import { ChartPoint } from '../types';
import { calculateRSI, calculateADX, calculateStochRSI, detectRSIDivergence, analyzeMarketStructure } from './cryptoApi';

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

export const runBacktest = (
    strategy: 'TREND_FOLLOWING' | 'MEAN_REVERSION',
    history: ChartPoint[],
    initialCapital: number = 1000
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
                    reason = 'Stop Loss (Wick)';
                } else if (H >= position.tp) {
                    pnl = (position.tp - position.entry) / position.entry * 100; // Win
                    closed = true;
                    reason = 'Take Profit';
                }
            } else if (position.type === 'SHORT') {
                if (H >= position.sl) {
                    pnl = (position.entry - position.sl) / position.entry * 100; // Loss
                    closed = true;
                    reason = 'Stop Loss (Wick)';
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
            const rsi = calculateRSI(lookbackPrices);
            const structure = analyzeMarketStructure(lookbackPrices);

            // Strategy 1: Trend Following (Buy dips in Uptrend)
            if (strategy === 'TREND_FOLLOWING') {
                if (structure.trend === 'UPTREND' && rsi && rsi < 40) {
                    // Buy Signal
                    // Static Risk: 2% SL, 4% TP
                    const sl = currentPrice * 0.98;
                    const tp = currentPrice * 1.04;
                    position = { type: 'LONG', entry: currentPrice, time: candle.time, sl, tp };
                }
            }

            // Strategy 2: Mean Reversion (Buy Oversold, Sell Overbought in Range)
            if (strategy === 'MEAN_REVERSION') {
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

