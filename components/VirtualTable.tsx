
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { TickerData, SortField, SortDirection } from '../types';
import { getQuoteAsset } from '../services/binanceService';

interface VirtualTableProps {
  data: TickerData[];
  height: string;
}

const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 48;
const OVERSCAN = 10;

// --- Static Formatters ---
const priceFormatterHigh = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

const priceFormatterLow = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 6,
  maximumFractionDigits: 8,
  useGrouping: true,
});

const volFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

const pctFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'always',
});

const formatPrice = (price: number) => {
  return price < 1 ? priceFormatterLow.format(price) : priceFormatterHigh.format(price);
};

const formatVolume = (vol: number) => {
  return volFormatter.format(vol);
};

const formatPercent = (pct: number | undefined) => {
  if (pct === undefined) return '-';
  return pctFormatter.format(pct) + '%';
};
// --------------------------

export const VirtualTable: React.FC<VirtualTableProps> = ({ data, height }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [sortField, setSortField] = useState<SortField>('volume');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => requestAnimationFrame(() => {
      if (container) setScrollTop(container.scrollTop);
    });

    container.addEventListener('scroll', onScroll);
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  // Sorting Logic
  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;

      switch (sortField) {
        case 'symbol':
          valA = a.symbol;
          valB = b.symbol;
          break;
        case 'price':
          valA = a.price;
          valB = b.price;
          break;
        case 'volume':
          valA = a.volume;
          valB = b.volume;
          break;
        case 'change1h':
          valA = a.changePercent1h ?? -9999;
          valB = b.changePercent1h ?? -9999;
          break;
        case 'change4h':
          valA = a.changePercent4h ?? -9999;
          valB = b.changePercent4h ?? -9999;
          break;
        case 'change24h':
          valA = a.changePercent24h;
          valB = b.changePercent24h;
          break;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [data, sortField, sortDirection]);

  const totalHeight = sortedData.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil((containerRef.current?.clientHeight || 600) / ROW_HEIGHT) + 2 * OVERSCAN;
  const endIndex = Math.min(sortedData.length, startIndex + visibleCount);
  const visibleData = sortedData.slice(startIndex, endIndex);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-gray-300 ml-1 opacity-0 group-hover:opacity-50">⇅</span>;
    return <span className="ml-1 text-gray-700">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  // Helper for conditional coloring
  const getPctColor = (pct: number | undefined) => {
    if (pct === undefined) return 'text-gray-400';
    if (pct > 0) return 'text-green-600';
    if (pct < 0) return 'text-red-600';
    return 'text-gray-500';
  };

  return (
    <div className="flex flex-col border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm h-full w-full">
      {/* Header */}
      <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500 sticky top-0 z-10" style={{ height: HEADER_HEIGHT, minHeight: HEADER_HEIGHT }}>
        {/* Token Name (Flexible width) */}
        <button 
          className="flex-1 px-4 text-left hover:bg-gray-100 h-full flex items-center transition-colors group"
          onClick={() => handleSort('symbol')}
        >
          Token <SortIcon field="symbol" />
        </button>

        {/* Price (Fixed width w-52) */}
        <button 
          className="w-52 px-4 text-right hover:bg-gray-100 h-full flex items-center justify-end transition-colors group"
          onClick={() => handleSort('price')}
        >
          Price <SortIcon field="price" />
        </button>

        {/* Volume (Fixed width w-52) */}
        <button 
          className="w-52 px-4 text-right hover:bg-gray-100 h-full flex items-center justify-end transition-colors group"
          onClick={() => handleSort('volume')}
        >
          Vol (24h) <SortIcon field="volume" />
        </button>

        {/* 1h Change (Fixed width w-24) */}
        <button 
          className="w-24 px-2 text-right hover:bg-gray-100 h-full flex items-center justify-end transition-colors group"
          onClick={() => handleSort('change1h')}
        >
          1h <SortIcon field="change1h" />
        </button>

        {/* 4h Change (Fixed width w-24) */}
        <button 
          className="w-24 px-2 text-right hover:bg-gray-100 h-full flex items-center justify-end transition-colors group"
          onClick={() => handleSort('change4h')}
        >
          4h <SortIcon field="change4h" />
        </button>

        {/* 24h Change (Fixed width w-24) */}
        <button 
          className="w-24 px-4 text-right hover:bg-gray-100 h-full flex items-center justify-end transition-colors group"
          onClick={() => handleSort('change24h')}
        >
          24h <SortIcon field="change24h" />
        </button>
      </div>

      {/* Body */}
      <div 
        ref={containerRef} 
        className="flex-1 overflow-y-auto relative custom-scrollbar"
        style={{ height: `calc(${height} - ${HEADER_HEIGHT}px)` }}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleData.map((item, index) => {
            const absoluteIndex = startIndex + index;
            const top = absoluteIndex * ROW_HEIGHT;
            
            const quoteAsset = getQuoteAsset(item.symbol);
            let baseAsset = item.symbol;
            let displayQuote = '';
            let tradeUrl = `https://www.binance.com/zh-CN/trade/${item.symbol}?type=spot`;

            if (quoteAsset) {
               baseAsset = item.symbol.substring(0, item.symbol.length - quoteAsset.length);
               displayQuote = `/${quoteAsset}`;
               tradeUrl = `https://www.binance.com/zh-CN/trade/${baseAsset}_${quoteAsset}?type=spot`;
            }

            const xUrl = `https://x.com/search?q=%24${baseAsset}&src=recent_search_click`;

            return (
              <div
                key={item.symbol}
                className="absolute top-0 left-0 w-full flex items-center border-b border-gray-100 hover:bg-gray-50 transition-colors group"
                style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
              >
                {/* Token */}
                <div className="flex-1 px-4 flex items-center min-w-0">
                  <a 
                    href={tradeUrl}
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center truncate px-2 py-1 -ml-2 rounded-md hover:bg-gray-200 transition-colors duration-200"
                    title="Trade on Binance"
                  >
                    <span className="font-bold text-gray-700 truncate">{baseAsset}</span>
                    <span className="text-xs text-gray-400 ml-0.5 font-normal">{displayQuote}</span>
                  </a>

                  {/* X Search Button */}
                  <a 
                    href={xUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 p-1.5 rounded-md text-gray-400 hover:bg-black hover:text-white transition-all duration-200"
                    title={`Search $${baseAsset} on X`}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="w-3 h-3 fill-current">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
                    </svg>
                  </a>
                </div>

                {/* Price */}
                <div className="w-52 px-4 text-right font-mono text-gray-700">
                  {formatPrice(item.price)}
                </div>

                {/* Volume */}
                <div className="w-52 px-4 text-right font-mono text-gray-700">
                  {formatVolume(item.volume)}
                </div>

                {/* 1h Change */}
                <div className={`w-24 px-2 text-right font-mono ${getPctColor(item.changePercent1h)}`}>
                  {formatPercent(item.changePercent1h)}
                </div>

                {/* 4h Change */}
                <div className={`w-24 px-2 text-right font-mono ${getPctColor(item.changePercent4h)}`}>
                  {formatPercent(item.changePercent4h)}
                </div>

                {/* 24h Change */}
                <div className={`w-24 px-4 text-right font-mono ${getPctColor(item.changePercent24h)}`}>
                  {formatPercent(item.changePercent24h)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
