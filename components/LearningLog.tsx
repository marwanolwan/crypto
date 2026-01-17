import React, { useEffect, useState } from 'react';
import { SavedPrediction } from '../types';
import { getMarketData } from '../services/cryptoApi';
import { analyzeTradeOutcome } from '../services/geminiService';
import { getLearningStats } from '../services/LearningService';
import { Trophy, XCircle, Clock, Trash2, RefreshCw, AlertCircle, Sparkles, Filter, Brain, AlertTriangle, CheckSquare, XSquare } from 'lucide-react';
import { formatCurrency, formatNumber } from '../utils/numberUtils';

export const LearningLog: React.FC = () => {
    const [predictions, setPredictions] = useState<SavedPrediction[]>([]);
    const [loading, setLoading] = useState(false);
    const [analyzingId, setAnalyzingId] = useState<string | null>(null);
    const [stats, setStats] = useState({ winRate: 0, totalWins: 0, total: 0 });
    const [learningStats, setLearningStats] = useState<any>(null);
    const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'WIN' | 'LOSS'>('ALL');
    const [selectedFailure, setSelectedFailure] = useState<string | null>(null);

    useEffect(() => {
        loadPredictions();
    }, []);

    const loadPredictions = () => {
        const saved = localStorage.getItem('crypto_predictions');
        if (saved) {
            const parsed = JSON.parse(saved);
            setPredictions(parsed);
            calculateStats(parsed);
            setLearningStats(getLearningStats());
        }
    };

    const calculateStats = (data: SavedPrediction[]) => {
        const completed = data.filter(p => p.status !== 'PENDING');
        const wins = completed.filter(p => p.status === 'WIN').length;
        setStats({
            total: data.length,
            totalWins: wins,
            winRate: completed.length > 0 ? Math.round((wins / completed.length) * 100) : 0
        });
    };

    const checkPredictions = async () => {
        setLoading(true);
        try {
            // Import functionality dynamically if needed, or rely on top-level imports
            const { fetchCandlesForAnalysis } = await import('../services/cryptoApi');

            const updatedPredictions = await Promise.all(predictions.map(async (pred) => {
                // If not PENDING, leave as is
                if (pred.status !== 'PENDING') return pred;

                // Skip processing for NEUTRAL predictions (Observation only)
                if (pred.predictionType === 'NEUTRAL') return pred;

                // 1. Fetch Historical Klines from entry date (or slightly before) to NOW
                // Use 1H candles for general verification (Good balance of speed/accuracy)
                // For Scalping (24h), maybe use 15m candles
                const interval = (pred.timeframeLabel === '24س' || pred.timeframeLabel?.includes('Scalping')) ? '15m' : '1h';
                const startTime = pred.date;
                const endTime = Math.min(Date.now(), pred.expiryDate || Date.now() + 86400000 * 7);

                // Fetch candles covering the entire duration of the trade so far
                // We fetch up to 1000 candles which covers plenty of hours/days
                const klines = await fetchCandlesForAnalysis(pred.coinSymbol, interval, 1000);

                if (!klines || klines.length === 0) return pred;

                // Filter klines strictly WITHIN the duration (Start -> Expiry)
                // This ensures we don't count a win if it happens AFTER the expected timeframe.
                const expiry = pred.expiryDate || (pred.date + 7 * 24 * 60 * 60 * 1000); // Default 7 days if missing
                const relevantKlines = klines.filter(k => {
                    const t = new Date(k.time).getTime();
                    return t >= startTime && t <= expiry;
                });

                if (relevantKlines.length === 0) return pred;

                let status: 'PENDING' | 'WIN' | 'LOSS' = 'PENDING';
                let finalPrice = pred.entryPrice;

                // Simulate Trade Path
                for (const candle of relevantKlines) {
                    finalPrice = candle.price; // Update "current" price as we march forward

                    if (pred.predictionType === 'BULLISH') {
                        // Check if hit TARGET first? High >= Target
                        // Check if hit STOP first? Low <= Stop
                        // In a single candle, assume worst case if both hit? (Standard conservative backtest)
                        // If High > Target AND Low < Stop in same candle, it's ambiguous. 
                        // But usually we assume Stop hit first if Open is closer to Stop.
                        // Simplified: Check High >= Target -> WIN
                        if (candle.high >= pred.targetPrice) {
                            status = 'WIN';
                            finalPrice = pred.targetPrice;
                            break;
                        }
                        if (candle.low <= pred.stopLoss) {
                            status = 'LOSS';
                            finalPrice = pred.stopLoss;
                            break;
                        }
                    } else {
                        // BEARISH
                        if (candle.low <= pred.targetPrice) {
                            status = 'WIN';
                            finalPrice = pred.targetPrice;
                            break;
                        }
                        if (candle.high >= pred.stopLoss) {
                            status = 'LOSS';
                            finalPrice = pred.stopLoss;
                            break;
                        }
                    }
                }

                // Expiry Check: If still PENDING coverage ended (meaning we checked all candles up to expiry)
                // If the current time is PAST expiry, and we haven't won yet, it's a TIMEOUT/LOSS.
                if (status === 'PENDING' && Date.now() > expiry) {
                    status = 'LOSS';
                    // Implicit Failure Reason: Target not reached within timeframe
                }

                return {
                    ...pred,
                    status,
                    finalPrice,
                    // If we just closed it, updated _marketTrend for AI context
                    _marketTrend: (relevantKlines[relevantKlines.length - 1].price - relevantKlines[0].price) / relevantKlines[0].price * 100
                };
            }));

            setPredictions(updatedPredictions);
            localStorage.setItem('crypto_predictions', JSON.stringify(updatedPredictions));
            calculateStats(updatedPredictions);
            setLearningStats(getLearningStats()); // Update patterns
        } catch (e) {
            console.error("Failed to check predictions", e);
        } finally {
            setLoading(false);
        }
    };

    const manualUpdateStatus = (id: string, newStatus: 'WIN' | 'LOSS' | 'PENDING') => {
        const updated = predictions.map(p =>
            p.id === id ? { ...p, status: newStatus, finalPrice: p.finalPrice || p.entryPrice } : p
        );
        setPredictions(updated);
        localStorage.setItem('crypto_predictions', JSON.stringify(updated));
        calculateStats(updated);
        setLearningStats(getLearningStats());
    };

    const analyzeFailure = async (pred: SavedPrediction & { _marketTrend?: number }) => {
        setAnalyzingId(pred.id);
        try {
            const exitPrice = pred.finalPrice || pred.stopLoss;
            const trend = pred._marketTrend || 0;

            const reason = await analyzeTradeOutcome(
                pred.coinSymbol,
                pred.predictionType,
                pred.entryPrice,
                pred.stopLoss,
                exitPrice,
                trend
            );

            const updated = predictions.map(p =>
                p.id === pred.id ? { ...p, failureReason: reason } : p
            );

            setPredictions(updated);
            localStorage.setItem('crypto_predictions', JSON.stringify(updated));

            // Re-fetch learning stats to include new failure reason
            setTimeout(() => setLearningStats(getLearningStats()), 100);

        } finally {
            setAnalyzingId(null);
        }
    };

    const deletePrediction = (id: string) => {
        const filtered = predictions.filter(p => p.id !== id);
        setPredictions(filtered);
        localStorage.setItem('crypto_predictions', JSON.stringify(filtered));
        calculateStats(filtered);
        setLearningStats(getLearningStats());
    };

    const filteredPredictions = predictions.filter(p => {
        if (filter === 'ALL') return true;
        return p.status === filter;
    });

    return (
        <div className="space-y-8 animate-in fade-in duration-500">

            {/* Failure Detail Modal */}
            {selectedFailure && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedFailure(null)}>
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl animate-in zoom-in-50 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <Brain className="text-red-500" />
                                تقرير تشخيص الفشل (Failure Diagnosis)
                            </h3>
                            <button onClick={() => setSelectedFailure(null)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
                                <XCircle size={20} />
                            </button>
                        </div>
                        <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800/50 mb-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            <p className="text-slate-300 leading-relaxed whitespace-pre-wrap text-base font-medium">
                                {selectedFailure}
                            </p>
                        </div>
                        <div className="flex justify-end">
                            <button onClick={() => setSelectedFailure(null)} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold transition-colors">
                                إغلاق
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 1. System Health & Learning Dashboard */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Brain className="text-indigo-400" />
                    نظام التعلم الذاتي والتصحيح (AI Self-Correction)
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Summary Stats */}
                    <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800 flex flex-col items-center justify-center text-center">
                        <div className="text-slate-400 text-xs uppercase mb-1">الدروس المستفادة</div>
                        <div className="text-3xl font-black text-indigo-400">{learningStats?.totalLosses || 0}</div>
                        <div className="text-[10px] text-slate-500">أنماط الفشل المسجلة</div>
                    </div>

                    {/* Common Failure Patterns */}
                    <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="bg-red-950/20 p-3 rounded-lg border border-red-500/10">
                            <div className="text-red-300 text-xs font-bold mb-1 flex items-center gap-1">
                                <AlertTriangle size={12} /> تشبع شرائي (RSI &gt; 70)
                            </div>
                            <div className="text-2xl font-bold text-white">{learningStats?.highRsiFailures || 0}</div>
                            <div className="text-[10px] text-slate-500">صفقات شراء فشلت بسبب القمم</div>
                        </div>

                        <div className="bg-orange-950/20 p-3 rounded-lg border border-orange-500/10">
                            <div className="text-orange-300 text-xs font-bold mb-1 flex items-center gap-1">
                                <AlertTriangle size={12} /> انخفاض السيولة
                            </div>
                            <div className="text-2xl font-bold text-white">{learningStats?.lowVolFailures || 0}</div>
                            <div className="text-[10px] text-slate-500">فشل بسبب ضعف الزخم (Fakeout)</div>
                        </div>

                        <div className="bg-yellow-950/20 p-3 rounded-lg border border-yellow-500/10">
                            <div className="text-yellow-300 text-xs font-bold mb-1 flex items-center gap-1">
                                <AlertTriangle size={12} /> دايفرجنس مخادع
                            </div>
                            <div className="text-2xl font-bold text-white">{learningStats?.divergenceFailures || 0}</div>
                            <div className="text-[10px] text-slate-500">إشارات انعكاس لم تكتمل</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. Main Log Section */}
            <div className="space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-end gap-4">
                    <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                        <button onClick={() => setFilter('ALL')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${filter === 'ALL' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>الكل</button>
                        <button onClick={() => setFilter('PENDING')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${filter === 'PENDING' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>جارية</button>
                        <button onClick={() => setFilter('WIN')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${filter === 'WIN' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-green-400'}`}>ناجحة</button>
                        <button onClick={() => setFilter('LOSS')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${filter === 'LOSS' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-red-400'}`}>فاشلة</button>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="text-left hidden md:block">
                            <span className="text-xs text-slate-500 block">نسبة الفوز الحالية</span>
                            <span className={`text-xl font-mono font-bold ${stats.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>{stats.winRate}%</span>
                        </div>
                        <button
                            onClick={checkPredictions}
                            disabled={loading}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-bold transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                            <span>تحديث الأسعار</span>
                        </button>
                    </div>
                </div>

                {/* Table View for Density */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-right">
                            <thead className="bg-slate-950 text-slate-400 text-xs uppercase font-medium">
                                <tr>
                                    <th className="px-6 py-4">العملة / التاريخ</th>
                                    <th className="px-6 py-4">نوع التوقع</th>
                                    <th className="px-6 py-4">الدخول</th>
                                    <th className="px-6 py-4">الهدف / الوقف</th>
                                    <th className="px-6 py-4">النتيجة</th>
                                    <th className="px-6 py-4">الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800 text-sm">
                                {filteredPredictions.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                            لا توجد بيانات مطابقة للفلتر المحدد.
                                        </td>
                                    </tr>
                                )}
                                {filteredPredictions.map((pred) => (
                                    <tr key={pred.id} className="hover:bg-slate-800/50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-white text-base">{pred.coinSymbol}</div>
                                            <div className="text-slate-500 text-xs">{new Date(pred.date).toLocaleDateString()}</div>
                                            {pred.timeframeLabel && (
                                                <div className="text-[10px] text-indigo-400 mt-1 flex items-center gap-1">
                                                    <Clock size={10} /> {pred.timeframeLabel}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded text-xs font-bold ${pred.predictionType === 'BULLISH' ? 'bg-green-500/10 text-green-400' :
                                                pred.predictionType === 'BEARISH' ? 'bg-red-500/10 text-red-400' :
                                                    'bg-slate-500/10 text-slate-400'
                                                }`}>
                                                {pred.predictionType === 'BULLISH' ? 'LONG 🔼' :
                                                    pred.predictionType === 'BEARISH' ? 'SHORT 🔽' : 'NEUTRAL ➖'}
                                            </span>
                                            <div className="mt-1">
                                                {pred.confidence && (
                                                    <div className="w-16 bg-slate-800 h-1 rounded-full overflow-hidden">
                                                        <div className={`h-full ${pred.confidence > 80 ? 'bg-green-500' : 'bg-yellow-500'}`} style={{ width: `${pred.confidence}%` }}></div>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-mono text-slate-300">
                                            {formatCurrency(pred.entryPrice)}
                                        </td>
                                        <td className="px-6 py-4 font-mono">
                                            {pred.predictionType === 'NEUTRAL' ? (
                                                <>
                                                    <div className="text-orange-400 flex items-center gap-1"><span className="text-slate-500 text-[10px]">مقاومة:</span> {formatNumber(pred.targetPrice)}</div>
                                                    <div className="text-blue-400 flex items-center gap-1"><span className="text-slate-500 text-[10px]">دعم:</span> {formatNumber(pred.stopLoss)}</div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="text-green-400 flex items-center gap-1"><span className="text-slate-600 text-[10px]">TP:</span> {formatNumber(pred.targetPrice)}</div>
                                                    <div className="text-red-400 flex items-center gap-1"><span className="text-slate-600 text-[10px]">SL:</span> {formatNumber(pred.stopLoss)}</div>
                                                </>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${pred.status === 'WIN' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                                pred.status === 'LOSS' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                                    'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                                }`}>
                                                {pred.status === 'WIN' && <CheckSquare size={12} />}
                                                {pred.status === 'LOSS' && <XSquare size={12} />}
                                                {pred.status === 'PENDING' && <Clock size={12} />}
                                                {pred.status === 'WIN' ? 'نجحت' : pred.status === 'LOSS' ? 'خسارة' : 'جارية'}
                                            </div>
                                            {/* Failure Reason Quick View */}
                                            {pred.status === 'LOSS' && pred.failureReason && (
                                                <button
                                                    onClick={() => setSelectedFailure(pred.failureReason || '')}
                                                    className="mt-2 text-[10px] text-red-300 hover:text-red-100 underline decoration-dashed flex items-center gap-1 transition-colors cursor-pointer"
                                                >
                                                    <AlertCircle size={10} />
                                                    عرض تقرير الفشل
                                                </button>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                {/* Analysis Button */}
                                                {pred.status === 'LOSS' && !pred.failureReason && (
                                                    <button
                                                        onClick={() => analyzeFailure(pred)}
                                                        disabled={analyzingId === pred.id}
                                                        className="p-2 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 rounded-lg border border-indigo-500/20"
                                                        title="تحليل سبب الفشل AI"
                                                    >
                                                        {analyzingId === pred.id ? <RefreshCw className="animate-spin" size={16} /> : <Sparkles size={16} />}
                                                    </button>
                                                )}

                                                {/* Manual Actions Dropdown (Simplified as buttons for now) */}
                                                {pred.status === 'PENDING' && (
                                                    <>
                                                        <button onClick={() => manualUpdateStatus(pred.id, 'WIN')} className="p-2 hover:bg-green-500/20 text-slate-500 hover:text-green-400 rounded-lg" title="تحديد كفوز يدوي"><CheckSquare size={16} /></button>
                                                        <button onClick={() => manualUpdateStatus(pred.id, 'LOSS')} className="p-2 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded-lg" title="تحديد كخسارة يدوية"><XSquare size={16} /></button>
                                                    </>
                                                )}

                                                <button
                                                    onClick={() => deletePrediction(pred.id)}
                                                    className="p-2 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-lg transition-colors"
                                                    title="حذف"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};