import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { AnalysisView } from './components/AnalysisView';
import { Scanner } from './components/Scanner';
import { LearningLog } from './components/LearningLog';
import { SettingsModal } from './components/SettingsModal';
import { ViewState } from './types';
import { CheckCircle2, XCircle } from 'lucide-react';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>(ViewState.DASHBOARD);
  const [selectedCoin, setSelectedCoin] = useState<{id: string, symbol: string}>({ id: 'bitcoin', symbol: 'BTC' });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [providerName, setProviderName] = useState('Alibaba');

  // Check for API key on mount and when settings close
  useEffect(() => {
    const checkKey = () => {
        const provider = localStorage.getItem('ai_provider') || 'alibaba';
        setProviderName(provider === 'google' ? 'Google' : 'Alibaba');
        
        let key = '';
        if (provider === 'google') key = localStorage.getItem('google_api_key') || '';
        else key = localStorage.getItem('alibaba_api_key') || '';
        
        setHasApiKey(!!key);
    };
    checkKey();
  }, [isSettingsOpen]);

  const handleSelectCoin = (coinId: string, symbol: string) => {
    setSelectedCoin({ id: coinId, symbol: symbol });
    setCurrentView(ViewState.ANALYSIS);
  };

  const renderContent = () => {
    switch (currentView) {
      case ViewState.DASHBOARD:
        return <Dashboard onSelectCoin={handleSelectCoin} />;
      case ViewState.ANALYSIS:
        return <AnalysisView coin={selectedCoin} />;
      case ViewState.SCANNER:
        return <Scanner onSelectCoin={handleSelectCoin} />;
      case ViewState.LEARNING:
        return <LearningLog />;
      default:
        return <Dashboard onSelectCoin={handleSelectCoin} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-orange-500/30 print:bg-white print:text-black">
      <Sidebar 
        currentView={currentView} 
        onNavigate={setCurrentView} 
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      
      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />

      <main className="pr-20 md:pr-64 min-h-screen print:pr-0 print:w-full print:m-0">
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-950/80 backdrop-blur sticky top-0 z-40 print:hidden">
           <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                <span className="text-xs font-mono text-slate-400">حالة النظام: متصل (Binance Live)</span>
           </div>
           <div className="flex items-center gap-4">
             <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                 hasApiKey 
                 ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                 : 'bg-red-500/10 border-red-500/20 text-red-400 cursor-pointer'
             }`} onClick={() => !hasApiKey && setIsSettingsOpen(true)}>
                 {hasApiKey ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                 {hasApiKey ? `${providerName} AI: متصل` : 'الذكاء الاصطناعي: غير متصل'}
             </div>
           </div>
        </header>

        <div className="p-6 md:p-8 max-w-7xl mx-auto print:p-0 print:max-w-none">
            {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default App;