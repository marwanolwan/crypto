import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Loader2, Key, ShieldCheck, Eye, EyeOff, ExternalLink, Globe, MapPin, Cpu, Sparkles, Server, Zap, Database, Settings, Lock, Trash2, CheckCircle2 } from 'lucide-react';
import { verifyApiKey } from '../services/geminiService';
import { verifyBinanceConnection } from '../services/cryptoApi';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    // Common State
    const [activeTab, setActiveTab] = useState<'ai' | 'market'>('ai');

    // AI Settings
    const [provider, setProvider] = useState<'alibaba' | 'google'>('google');
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [status, setStatus] = useState<'idle' | 'checking' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [isAiSaved, setIsAiSaved] = useState(false);

    // Alibaba Specific
    const [aliRegion, setAliRegion] = useState<'intl' | 'cn'>('intl');
    const [aliModel, setAliModel] = useState<string>('qwen-plus');

    // Google Specific
    const [googleModel, setGoogleModel] = useState<string>('gemini-3-flash-preview');

    // Market Data Settings State
    const [binanceKey, setBinanceKey] = useState('');
    const [binanceSecret, setBinanceSecret] = useState('');
    const [showBinanceKey, setShowBinanceKey] = useState(false);
    const [showBinanceSecret, setShowBinanceSecret] = useState(false);
    const [marketStatus, setMarketStatus] = useState<'idle' | 'checking' | 'success' | 'error'>('idle');
    const [marketMessage, setMarketMessage] = useState('');
    const [isBinanceSaved, setIsBinanceSaved] = useState(false);

    useEffect(() => {
        // Load config
        const storedProvider = localStorage.getItem('ai_provider');
        if (storedProvider === 'alibaba') {
            setProvider('alibaba');
            const key = localStorage.getItem('alibaba_api_key') || '';
            setApiKey(key);
            setIsAiSaved(!!key);
            setAliRegion((localStorage.getItem('alibaba_region') as 'intl' | 'cn') || 'intl');
            setAliModel(localStorage.getItem('alibaba_model') || 'qwen-plus');
        } else {
            setProvider('google');
            const key = localStorage.getItem('google_api_key') || '';
            setApiKey(key);
            setIsAiSaved(!!key);
            let storedModel = localStorage.getItem('google_model');
            // Auto-fix for deprecated models
            if (!storedModel || storedModel.includes('1.5') || storedModel === 'gemini-2.0-flash') {
                storedModel = 'gemini-3-flash-preview';
            } else if (storedModel.includes('exp') || storedModel.includes('2.0-pro')) {
                storedModel = 'gemini-3-pro-preview';
            }
            setGoogleModel(storedModel);
        }

        // Load Market Config
        const bKey = localStorage.getItem('binance_api_key') || '';
        setBinanceKey(bKey);
        setIsBinanceSaved(!!bKey);
        setBinanceSecret(localStorage.getItem('binance_api_secret') || '');

        setStatus('idle');
        setMarketStatus('idle');
        setMessage('');
        setMarketMessage('');
    }, [isOpen]);

    const handleProviderChange = (newProvider: 'alibaba' | 'google') => {
        setProvider(newProvider);
        setStatus('idle');
        setMessage('');
        if (newProvider === 'google') {
            const key = localStorage.getItem('google_api_key') || '';
            setApiKey(key);
            setIsAiSaved(!!key);
        } else {
            const key = localStorage.getItem('alibaba_api_key') || '';
            setApiKey(key);
            setIsAiSaved(!!key);
        }
    };

    const saveAiSettings = async () => {
        const cleanKey = apiKey.trim();
        if (!cleanKey) {
            setStatus('error');
            setMessage('يرجى إدخال مفتاح AI API');
            return;
        }

        setStatus('checking');
        setMessage('جاري التحقق من المفتاح...');

        let result;
        if (provider === 'google') {
            result = await verifyApiKey('google', cleanKey, { model: googleModel });
        } else {
            result = await verifyApiKey('alibaba', cleanKey, { region: aliRegion, model: aliModel });
        }

        if (result.valid) {
            localStorage.setItem('ai_provider', provider);
            if (provider === 'google') {
                localStorage.setItem('google_api_key', cleanKey);
                localStorage.setItem('google_model', googleModel);
            } else {
                localStorage.setItem('alibaba_api_key', cleanKey);
                localStorage.setItem('alibaba_region', aliRegion);
                localStorage.setItem('alibaba_model', aliModel);
            }
            setStatus('success');
            setMessage('تم حفظ إعدادات الذكاء الاصطناعي بنجاح');
            setIsAiSaved(true);
        } else {
            setStatus('error');
            setMessage(result.error || 'فشل الاتصال بالمزود');
        }
    };

    const saveMarketSettings = async () => {
        localStorage.removeItem('market_provider');

        if (binanceKey) {
            setMarketStatus('checking');
            setMarketMessage('جاري التحقق من مفتاح Binance...');

            const result = await verifyBinanceConnection(binanceKey, binanceSecret);

            if (result.valid) {
                localStorage.setItem('binance_api_key', binanceKey);
                if (binanceSecret) localStorage.setItem('binance_api_secret', binanceSecret);
                else localStorage.removeItem('binance_api_secret');

                setMarketStatus('success');
                setMarketMessage('تم التحقق والحفظ بنجاح!');
                setIsBinanceSaved(true);
            } else {
                setMarketStatus('error');
                setMarketMessage(result.error || 'المفتاح غير صالح');
            }
        } else {
            localStorage.removeItem('binance_api_key');
            localStorage.removeItem('binance_api_secret');
            setIsBinanceSaved(false);
            setMarketStatus('success');
            setMarketMessage('تم إزالة المفاتيح (العودة للوضع العام)');
        }
    };

    const handleClearData = () => {
        if (window.confirm('هل أنت متأكد؟ سيتم حذف جميع مفاتيح API وإعداداتك من هذا المتصفح.')) {
            localStorage.removeItem('google_api_key');
            localStorage.removeItem('alibaba_api_key');
            localStorage.removeItem('binance_api_key');
            localStorage.removeItem('binance_api_secret');
            localStorage.removeItem('ai_provider');
            localStorage.removeItem('market_provider');
            localStorage.removeItem('google_model');
            localStorage.removeItem('alibaba_model');

            setApiKey('');
            setBinanceKey('');
            setBinanceSecret('');
            setIsAiSaved(false);
            setIsBinanceSaved(false);
            setMessage('تم حذف البيانات بنجاح.');
            setStatus('idle');
            window.location.reload();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">

                <div className="p-6 bg-slate-950 border-b border-slate-800 flex justify-between items-center shrink-0">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Settings size={22} className="text-indigo-500" />
                        الإعدادات العامة
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-800">
                    <button
                        onClick={() => setActiveTab('ai')}
                        className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === 'ai' ? 'border-indigo-500 text-indigo-400 bg-slate-900' : 'border-transparent text-slate-500 bg-slate-950 hover:text-slate-300'
                            }`}
                    >
                        <Sparkles size={16} /> الذكاء الاصطناعي
                    </button>
                    <button
                        onClick={() => setActiveTab('market')}
                        className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === 'market' ? 'border-green-500 text-green-400 bg-slate-900' : 'border-transparent text-slate-500 bg-slate-950 hover:text-slate-300'
                            }`}
                    >
                        <Database size={16} /> بيانات Binance
                    </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">
                    {activeTab === 'market' ? (
                        /* Market Data Settings */
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">

                            <div className="space-y-4">
                                <div className="bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/20 text-xs text-yellow-200 leading-relaxed">
                                    ⚡ النظام متصل بـ Binance API بشكل افتراضي. إدخال المفاتيح اختياري ولكنه يحسن سرعة البيانات وحدود الاستخدام.
                                </div>

                                <div className="space-y-3">
                                    <div className="space-y-1">
                                        <label className="text-sm font-medium text-slate-300 flex items-center justify-between">
                                            <span className="flex items-center gap-2">
                                                API Key
                                                {isBinanceSaved && <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 rounded flex items-center gap-1"><CheckCircle2 size={10} /> محفوظ</span>}
                                            </span>
                                            <span className="text-xs text-slate-500">Public Key</span>
                                        </label>
                                        <div className="relative">
                                            <input
                                                type={showBinanceKey ? "text" : "password"}
                                                value={binanceKey}
                                                onChange={(e) => { setBinanceKey(e.target.value); setIsBinanceSaved(false); }}
                                                placeholder="ادخل Binance API Key"
                                                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-10 py-3 text-white focus:outline-none focus:border-yellow-500 font-mono text-sm"
                                            />
                                            <div className="absolute left-3 top-3 text-slate-500"><Key size={18} /></div>
                                            <button onClick={() => setShowBinanceKey(!showBinanceKey)} className="absolute right-3 top-3 text-slate-500 hover:text-white"><Eye size={18} /></button>
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-sm font-medium text-slate-300 flex items-center justify-between">
                                            <span>Secret Key</span>
                                            <span className="text-xs text-slate-500">Private Key</span>
                                        </label>
                                        <div className="relative">
                                            <input
                                                type={showBinanceSecret ? "text" : "password"}
                                                value={binanceSecret}
                                                onChange={(e) => setBinanceSecret(e.target.value)}
                                                placeholder="ادخل Binance Secret Key"
                                                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-10 py-3 text-white focus:outline-none focus:border-yellow-500 font-mono text-sm"
                                            />
                                            <div className="absolute left-3 top-3 text-slate-500"><Lock size={18} /></div>
                                            <button onClick={() => setShowBinanceSecret(!showBinanceSecret)} className="absolute right-3 top-3 text-slate-500 hover:text-white"><Eye size={18} /></button>
                                        </div>
                                    </div>
                                </div>

                                {marketStatus !== 'idle' && (
                                    <div className={`p-3 rounded-lg flex items-start gap-2 text-xs ${marketStatus === 'checking' ? 'bg-blue-500/10 text-blue-400' :
                                            marketStatus === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                        }`}>
                                        {marketStatus === 'checking' ? <Loader2 className="animate-spin shrink-0" size={14} /> :
                                            marketStatus === 'success' ? <CheckCircle className="shrink-0" size={14} /> : <AlertCircle className="shrink-0" size={14} />}
                                        <span>{marketMessage}</span>
                                    </div>
                                )}

                                <button
                                    onClick={saveMarketSettings}
                                    disabled={marketStatus === 'checking'}
                                    className="w-full py-3 rounded-lg font-bold text-black bg-yellow-400 hover:bg-yellow-500 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                                >
                                    {marketStatus === 'checking' ? 'جاري التحقق...' : (isBinanceSaved ? 'تحديث مفاتيح Binance' : 'حفظ واختبار الاتصال')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* AI Settings (Existing) */
                        <div className="space-y-6 animate-in slide-in-from-left-4 duration-300">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                                    <Server size={14} /> مزود الذكاء (AI Provider)
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => handleProviderChange('google')}
                                        className={`p-3 rounded-lg border text-sm flex flex-col items-center justify-center gap-2 transition-all relative overflow-hidden ${provider === 'google'
                                                ? 'bg-blue-600/20 border-blue-500 text-blue-400 font-bold shadow-lg shadow-blue-500/10'
                                                : 'bg-slate-950 border-slate-800 text-slate-400 opacity-60 hover:opacity-100'
                                            }`}
                                    >
                                        {provider === 'google' && <div className="absolute inset-0 bg-blue-500/5 animate-pulse"></div>}
                                        <span className="text-lg relative z-10">✨</span>
                                        <span className="relative z-10">Google Gemini</span>
                                        <span className="text-[9px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-bold relative z-10">مجاني (Recommended)</span>
                                    </button>
                                    <button
                                        onClick={() => handleProviderChange('alibaba')}
                                        className={`p-3 rounded-lg border text-sm flex flex-col items-center justify-center gap-2 transition-all ${provider === 'alibaba'
                                                ? 'bg-orange-600/20 border-orange-500 text-orange-400 font-bold'
                                                : 'bg-slate-950 border-slate-800 text-slate-400 opacity-60 hover:opacity-100'
                                            }`}
                                    >
                                        <span className="text-lg">☁️</span>
                                        <span>Alibaba Cloud</span>
                                    </button>
                                </div>
                            </div>

                            {provider === 'alibaba' ? (
                                <>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-slate-300">المنطقة (Region)</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button onClick={() => setAliRegion('intl')} className={`p-2 rounded border text-xs ${aliRegion === 'intl' ? 'bg-orange-500/20 border-orange-500 text-orange-400' : 'bg-slate-950 border-slate-800'}`}>International</button>
                                            <button onClick={() => setAliRegion('cn')} className={`p-2 rounded border text-xs ${aliRegion === 'cn' ? 'bg-orange-500/20 border-orange-500 text-orange-400' : 'bg-slate-950 border-slate-800'}`}>China</button>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-slate-300">الموديل (Model)</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {['qwen-max', 'qwen-plus', 'qwen-turbo'].map(m => (
                                                <button key={m} onClick={() => setAliModel(m)} className={`p-2 rounded border text-[10px] font-bold ${aliModel === m ? 'bg-orange-500/20 border-orange-500 text-orange-400' : 'bg-slate-950 border-slate-800'}`}>
                                                    {m.toUpperCase()}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-slate-300">الموديل (Model)</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button onClick={() => setGoogleModel('gemini-3-flash-preview')} className={`p-2 rounded border text-xs flex flex-col items-center gap-1 transition-all ${googleModel === 'gemini-3-flash-preview' ? 'bg-blue-500/20 border-blue-500 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.2)]' : 'bg-slate-950 border-slate-800 opacity-60'}`}>
                                                <span className="font-bold">Gemini 3 Flash</span>
                                                <span className="text-[9px] text-green-400 font-bold">الأحدث والأسرع</span>
                                            </button>
                                            <button onClick={() => setGoogleModel('gemini-3-pro-preview')} className={`p-2 rounded border text-xs flex flex-col items-center gap-1 transition-all ${googleModel === 'gemini-3-pro-preview' ? 'bg-blue-500/20 border-blue-500 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.2)]' : 'bg-slate-950 border-slate-800 opacity-60'}`}>
                                                <span className="font-bold">Gemini 3 Pro</span>
                                                <span className="text-[9px] text-yellow-400 font-bold">الأكثر ذكاءً</span>
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}

                            <div className="relative">
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-sm text-slate-400">مفتاح API</label>
                                    {isAiSaved && <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 rounded flex items-center gap-1"><CheckCircle2 size={10} /> محفوظ</span>}
                                </div>
                                <input
                                    type={showKey ? "text" : "password"}
                                    value={apiKey}
                                    onChange={(e) => { setApiKey(e.target.value); setStatus('idle'); setIsAiSaved(false); }}
                                    placeholder={provider === 'google' ? "ألصق مفتاح AIzaSy هنا..." : "sk-..."}
                                    className={`w-full bg-slate-950 border rounded-lg pl-10 pr-10 py-3 text-white focus:outline-none transition-colors font-mono text-sm ${status === 'error' ? 'border-red-500' : 'border-slate-800 focus:border-indigo-500'
                                        }`}
                                />
                                <div className="absolute left-3 top-9 text-slate-500"><ShieldCheck size={18} /></div>
                                <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-9 text-slate-500 hover:text-white"><Eye size={18} /></button>
                            </div>

                            {status !== 'idle' && (
                                <div className={`p-4 rounded-lg flex items-start gap-3 text-sm animate-in zoom-in-95 duration-200 ${status === 'checking' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                                        status === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                    }`}>
                                    {status === 'checking' ? <Loader2 className="animate-spin shrink-0" size={16} /> :
                                        status === 'success' ? <CheckCircle className="shrink-0" size={16} /> : <AlertCircle className="shrink-0" size={16} />}
                                    <span>{message}</span>
                                </div>
                            )}

                            <button
                                onClick={saveAiSettings}
                                disabled={status === 'checking'}
                                className={`w-full py-3 rounded-lg font-bold text-white transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${provider === 'google'
                                        ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20'
                                        : 'bg-orange-600 hover:bg-orange-500 shadow-orange-500/20'
                                    }`}
                            >
                                {status === 'checking' ? 'جاري التحقق...' : (isAiSaved ? 'تحديث مفتاح AI' : 'حفظ الإعدادات')}
                            </button>
                        </div>
                    )}
                </div>

                <div className="p-4 bg-slate-950/50 border-t border-slate-800 shrink-0 flex justify-between items-center">
                    <button
                        onClick={handleClearData}
                        className="text-red-400 hover:text-red-300 text-sm flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors"
                        title="حذف جميع البيانات (تسجيل خروج)"
                    >
                        <Trash2 size={16} />
                        <span>مسح البيانات</span>
                    </button>
                    <button onClick={onClose} className="text-slate-400 hover:text-white text-sm px-4">إغلاق</button>
                </div>
            </div>
        </div>
    );
};