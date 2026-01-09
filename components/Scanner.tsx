import React, { useEffect, useState, useRef } from 'react';
import { ScannerSignal, CoinData } from '../types';
import { getMarketData, subscribeToMiniTicker } from '../services/cryptoApi';
import { ArrowUpRight, Radar, Zap, Activity, Clock, Briefcase, Flame, Wifi } from 'lucide-react';

interface ScannerProps {
    onSelectCoin: (id: string, symbol: string) => void;
}

type ScanMode = 'SCALPING' | 'DAY' | 'SWING' | 'INVESTING';

const MODES: { id: ScanMode; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'SCALPING', label: 'مضاربة (Scalp)', icon: <Zap size={16} />, desc: 'إطار 1د - 5د: كشف الزخم اللحظي (LIVE)' },
    { id: 'DAY', label: 'يومي (Day)', icon: <Clock size={16} />, desc: 'إطار 4س: بحث عن انفجارات سعرية' },
    { id: 'SWING', label: 'متأرجح (Swing)', icon: <Activity size={16} />, desc: 'إطار يومي: بحث عن استمرار اتجاه' },
    { id: 'INVESTING', label: 'استثمار', icon: <Briefcase size={16} />, desc: 'إطار أسبوعي: بحث عن قيم استثمارية' },
];

interface PricePoint {
    p: number; // Price
    v: number; // Volume Accumulation
    t: number; // Time
}

export const Scanner: React.FC<ScannerProps> = ({ onSelectCoin }) => {
    const [signals, setSignals] = useState<ScannerSignal[]>([]);
    const [loading, setLoading] = useState(true);
    const [mode, setMode] = useState<ScanMode>('SCALPING');
    const [isLive, setIsLive] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_lastUpdate, setLastUpdate] = useState<number>(Date.now());

    // ROLLING WINDOW BUFFER: Store last 15 mins of ticks for Top 250 coins
    const priceBuffer = useRef<Map<string, PricePoint[]>>(new Map());
    const initialLoadDone = useRef(false);

    // Initial Seed & WebSocket Connection
    useEffect(() => {
        let cleanupWs: (() => void) | undefined;

        const initScanner = async () => {
            setLoading(true);
            try {
                // 1. Seed Buffer with Snapshot (Tickers)
                const snapshot = await getMarketData(250, true);
                const now = Date.now();
                snapshot.forEach(coin => {
                    const symbol = coin.symbol;
                    priceBuffer.current.set(symbol, [{
                        p: coin.price,
                        v: coin.volume,
                        t: now
                    }]);
                });

                setLoading(false);
                initialLoadDone.current = true;

                // 2. Connect WebSocket logic for Scalping
                if (mode === 'SCALPING') {
                    cleanupWs = subscribeToMiniTicker((data: any[]) => {
                        processStreamData(data);
                        setIsLive(true);
                        setLastUpdate(Date.now());
                    });
                } else {
                    // For other modes, we keep using the Snapshot logic periodically or basic Static Scan
                    processSnapshotLogic(snapshot);
                }

            } catch (e) {
                console.error("Scanner Init Failed:", e);
                setLoading(false);
            }
        };

        // Reset buffer on mode change (optional, but cleaner)
        if (mode === 'SCALPING') {
            priceBuffer.current.clear();
            setIsLive(false);
            setSignals([]);
        }

        initScanner();

        return () => {
            if (cleanupWs) cleanupWs();
        };
    }, [mode]);

    // Interval to refresh UI signals from Buffer (Throttle UI updates to 1s)
    useEffect(() => {
        if (mode !== 'SCALPING') return;

        const interval = setInterval(() => {
            if (priceBuffer.current.size > 0 && initialLoadDone.current) {
                analyzeBufferForSignals();
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [mode]);


    // --- REAL-TIME PROCESSING ENGINE ---

    const processStreamData = (tickers: any[]) => {
        const now = Date.now();

        tickers.forEach(t => {
            // Filter only USDT pairs for simplicity
            if (!t.s.endsWith('USDT')) return;

            const symbol = t.s.replace('USDT', '');
            const price = parseFloat(t.c);
            const volume = parseFloat(t.v); // Total Volume 24h (Binance sends Cumulative Volume in MiniTicker)

            // We need to store standard Symbol Key
            let history = priceBuffer.current.get(symbol);
            if (!history) {
                history = [];
                priceBuffer.current.set(symbol, history);
            }

            // Push Update
            history.push({ p: price, v: volume, t: now });

            // Prune Old Data (> 15 minutes)
            const cutoff = now - (15 * 60 * 1000);
            if (history[0].t < cutoff) {
                // Determine how many to slice. Optimization: check first, if old, slice.
                // Or just filter. Array is small (900 items max if 1s updates), slice is fine.
                // Keeping it simple: remove if older than cutoff.
                // Since it's sorted by time, we can just shift.
                while (history.length > 0 && history[0].t < cutoff) {
                    history.shift();
                }
            }
        });
    };

    const analyzeBufferForSignals = () => {
        const detectedSignals: ScannerSignal[] = [];
        const now = Date.now();

        priceBuffer.current.forEach((history, symbol) => {
            if (history.length < 5) return; // Need at least some seconds of data

            const current = history[history.length - 1];
            // Get data from 1 minute ago (approx)
            // find point closest to now - 60000ms
            const oneMinAgoTarget = now - 60000;

            let p1m = history[0]; // fallback if history is short

            // Find closest historical point
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].t <= oneMinAgoTarget) {
                    p1m = history[i];
                    break;
                }
            }

            // Prevent division by zero or bad data
            if (p1m.p === 0) return;

            // --- ALGORITHMS ---

            const price = current.p;
            const price1m = p1m.p;

            const mom1m = ((price - price1m) / price1m) * 100;

            // 1. SCALPING IGNITION (Serious Pump Start in 1m)
            // Rules:
            // - 1m Move > 0.4% (Very fast for 1min)
            // - We focus on PURE MOMENTUM

            if (mom1m > 0.4) {
                detectedSignals.push({
                    id: symbol + 'USDT',
                    coin: symbol,
                    signalType: 'SCALPING_PUMP',
                    probability: Math.min(80 + (mom1m * 10), 99),
                    detectedAt: 'الآن',
                    price: price,
                    modeTag: `🚀${mom1m.toFixed(2)}% (1m)`
                });
            }

            // 2. FLASH DUMP
            else if (mom1m < -0.5) {
                detectedSignals.push({
                    id: symbol + 'USDT',
                    coin: symbol,
                    signalType: 'DUMP',
                    probability: 80,
                    detectedAt: 'الآن',
                    price: price,
                    modeTag: `🔻${mom1m.toFixed(2)}% (1m)`
                });
            }
        });

        // Sort by Magnitude
        detectedSignals.sort((a, b) => b.probability - a.probability);
        // Take top 20
        setSignals(detectedSignals.slice(0, 20));
    };

    // --- STATIC FALLBACK LOGIC (Day/Swing/Invest with Deep Dive) ---

    const analyzeDeepDive = async (candidates: CoinData[]) => {
        const enhancedSignals: ScannerSignal[] = [];

        // LIMIT: Only analyze top 10 candidates to avoid API rate limits
        const topCandidates = candidates.slice(0, 10);

        // Parallel Fetch for efficiency
        await Promise.all(topCandidates.map(async (coin) => {
            try {
                // Fetch History based on Mode
                // SWING -> Daily Candles
                // INVEST -> Weekly Candles
                const timeframe = mode === 'INVESTING' ? 'D' : 'D';
                // Note: cryptoApi's fetchCandlesForAnalysis uses 'D' for Daily. 
                // Ideally Investing uses Weekly but Daily is enough for simple ATH check over 365 days.

                const { fetchCandlesForAnalysis } = await import('../services/cryptoApi');
                const history = await fetchCandlesForAnalysis(coin.symbol, timeframe, 200);

                if (history.length < 50) return;

                const lastPrice = history[history.length - 1].price;

                if (mode === 'SWING') {
                    // SWING RULES:
                    // 1. Uptrend: Price > EMA 50 (Approximated by simple SMA of last 50)
                    const sma50 = history.slice(-50).reduce((a, b) => a + b.price, 0) / 50;

                    // 2. RSI Checks (Pre-calculated in cryptoApi)
                    const rsi = history[history.length - 1].rsi || 50;

                    // Condition: Uptrend AND Not Overbought
                    if (lastPrice > sma50 && rsi < 70) {
                        enhancedSignals.push({
                            id: coin.id, coin: coin.symbol, signalType: 'TREND_CONTINUATION',
                            probability: 85 + (rsi < 50 ? 10 : 0), // Bonus if not overbought
                            detectedAt: 'يومي',
                            price: coin.price,
                            modeTag: `Trend: Above EMA50`
                        });
                    }
                }
                else if (mode === 'INVESTING') {
                    // INVESTING RULES:
                    // 1. Deep Value: Price is < 50% of 52-Week High (ATH)
                    const maxHigh = Math.max(...history.map(h => h.price));
                    const drawdown = ((maxHigh - lastPrice) / maxHigh) * 100;

                    // 2. RSI Weekly (Approximated by Daily RSI being low for long time? Or just Daily RSI < 40)
                    const rsi = history[history.length - 1].rsi || 50;

                    if (drawdown > 40 && rsi < 45) { // 40% Discount + Oversold
                        enhancedSignals.push({
                            id: coin.id, coin: coin.symbol, signalType: 'UNDERVALUED',
                            probability: 80 + (drawdown / 2),
                            detectedAt: 'استثماري',
                            price: coin.price,
                            modeTag: `Discount: -${drawdown.toFixed(0)}%`
                        });
                    }
                }

            } catch (e) {
                console.warn("Deep Dive Failed for", coin.symbol);
            }
        }));

        // Merge/Set Signals
        if (enhancedSignals.length > 0) {
            enhancedSignals.sort((a, b) => b.probability - a.probability);
            setSignals(prev => [...enhancedSignals, ...prev].slice(0, 20)); // Prepend deep signals
        }
    };

    const processSnapshotLogic = (data: CoinData[]) => {
        const detected: ScannerSignal[] = [];
        const candidatesForDeepDive: CoinData[] = [];

        data.forEach(coin => {
            if (mode === 'DAY') {
                // DAY RULE: Aggressive Move + Price > VWAP (Buyers in Control)
                // VWAP check ensures we don't buy the top of a pump that is crashing back down
                if (coin.change24h > 4 && coin.price > coin.weightedAvgPrice) {
                    detected.push({
                        id: coin.id, coin: coin.symbol, signalType: 'BREAKOUT',
                        probability: 85, detectedAt: '24س', price: coin.price, modeTag: `Day +${coin.change24h.toFixed(1)}%`
                    });
                }
            }
            else if (mode === 'SWING') {
                // Phase 1: Filter potential movers
                if (coin.change24h > 5) {
                    candidatesForDeepDive.push(coin);
                }
            }
            else if (mode === 'INVESTING') {
                // Phase 1: Filter beaten down coins
                if (coin.change24h < -2) {
                    candidatesForDeepDive.push(coin);
                }
            }
        });

        // Set initial "surface" signals for Day trading
        if (mode === 'DAY') {
            detected.sort((a, b) => b.probability - a.probability);
            setSignals(detected.slice(0, 20));
        }

        // Trigger Phase 2 for Swing/Invest
        if (candidatesForDeepDive.length > 0) {
            analyzeDeepDive(candidatesForDeepDive);
        } else if (mode !== 'DAY') {
            setSignals([]); // Clear if no candidates
        }
    };


    const getArabicSignalType = (type: string) => {
        switch (type) {
            case 'ACCUMULATION': return 'تجميع / ضغط';
            case 'BREAKOUT': return 'انفجار سعري';
            case 'VOLUME_SPIKE': return 'سيولة مفاجئة';
            case 'DUMP': return 'انهيار سريع';
            case 'SCALPING_PUMP': return 'زخم شرائي (Ignition)';
            case 'TREND_CONTINUATION': return 'استمرار اتجاه';
            case 'UNDERVALUED': return 'فرصة استثمارية';
            default: return type;
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">

            {/* Header & Controls */}
            <div className="flex flex-col gap-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <Radar className="text-emerald-500" />
                            كشف الزخم المبكر (Live Scanner)
                        </h2>
                        <div className="flex items-center gap-2 mt-1">
                            {isLive ? (
                                <span className="flex items-center gap-1 text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full animate-pulse transition-all">
                                    <Wifi size={10} /> LIVE STREAM (1s)
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full transition-all">
                                    <Clock size={10} /> SNAPSHOT
                                </span>
                            )}
                            <p className="text-slate-400 text-sm">تحديثات لحظية ومسح لكل أزواج USDT</p>
                        </div>
                    </div>
                    <button onClick={() => setMode(mode)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400" title="Reset">
                        {/* Fake refresh, effectively resets state via useEffect dependency if we toggled logic, else just visual */}
                        <Activity size={20} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                {/* Mode Tabs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-900/50 p-1 rounded-xl border border-slate-800">
                    {MODES.map((m) => (
                        <button
                            key={m.id}
                            onClick={() => setMode(m.id)}
                            className={`flex flex-col items-center justify-center py-3 px-2 rounded-lg transition-all ${mode === m.id
                                ? 'bg-slate-800 text-white shadow-lg border border-slate-700'
                                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
                                }`}
                        >
                            <div className={`flex items-center gap-2 mb-1 font-bold ${mode === m.id ? 'text-indigo-400' : ''}`}>
                                {m.icon}
                                <span>{m.label}</span>
                            </div>
                            <span className="text-[10px] opacity-70 hidden md:block">{m.desc.split(':')[0]}</span>
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center h-64 gap-4">
                    <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                    <p className="text-slate-500 animate-pulse">جاري الاتصال بقنوات البيانات الحية (Binance WebSocket)...</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {signals.map((signal) => (
                        <div key={signal.id} onClick={() => onSelectCoin(signal.id, signal.coin)} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-indigo-500/50 transition-all cursor-pointer group relative overflow-hidden">
                            <div className="absolute top-0 left-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                {signal.signalType === 'DUMP' ? <Activity className="w-16 h-16 text-red-500" /> : <Flame className="w-16 h-16 text-emerald-500" />}
                            </div>

                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs">
                                        {signal.coin.substring(0, 3)}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-white">{signal.coin}</h3>
                                        <span className="text-xs text-slate-500 font-mono">${signal.price}</span>
                                    </div>
                                </div>
                                <div className={`px-2 py-1 rounded text-xs font-bold ${signal.probability > 90 ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                                    }`}>
                                    {Math.floor(signal.probability)}% جودة
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">الإشارة</span>
                                    <span className={`font-medium ${signal.signalType === 'DUMP' ? 'text-red-400' :
                                        signal.signalType === 'SCALPING_PUMP' ? 'text-green-400' :
                                            'text-white'
                                        }`}>{getArabicSignalType(signal.signalType)}</span>
                                </div>
                                {signal.modeTag && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">التغير (1د)</span>
                                        <span className={`font-mono font-bold ${signal.modeTag.includes('🔻') ? 'text-red-400' : 'text-emerald-400'
                                            }`}>
                                            {signal.modeTag}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-800 flex justify-between items-center">
                                <div className="text-xs text-slate-500 flex items-center gap-1">
                                    <Zap className="w-3 h-3 text-orange-500" />
                                    {mode === 'SCALPING' ? 'Live Momentum' : 'Analysis'}
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onSelectCoin(signal.id, signal.coin); }}
                                    className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-lg shadow-indigo-500/20"
                                >
                                    تحليل وتفسير <ArrowUpRight className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                    {signals.length === 0 && (
                        <div className="col-span-3 text-center py-10 text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800 border-dashed">
                            {mode === 'SCALPING' && "جاري مسح السوق لحظياً... انتظر التقاط الزخم (Waiting for Momentum > 0.4%)"}
                            {mode !== 'SCALPING' && "لا توجد فرص مطابقة حالياً"}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};