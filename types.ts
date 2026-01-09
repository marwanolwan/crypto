
export enum ViewState {
  DASHBOARD = 'DASHBOARD',
  ANALYSIS = 'ANALYSIS',
  SCANNER = 'SCANNER',
  LEARNING = 'LEARNING'
}

export interface CoinData {
  id: string; // Add ID for API calls
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  weightedAvgPrice: number; // Analyzed VWAP
  change1h?: number; // Added for Scalping
  change7d?: number; // Added for Swing/Investing
  volume: number; // Changed to number for calculations
  marketCap: number; // Changed to number
  image?: string;
  high24h?: number;
  low24h?: number;
}

export interface WhaleActivity {
  netFlow: string;
  largeTransactions: number;
  sentiment: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
  alert: string;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  published_on: number;
}

export interface NewsAnalysis {
  impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  pricedIn: boolean;
  manipulationRisk: boolean;
  marketReaction: 'ALIGNED' | 'DIVERGENT' | 'IGNORED';
  summary: string;
  flaggedTitles?: string[];
}

export interface AnalysisResult {
  coin: string;
  price: number;
  prediction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  targetPrice: number;
  stopLoss: number;
  confidenceScore: number; // 0-100
  timeframe: string;
  reasoning: string;
  keyFactors: string[];
  smartMoneyInsights: string[]; // New field for Smart Money Engine outputs
  newsAnalysis: NewsAnalysis; // New field for Predictive News Engine
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  scenario: string;
  whaleActivity: WhaleActivity;
}

export interface ScannerSignal {
  id: string;
  coin: string;
  signalType: 'ACCUMULATION' | 'BREAKOUT' | 'VOLUME_SPIKE' | 'DUMP' | 'SCALPING_PUMP' | 'TREND_CONTINUATION' | 'UNDERVALUED';
  probability: number;
  daysAccumulating?: number;
  detectedAt: string;
  price: number;
  modeTag?: string;
}

export interface ChartPoint {
  time: string;
  price: number;
  prediction?: number;
  lowerBand?: number;
  upperBand?: number;
  volume?: number;
  high?: number;
  low?: number;
  macdLine?: number;

  signalLine?: number;
  histogram?: number;
  rsi?: number;
}

export interface SavedPrediction {
  id: string;
  coinSymbol: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  predictionType: 'BULLISH' | 'BEARISH';
  date: number;
  status: 'PENDING' | 'WIN' | 'LOSS';
  finalPrice?: number;
  confidence: number;
  failureReason?: string; // Reason for failure provided by AI
}

export interface MiniTicker {
  s: string; // Symbol
  c: string; // Close Price
  o: string; // Open Price
  h: string; // High Price
  l: string; // Low Price
  v: string; // Total Traded Base Asset Volume
  q: string; // Total Traded Quote Asset Volume
  E: number; // Event Time
}