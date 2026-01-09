import React, { useState, useEffect, useCallback } from 'react';
import { AnalysisResult, ChartPoint, NewsItem, SavedPrediction } from '../types';
import { analyzeCoinWithGemini } from '../services/geminiService';
import { getCoinHistory, calculateRSI, getCryptoNews, analyzeMarketStructure, calculateCorrelation, detectRSIDivergence, calculateFibonacciLevels, calculateATR, calculateStochRSI, calculateADX, detectWhaleMovements, calculateTechnicalScore, calculateVolumeProfile, getMultiTimeframeConfluence, calculateAnchoredVWAP, getOrderBookAnalysis } from '../services/cryptoApi';

import { runBacktest, BacktestResult, runWalkForwardAnalysis, WalkForwardResult } from '../services/BacktestService';

import { MarketChart } from './MarketChart';
import { Brain, ShieldAlert, Target, RefreshCw, AlertTriangle, Waves, Activity, Zap, CheckCircle2, Newspaper, Megaphone, TrendingUp, ArrowDownRight, ArrowUpRight, Scale, Wallet, Save, Calculator, Divide, Printer, FileBarChart, GitCommit, CloudLightning, Loader2, AlertCircle, History, X } from 'lucide-react';

interface AnalysisViewProps {
    coin: { id: string, symbol: string };
}

const TIMEFRAMES = [
    { label: '24س', value: '1', desc: 'مضاربة (Scalping)' },
    { label: '7أيام', value: '7', desc: 'تداول يومي (Intraday)' },
    { label: '30يوم', value: '30', desc: 'تداول متأرجح (Swing)' },
    { label: '90يوم', value: '90', desc: 'استثمار (Trend)' },
];

export const AnalysisView: React.FC<AnalysisViewProps> = ({ coin }) => {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<AnalysisResult | null>(null);
    const [chartData, setChartData] = useState<ChartPoint[]>([]);
    const [techData, setTechData] = useState<any>(null);
    const [news, setNews] = useState<NewsItem[]>([]);
    const [selectedTimeframe, setSelectedTimeframe] = useState('7');
    const [saved, setSaved] = useState(false);
    const [btcData, setBtcData] = useState<{ correlation: number, trend: string } | null>(null);
    const [providerName, setProviderName] = useState('AI Engine');

    // Risk Calculator State
    const [portfolioSize, setPortfolioSize] = useState<number>(1000);
    const [riskPercentage, setRiskPercentage] = useState<number>(1);
    const [positionSize, setPositionSize] = useState<number>(0);

    // Backtest State
    const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
    const [wfResult, setWfResult] = useState<WalkForwardResult | null>(null);
    const [showBacktest, setShowBacktest] = useState(false);


    useEffect(() => {
        const p = localStorage.getItem('ai_provider');
        setProviderName(p === 'google' ? 'Google Gemini' : 'Alibaba Qwen');
    }, [loading]); // Update when loading starts

    const fetchLatestData = useCallback(async () => {
        try {
            // Fetch Target Coin AND Bitcoin Data for correlation
            // Pass both coin.id and coin.symbol to getCoinHistory to support both Binance and CoinGecko
            const [{ points, volumes, highs, lows }, btcHistory, newsData, multiTf, orderBook] = await Promise.all([
                getCoinHistory(coin.id, coin.symbol, selectedTimeframe),
                getCoinHistory('bitcoin', 'BTC', selectedTimeframe), // Always fetch BTC context
                getCryptoNews(coin.symbol),
                getMultiTimeframeConfluence(coin.symbol, selectedTimeframe),
                getOrderBookAnalysis(coin.symbol)
            ]);


            if (points.length > 0) {
                setChartData(points);
                setNews(newsData);

                // Calculate basic technicals from real data
                const prices = points.map(p => p.price);
                const currentPrice = prices[prices.length - 1];

                // RSI & Divergence
                const rsiArray = points.map(p => p.rsi); // Assume getCoinHistory calculates array
                const rsi = calculateRSI(prices); // Fallback calc (returns number | null)
                const divergence = detectRSIDivergence(prices, rsiArray);

                // NEW: Institutional Indicators
                const atr = calculateATR(highs, lows, prices);
                const stochRsi = calculateStochRSI(prices);
                const adx = calculateADX(highs, lows, prices);

                const lastVolume = volumes[volumes.length - 1];

                // Calculate Avg Vol (last 20 points)
                const relevantVolumes = volumes.slice(-20);
                const avgVolume = relevantVolumes.reduce((a, b) => a + b, 0) / relevantVolumes.length;
                const volumeSpike = lastVolume > (avgVolume * 1.5);

                // NEW: Algorithmic Market Structure
                const structure = analyzeMarketStructure(prices);

                // NEW: Volume Profile (POC)
                const volProfile = calculateVolumeProfile(prices, volumes);

                // NEW: Fibonacci Levels
                const fibs = calculateFibonacciLevels(prices);

                // NEW: Anchored VWAP
                const vwap = calculateAnchoredVWAP(points, 0);


                // NEW: Institutional Correlation
                let correlation = 0;
                let btcTrend = 'NEUTRAL';
                if (btcHistory.points.length > 0) {
                    const btcPrices = btcHistory.points.map(p => p.price);
                    correlation = calculateCorrelation(prices, btcPrices);

                    // Determine BTC Trend
                    const btcStart = btcPrices[0];
                    const btcEnd = btcPrices[btcPrices.length - 1];
                    btcTrend = btcEnd > btcStart ? 'BULLISH' : 'BEARISH';
                }
                setBtcData({ correlation, trend: btcTrend });

                // Extract last calculated MACD/BB values from points
                const lastPoint = points[points.length - 1];

                // NEW: Detect Whale Activity (Proxy)
                // We approximate market cap change based on price change since volume is available
                const priceChangeApprox = ((currentPrice - points[0].price) / points[0].price) * 100;
                // Since we don't have Market Cap in history, we approximate Turnover using avg Volume
                const whaleMetrics = detectWhaleMovements(
                    currentPrice,
                    priceChangeApprox,
                    lastVolume,
                    avgVolume * 100, // Rough proxy for market cap if unknown, or rely on turnover calc inside
                    points
                );

                // NEW: Calculate Technical Score Deterministically
                const technicalScore = calculateTechnicalScore(prices, rsi, adx, stochRsi, structure.trend, divergence);

                const data = {
                    currentPrice,
                    rsi,
                    divergence,
                    atr, // Pass ATR
                    stochRsi, // Pass StochRSI
                    adx, // Pass ADX
                    technicalScore, // Pass Pre-calculated Score
                    volProfile,
                    avgVolume,
                    lastVolume,
                    volumeSpike,
                    timeframeUsed: selectedTimeframe,
                    structure,
                    fibs,
                    btcCorrelation: correlation,
                    btcTrend: btcTrend,
                    whaleMetrics, // Pass computed whale metrics
                    macd: {
                        line: lastPoint.macdLine,
                        signal: lastPoint.signalLine,
                        histogram: lastPoint.histogram
                    },
                    bb: {
                        upper: lastPoint.upperBand,
                        lower: lastPoint.lowerBand
                    },
                    // Pass significant history (last 50 points) to AI for Pattern Recognition (Order Blocks, etc)
                    history: points.slice(-50),
                    news: newsData,
                    multiTf,
                    orderBook,
                    vwap: vwap.slice(-10) // Only pass last 10 points to context to save tokens
                };

                setTechData(data);
                return data;
            } else {
                // Explicitly set null to trigger empty state
                setTechData(null);
                setChartData([]);
                return null;
            }
        } catch (e) {
            console.error("Error loading history", e);
            setTechData(null);
            setChartData([]);
            return null;
        }
    }, [coin.id, coin.symbol, selectedTimeframe]);

    useEffect(() => {
        setResult(null);
        setSaved(false);
        setLoading(true);
        fetchLatestData().finally(() => setLoading(false));
    }, [fetchLatestData]);

    // Recalculate Position Size when result or inputs change
    useEffect(() => {
        if (result && portfolioSize > 0 && riskPercentage > 0) {
            const entry = result.price;
            const stop = result.stopLoss;
            const riskAmount = portfolioSize * (riskPercentage / 100);
            const distance = Math.abs(entry - stop);

            if (distance > 0) {
                // Position Size (Units) = Risk / Distance per unit
                const units = riskAmount / distance;
                // Position Size ($) = Units * Entry
                setPositionSize(units * entry);
            } else {
                setPositionSize(0);
            }
        }
    }, [result, portfolioSize, riskPercentage]);

    const handleRunAnalysis = async () => {
        setLoading(true);
        setSaved(false);
        try {
            // 1. Refresh Data to ensure analysis is on LIVE market conditions
            const freshData = await fetchLatestData();

            // 2. Trigger AI Analysis with fresh data
            if (freshData) {
                const analysis = await analyzeCoinWithGemini(coin.symbol, freshData);

                // Override Whale Activity with our Calculated Hard Data if AI hallucinates
                if (freshData.whaleMetrics && freshData.whaleMetrics.whaleAlert !== "لا يوجد نشاط غير طبيعي") {
                    analysis.whaleActivity = {
                        netFlow: freshData.whaleMetrics.netFlowStatus,
                        largeTransactions: Math.round(freshData.whaleMetrics.volumeAnomalyFactor * 10),
                        sentiment: freshData.whaleMetrics.netFlowStatus,
                        alert: freshData.whaleMetrics.whaleAlert
                    };
                }

                setResult(analysis);
            }
        } finally {
            setLoading(false);
        }
    };

    const savePrediction = () => {
        if (!result) return;

        const newPrediction: SavedPrediction = {
            id: Date.now().toString(),
            coinSymbol: coin.symbol,
            entryPrice: result.price,
            targetPrice: result.targetPrice,
            stopLoss: result.stopLoss,
            predictionType: result.prediction === 'BULLISH' ? 'BULLISH' : 'BEARISH',
            date: Date.now(),
            status: 'PENDING',
            confidence: result.confidenceScore
        };

        const existing = localStorage.getItem('crypto_predictions');
        const list = existing ? JSON.parse(existing) : [];
        list.unshift(newPrediction);
        localStorage.setItem('crypto_predictions', JSON.stringify(list));
        setSaved(true);
    };



    const handleBacktest = () => {
        if (chartData.length < 50) return;
        // Determine strategy based on trend
        const strategy = techData?.structure?.trend === 'RANGING' ? 'MEAN_REVERSION' : 'TREND_FOLLOWING';

        // Run Standard Backtest
        const result = runBacktest(strategy, chartData);
        setBacktestResult(result);

        // Run Walk-Forward Analysis (Phase 3)
        // Ensure enough data: Need at least 250 candles for 1 loop (200 train + 50 test)
        if (chartData.length > 250) {
            const wf = runWalkForwardAnalysis(strategy, chartData, 200, 50);
            setWfResult(wf);
        } else {
            setWfResult(null);
        }

        setShowBacktest(true);
    };


    const handlePrint = (e: React.MouseEvent) => {
        e.preventDefault();
        window.print();
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-500 print:block print:p-0">

            {/* Left Column: Chart & Controls */}
            <div className="lg:col-span-2 space-y-6 print:w-full">
                <div className="space-y-4 print:hidden">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                            تحليل {coin.symbol}
                            <span className="text-sm px-3 py-1 bg-slate-800 rounded-full text-slate-400 font-normal">
                                {TIMEFRAMES.find(t => t.value === selectedTimeframe)?.desc}
                            </span>
                        </h2>

                        <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
                            {TIMEFRAMES.map((tf) => (
                                <button
                                    key={tf.value}
                                    onClick={() => setSelectedTimeframe(tf.value)}
                                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${selectedTimeframe === tf.value
                                        ? 'bg-indigo-600 text-white shadow-lg'
                                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                        }`}
                                >
                                    {tf.label}
                                </button>
                            ))}
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleRunAnalysis}
                                disabled={loading || !techData}
                                className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-white transition-all ${loading || !techData
                                    ? 'bg-slate-700 cursor-not-allowed'
                                    : providerName.includes('Google')
                                        ? 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20'
                                        : 'bg-orange-600 hover:bg-orange-500 shadow-lg shadow-orange-500/20'
                                    }`}
                            >
                                {loading ? <RefreshCw className="animate-spin" /> : <CloudLightning />}
                                {loading ? 'جاري المعالجة...' : `${providerName}`}
                            </button>
                            {result && (
                                <>
                                    {result.prediction !== 'NEUTRAL' && (
                                        <button
                                            onClick={savePrediction}
                                            disabled={saved}
                                            className={`flex items-center gap-2 px-4 py-3 rounded-lg font-bold border transition-all ${saved
                                                ? 'bg-green-500/20 border-green-500/50 text-green-400'
                                                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                                                }`}
                                        >
                                            {saved ? <CheckCircle2 /> : <Save />}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handlePrint}
                                        className="flex items-center gap-2 px-4 py-3 rounded-lg font-bold border bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                                        title="طباعة تقرير احترافي"
                                    >
                                        <Printer size={20} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Progress Bar Animation */}
                    {loading && (
                        <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800/50">
                            <div className={`h-full animate-pulse w-full rounded-full ${providerName.includes('Google')
                                ? 'bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-600 shadow-[0_0_10px_rgba(59,130,246,0.5)]'
                                : 'bg-gradient-to-r from-orange-600 via-yellow-500 to-orange-600 shadow-[0_0_10px_rgba(234,88,12,0.3)]'
                                }`}></div>
                        </div>
                    )}
                </div>

                {/* Print Header */}
                <div className="hidden print:flex justify-between items-center mb-6 border-b border-slate-300 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center text-white font-bold">A</div>
                        <h1 className="text-2xl font-bold text-black">تقرير تحليل {providerName}</h1>
                    </div>
                    <div className="text-right">
                        <div className="text-lg font-bold text-black">{coin.symbol} / USD</div>
                        <div className="text-sm text-slate-600">{new Date().toLocaleDateString()}</div>
                    </div>
                </div>

                <div className="print:break-inside-avoid">
                    {chartData.length > 0 ? (
                        <MarketChart
                            data={chartData}
                            targetPrice={result?.targetPrice}
                            stopLoss={result?.stopLoss}
                            prediction={result?.prediction}
                            supports={techData?.structure?.supports}
                            resistances={techData?.structure?.resistances}
                            fibs={techData?.fibs}
                        />
                    ) : (
                        <div className="w-full h-[400px] bg-slate-900/50 rounded-xl border border-slate-800 flex flex-col items-center justify-center text-slate-500 gap-3">
                            {loading ? (
                                <>
                                    <RefreshCw className="animate-spin text-indigo-500" size={32} />
                                    <span className="animate-pulse">جاري تحميل الرسم البياني...</span>
                                </>
                            ) : (
                                <>
                                    <AlertCircle className="text-slate-600" size={48} />
                                    <span>لا تتوفر بيانات للرسم البياني</span>
                                    <span className="text-xs text-slate-600">تأكد من اختيار مزود البيانات الصحيح أو جرب عملة أخرى.</span>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Macro Context Card (Visible only if BTC data exists) */}
                {btcData && (
                    <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 flex items-center justify-between print:border-slate-300 print:bg-white print:text-black">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
                                <FileBarChart size={20} />
                            </div>
                            <div>
                                <h4 className="text-sm font-bold text-white print:text-black">السياق العام (Macro)</h4>
                                <p className="text-xs text-slate-400 print:text-slate-600">ارتباط مع Bitcoin (Correlation)</p>
                            </div>
                        </div>
                        <div className="text-left">
                            <div className={`text-lg font-bold font-mono ${btcData.correlation > 0.7 ? 'text-yellow-400 print:text-black' : 'text-slate-200 print:text-black'
                                }`}>
                                {btcData.correlation.toFixed(2)}
                            </div>
                            <div className="text-xs text-slate-500 print:text-slate-600">
                                {btcData.trend === 'BULLISH' ? 'Bitcoin صاعد 🔼' : 'Bitcoin هابط 🔽'}
                            </div>
                        </div>
                    </div>
                )}

                {/* Textual Analysis Box */}
                {result && (
                    <div className="space-y-4 print:space-y-6">
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden print:bg-white print:border-slate-300 print:text-black">
                            <div className="absolute top-0 left-0 p-6 opacity-5 print:hidden">
                                <Brain className="w-32 h-32" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-4 print:text-black">منطق {providerName} الذكي</h3>
                            <div className="prose prose-invert max-w-none text-slate-300 text-lg leading-relaxed text-justify print:text-black">
                                {result.reasoning}
                            </div>
                            <div className="mt-6 pt-4 border-t border-slate-800 print:border-slate-300 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <h4 className="text-sm text-slate-500 font-bold uppercase mb-2 flex items-center gap-2 print:text-slate-700">
                                        <Target size={14} /> عوامل التأكيد (Confluence)
                                    </h4>
                                    <ul className="space-y-2">
                                        {result.keyFactors.map((factor, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-slate-300 print:text-black">
                                                <CheckCircle2 size={16} className="text-green-500 mt-0.5 shrink-0 print:text-green-700" />
                                                {factor}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <div>
                                    <h4 className="text-sm text-slate-500 font-bold uppercase mb-2 print:text-slate-700">السيناريو البديل</h4>
                                    <p className="text-sm text-slate-400 bg-slate-950/50 p-3 rounded-lg border border-slate-800 print:bg-slate-100 print:border-slate-200 print:text-black">
                                        {result.scenario}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* News Impact Analysis */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden print:break-inside-avoid print:bg-white print:border-slate-300 print:text-black">
                            <h3 className="text-slate-400 text-xs font-bold uppercase mb-4 flex items-center gap-2 print:text-slate-700">
                                <Newspaper size={14} /> محرك الأخبار الاستباقي (Predictive Impact)
                            </h3>

                            <div className="flex flex-col md:flex-row gap-6">
                                <div className="flex-1 space-y-3">
                                    {news.slice(0, 3).map((item) => {
                                        const isFlagged = result.newsAnalysis.flaggedTitles?.some(t => item.title.includes(t) || t.includes(item.title));
                                        return (
                                            <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className={`block p-3 rounded-lg border transition-colors group print:border-slate-300 print:bg-slate-50 ${isFlagged
                                                ? 'bg-orange-950/30 border-orange-500/50 hover:bg-orange-900/30 print:bg-orange-50 print:border-orange-200'
                                                : 'bg-slate-950/50 border-slate-800 hover:bg-slate-950 print:bg-white'
                                                }`}>
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex items-start gap-2">
                                                        {isFlagged && (
                                                            <AlertTriangle size={16} className="text-orange-500 shrink-0 mt-0.5 print:text-orange-700" />
                                                        )}
                                                        <p className={`text-sm font-medium transition-colors line-clamp-2 print:text-black ${isFlagged ? 'text-orange-200 print:text-orange-700' : 'text-slate-300 group-hover:text-indigo-400'
                                                            }`}>
                                                            {item.title}
                                                        </p>
                                                    </div>
                                                    <ArrowUpRight size={16} className="text-slate-500 shrink-0" />
                                                </div>
                                                <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500 print:text-slate-600">
                                                    <span>{item.source}</span>
                                                    <span>•</span>
                                                    <span>{new Date(item.published_on * 1000).toLocaleTimeString()}</span>
                                                </div>
                                            </a>
                                        )
                                    })}
                                    {news.length === 0 && <p className="text-slate-500 text-sm">لا توجد أخبار حديثة مهمة.</p>}
                                </div>

                                <div className="md:w-1/2 bg-indigo-950/20 rounded-lg p-4 border border-indigo-500/20 flex flex-col justify-between print:bg-indigo-50 print:border-indigo-200 print:text-black">
                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-xs text-indigo-300 font-bold print:text-indigo-700">تحليل التأثير</span>
                                            <span className={`px-2 py-1 rounded text-xs font-bold ${result.newsAnalysis.impact === 'POSITIVE' ? 'bg-green-500/20 text-green-400 print:text-green-700 print:bg-green-100' :
                                                result.newsAnalysis.impact === 'NEGATIVE' ? 'bg-red-500/20 text-red-400 print:text-red-700 print:bg-red-100' :
                                                    'bg-slate-700/50 text-slate-300 print:text-slate-700 print:bg-slate-200'
                                                }`}>
                                                {result.newsAnalysis.impact === 'POSITIVE' ? 'إيجابي' :
                                                    result.newsAnalysis.impact === 'NEGATIVE' ? 'سلبي' : 'محايد'}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-300 mb-4 leading-relaxed print:text-black">
                                            {result.newsAnalysis.summary}
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div className={`p-2 rounded border text-center print:border-slate-300 print:text-black ${result.newsAnalysis.pricedIn ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400 print:text-yellow-700' : 'bg-slate-800 border-slate-700 text-slate-500'
                                                }`}>
                                                {result.newsAnalysis.pricedIn ? '⚠️ تم التسعير (Priced In)' : 'تأثير جديد (Fresh)'}
                                            </div>
                                            <div className={`p-2 rounded border text-center print:border-slate-300 print:text-black ${result.newsAnalysis.manipulationRisk ? 'bg-red-500/10 border-red-500/20 text-red-400 print:text-red-700' : 'bg-slate-800 border-slate-700 text-green-500 print:text-green-700'
                                                }`}>
                                                {result.newsAnalysis.manipulationRisk ? '⚠️ احتمال تلاعب' : 'حركة عضوية'}
                                            </div>
                                        </div>

                                        <div className={`p-3 rounded-lg border text-xs flex items-center justify-between print:border-slate-300 print:bg-white print:text-black ${result.newsAnalysis.marketReaction === 'DIVERGENT' ? 'bg-orange-500/10 border-orange-500/20 text-orange-300' :
                                            result.newsAnalysis.marketReaction === 'IGNORED' ? 'bg-slate-700/50 border-slate-600 text-slate-400' :
                                                'bg-green-500/10 border-green-500/20 text-green-300'
                                            }`}>
                                            <div className="flex items-center gap-2">
                                                <Scale size={14} />
                                                <span className="font-bold">استجابة السوق:</span>
                                            </div>
                                            <span className="font-bold">
                                                {result.newsAnalysis.marketReaction === 'ALIGNED' && 'متوافق (Aligned) ✅'}
                                                {result.newsAnalysis.marketReaction === 'DIVERGENT' && 'تناقض (Divergence) ⚠️'}
                                                {result.newsAnalysis.marketReaction === 'IGNORED' && 'تجاهل (Ignored) ➖'}
                                                {!result.newsAnalysis.marketReaction && 'غير محدد'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Smart Money Insights Card */}
                        {result.smartMoneyInsights && result.smartMoneyInsights.length > 0 && (
                            <div className="bg-gradient-to-r from-slate-900 to-indigo-950/20 border border-indigo-500/20 rounded-xl p-6 relative print:break-inside-avoid print:bg-white print:border-indigo-200">
                                <h3 className="text-indigo-400 text-sm font-bold uppercase mb-4 flex items-center gap-2 print:text-indigo-700">
                                    <Zap size={16} className="text-yellow-400 print:text-yellow-600" />
                                    رؤى الأموال الذكية (Smart Money Concepts)
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {result.smartMoneyInsights.map((insight, i) => (
                                        <div key={i} className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/50 text-sm text-slate-200 flex items-center gap-3 print:bg-slate-50 print:border-slate-300 print:text-black">
                                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></span>
                                            {insight}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Right Column: Signal & Metrics */}
            <div className="space-y-6 print:w-full print:mt-6">

                {/* Signal Card */}
                <div className={`rounded-xl p-6 border-2 flex flex-col items-center justify-center text-center relative overflow-hidden min-h-[14rem] print:bg-white print:border-slate-300 ${!result ? 'bg-slate-900 border-slate-800' :
                    result.prediction === 'BULLISH' ? 'bg-green-950/30 border-green-500/50' :
                        result.prediction === 'BEARISH' ? 'bg-red-950/30 border-red-500/50' :
                            'bg-slate-800 border-slate-700'
                    }`}>
                    {!result ? (
                        <div className="text-slate-500 px-4">
                            {loading ? (
                                <div className="flex flex-col items-center gap-2">
                                    <Loader2 className="animate-spin text-indigo-500" />
                                    <span className="animate-pulse">جاري جلب البيانات وتحليلها...</span>
                                </div>
                            ) : techData ? (
                                <div className="flex flex-col items-center gap-2">
                                    <CheckCircle2 className="text-green-500" size={32} />
                                    <span className="text-white font-bold">البيانات جاهزة!</span>
                                    <span className="text-xs text-slate-400">اضغط على زر التحليل في الأعلى للبدء.</span>
                                </div>
                            ) : (
                                <div className="text-red-400 flex flex-col items-center gap-2 animate-in fade-in zoom-in">
                                    <AlertCircle size={32} />
                                    <span className="font-bold">لا تتوفر بيانات كافية</span>
                                    <span className="text-xs text-slate-500 max-w-[200px]">لم يتم العثور على تاريخ سعري لهذه العملة في المصدر المحدد. حاول تغيير المصدر في الإعدادات.</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-2 print:text-slate-700">الإشارة</h3>
                            <div className={`text-4xl font-black mb-4 ${result.prediction === 'BULLISH' ? 'text-green-400 print:text-green-700' :
                                result.prediction === 'BEARISH' ? 'text-red-400 print:text-red-700' : 'text-slate-200 print:text-black'
                                }`}>
                                {result.prediction === 'BULLISH' ? 'صعود' : result.prediction === 'BEARISH' ? 'هبوط' : 'محايد'}
                            </div>

                            {/* Enhanced Confirmation Score Display */}
                            <div className="w-full flex flex-col items-center">
                                <div className={`text-3xl font-black mb-1 ${result.confidenceScore >= 90 ? 'text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.5)] print:text-green-700' :
                                    result.confidenceScore >= 80 ? 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)] print:text-yellow-700' :
                                        'text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.5)] print:text-red-700'
                                    }`}>
                                    {result.confidenceScore}
                                    <span className="text-lg font-bold text-slate-500 ml-1 opacity-60">/100</span>
                                </div>
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-2 print:text-slate-600">نقاط التأكيد</span>

                                <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden border border-slate-800/50 print:bg-slate-200 print:border-slate-300">
                                    <div
                                        className={`h-full transition-all duration-1000 ${result.confidenceScore >= 90 ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' :
                                            result.confidenceScore >= 80 ? 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]' :
                                                'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                                            }`}
                                        style={{ width: `${result.confidenceScore}%` }}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* RSI Divergence Alert */}
                {techData?.divergence?.type && techData?.divergence?.type !== 'NONE' && (
                    <div className={`rounded-xl p-4 border flex items-center gap-3 animate-pulse ${techData.divergence.type === 'BULLISH' ? 'bg-green-950/20 border-green-500/30' : 'bg-red-950/20 border-red-500/30'
                        }`}>
                        <GitCommit className={techData.divergence.type === 'BULLISH' ? 'text-green-500' : 'text-red-500'} />
                        <div>
                            <h4 className={`font-bold text-sm ${techData.divergence.type === 'BULLISH' ? 'text-green-400' : 'text-red-400'
                                }`}>
                                كشف انعكاس قوي (Divergence)
                            </h4>
                            <p className="text-xs text-slate-400">
                                {techData.divergence.type === 'BULLISH'
                                    ? 'السعر يحقق قاع أدنى بينما المؤشر يحقق قاع أعلى (إشارة صعود).'
                                    : 'السعر يحقق قمة أعلى بينما المؤشر يحقق قمة أدنى (إشارة هبوط).'}
                            </p>
                        </div>
                    </div>
                )}

                {/* Institutional Metrics Grid */}
                {techData && (
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-center print:bg-white print:border-slate-300">
                            <div className="text-[10px] text-slate-500 uppercase font-bold print:text-black">Trend (ADX)</div>
                            <div className={`text-lg font-mono font-bold ${(techData.adx || 0) > 25 ? 'text-green-400 print:text-green-700' : 'text-slate-400 print:text-black'
                                }`}>
                                {techData.adx !== null ? techData.adx.toFixed(1) : "N/A"}
                            </div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-center print:bg-white print:border-slate-300">
                            <div className="text-[10px] text-slate-500 uppercase font-bold print:text-black">Stoch RSI</div>
                            <div className={`text-lg font-mono font-bold ${!techData.stochRsi ? 'text-slate-400' :
                                techData.stochRsi.k < 20 ? 'text-green-400 print:text-green-700' :
                                    techData.stochRsi.k > 80 ? 'text-red-400 print:text-red-700' : 'text-slate-400 print:text-black'
                                }`}>
                                {techData.stochRsi ? Math.round(techData.stochRsi.k) : "N/A"}
                            </div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-center print:bg-white print:border-slate-300">
                            <div className="text-[10px] text-slate-500 uppercase font-bold print:text-black">Volatility</div>
                            <div className="text-lg font-mono font-bold text-indigo-400 print:text-indigo-700">
                                {techData.atr !== null ? techData.atr.toFixed(2) : "N/A"}
                            </div>
                        </div>
                    </div>
                )}

                {result && (
                    <>
                        {/* Position Size Calculator (Risk Management) - HIDDEN ON PRINT */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 print:hidden">
                            <h3 className="text-slate-400 text-xs font-bold uppercase mb-4 flex items-center gap-2">
                                <Calculator size={14} /> حاسبة إدارة المخاطر (Position Size)
                            </h3>
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] text-slate-500 block mb-1">رصيد المحفظة ($)</label>
                                        <input
                                            type="number"
                                            value={portfolioSize}
                                            onChange={(e) => setPortfolioSize(Number(e.target.value))}
                                            className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 block mb-1">المخاطرة (%)</label>
                                        <input
                                            type="number"
                                            value={riskPercentage}
                                            onChange={(e) => setRiskPercentage(Number(e.target.value))}
                                            className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                </div>

                                <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/50">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-slate-400">قيمة الدخول المقترحة</span>
                                        <span className="text-indigo-400 font-bold font-mono text-lg">${Math.floor(positionSize).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px] text-slate-500">
                                        <span>مبلغ المخاطرة (الخسارة القصوى):</span>
                                        <span className="text-red-400 font-bold">${(portfolioSize * (riskPercentage / 100)).toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 print:border-slate-300 print:bg-white print:break-inside-avoid">
                            <h3 className="text-slate-400 text-xs font-bold uppercase mb-4 flex items-center gap-2 print:text-slate-700">
                                <ShieldAlert size={14} /> تقييم المخاطر
                            </h3>
                            <div className="flex items-center gap-3">
                                <div className={`p-3 rounded-full ${result.riskLevel === 'HIGH' ? 'bg-red-500/20 text-red-500' :
                                    result.riskLevel === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-500' :
                                        'bg-green-500/20 text-green-500'
                                    }`}>
                                    <AlertTriangle size={24} />
                                </div>
                                <div>
                                    <div className="font-bold text-white print:text-black">
                                        {result.riskLevel === 'HIGH' ? 'مخاطرة عالية' : result.riskLevel === 'MEDIUM' ? 'مخاطرة متوسطة' : 'مخاطرة منخفضة'}
                                    </div>
                                    <p className="text-xs text-slate-400 print:text-slate-600">
                                        {result.riskLevel === 'HIGH' ? 'التقلبات عالية، يفضل الانتظار أو تقليل حجم العقد.' :
                                            result.riskLevel === 'MEDIUM' ? 'السوق متقلب، التزم بوقف الخسارة بدقة.' :
                                                'الظروف مواتية للدخول الآمن.'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-slate-900 to-indigo-900/20 border border-slate-800 rounded-xl p-6 relative overflow-hidden print:bg-white print:border-slate-300 print:break-inside-avoid">
                            <div className="absolute top-0 left-0 p-4 opacity-10">
                                <Waves className="w-16 h-16 text-indigo-400" />
                            </div>
                            <h3 className="text-indigo-400 text-xs font-bold uppercase mb-4 flex items-center gap-2 relative z-10 print:text-indigo-700">
                                <Waves size={14} /> سلوك الحيتان (On-Chain Proxy)
                            </h3>
                            <div className="space-y-4 relative z-10">

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/50 relative overflow-hidden group print:bg-slate-50 print:border-slate-300">
                                        <span className="text-slate-500 text-[10px] block mb-1">صافي التدفق (Net Flow)</span>
                                        <span className={`font-mono text-sm font-bold relative z-10 ${techData.whaleMetrics?.netFlowStatus === 'ACCUMULATION' ? 'text-green-400 print:text-green-700' :
                                            techData.whaleMetrics?.netFlowStatus === 'DISTRIBUTION' ? 'text-red-400 print:text-red-700' : 'text-slate-300 print:text-black'
                                            }`}>
                                            {techData.whaleMetrics?.netFlowStatus || result.whaleActivity?.netFlow}
                                        </span>
                                        {/* Background indicator for flow */}
                                        <div className={`absolute bottom-0 left-0 h-1 transition-all duration-1000 print:hidden ${techData.whaleMetrics?.netFlowStatus === 'ACCUMULATION' ? 'w-full bg-green-500' :
                                            techData.whaleMetrics?.netFlowStatus === 'DISTRIBUTION' ? 'w-full bg-red-500' : 'w-1/2 bg-slate-500'
                                            }`}></div>
                                    </div>

                                    <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/50 print:bg-slate-50 print:border-slate-300">
                                        <span className="text-slate-500 text-[10px] block mb-1">دوران السيولة (Turnover)</span>
                                        <div className="flex items-center gap-2">
                                            <span className={`font-mono text-sm font-bold print:text-black ${techData.whaleMetrics?.turnoverRatio > 10 ? 'text-yellow-400' : 'text-white'
                                                }`}>
                                                {techData.whaleMetrics?.turnoverRatio?.toFixed(1) ?? 0}%
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {techData.whaleMetrics?.whaleAlert && techData.whaleMetrics.whaleAlert !== "لا يوجد نشاط غير طبيعي" && (
                                    <div className="mt-2 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg flex items-start gap-2 print:bg-indigo-50 print:border-indigo-200">
                                        <Megaphone size={16} className="text-indigo-400 mt-0.5 shrink-0 print:text-indigo-700" />
                                        <div className="space-y-1">
                                            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider print:text-indigo-700">كاشف التحركات الكبرى</span>
                                            <p className="text-xs text-slate-300 leading-relaxed print:text-black">
                                                {techData.whaleMetrics.whaleAlert}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {/* Institutional Metrics Grid (Phase 4) */}
                {techData && (
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mt-6 print:break-inside-avoid print:bg-white print:border-slate-300">
                        <h3 className="text-slate-400 text-xs font-bold uppercase mb-4 flex items-center gap-2 print:text-black">
                            <Activity size={14} /> بيانات المؤسسات (Verified Engines)
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800/50 print:bg-slate-50 print:border-slate-200">
                                <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Order Book Imbalance</div>
                                <div className={`text-lg font-mono font-bold ${techData.orderBook?.imbalanceRatio > 1.2 ? 'text-green-400' : techData.orderBook?.imbalanceRatio < 0.8 ? 'text-red-400' : 'text-slate-200'} print:text-black`}>
                                    {techData.orderBook?.imbalanceRatio?.toFixed(2) || "N/A"}
                                </div>
                                <div className="text-[10px] text-slate-500">{techData.orderBook?.marketPressure}</div>
                            </div>
                            <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800/50 print:bg-slate-50 print:border-slate-200">
                                <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Anchored VWAP</div>
                                <div className="text-lg font-mono font-bold text-indigo-400 print:text-indigo-700">
                                    {techData.vwap && techData.vwap.length > 0 ? techData.vwap[techData.vwap.length - 1].toFixed(2) : "N/A"}
                                </div>
                            </div>
                            <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800/50 print:bg-slate-50 print:border-slate-200">
                                <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Trend Confluence</div>
                                <div className={`text-lg font-mono font-bold ${techData.multiTf?.trendStructure?.trend === 'UPTREND' ? 'text-green-400' : techData.multiTf?.trendStructure?.trend === 'DOWNTREND' ? 'text-red-400' : 'text-slate-200'} print:text-black`}>
                                    {techData.multiTf?.trendStructure?.trend || "N/A"}
                                </div>
                                <div className="text-[10px] text-slate-500">Higher Timeframe</div>
                            </div>
                            <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800/50 print:bg-slate-50 print:border-slate-200">
                                <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Volatility (ATR)</div>
                                <div className="text-lg font-mono font-bold text-slate-200 print:text-black">
                                    {techData.atr?.toFixed(2) || "N/A"}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Backtest & Walk-Forward Result Modal/Section */}
                {showBacktest && backtestResult && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm print:hidden">
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold text-white">نتائج الاختبار (Backtest & Validation)</h3>
                                <button onClick={() => setShowBacktest(false)} className="text-slate-400 hover:text-white"><X size={24} /></button>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-6">
                                <div className="p-4 bg-slate-950 rounded-lg border border-slate-800">
                                    <div className="text-slate-400 text-xs uppercase mb-1">Win Rate</div>
                                    <div className="text-2xl font-bold text-green-400">{backtestResult.winRate.toFixed(1)}%</div>
                                </div>
                                <div className="p-4 bg-slate-950 rounded-lg border border-slate-800">
                                    <div className="text-slate-400 text-xs uppercase mb-1">Profit Factor</div>
                                    <div className="text-2xl font-bold text-indigo-400">{backtestResult.profitFactor.toFixed(2)}</div>
                                </div>
                            </div>

                            {wfResult && (
                                <div className="mb-6 p-4 bg-indigo-950/20 rounded-lg border border-indigo-500/30">
                                    <h4 className="text-indigo-400 font-bold mb-3 flex items-center gap-2">
                                        <ShieldAlert size={16} /> Walk-Forward Analysis (Phase 3)
                                    </h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <div className="text-slate-400 text-xs uppercase mb-1">Stability Score</div>
                                            <div className={`text-xl font-bold ${wfResult.overallStability > 70 ? 'text-green-400' : 'text-yellow-400'}`}>
                                                {wfResult.overallStability.toFixed(1)}/100
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-slate-400 text-xs uppercase mb-1">Avg Test Win Rate</div>
                                            <div className="text-xl font-bold text-white">
                                                {wfResult.averageWinRate.toFixed(1)}%
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-2">
                                        * Stability &gt; 70 implies the strategy is robust and not overfitted to past past data.
                                    </p>
                                </div>
                            )}

                            <div className="space-y-2">
                                <h4 className="text-white font-bold text-sm">Trade Log (Last 5)</h4>
                                {backtestResult.trades.slice(-5).reverse().map((t, i) => (
                                    <div key={i} className="flex justify-between items-center p-2 bg-slate-950/50 rounded border border-slate-800/50 text-xs">
                                        <span className={t.type === 'LONG' ? 'text-green-500' : 'text-red-500'}>{t.type}</span>
                                        <span className="text-slate-300">{t.entryPrice.toFixed(2)} ➜ {t.exitPrice.toFixed(2)}</span>
                                        <span className={t.pnl > 0 ? 'text-green-400' : 'text-red-400'}>{t.pnlPercent.toFixed(2)}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>

    );
};