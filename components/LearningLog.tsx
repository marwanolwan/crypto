import React, { useEffect, useState } from 'react';
import { SavedPrediction } from '../types';
import { getMarketData } from '../services/cryptoApi';
import { analyzeTradeOutcome } from '../services/geminiService';
import { Trophy, XCircle, Clock, Trash2, RefreshCw, AlertCircle, Sparkles, HelpCircle } from 'lucide-react';

export const LearningLog: React.FC = () => {
  const [predictions, setPredictions] = useState<SavedPrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [stats, setStats] = useState({ winRate: 0, totalWins: 0, total: 0 });

  useEffect(() => {
    loadPredictions();
  }, []);

  const loadPredictions = () => {
    const saved = localStorage.getItem('crypto_predictions');
    if (saved) {
      const parsed = JSON.parse(saved);
      setPredictions(parsed);
      calculateStats(parsed);
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
        const marketData = await getMarketData(100); // Fetch enough depth
        const priceMap = new Map(marketData.map(c => [c.symbol.toUpperCase(), c.price]));

        // We also need market trend to pass to AI if needed, simplified here
        const changeMap = new Map(marketData.map(c => [c.symbol.toUpperCase(), c.change24h]));

        const updatedPredictions = predictions.map(pred => {
            // Only update PENDING trades
            if (pred.status !== 'PENDING') return pred;

            const currentPrice = priceMap.get(pred.coinSymbol);
            if (!currentPrice) return pred;

            let newStatus: 'PENDING' | 'WIN' | 'LOSS' = 'PENDING';
            
            if (pred.predictionType === 'BULLISH') {
                if (currentPrice >= pred.targetPrice) newStatus = 'WIN';
                else if (currentPrice <= pred.stopLoss) newStatus = 'LOSS';
            } else if (pred.predictionType === 'BEARISH') {
                if (currentPrice <= pred.targetPrice) newStatus = 'WIN';
                else if (currentPrice >= pred.stopLoss) newStatus = 'LOSS';
            }

            return { 
                ...pred, 
                status: newStatus, 
                finalPrice: currentPrice,
                // Store market context for future AI analysis
                _marketTrend: changeMap.get(pred.coinSymbol) || 0 
            };
        });

        // Save immediately to persist changes
        setPredictions(updatedPredictions);
        localStorage.setItem('crypto_predictions', JSON.stringify(updatedPredictions));
        calculateStats(updatedPredictions);
    } catch (e) {
        console.error("Failed to check predictions", e);
    } finally {
        setLoading(false);
    }
  };

  const analyzeFailure = async (pred: SavedPrediction & { _marketTrend?: number }) => {
      setAnalyzingId(pred.id);
      try {
          // If we don't have final price stored, assume current or stop loss
          const exitPrice = pred.finalPrice || pred.stopLoss;
          const trend = pred._marketTrend || 0; // Fallback

          const reason = await analyzeTradeOutcome(
              pred.coinSymbol,
              pred.predictionType,
              pred.entryPrice,
              pred.stopLoss,
              exitPrice,
              trend
          );

          // Update prediction with reason
          const updated = predictions.map(p => 
              p.id === pred.id ? { ...p, failureReason: reason } : p
          );
          
          setPredictions(updated);
          localStorage.setItem('crypto_predictions', JSON.stringify(updated));
      } finally {
          setAnalyzingId(null);
      }
  };

  const deletePrediction = (id: string) => {
      const filtered = predictions.filter(p => p.id !== id);
      setPredictions(filtered);
      localStorage.setItem('crypto_predictions', JSON.stringify(filtered));
      calculateStats(filtered);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
       <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Trophy className="text-yellow-500" />
                    سجل الأداء (Paper Trading)
                </h2>
                <p className="text-slate-400 text-sm mt-1">تتبع دقة تحليلات الذكاء الاصطناعي وقم بقياس نسبة النجاح.</p>
            </div>
            
            <div className="flex items-center gap-4 bg-slate-900 p-2 rounded-xl border border-slate-800">
                 <div className="text-center px-4 border-l border-slate-800 last:border-0">
                     <div className="text-xs text-slate-500 uppercase">نسبة الفوز</div>
                     <div className={`text-xl font-black ${
                         stats.winRate >= 60 ? 'text-green-400' : stats.winRate >= 40 ? 'text-yellow-400' : 'text-red-400'
                     }`}>{stats.winRate}%</div>
                 </div>
                 <div className="text-center px-4">
                     <div className="text-xs text-slate-500 uppercase">الصفقات</div>
                     <div className="text-xl font-bold text-white">{stats.total}</div>
                 </div>
                 <button 
                    onClick={checkPredictions} 
                    disabled={loading}
                    className="p-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white transition-colors disabled:opacity-50 shadow-lg shadow-indigo-500/20"
                    title="تحديث الأسعار وفحص النتائج"
                 >
                     <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
                 </button>
            </div>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
           {predictions.length === 0 && (
               <div className="col-span-3 text-center py-20 bg-slate-900/50 rounded-xl border border-slate-800 border-dashed">
                   <p className="text-slate-500">لا توجد توقعات محفوظة. قم بحفظ تحليل جديد من صفحة "تحليل عميق".</p>
               </div>
           )}

           {predictions.map((pred) => (
               <div key={pred.id} className={`relative overflow-hidden rounded-xl border p-5 transition-all ${
                   pred.status === 'WIN' ? 'bg-green-950/10 border-green-500/30' : 
                   pred.status === 'LOSS' ? 'bg-red-950/10 border-red-500/30' : 
                   'bg-slate-900 border-slate-800'
               }`}>
                   <div className="flex justify-between items-start mb-4">
                       <div>
                           <div className="flex items-center gap-2">
                               <h3 className="font-bold text-white text-lg">{pred.coinSymbol}</h3>
                               <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                   pred.predictionType === 'BULLISH' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                               }`}>
                                   {pred.predictionType === 'BULLISH' ? 'LONG' : 'SHORT'}
                               </span>
                           </div>
                           <span className="text-xs text-slate-500">{new Date(pred.date).toLocaleDateString()}</span>
                       </div>
                       <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${
                           pred.status === 'WIN' ? 'bg-green-500 text-slate-950' : 
                           pred.status === 'LOSS' ? 'bg-red-500 text-white' : 
                           'bg-slate-800 text-slate-400'
                       }`}>
                           {pred.status === 'WIN' && <Trophy size={12} />}
                           {pred.status === 'LOSS' && <XCircle size={12} />}
                           {pred.status === 'PENDING' && <Clock size={12} />}
                           {pred.status === 'WIN' ? 'نجحت' : pred.status === 'LOSS' ? 'فشلت' : 'جارية'}
                       </div>
                   </div>

                   <div className="space-y-2 text-sm mb-4">
                       <div className="flex justify-between">
                           <span className="text-slate-500">الدخول</span>
                           <span className="font-mono text-slate-300">${pred.entryPrice.toLocaleString()}</span>
                       </div>
                       <div className="flex justify-between">
                           <span className="text-slate-500">الهدف</span>
                           <span className="font-mono text-green-400">${pred.targetPrice.toLocaleString()}</span>
                       </div>
                       <div className="flex justify-between">
                           <span className="text-slate-500">الوقف</span>
                           <span className="font-mono text-red-400">${pred.stopLoss.toLocaleString()}</span>
                       </div>
                       {pred.finalPrice && pred.status !== 'PENDING' && (
                            <div className="flex justify-between pt-2 border-t border-slate-800/50">
                                <span className="text-slate-400">سعر الإغلاق</span>
                                <span className={`font-mono font-bold ${pred.status === 'WIN' ? 'text-green-400' : 'text-red-400'}`}>
                                    ${pred.finalPrice.toLocaleString()}
                                </span>
                            </div>
                       )}
                   </div>

                    {/* AI Failure Analysis Section */}
                    {pred.status === 'LOSS' && (
                        <div className="mb-4">
                            {pred.failureReason ? (
                                <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                        <AlertCircle size={12} className="text-red-400" />
                                        <span className="text-[10px] text-red-300 font-bold">تشخيص الذكاء الاصطناعي</span>
                                    </div>
                                    <p className="text-xs text-slate-300 leading-relaxed">{pred.failureReason}</p>
                                </div>
                            ) : (
                                <button 
                                    onClick={() => analyzeFailure(pred)}
                                    disabled={analyzingId === pred.id}
                                    className="w-full py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors border border-slate-700"
                                >
                                    {analyzingId === pred.id ? <RefreshCw className="animate-spin" size={14} /> : <Sparkles size={14} className="text-yellow-400" />}
                                    <span>لماذا فشلت هذه الصفقة؟ (تحليل AI)</span>
                                </button>
                            )}
                        </div>
                    )}

                    {pred.confidence && pred.status === 'PENDING' && (
                         <div className="w-full bg-slate-800 h-1.5 rounded-full mb-4 overflow-hidden">
                             <div className="bg-indigo-500 h-full" style={{width: `${pred.confidence}%`}}></div>
                         </div>
                    )}

                   <div className="flex justify-end pt-2 border-t border-slate-800/50">
                       <button 
                           onClick={() => deletePrediction(pred.id)}
                           className="text-slate-500 hover:text-red-400 transition-colors p-2 hover:bg-red-500/10 rounded-lg"
                           title="حذف من السجل"
                       >
                           <Trash2 size={16} />
                       </button>
                   </div>
               </div>
           ))}
       </div>
    </div>
  );
};