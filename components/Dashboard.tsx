import React, { useEffect, useState, useRef } from 'react';
import { CoinData } from '../types';
import { getMarketData, subscribeToTicker } from '../services/cryptoApi';
import { TrendingUp, TrendingDown, DollarSign, BarChart3, RefreshCw, Star, Filter, Wifi } from 'lucide-react';
import { formatCurrency, formatNumber as formatDecimal } from '../utils/numberUtils';

interface DashboardProps {
    onSelectCoin: (coinId: string, symbol: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onSelectCoin }) => {
    const [coins, setCoins] = useState<CoinData[]>([]);
    const [loading, setLoading] = useState(true);
    const [isLive, setIsLive] = useState(false);
    const [globalStats, setGlobalStats] = useState({
        marketCap: 0,
        vol24h: 0,
        btcDominance: 0
    });

    // Watchlist State
    const [favorites, setFavorites] = useState<string[]>(() => {
        const saved = localStorage.getItem('crypto_favorites');
        return saved ? JSON.parse(saved) : [];
    });
    const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

    // Initial Fetch
    const fetchData = async () => {
        if (!isLive) setLoading(true); // Only show loading spinner on initial load, not live updates
        const data = await getMarketData(50); // Fetch top 50 for dashboard
        setCoins(data);
        updateGlobalStats(data);
        setLoading(false);
    };

    const updateGlobalStats = (data: CoinData[]) => {
        if (data.length > 0) {
            const totalCap = data.reduce((acc, coin) => acc + coin.marketCap, 0);
            const totalVol = data.reduce((acc, coin) => acc + coin.volume, 0);

            let btcDom = 0;
            if (totalCap > 0) {
                btcDom = (data[0].marketCap / totalCap) * 100;
            } else {
                btcDom = (data[0].volume / totalVol) * 100;
            }

            setGlobalStats({
                marketCap: totalCap,
                vol24h: totalVol,
                btcDominance: btcDom
            });
        }
    };

    useEffect(() => {
        fetchData();

        // WebSocket Subscription
        const unsubscribe = subscribeToTicker((tickerData: any[]) => {
            if (!tickerData || !Array.isArray(tickerData)) return;

            setIsLive(true);
            setCoins(prevCoins => {
                const updated = [...prevCoins];
                let hasChanges = false;

                tickerData.forEach(t => {
                    const symbol = t.s.replace('USDT', '');
                    const coinIndex = updated.findIndex(c => c.symbol === symbol);

                    if (coinIndex !== -1) {
                        const coin = updated[coinIndex];
                        // Update live fields
                        coin.price = parseFloat(t.c);
                        coin.change24h = parseFloat(t.P);
                        coin.volume = parseFloat(t.q); // Quote Volume in USDT
                        coin.high24h = parseFloat(t.h);
                        coin.low24h = parseFloat(t.l);
                        hasChanges = true;
                    }
                });

                if (hasChanges) updateGlobalStats(updated);
                return hasChanges ? updated : prevCoins;
            });
        });

        return () => {
            unsubscribe();
            setIsLive(false);
        };
    }, []);

    const toggleFavorite = (e: React.MouseEvent, coinId: string) => {
        e.stopPropagation();
        const newFavorites = favorites.includes(coinId)
            ? favorites.filter(id => id !== coinId)
            : [...favorites, coinId];

        setFavorites(newFavorites);
        localStorage.setItem('crypto_favorites', JSON.stringify(newFavorites));
    };

    const filteredCoins = showFavoritesOnly
        ? coins.filter(coin => favorites.includes(coin.id))
        : coins;

    const formatLargeNumber = (num: number) => {
        if (!num) return 'N/A';
        if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
        if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
        if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
        return `$${num.toLocaleString()}`;
    };

    if (loading && coins.length === 0) {
        return (
            <div className="flex items-center justify-center h-96">
                <RefreshCw className="animate-spin text-indigo-500 w-8 h-8" />
                <span className="mr-3 text-slate-400">جاري جلب بيانات السوق...</span>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">

            {/* Market Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl relative overflow-hidden">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400"><BarChart3 size={18} /></div>
                        <h3 className="text-slate-400 text-sm font-medium">نظام السوق</h3>
                    </div>
                    <p className="text-xl font-bold text-white">
                        {coins.length > 0 && coins[0].change24h > 0 ? 'اتجاه صاعد' : coins.length > 0 ? 'تذبذب / هبوط' : '--'}
                    </p>
                    <span className={`text-xs ${coins.length > 0 && coins[0].change24h > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        Bitcoin {coins.length > 0 ? formatDecimal(coins[0].change24h) : 0}%
                    </span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400"><DollarSign size={18} /></div>
                        <h3 className="text-slate-400 text-sm font-medium">السيولة (Top 50)</h3>
                    </div>
                    <p className="text-xl font-bold text-white">{formatLargeNumber(globalStats.vol24h)}</p>
                    <span className="text-xs text-slate-500">حجم التداول 24س</span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400"><DollarSign size={18} /></div>
                        <h3 className="text-slate-400 text-sm font-medium">القيمة السوقية</h3>
                    </div>
                    <p className="text-xl font-bold text-white">{globalStats.marketCap > 0 ? formatLargeNumber(globalStats.marketCap) : 'بيانات محدودة'}</p>
                    <span className="text-xs text-green-400">إجمالي Top 50</span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-orange-500/20 rounded-lg text-orange-400"><TrendingUp size={18} /></div>
                        <h3 className="text-slate-400 text-sm font-medium">هيمنة البيتكوين</h3>
                    </div>
                    <p className="text-xl font-bold text-white">{formatDecimal(globalStats.btcDominance)}%</p>
                    <span className="text-xs text-orange-400">{globalStats.marketCap > 0 ? 'حصة سوقية' : 'حصة حجم التداول'}</span>
                </div>
            </div>

            {/* Top Assets */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                <div className="p-6 border-b border-slate-800 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-white">تحليل العملات القيادية</h2>
                        {isLive && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-green-500/10 rounded-full border border-green-500/20">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                </span>
                                <span className="text-[10px] text-green-400 font-bold uppercase tracking-wider">Live Socket</span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${showFavoritesOnly
                                ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                                : 'bg-slate-800 text-slate-400 hover:text-white'
                                }`}
                        >
                            <Star size={16} fill={showFavoritesOnly ? "currentColor" : "none"} />
                            <span>المفضلة فقط</span>
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-right">
                        <thead className="bg-slate-950 text-slate-400 text-xs uppercase">
                            <tr>
                                <th className="px-6 py-4 w-10"></th>
                                <th className="px-6 py-4">العملة</th>
                                <th className="px-6 py-4">السعر</th>
                                <th className="px-6 py-4">التغير (24س)</th>
                                <th className="px-6 py-4">
                                    {globalStats.marketCap > 0 ? 'القيمة السوقية' : 'السيولة (Volume)'}
                                </th>
                                <th className="px-6 py-4 text-left">إجراء</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {filteredCoins.map((coin) => (
                                <tr key={coin.id} className="hover:bg-slate-800/50 transition-colors group">
                                    <td className="px-6 py-4">
                                        <button
                                            onClick={(e) => toggleFavorite(e, coin.id)}
                                            className="text-slate-600 hover:text-yellow-400 transition-colors focus:outline-none"
                                        >
                                            <Star
                                                size={18}
                                                className={favorites.includes(coin.id) ? 'text-yellow-400 fill-yellow-400' : ''}
                                            />
                                        </button>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            {coin.image && <img src={coin.image} alt={coin.symbol} className="w-8 h-8 rounded-full" onError={(e) => (e.currentTarget.style.display = 'none')} />}
                                            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-300" style={{ display: coin.image ? 'none' : 'flex' }}>
                                                {coin.symbol[0]}
                                            </div>
                                            <div>
                                                <div className="font-bold text-white">{coin.name}</div>
                                                <div className="text-xs text-slate-500">{coin.symbol}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 font-mono text-slate-200 transition-all duration-300">
                                        {formatCurrency(coin.price)}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className={`flex items-center gap-1 font-bold ${coin.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            {coin.change24h >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                                            {formatDecimal(Math.abs(coin.change24h))}%
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-slate-400">
                                        {coin.marketCap > 0 ? formatLargeNumber(coin.marketCap) : formatLargeNumber(coin.volume)}
                                    </td>
                                    <td className="px-6 py-4 text-left">
                                        <button
                                            onClick={() => onSelectCoin(coin.id, coin.symbol)}
                                            className="text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        >
                                            تحليل ذكي
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {filteredCoins.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                        {showFavoritesOnly
                                            ? 'قائمة المفضلة فارغة. قم بتحديد النجمة بجوار العملات لإضافتها هنا.'
                                            : 'لا توجد بيانات متاحة حالياً.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div >
    );
};