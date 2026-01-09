import React from 'react';
import { ViewState } from '../types';
import { LayoutDashboard, LineChart, Radar, Settings, TerminalSquare } from 'lucide-react';

interface SidebarProps {
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate, onOpenSettings }) => {
  const menuItems = [
    { id: ViewState.DASHBOARD, icon: <LayoutDashboard size={20} />, label: 'نظرة عامة' },
    { id: ViewState.ANALYSIS, icon: <LineChart size={20} />, label: 'تحليل عميق' },
    { id: ViewState.SCANNER, icon: <Radar size={20} />, label: 'ماسح الفرص' },
    { id: ViewState.LEARNING, icon: <TerminalSquare size={20} />, label: 'سجلات الذكاء' },
  ];

  return (
    <aside className="w-20 md:w-64 bg-slate-950 border-l border-slate-800 h-screen flex flex-col fixed right-0 top-0 z-50 transition-all">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center text-white font-bold shadow-lg shadow-orange-500/50">
            A
        </div>
        <span className="font-bold text-xl text-white hidden md:block tracking-tight">Crypto<span className="text-orange-400">Mind</span></span>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-2">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              currentView === item.id 
                ? 'bg-orange-600/10 text-orange-400 border border-orange-600/20' 
                : 'text-slate-400 hover:bg-slate-900 hover:text-white'
            }`}
          >
            {item.icon}
            <span className="hidden md:block font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-900">
        <button 
            onClick={onOpenSettings}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:text-white hover:bg-slate-900 transition-colors"
        >
            <Settings size={20} />
            <span className="hidden md:block text-sm">إعدادات API</span>
        </button>
      </div>
    </aside>
  );
};