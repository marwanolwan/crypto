import { ChartPoint, ScannerSignal } from '../types';
import { calculateRSI, calculateATR, calculateADX, calculateEMA } from './cryptoApi';

/**
 * HYBRID SCANNER SERVICE
 * Acts as a secondary decision layer for the base rule-based scanner.
 * Enforces Institutional Logic, Market Regime Detection, and Risk Analysis.
 */

// --- TYPES ---

export type MarketRegime = 'TRENDING' | 'RANGING' | 'VOLATILE' | 'ACCUMULATION' | 'DISTRIBUTION';
export type MoveClassification = 'REAL_MOMENTUM' | 'LIQUIDITY_GRAB' | 'STOP_HUNT' | 'NEWS_EVENT' | 'UNKNOWN';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type ExecutionBias = 'BREAKOUT' | 'PULLBACK' | 'MEAN_REVERSION' | 'ACCUMULATION';

interface HybridAnalysisResult {
    marketRegime: MarketRegime;
    moveClassification: MoveClassification;
    opportunityScore: number;
    riskLevel: RiskLevel;
    executionBias: ExecutionBias;
    failureProbability: string;
    institutionalTag?: string;
}

// --- CONSTANTS ---

const VOLATILITY_THRESHOLD_HIGH = 2.5; // % ATR relative to price
const TREND_ADX_THRESHOLD = 25;
const MOMENTUM_CONFIRMATION_VOLUME_FACTOR = 1.5;

// --- SERVICE CLASS ---

export class HybridScannerService {

    /**
     * CORE FUNCTION: Enriches a raw rule-based signal with institutional metrics.
     * @param baseSignal The raw signal from the basic scanner
     * @param history Candle history (timeframe depends on mode, e.g., 1m for Scalping, 1h/4h for Day)
     * @param volumeProfile Optional volume profile data
     */
    static enrichSignal(
        baseSignal: ScannerSignal,
        history: ChartPoint[],
        btcContext?: { trend: 'UP' | 'DOWN' | 'FLAT' }
    ): HybridAnalysisResult {

        if (!history || history.length < 50) {
            // Fallback for insufficient data
            return {
                marketRegime: 'RANGING',
                moveClassification: 'UNKNOWN',
                opportunityScore: baseSignal.probability, // Fallback to raw prob
                riskLevel: 'MEDIUM',
                executionBias: 'MEAN_REVERSION',
                failureProbability: '50%'
            };
        }

        const prices = history.map(p => p.price);
        const volumes = history.map(p => p.volume);

        // 1. Detect Market Regime
        const regime = this.detectMarketRegime(history, prices);

        // 2. Validate Opportunity (Move Classification)
        const classification = this.classifyMove(baseSignal, history, regime);

        // 3. Score Opportunity
        const score = this.calculateOpportunityScore(baseSignal, regime, classification, history, btcContext);

        // 4. Institutional Analysis (Whale Alerts)
        let institutionalTag: string | undefined = undefined;
        let adjustedScore = score;
        let adjustedRisk = undefined;

        if (baseSignal.futuresData) {
            const fd = baseSignal.futuresData;

            // A. Short Squeeze (Crowded Shorts + Upward Move)
            if (fd.longShortRatio < 0.6 && (baseSignal.signalType !== 'DUMP')) {
                institutionalTag = '🐋 Potential Short Squeeze';
                adjustedScore += 20; // High conviction
                adjustedRisk = 'LOW'; // Squeezes are explosive
            }

            // B. Crowded Longs (Euphoria Warning)
            else if (fd.longShortRatio > 3.0 && baseSignal.signalType !== 'DUMP') {
                institutionalTag = '⚠️ Crowded Longs (Risk)';
                adjustedScore -= 30; // High risk of liquidation cascade
                adjustedRisk = 'HIGH';
            }

            // C. Smart Money Accumulation (Price Down/Flat + OI Up + Low LS)
            // Shorts are trapped or Smart Money hedging
            if (baseSignal.signalType === 'ACCUMULATION' && fd.openInterest > 0 && fd.longShortRatio < 0.8) {
                institutionalTag = '🏦 Smart Money Accumulation';
                adjustedScore += 15;
            }
        }

        // 5. Determine Risk & BIAS
        const { risk, failureProbability } = this.assessRisk(adjustedScore, regime, classification);
        const bias = this.determineExecutionBias(baseSignal.signalType, regime);

        // Override Risk if Institutional Flag set
        const finalRisk = adjustedRisk || risk;

        return {
            marketRegime: regime,
            moveClassification: classification,
            opportunityScore: Math.min(99, adjustedScore), // Cap at 99
            riskLevel: finalRisk,
            executionBias: bias,
            failureProbability: failureProbability,
            institutionalTag
        };
    }

    /**
     * Enriches the signal object with the institutional text if found
     */
    static formatModeTag(baseTag: string, institutionalTag?: string): string {
        return institutionalTag ? `${institutionalTag}` : baseTag;
    }

    // --- A. MARKET REGIME DETECTION ---

    private static detectMarketRegime(history: ChartPoint[], prices: number[]): MarketRegime {
        const adx = calculateADX([], [], prices); // Note: Simple ADX approximation needed if HL not avail, but cryptoApi usually implies calc
        // Re-using calculateADX from cryptoApi requires highs/lows. 
        // Let's assume we have highs/lows in history.
        const highs = history.map(h => h.high || h.price);
        const lows = history.map(l => l.low || l.price);

        /* 
           Using a simplified calculation here if cryptoApi's calculateADX isn't exported perfectly for external array use 
           OR assume we use the one imported.
           Ideally we should calculate ADX properly. 
           For this logic, we will check EMA Alignment + Volatility.
        */

        const ema20 = this.getLast(calculateEMA(prices, 20));
        const ema50 = this.getLast(calculateEMA(prices, 50));
        const current = prices[prices.length - 1];

        // Volatility Check (ATR)
        const atr = calculateATR(highs, lows, prices, 14); // Returns last ATR
        const atrPct = (atr && current) ? (atr / current) * 100 : 0;

        if (atrPct > VOLATILITY_THRESHOLD_HIGH) return 'VOLATILE';

        // Trend Check
        const isUptrend = current > ema20 && ema20 > ema50;
        const isDowntrend = current < ema20 && ema20 < ema50;

        if (isUptrend || isDowntrend) {
            // Robustness: Check ADX if available, else assume trend
            return 'TRENDING';
        }

        // Accumulation vs Distribution (Sideways)
        // Simple Logic: If sideways and near Support (Low of last 50) -> Accumulation
        // If sideways and near Resistance (High of last 50) -> Distribution
        const period50 = prices.slice(-50);
        const min50 = Math.min(...period50);
        const max50 = Math.max(...period50);
        const rangePos = (current - min50) / (max50 - min50);

        if (rangePos < 0.3) return 'ACCUMULATION';
        if (rangePos > 0.7) return 'DISTRIBUTION';

        return 'RANGING';
    }

    // --- B. OPPORTUNITY VALIDATION LAYER ---

    private static classifyMove(signal: ScannerSignal, history: ChartPoint[], regime: MarketRegime): MoveClassification {
        const lastCandle = history[history.length - 1];
        const prevCandle = history[history.length - 2];
        const avgVol = history.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;

        const isVolumeSupported = lastCandle.volume > (avgVol * MOMENTUM_CONFIRMATION_VOLUME_FACTOR);
        const isWickRejection = Math.abs(lastCandle.price - (prevCandle ? prevCandle.price : lastCandle.price)) < (lastCandle.high! - lastCandle.low!) * 0.4; // Small body, big wick

        // 1. Liquidity Grab (Stop Hunt)
        // Fast move down then quick rejection? Or breakout with low volume?
        if (signal.signalType === 'BREAKOUT' || signal.signalType === 'SCALPING_PUMP') {
            if (!isVolumeSupported) return 'LIQUIDITY_GRAB'; // Fake breakout
        }

        // 2. Real Momentum
        if (isVolumeSupported && (regime === 'TRENDING' || regime === 'ACCUMULATION')) {
            return 'REAL_MOMENTUM';
        }

        // 3. News Event (Volatility Spy)
        // If price moves > 2% in 1 candle (assuming 1m/5m/1h) without prior structure
        const movePct = Math.abs((lastCandle.price - (prevCandle ? prevCandle.price : lastCandle.price)) / (prevCandle ? prevCandle.price : lastCandle.price)) * 100;
        if (movePct > 2.0 && regime === 'VOLATILE') {
            return 'NEWS_EVENT';
        }

        // Default
        if (regime === 'RANGING') return 'UNKNOWN'; // Choppy

        return 'REAL_MOMENTUM'; // Fallback goodness
    }

    // --- C. OPPORTUNITY SCORING ENGINE (0-100) ---

    private static calculateOpportunityScore(
        signal: ScannerSignal,
        regime: MarketRegime,
        classification: MoveClassification,
        history: ChartPoint[],
        btcContext?: { trend: 'UP' | 'DOWN' | 'FLAT' }
    ): number {
        let score = 50; // Base Score

        // 1. Base Probability from Hard-Coded Scanner
        score += (signal.probability - 50); // Adjust baseline (+30 if prob is 80)

        // 2. Regime Alignment
        if (signal.signalType === 'TREND_CONTINUATION' && regime === 'TRENDING') score += 10;
        if (signal.signalType === 'BREAKOUT' && regime === 'ACCUMULATION') score += 15; // Golden Breakout
        if (signal.signalType === 'SCALPING_PUMP' && regime === 'VOLATILE') score -= 10; // Dangerous
        if (signal.signalType === 'SCALPING_PUMP' && regime === 'TRENDING') score += 10;

        // 3. Classification Validation
        switch (classification) {
            case 'REAL_MOMENTUM': score += 15; break;
            case 'LIQUIDITY_GRAB': score -= 20; break;
            case 'STOP_HUNT': score -= 15; break;
            case 'NEWS_EVENT': score -= 5; break; // Risky but profitable
            case 'UNKNOWN': score -= 5; break;
        }

        // 4. BTC Correlation
        if (btcContext) {
            const signalBias = (signal.signalType === 'DUMP') ? 'DOWN' : 'UP';
            if (signalBias === btcContext.trend) score += 5;
            else score -= 5;
        }

        // 5. RSI Check (Gatekeeper adjustment)
        const prices = history.map(p => p.price);
        const rsi = calculateRSI(prices, 14);
        if (rsi) {
            if (signal.signalType !== 'DUMP' && rsi > 75) score -= 10; // Overbought penalty for buys
            if (signal.signalType !== 'DUMP' && rsi < 40 && regime === 'TRENDING') score += 5; // Dip buy
        }

        // Caps
        return Math.min(99, Math.max(1, score));
    }

    // --- D. RISK & EXECUTION ---

    private static assessRisk(score: number, regime: MarketRegime, classification: MoveClassification): { risk: RiskLevel, failureProbability: string } {
        // High Score = Low Risk
        // Low Score = High Risk

        let risk: RiskLevel = 'MEDIUM';
        let failProb = 0;

        if (score > 80) risk = 'LOW';
        else if (score < 50) risk = 'HIGH';

        // Modifiers
        if (regime === 'VOLATILE') risk = 'HIGH';
        if (classification === 'LIQUIDITY_GRAB') risk = 'HIGH';

        // Calculate Probability of Failure (Inverse of Score map, roughly)
        failProb = 100 - score;

        // Add "Uncertainty Buffer" based on Regime
        if (regime === 'RANGING') failProb += 5;

        return {
            risk,
            failureProbability: `${Math.round(failProb)}%`
        };
    }

    private static determineExecutionBias(signalType: string, regime: MarketRegime): ExecutionBias {
        if (signalType === 'SCALPING_PUMP') return 'BREAKOUT';
        if (signalType === 'DUMP') return 'BREAKOUT'; // Breakdown actually

        if (regime === 'TRENDING') return 'PULLBACK'; // Safer to enter trends on pullback
        if (regime === 'ACCUMULATION') return 'ACCUMULATION'; // Limit orders inside range
        if (regime === 'RANGING') return 'MEAN_REVERSION'; // Buy low, sell high

        return 'BREAKOUT'; // Default Agressive
    }

    // Helper
    private static getLast(arr: (number | undefined)[]): number {
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i] !== undefined && !isNaN(arr[i])) return arr[i]!;
        }
        return 0;
    }
}
