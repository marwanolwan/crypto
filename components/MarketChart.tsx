import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, ISeriesApi, Time, LineStyle } from 'lightweight-charts';
import { ChartPoint } from '../types';
import { formatCurrency, formatNumber } from '../utils/numberUtils';

interface MarketChartProps {
  data: ChartPoint[];
  targetPrice?: number;
  stopLoss?: number;
  prediction?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  supports?: number[];
  resistances?: number[];
  fibs?: { fib382: number; fib500: number; fib618: number };
}

export const MarketChart: React.FC<MarketChartProps> = ({
  data,
  targetPrice,
  stopLoss,
  prediction,
  supports,
  resistances,
  fibs
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. Initialize Chart
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' }, // Slate 900
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' }, // Slate 800
        horzLines: { color: '#1e293b' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 500,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#334155',
      },
      rightPriceScale: {
        borderColor: '#334155',
      },
    });

    chartRef.current = chart;

    // 2. Add Area Series (Price)
    const areaSeries = chart.addAreaSeries({
      lineColor: '#2962FF',
      topColor: 'rgba(41, 98, 255, 0.3)',
      bottomColor: 'rgba(41, 98, 255, 0)',
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => formatNumber(price),
      },
    });

    // 3. Add Volume Series (Histogram)
    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // Overlay on same chart
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // Show volume in bottom 20%
        bottom: 0,
      },
    });

    // 4. Add Bollinger Bands Series
    const upperBandSeries = chart.addLineSeries({
      color: 'rgba(43, 230, 255, 0.5)',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    const lowerBandSeries = chart.addLineSeries({
      color: 'rgba(43, 230, 255, 0.5)',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    // 5. Format Data with High Performance & Strict Validation
    const isValid = (num: any) => typeof num === 'number' && !isNaN(num) && isFinite(num);

    // O(N) Processing using Map for deduplication
    const dataMap = new Map<number, { time: Time, value: number, vol: number, volColor: string, upper?: number, lower?: number }>();

    data.forEach((d, i) => {
      if (!isValid(d.price)) return;
      const timeVal = new Date(d.time).getTime() / 1000;

      // Volume Color Logic
      const prev = data[i - 1]?.price || d.price;
      const volColor = d.price >= prev ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)';

      dataMap.set(timeVal, {
        time: timeVal as Time,
        value: d.price,
        vol: isValid(d.volume) ? d.volume : 0,
        volColor: volColor,
        upper: isValid(d.upperBand) ? d.upperBand : undefined,
        lower: isValid(d.lowerBand) ? d.lowerBand : undefined
      });
    });

    const uniqueData = Array.from(dataMap.values());

    // Sort by time just in case (chart requirement)
    uniqueData.sort((a, b) => (a.time as number) - (b.time as number));

    const areaData = uniqueData.map(d => ({ time: d.time, value: d.value }));
    const volumeData = uniqueData.map(d => ({ time: d.time, value: d.vol, color: d.volColor }));
    const upperData = uniqueData.filter(d => d.upper !== undefined).map(d => ({ time: d.time, value: d.upper! }));
    const lowerData = uniqueData.filter(d => d.lower !== undefined).map(d => ({ time: d.time, value: d.lower! }));

    // Set Data Safely
    if (areaData.length > 0) areaSeries.setData(areaData);
    if (volumeData.length > 0) volumeSeries.setData(volumeData);
    if (upperData.length > 0) upperBandSeries.setData(upperData);
    if (lowerData.length > 0) lowerBandSeries.setData(lowerData);

    // 6. Add Target / Stop Loss Lines (Safeguarded)
    if (targetPrice && isValid(targetPrice)) {
      areaSeries.createPriceLine({
        price: targetPrice,
        color: prediction === 'BULLISH' ? '#22c55e' : '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'هدف (TP)',
      });
    }

    if (stopLoss && isValid(stopLoss)) {
      areaSeries.createPriceLine({
        price: stopLoss,
        color: '#f97316',
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'وقف (SL)',
      });
    }

    // 7. Add Auto Support & Resistance Lines (Visualizing Math)
    if (supports && supports.length > 0) {
      supports.filter(isValid).forEach(level => {
        areaSeries.createPriceLine({
          price: level,
          color: 'rgba(34, 197, 94, 0.6)',
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: false,
          title: 'دعم',
        });
      });
    }

    if (resistances && resistances.length > 0) {
      resistances.filter(isValid).forEach(level => {
        areaSeries.createPriceLine({
          price: level,
          color: 'rgba(239, 68, 68, 0.6)',
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: false,
          title: 'مقاومة',
        });
      });
    }

    // 8. Add Fibonacci Lines
    if (fibs && isValid(fibs.fib618) && isValid(fibs.fib500)) {
      areaSeries.createPriceLine({
        price: fibs.fib618,
        color: 'rgba(250, 204, 21, 0.8)', // Yellow (Golden Pocket)
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Fib 0.618 (Golden)',
      });

      areaSeries.createPriceLine({
        price: fibs.fib500,
        color: 'rgba(148, 163, 184, 0.5)',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'Fib 0.5',
      });
    }

    // 9. Fit Content
    chart.timeScale().fitContent();

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, targetPrice, stopLoss, prediction, supports, resistances, fibs]);

  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl relative print:border-slate-300 print:bg-white">
      {/* Header / Info Overlay */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 pointer-events-none">
        <div className="flex gap-2">
          <div className="bg-slate-950/80 backdrop-blur px-3 py-1 rounded-lg border border-slate-800 text-xs text-slate-400 print:bg-white print:border-slate-300 print:text-black">
            TradingView Engine
          </div>
          {data.length > 0 && (
            <div className="bg-slate-950/80 backdrop-blur px-3 py-1 rounded-lg border border-slate-800 text-xs text-indigo-400 font-mono print:bg-white print:border-slate-300 print:text-indigo-700">
              {formatCurrency(data[data.length - 1].price)}
            </div>
          )}
        </div>
        <div className="bg-slate-950/80 backdrop-blur px-2 py-1 rounded-lg border border-slate-800 text-[10px] text-cyan-400/70 w-fit print:hidden">
          Bollinger Bands (20, 2)
        </div>
      </div>

      <div ref={chartContainerRef} className="w-full h-[500px]" />

      <div className="bg-slate-950 px-4 py-2 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between print:bg-white print:border-slate-300 print:text-black">
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500/50"></span> دعم
          <span className="w-2 h-2 rounded-full bg-red-500/50"></span> مقاومة
          <span className="w-2 h-2 rounded-full bg-yellow-400"></span> تصحيح ذهبي (0.618)
        </span>
        <span>Timezone: UTC</span>
      </div>
    </div>
  );
};