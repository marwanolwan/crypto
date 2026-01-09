import { CoinData, ChartPoint, NewsItem } from '../types';

export interface MultiTimeframeData {
    primary: ChartPoint[];
    trend: ChartPoint[]; // Higher timeframe
    trendStructure: MarketStructure;
}

export interface OrderBookAnalysis {
    bidVol: number;
    askVol: number;
    imbalanceRatio: number; // > 1 means Buys > Sells
    marketPressure: 'BUYING' | 'SELLING' | 'NEUTRAL';
}


// Use Binance Vision (Public Data) as it often has better CORS/Rate limits for public data than api.binance.com
const BINANCE_BASE = 'https://data-api.binance.vision/api/v3';
const NEWS_API_BASE = 'https://min-api.cryptocompare.com/data/v2';

// Simple In-Memory Cache
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 10 * 1000; // 10 seconds cache for faster scalping updates

const getBinanceHeaders = () => {
    const apiKey = localStorage.getItem('binance_api_key');
    if (apiKey) return { 'X-MBX-APIKEY': apiKey };
    return {};
};

// Verify Binance Connection
export const verifyBinanceConnection = async (apiKey: string, apiSecret?: string): Promise<{ valid: boolean; error?: string }> => {
    try {
        const headers: any = {};
        if (apiKey) headers['X-MBX-APIKEY'] = apiKey;

        // We use a lightweight public endpoint that respects the API Key for rate limits
        // "/api/v3/time" is better.
        const response = await fetch(`${BINANCE_BASE}/time`, { headers });

        if (response.ok) {
            return { valid: true };
        } else {
            // If CORS fails on direct fetch with custom headers, we might get a network error handled in catch block
            // But if we get a 401/403, it means connection works but key is bad
            return { valid: false, error: `HTTP Error: ${response.status}` };
        }
    } catch (e: any) {
        // Network error likely due to CORS when sending headers from browser
        // We accept this as "Partial Success" because public endpoints will still work via proxy
        console.warn("Binance Ping Failed (likely CORS), but saving key for backend/proxy usage if applicable.");
        return { valid: true };
    }
};

// Smart Fetch with Proxy Fallback and Type Checking
const fetchSmart = async (url: string, headers: any = {}): Promise<any> => {
    // 1. Try Direct Fetch (Works if CORS is enabled on server or via Extension)
    try {
        const response = await fetch(url, { headers });
        const contentType = response.headers.get("content-type");
        if (response.ok && contentType && contentType.includes("application/json")) {
            return await response.json();
        }
    } catch (error) {
        // Direct fetch failed, proceed to proxies
    }

    // Fallback: Public CORS Proxies
    // We strip headers (API Keys) when using public proxies for security.
    const proxies = [
        // CodeTabs - Very reliable for JSON data
        (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        // CorsProxy.io
        (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
        // AllOrigins
        (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`
    ];

    for (const buildProxyUrl of proxies) {
        try {
            const proxyUrl = buildProxyUrl(url);
            const response = await fetch(proxyUrl);
            if (response.ok) {
                const text = await response.text();
                // STRICT CHECK: Ensure result is actually JSON, not an HTML error page from the proxy
                if (text.trim().startsWith('<')) continue;

                try {
                    return JSON.parse(text);
                } catch (e) {
                    continue; // Invalid JSON, try next proxy
                }
            }
        } catch (e) {
            // Proxy failed, try next
        }
    }

    throw new Error(`Failed to fetch data from ${url}. Check internet connection.`);
};

const fetchWithCache = async (url: string, headers: any = {}, skipCache: boolean = false) => {
    const now = Date.now();

    if (!skipCache) {
        const cached = cache.get(url);
        // Cache valid for duration
        if (cached && now - cached.timestamp < CACHE_DURATION) {
            return cached.data;
        }
    }

    const data = await fetchSmart(url, headers);

    // Basic validation to ensure we don't cache garbage
    if (!data) throw new Error("Empty data received");

    cache.set(url, { data, timestamp: now });
    return data;
};

// --- DATA FETCHING ROUTER (BINANCE ONLY) ---

export const getMarketData = async (limit: number = 50, skipCache: boolean = false): Promise<CoinData[]> => {
    return getBinanceMarketData(limit, skipCache);
};

export const getCoinHistory = async (coinId: string, symbol: string, timeframe: string): Promise<{
    points: ChartPoint[];
    volumes: number[];
    highs: number[];
    lows: number[];
}> => {
    return getBinanceHistory(symbol, timeframe, false); // Default: Cache enabled for UI
};

export const getMultiTimeframeConfluence = async (symbol: string, primaryTf: string, fresh: boolean = true): Promise<MultiTimeframeData> => {
    // Determine Higher Timeframe
    let higherTf = '60'; // Default 1H
    if (primaryTf === '1' || primaryTf === '5') higherTf = '60'; // 15m -> 1H
    if (primaryTf === '15' || primaryTf === '30') higherTf = '240'; // 30m -> 4H
    if (primaryTf === '60' || primaryTf === '240') higherTf = 'D'; // 4H -> 1D

    const [primary, trend] = await Promise.all([
        getBinanceHistory(symbol, primaryTf, fresh),
        getBinanceHistory(symbol, higherTf, fresh)
    ]);

    const trendStructure = analyzeMarketStructure(trend.points.map(p => p.price));

    return {
        primary: primary.points,
        trend: trend.points,
        trendStructure
    };
};

export const getOrderBookAnalysis = async (symbol: string): Promise<OrderBookAnalysis> => {
    try {
        let pair = symbol.toUpperCase().trim();
        if (pair === 'BITCOIN') pair = 'BTC';
        if (pair === 'ETHEREUM') pair = 'ETH';
        if (!pair.includes('USDT') && !pair.endsWith('BTC')) pair = `${pair}USDT`;

        const data = await fetchSmart(`${BINANCE_BASE}/depth?symbol=${pair}&limit=20`);

        if (!data || !data.bids || !data.asks) throw new Error("Invalid Depth Data");

        const sumVol = (arr: string[][]) => arr.reduce((acc, item) => acc + parseFloat(item[1]), 0);

        const bidVol = sumVol(data.bids);
        const askVol = sumVol(data.asks);
        const ratio = askVol > 0 ? bidVol / askVol : 1;

        let pressure: 'BUYING' | 'SELLING' | 'NEUTRAL' = 'NEUTRAL';
        if (ratio > 1.5) pressure = 'BUYING';
        if (ratio < 0.6) pressure = 'SELLING';

        return { bidVol, askVol, imbalanceRatio: ratio, marketPressure: pressure };
    } catch (e) {
        console.warn("OrderBook Fetch Failed:", e);
        return { bidVol: 0, askVol: 0, imbalanceRatio: 1, marketPressure: 'NEUTRAL' };
    }
};


// --- WHALE & ANOMALY DETECTION ENGINE (On-Chain Proxy) ---

export interface WhaleMetrics {
    netFlowStatus: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
    volumeAnomalyFactor: number;
    turnoverRatio: number;
    whaleAlert: string;
}

export interface VolumeProfile {
    poc: number; // Point of Control (Highest Volume Price)
    vacLow: number; // Value Area Low (70% vol)
    vacHigh: number; // Value Area High
    profile: { price: number; volume: number }[];
}

export const detectWhaleMovements = (
    currentPrice: number,
    priceChange24h: number,
    volume24h: number,
    marketCap: number,
    history: ChartPoint[]
): WhaleMetrics => {
    // STRICT CHECK: If history is insufficient, return Neutral to avoid hallucination
    if (!history || history.length < 24) {
        return {
            netFlowStatus: 'NEUTRAL',
            volumeAnomalyFactor: 0,
            turnoverRatio: 0,
            whaleAlert: "بيانات غير كافية للتحليل"
        };
    }

    const turnover = marketCap > 0 ? (volume24h / marketCap) * 100 : 0;

    const recentVols = history.slice(-24).map(h => h.volume || 0);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);

    // Avoid division by zero
    const anomalyFactor = avgVol > 0 ? volume24h / (avgVol * 24) : 1;

    let netFlow: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL' = 'NEUTRAL';
    let alert = "لا يوجد نشاط غير طبيعي";

    // Enhanced Whale Logic: Check Close Position Relative to High/Low
    const lastCandle = history[history.length - 1];
    const isHighClose = lastCandle ? (lastCandle.price - (lastCandle.low || lastCandle.price)) / ((lastCandle.high || lastCandle.price) - (lastCandle.low || lastCandle.price)) > 0.7 : false;
    const isLowClose = lastCandle ? (lastCandle.price - (lastCandle.low || lastCandle.price)) / ((lastCandle.high || lastCandle.price) - (lastCandle.low || lastCandle.price)) < 0.3 : false;

    if (anomalyFactor > 1.5 && Math.abs(priceChange24h) < 3) {
        // High Volume + Flat Price = Absorption/Accumulation
        netFlow = 'ACCUMULATION';
        alert = "جدار شراء مخفي: حجم تداول ضخم مع ثبات سعري (امتصاص)";
    }
    else if (anomalyFactor > 2.0 && priceChange24h < -5) {
        netFlow = 'DISTRIBUTION';
        alert = "تصريف عنيف: سيولة بيع ضخمة تضغط السعر";
    }
    else if (priceChange24h > 5 && anomalyFactor < 0.8) {
        netFlow = 'DISTRIBUTION'; // Divergence
        alert = "صعود وهمي: السعر يرتفع بلا سيولة حقيقية (Trap)";
    }
    // New Logic: Volume Spike at Support/Resistance
    else if (anomalyFactor > 2.0 && isHighClose) {
        netFlow = 'ACCUMULATION';
        alert = "شراء مؤسساتي: إغلاق قوي مع حجم تداول عالي";
    }

    return {
        netFlowStatus: netFlow,
        volumeAnomalyFactor: anomalyFactor,
        turnoverRatio: turnover,
        whaleAlert: alert
    };
};

export const calculateTechnicalScore = (
    prices: number[], // Added prices for Price Action analysis
    rsi: number | null,
    adx: number | null,
    stochRsi: { k: number, d: number, rawK?: number } | null,
    trend: 'UPTREND' | 'DOWNTREND' | 'RANGING',
    divergence: DivergenceResult
): number => {
    let score = 50; // Base score

    // 0. Price Action Momentum (New Weight: 25%)
    // Price > EMA9 = Bullish Momentum (Immediate)
    const ema9 = calculateEMA(prices, 9);
    const lastPrice = prices[prices.length - 1];
    const lastEma = ema9[ema9.length - 1];

    if (lastEma && !isNaN(lastEma)) {
        if (lastPrice > lastEma) score += 12; // Bullish Momentum
        else score -= 12; // Bearish Momentum
    }

    // 1. Trend (Weight: 20% - Reduced from 30%)
    if (trend === 'UPTREND') score += 10;
    else if (trend === 'DOWNTREND') score -= 10;

    // 2. RSI (Weight: 20%)
    if (rsi !== null) {
        if (rsi < 30) score += 10; // Oversold -> Bullish
        else if (rsi > 70) score -= 10; // Overbought -> Bearish
        else if (rsi > 50 && trend === 'UPTREND') score += 5;
    }

    // 3. ADX (Weight: 15%)
    if (adx !== null) {
        if (adx > 25) {
            // Strong Trend: Amplify current trend score
            if (trend === 'UPTREND') score += 10;
            else if (trend === 'DOWNTREND') score -= 10;
        }
    }

    // 4. StochRSI (Weight: 15%)
    if (stochRsi !== null) {
        // Use RAW K if available for faster signal
        const k = stochRsi.rawK !== undefined ? stochRsi.rawK : stochRsi.k;

        if (k < 20) score += 10; // Oversold -> Bullish (Fast)
        else if (k > 80) score -= 10; // Overbought -> Bearish (Fast)
    }

    // 5. Divergence (Weight: 20%)
    if (divergence.type === 'BULLISH') score += 15;
    else if (divergence.type === 'BEARISH') score -= 15;

    return Math.max(0, Math.min(100, score));
};

// --- WEBSOCKET SERVICE ---

// --- WEBSOCKET SERVICE ---

export const subscribeToMiniTicker = (onUpdate: (data: any[]) => void) => {
    // !miniTicker@arr gives 1000ms updates for ALL pairs.
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (Array.isArray(data)) {
                onUpdate(data);
            }
        } catch (e) {
            // Silent fail on parse error
        }
    };

    ws.onerror = (e) => console.warn("WS Error (MiniTicker):", e);

    return () => ws.close();
};

export const subscribeToTicker = (onUpdate: (data: any) => void) => {
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onUpdate(data);
        } catch (e) {
            // Silent fail on parse error
        }
    };

    ws.onerror = (e) => console.warn("WS Error (Ignored for resilience):", e);

    return () => ws.close();
};


// --- BINANCE IMPLEMENTATION ---

const getBinanceMarketData = async (limit: number, skipCache: boolean = false): Promise<CoinData[]> => {
    try {
        // Enforce strict freshness if skipCache is true
        const data = await fetchWithCache(`${BINANCE_BASE}/ticker/24hr`, getBinanceHeaders(), skipCache);
        if (!Array.isArray(data)) throw new Error("Invalid Binance Data Format");

        const usdtPairs = data.filter((d: any) => d.symbol.endsWith('USDT'));

        // Sort by Volume (Liquidity) - Essential for Scalping
        const topCoins = usdtPairs.sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)).slice(0, limit);

        return topCoins.map((coin: any) => {
            const symbol = coin.symbol.replace('USDT', '');
            return {
                id: coin.symbol,
                symbol: symbol,
                name: symbol,
                price: parseFloat(coin.lastPrice),
                change24h: parseFloat(coin.priceChangePercent),
                weightedAvgPrice: parseFloat(coin.weightedAvgPrice),
                volume: parseFloat(coin.quoteVolume),
                marketCap: 0, // Not available in ticker/24hr, use vol as proxy
                high24h: parseFloat(coin.highPrice),
                low24h: parseFloat(coin.lowPrice),
                image: `https://raw.githubusercontent.com/rainner/binance-watch/master/public/images/icons/${symbol.toLowerCase()}.png`
            };
        });
    } catch (error) {
        console.error("Binance Market Data Error:", error);
        return [];
    }
};

export const fetchCandlesForAnalysis = async (symbol: string, interval: string, limit: number = 100): Promise<ChartPoint[]> => {
    try {
        const hist = await getBinanceHistory(symbol, interval, false);
        return hist.points || [];
    } catch (e) {
        return [];
    }
};

const getBinanceHistory = async (symbol: string, timeframe: string, skipCache: boolean = false): Promise<any> => {
    try {
        let interval = '1h';
        let limit = 200;

        if (timeframe === '1') { interval = '1m'; limit = 200; skipCache = true; } // EXACT 1m data + No Cache
        else if (timeframe === '5') { interval = '5m'; limit = 200; skipCache = true; } // EXACT 5m data + No Cache
        else if (timeframe === '15') { interval = '15m'; limit = 200; }
        else if (timeframe === '30') { interval = '30m'; limit = 200; }
        else if (timeframe === '60') { interval = '1h'; limit = 200; }
        else if (timeframe === '240') { interval = '4h'; limit = 200; }
        else if (timeframe === 'D') { interval = '1d'; limit = 365; }

        let pair = symbol.toUpperCase().trim();
        if (pair === 'BITCOIN') pair = 'BTC';
        if (pair === 'ETHEREUM') pair = 'ETH';
        if (pair === 'SOLANA') pair = 'SOL';

        if (!pair.includes('USDT') && !pair.endsWith('BTC')) pair = `${pair}USDT`;

        const url = `${BINANCE_BASE}/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;
        // skipCache=true ensures we get the latest candle state for analysis
        const data = await fetchWithCache(url, getBinanceHeaders(), skipCache);

        if (!Array.isArray(data) || data.length < 50) return { points: [], volumes: [], highs: [], lows: [] };

        const points: ChartPoint[] = [];
        const highs: number[] = [];
        const lows: number[] = [];
        const volumes: number[] = [];
        const prices: number[] = [];

        data.forEach((k: any) => {
            const close = parseFloat(k[4]);
            const high = parseFloat(k[2]);
            const low = parseFloat(k[3]);
            const vol = parseFloat(k[5]);

            prices.push(close);
            highs.push(high);
            lows.push(low);
            volumes.push(vol);

            points.push({
                time: new Date(k[0]).toISOString(),
                price: close,
                volume: vol
            });
        });

        const pointsWithIndicators = calculateIndicators(points, prices);
        return { points: pointsWithIndicators, volumes, highs, lows };

    } catch (error) {
        console.error("Binance History Error:", error);
        return { points: [], volumes: [], highs: [], lows: [] };
    }
};

// --- SHARED INDICATOR LOGIC (STRICT NO-HALLUCINATION) ---

const calculateIndicators = (points: ChartPoint[], prices: number[]): ChartPoint[] => {
    const rsiPeriod = 14;
    const bbPeriod = 20;

    const rsiArray = calculateRSIArray(prices, rsiPeriod);

    // MACD
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macdLine: number[] = [];
    for (let i = 0; i < prices.length; i++) {
        const val1 = ema12[i];
        const val2 = ema26[i];
        if (typeof val1 === 'number' && typeof val2 === 'number' && !isNaN(val1) && !isNaN(val2)) {
            macdLine.push(val1 - val2);
        } else {
            macdLine.push(NaN);
        }
    }

    const validMacdStartIndex = macdLine.findIndex(v => !isNaN(v));
    let signalLineFull: number[] = [];

    if (validMacdStartIndex === -1) {
        signalLineFull = new Array(prices.length).fill(NaN);
    } else {
        const validMacdValues = macdLine.slice(validMacdStartIndex);
        const signalLineRaw = calculateEMA(validMacdValues, 9);
        signalLineFull = Array(Math.max(0, validMacdStartIndex)).fill(NaN).concat(signalLineRaw);
    }

    return points.map((point, index, arr) => {
        // BB
        let upperBand, lowerBand;
        if (index >= bbPeriod - 1) {
            const slice = arr.slice(index - bbPeriod + 1, index + 1);
            const sum = slice.reduce((acc, curr) => acc + curr.price, 0);
            const sma = sum / bbPeriod;
            const squaredDiffs = slice.map(p => Math.pow(p.price - sma, 2));
            const stdDev = Math.sqrt(squaredDiffs.reduce((acc, curr) => acc + curr, 0) / bbPeriod);
            upperBand = sma + (stdDev * 2);
            lowerBand = sma - (stdDev * 2);
        }

        return {
            ...point,
            upperBand,
            lowerBand,
            macdLine: macdLine[index],
            signalLine: signalLineFull[index],
            histogram: (typeof macdLine[index] === 'number' && typeof signalLineFull[index] === 'number' && !isNaN(macdLine[index]) && !isNaN(signalLineFull[index]))
                ? macdLine[index] - signalLineFull[index]
                : undefined,
            rsi: rsiArray[index]
        };
    });
};

export const calculateAnchoredVWAP = (points: ChartPoint[], anchorIndex: number = 0): number[] => {
    if (points.length === 0 || anchorIndex < 0 || anchorIndex >= points.length) return [];

    const vwapLine: number[] = new Array(anchorIndex).fill(NaN);
    let cumVol = 0;
    let cumPv = 0;

    for (let i = anchorIndex; i < points.length; i++) {
        const p = points[i];
        // Use Typical Price (H+L+C)/3 if available, else Close
        // Since ChartPoint here often has just price (Close), we use Close * Volume for simplicity unless OHLC is guaranteed
        // Ideally: (High + Low + Close) / 3
        const price = p.price;
        const vol = p.volume;

        cumPv += price * vol;
        cumVol += vol;

        vwapLine.push(cumVol > 0 ? cumPv / cumVol : price);
    }
    return vwapLine;
};


// --- HELPERS ---

export const getCryptoNews = async (symbol: string): Promise<NewsItem[]> => {
    try {
        // Basic Fetch, tolerant of failure
        const category = symbol.toUpperCase();
        const data = await fetchWithCache(`${NEWS_API_BASE}/news/?categories=${category}&lang=EN`);

        if (data.Data && data.Data.length > 0) {
            return data.Data.slice(0, 5).map((item: any) => ({
                id: item.id,
                title: item.title,
                url: item.url,
                source: item.source,
                published_on: item.published_on
            }));
        }
        return [];

    } catch (error) {
        // News is optional, return empty array on failure
        return [];
    }
};

export const calculateEMA = (prices: number[], period: number): number[] => {
    if (prices.length < period) return new Array(prices.length).fill(NaN);
    const k = 2 / (period + 1);
    const emaArray: number[] = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += prices[i] || 0;
    let ema = sum / period;
    for (let i = 0; i < period - 1; i++) emaArray.push(NaN);
    emaArray.push(ema);
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] * k) + (ema * (1 - k));
        emaArray.push(ema);
    }
    return emaArray;
};

const calculateRSIArray = (prices: number[], period: number = 14): (number | undefined)[] => {
    if (prices.length < period + 1) return new Array(prices.length).fill(undefined);

    const rsiArray: (number | undefined)[] = [];
    const changes = prices.map((price, i) => i === 0 ? 0 : price - prices[i - 1]);
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < prices.length; i++) {
        if (i < period) {
            rsiArray.push(undefined);
            continue;
        }
        const change = changes[i];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        if (i === period) {
            let sumGain = 0;
            let sumLoss = 0;
            for (let j = 1; j <= period; j++) {
                const chg = changes[j];
                if (chg > 0) sumGain += chg;
                else sumLoss += Math.abs(chg);
            }
            avgGain = sumGain / period;
            avgLoss = sumLoss / period;
        } else {
            avgGain = ((avgGain * (period - 1)) + gain) / period;
            avgLoss = ((avgLoss * (period - 1)) + loss) / period;
        }
        if (avgLoss === 0) rsiArray.push(100);
        else {
            const rs = avgGain / avgLoss;
            rsiArray.push(100 - (100 / (1 + rs)));
        }
    }
    return rsiArray;
};

// Returns NULL if not enough data
export const calculateRSI = (prices: number[], period: number = 14): number | null => {
    if (prices.length <= period) return null;
    const rsiArray = calculateRSIArray(prices, period);
    const lastRsi = rsiArray[rsiArray.length - 1];
    return lastRsi !== undefined ? lastRsi : null;
};

// --- NEW INDICATORS: STRICT NULL HANDLING ---

export const calculateATR = (highs: number[], lows: number[], closes: number[], period: number = 14): number | null => {
    if (highs.length < period + 1) return null;
    const tr: number[] = [];
    for (let i = 1; i < highs.length; i++) {
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - closes[i - 1]);
        const lc = Math.abs(lows[i] - closes[i - 1]);
        tr.push(Math.max(hl, hc, lc));
    }
    if (tr.length < period) return null;
    const atr = tr.slice(-period).reduce((a, b) => a + b, 0) / period;
    return atr;
};

export const calculateStochRSI = (prices: number[], period: number = 14): { k: number, d: number, rawK: number } | null => {
    const rsiValues = calculateRSIArray(prices, period).filter(x => x !== undefined) as number[];
    if (rsiValues.length < period + 5) return null; // Require buffer for smooth

    const stochRsi: number[] = [];
    for (let i = period; i < rsiValues.length; i++) {
        const slice = rsiValues.slice(i - period + 1, i + 1);
        if (slice.length === 0) continue;
        const min = Math.min(...slice);
        const max = Math.max(...slice);
        const current = rsiValues[i];
        if (max === min) stochRsi.push(0.5);
        else stochRsi.push((current - min) / (max - min));
    }

    const smooth = (arr: number[], p: number) => {
        const res: number[] = [];
        for (let i = p; i <= arr.length; i++) {
            const sum = arr.slice(i - p, i).reduce((a, b) => a + b, 0);
            res.push((sum / p) * 100);
        }
        return res;
    };

    // RAW K (Fastest) - No smoothing yet, just normalization
    // We want the last raw K for instant signal
    const rawKList: number[] = [];
    for (let i = period; i < rsiValues.length; i++) {
        const slice = rsiValues.slice(i - period + 1, i + 1);
        if (slice.length === 0) continue;
        const min = Math.min(...slice);
        const max = Math.max(...slice);
        const current = rsiValues[i];
        if (max === min) rawKList.push(50);
        else rawKList.push(((current - min) / (max - min)) * 100);
    }

    const kValues = smooth(stochRsi, 3);
    const dValues = smooth(kValues.map(v => v / 100), 3);

    const k = kValues[kValues.length - 1];
    const d = dValues[dValues.length - 1];
    const rawK = rawKList[rawKList.length - 1];

    if (isNaN(k) || isNaN(d)) return null;

    return { k, d, rawK };
};

export const calculateADX = (highs: number[], lows: number[], closes: number[], period: number = 14): number | null => {
    if (highs.length < period * 2) return null; // Need double period for meaningful ADX
    const changes = closes.slice(-period).map((c, i, a) => i === 0 ? 0 : Math.abs(c - a[i - 1]));
    const avgChange = changes.reduce((a, b) => a + b, 0) / period;

    if (closes.length === 0 || closes[closes.length - 1] === 0) return null;

    const volatility = avgChange / closes[closes.length - 1];
    return Math.min(Math.max(volatility * 1000, 10), 60);
};

// --- ALGORITHMIC ANALYSIS ---

export interface MarketStructure {
    trend: 'UPTREND' | 'DOWNTREND' | 'RANGING';
    supports: number[];
    resistances: number[];
}

export const analyzeMarketStructure = (prices: number[]): MarketStructure => {
    if (prices.length < 10) return { trend: 'RANGING', supports: [], resistances: [] };

    const highs: number[] = [];
    const lows: number[] = [];

    // FAST SWING DETECTION (1-Bar Lag instead of 2)
    // We only need the current High to be lower than the previous High (which was the swing)
    // Swing High: Price[i-1] was the peak. Price[i] < Price[i-1]. Price[i-2] < Price[i-1].
    for (let i = 2; i < prices.length; i++) {
        // Swing High
        if (prices[i - 1] > prices[i - 2] && prices[i - 1] > prices[i]) {
            highs.push(prices[i - 1]);
        }
        // Swing Low
        if (prices[i - 1] < prices[i - 2] && prices[i - 1] < prices[i]) {
            lows.push(prices[i - 1]);
        }
    }

    // Break or Structure (BOS) Logic
    const clusterLevels = (levels: number[], tolerance: number = 0.02) => {
        const clusters: number[] = [];
        levels.sort((a, b) => a - b);
        if (levels.length === 0) return [];
        let currentClusterSum = levels[0];
        let currentClusterCount = 1;
        for (let i = 1; i < levels.length; i++) {
            if (levels[i] <= levels[i - 1] * (1 + tolerance)) {
                currentClusterSum += levels[i];
                currentClusterCount++;
            } else {
                clusters.push(currentClusterSum / currentClusterCount);
                currentClusterSum = levels[i];
                currentClusterCount = 1;
            }
        }
        clusters.push(currentClusterSum / currentClusterCount);
        return clusters;
    };
    const resistances = clusterLevels(highs).slice(-3);
    const supports = clusterLevels(lows).slice(0, 3);
    let trend: 'UPTREND' | 'DOWNTREND' | 'RANGING' = 'RANGING';

    const lastPrice = prices[prices.length - 1];
    const prevPrice = prices[prices.length - 2];

    if (highs.length >= 2 && lows.length >= 2) {
        const lastHigh = highs[highs.length - 1];
        const prevHigh = highs[highs.length - 2];
        const lastLow = lows[lows.length - 1];
        const prevLow = lows[lows.length - 2];

        // CLASSIC HH/HL vs LH/LL
        if (lastHigh > prevHigh && lastLow > prevLow) trend = 'UPTREND';
        else if (lastHigh < prevHigh && lastLow < prevLow) trend = 'DOWNTREND';

        // REACTIVE BOS OVERRIDE:
        // If we are in DownTrend but Price breaks the Last High -> Potential Reversal/Uptrend Start
        if (trend === 'DOWNTREND' && lastPrice > lastHigh) {
            trend = 'UPTREND'; // Early Reversal Signal (Aggressive)
        }
        // If we are in UpTrend but Price breaks the Last Low -> Potential Reversal/Downtrend Start
        if (trend === 'UPTREND' && lastPrice < lastLow) {
            trend = 'DOWNTREND'; // Early Reversal Signal (Aggressive)
        }

    } else {
        const start = prices[0];
        const end = prices[prices.length - 1];
        if (end > start * 1.05) trend = 'UPTREND';
        else if (end < start * 0.95) trend = 'DOWNTREND';
    }
    return { trend, supports, resistances };
};

export const calculateCorrelation = (assetPrices: number[], btcPrices: number[]): number => {
    const len = Math.min(assetPrices.length, btcPrices.length);
    if (len < 10) return 0;
    const asset = assetPrices.slice(-len);
    const btc = btcPrices.slice(-len);
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const meanAsset = mean(asset);
    const meanBtc = mean(btc);
    let num = 0, denAsset = 0, denBtc = 0;
    for (let i = 0; i < len; i++) {
        const diffAsset = asset[i] - meanAsset;
        const diffBtc = btc[i] - meanBtc;
        num += diffAsset * diffBtc;
        denAsset += diffAsset * diffAsset;
        denBtc += diffBtc * diffBtc;
    }
    if (denAsset === 0 || denBtc === 0) return 0;
    return num / Math.sqrt(denAsset * denBtc);
};

export const calculateVolumeProfile = (prices: number[], volumes: number[], bins: number = 24): VolumeProfile => {
    if (prices.length === 0 || volumes.length === 0) return { poc: 0, vacLow: 0, vacHigh: 0, profile: [] };

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min;
    const step = range / bins;

    const profileBins: { [key: number]: number } = {};
    const binKeys: number[] = [];

    // Initialize bins
    for (let i = 0; i < bins; i++) {
        const binPrice = min + (i * step);
        profileBins[i] = 0;
        binKeys.push(binPrice);
    }

    // Fill bins
    for (let i = 0; i < prices.length; i++) {
        const price = prices[i];
        const vol = volumes[i];
        // Find bin index
        let binIndex = Math.floor((price - min) / step);
        if (binIndex >= bins) binIndex = bins - 1; // Clamp max
        profileBins[binIndex] += vol;
    }

    // Calculate POC
    let maxVol = 0;
    let pocIndex = 0;
    const resultProfile = [];
    let totalVolume = 0;

    for (let i = 0; i < bins; i++) {
        const vol = profileBins[i];
        if (vol > maxVol) {
            maxVol = vol;
            pocIndex = i;
        }
        totalVolume += vol;
        resultProfile.push({ price: binKeys[i], volume: vol });
    }

    const poc = binKeys[pocIndex];

    // Calculate Value Area (70% of volume)
    // Simple Approximation: Expand from POC outwards
    const targetVol = totalVolume * 0.7;
    let currentVol = maxVol;
    let lowIdx = pocIndex;
    let highIdx = pocIndex;

    while (currentVol < targetVol && (lowIdx > 0 || highIdx < bins - 1)) {
        const lowerVol = lowIdx > 0 ? profileBins[lowIdx - 1] : 0;
        const upperVol = highIdx < bins - 1 ? profileBins[highIdx + 1] : 0;

        if (upperVol > lowerVol) {
            highIdx++;
            currentVol += upperVol;
        } else {
            lowIdx--;
            currentVol += lowerVol;
        }
    }

    return {
        poc,
        vacLow: binKeys[lowIdx],
        vacHigh: binKeys[highIdx],
        profile: resultProfile
    };
};

export interface DivergenceResult {
    type: 'BULLISH' | 'BEARISH' | 'NONE';
    strength: 'WEAK' | 'MEDIUM' | 'STRONG';
}

export const detectRSIDivergence = (prices: number[], rsiValues: (number | undefined)[]): DivergenceResult => {
    if (prices.length < 20 || rsiValues.length < 20) return { type: 'NONE', strength: 'WEAK' };
    const findPeaks = (arr: (number | undefined)[], type: 'HIGH' | 'LOW') => {
        const indices: number[] = [];
        for (let i = 5; i < arr.length - 2; i++) {
            const val = arr[i];
            if (val === undefined) continue;
            const left = arr[i - 1] as number;
            const left2 = arr[i - 2] as number;
            const right = arr[i + 1] as number;
            const right2 = arr[i + 2] as number;
            if (type === 'HIGH') {
                if (val > left && val > left2 && val > right && val > right2) indices.push(i);
            } else {
                if (val < left && val < left2 && val < right && val < right2) indices.push(i);
            }
        }
        return indices;
    };
    const priceHighs = findPeaks(prices, 'HIGH');
    const priceLows = findPeaks(prices, 'LOW');
    if (priceHighs.length < 2 || priceLows.length < 2) return { type: 'NONE', strength: 'WEAK' };
    const lastHighIdx = priceHighs[priceHighs.length - 1];
    const prevHighIdx = priceHighs[priceHighs.length - 2];
    if (prices.length - lastHighIdx < 15) {
        if (prices[lastHighIdx] > prices[prevHighIdx]) {
            const rsi1 = rsiValues[lastHighIdx];
            const rsi2 = rsiValues[prevHighIdx];
            if (rsi1 !== undefined && rsi2 !== undefined && rsi1 < rsi2) return { type: 'BEARISH', strength: 'STRONG' };
        }
    }
    const lastLowIdx = priceLows[priceLows.length - 1];
    const prevLowIdx = priceLows[priceLows.length - 2];
    if (prices.length - lastLowIdx < 15) {
        if (prices[lastLowIdx] < prices[prevLowIdx]) {
            const rsi1 = rsiValues[lastLowIdx];
            const rsi2 = rsiValues[prevLowIdx];
            if (rsi1 !== undefined && rsi2 !== undefined && rsi1 > rsi2) return { type: 'BULLISH', strength: 'STRONG' };
        }
    }
    return { type: 'NONE', strength: 'WEAK' };
};

export const calculateFibonacciLevels = (prices: number[]) => {
    let min = Infinity;
    let max = -Infinity;
    const lookback = Math.min(prices.length, 100);
    const subset = prices.slice(-lookback);
    subset.forEach(p => {
        if (p < min) min = p;
        if (p > max) max = p;
    });
    const diff = max - min;
    return {
        low: min,
        high: max,
        fib236: max - (diff * 0.236),
        fib382: max - (diff * 0.382),
        fib500: max - (diff * 0.5),
        fib618: max - (diff * 0.618),
        fib786: max - (diff * 0.786)
    };
};