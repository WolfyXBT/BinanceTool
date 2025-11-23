
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { TickerData, SortField, SortDirection } from '../types';
import { getQuoteAsset } from '../services/binanceService';

interface VirtualTableProps {
  data: TickerData[];
  height: string;
  favorites: Set<string>;
  onToggleFavorite: (symbol: string) => void;
  // Callback to inform parent about the current sorted order
  onSortedIdsChange?: (sortedIds: string[]) => void;
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

export const VirtualTable: React.FC<VirtualTableProps> = ({ data, height, favorites, onToggleFavorite, onSortedIdsChange }) => {
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
          // Treat undefined as 0 for sorting purposes only (keeps them in the middle)
          valA = a.changePercent1h ?? 0;
          valB = b.changePercent1h ?? 0;
          break;
        case 'change4h':
          // Treat undefined as 0 for sorting purposes only (keeps them in the middle)
          valA = a.changePercent4h ?? 0;
          valB = b.changePercent4h ?? 0;
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

  // Notify parent whenever the sorted list changes
  useEffect(() => {
    if (onSortedIdsChange) {
      onSortedIdsChange(sortedData.map(d => d.symbol));
    }
  }, [sortedData, onSortedIdsChange]);

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

  // Helper for full-cell background coloring based on specific thresholds
  const getCellBackgroundColor = (pct: number | undefined) => {
    if (pct === undefined) return '#f3f4f6';
    
    if (pct > 30) return '#7bbc81';        // > 30%
    if (pct > 20) return '#a3d1aa';        // 20% ~ 30%
    if (pct > 10) return '#b1d9b9';        // 10% ~ 20%
    if (pct > 5) return '#c0e0c7';         // 5% ~ 10%
    if (pct > 0.01) return '#dfeee2';      // 0.01% ~ 5%
    if (pct >= -0.01) return '#fdf3d1';    // -0.01% ~ 0.01% (Neutral, Cream)
    if (pct > -5) return '#efbdc2';        // -5% ~ -0.01%
    if (pct > -10) return '#e8939a';       // -10% ~ -5%
    if (pct > -20) return '#e68085';       // -20% ~ -10%
    return '#e46c72';                      // < -20%
  };

  return (
    <div className="flex flex-col border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm h-full w-full">
      {/* Header */}
      <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500 sticky top-0 z-10" style={{ height: HEADER_HEIGHT, minHeight: HEADER_HEIGHT }}>
        {/* Fav Star Column */}
        <div className="w-10 h-full"></div>

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
            const isFav = favorites.has(item.symbol);

            return (
              <div
                key={item.symbol}
                className="absolute top-0 left-0 w-full flex items-center border-b border-gray-100 hover:bg-gray-50 transition-colors group"
                style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
              >
                {/* Fav Star Button */}
                <div className="w-10 flex items-center justify-center bg-white h-full">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(item.symbol);
                    }}
                    className="p-1.5 rounded-full hover:bg-gray-100 transition-colors focus:outline-none"
                  >
                    {isFav ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-yellow-400">
                        <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-gray-300 group-hover:text-gray-400">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* Token */}
                <div className="flex-1 px-4 flex items-center min-w-0 bg-white h-full">
                  {/* Token Name (Text Only) */}
                  <div 
                    className="flex items-center truncate px-2 py-1 -ml-2 rounded-md select-all"
                  >
                    <span className="font-bold text-gray-700 truncate">{baseAsset}</span>
                    <span className="text-xs text-gray-400 ml-0.5 font-normal">{displayQuote}</span>
                  </div>

                  {/* Binance Trade Button */}
                  <a 
                    href={tradeUrl}
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="ml-2 p-[3px] rounded-md hover:bg-black transition-all duration-200 flex-shrink-0"
                    title="Trade on Binance"
                  >
                    <svg fill="#f3ba2f" viewBox="0 0 32 32" className="w-[15px] h-[15px]" xmlns="http://www.w3.org/2000/svg">
                      <title>binance</title>
                      <path d="M15.986 1.019l9.189 9.159-3.396 3.393-5.793-5.793-5.793 5.823-3.396-3.393 9.189-9.189zM4.399 12.605l3.365 3.395-3.363 3.365-3.396-3.365zM15.986 12.607l3.394 3.363-3.395 3.395-3.395-3.365 3.395-3.393zM27.572 12.605l3.423 3.395-3.393 3.395-3.395-3.395zM21.778 18.399l3.396 3.393-9.189 9.189-9.189-9.187 3.396-3.395 5.793 5.823 5.793-5.823z"></path>
                    </svg>
                  </a>

                  {/* X Search Button */}
                  <a 
                    href={xUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 p-[3px] rounded-md text-gray-400 hover:bg-black hover:text-white transition-all duration-200 flex-shrink-0"
                    title={`Search $${baseAsset} on X`}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="w-[15px] h-[15px] fill-current">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
                    </svg>
                  </a>
                </div>

                {/* Price */}
                <div className="w-52 px-4 text-right font-mono text-gray-700 bg-white h-full flex items-center justify-end">
                  {formatPrice(item.price)}
                </div>

                {/* Volume */}
                <div className="w-52 px-4 text-right font-mono text-gray-700 bg-white h-full flex items-center justify-end">
                  {formatVolume(item.volume)}
                </div>

                {/* 1h Change */}
                <div 
                  className="w-24 px-2 h-full flex items-center justify-end font-mono text-gray-700"
                  style={{ backgroundColor: getCellBackgroundColor(item.changePercent1h) }}
                >
                  {formatPercent(item.changePercent1h)}
                </div>

                {/* 4h Change */}
                <div 
                  className="w-24 px-2 h-full flex items-center justify-end font-mono text-gray-700"
                  style={{ backgroundColor: getCellBackgroundColor(item.changePercent4h) }}
                >
                  {formatPercent(item.changePercent4h)}
                </div>

                {/* 24h Change */}
                <div 
                  className="w-24 px-4 h-full flex items-center justify-end font-mono text-gray-700"
                  style={{ backgroundColor: getCellBackgroundColor(item.changePercent24h) }}
                >
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
