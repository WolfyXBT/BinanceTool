
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { binanceService, getQuoteAsset } from './services/binanceService';
import { TickerData } from './types';
import { VirtualTable } from './components/VirtualTable';

const App = () => {
  const [tickerDataMap, setTickerDataMap] = useState<Map<string, TickerData>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // Default to USDT instead of ALL
  const [selectedAssets, setSelectedAssets] = useState<string[]>(['USDT']);
  
  // Filter Menu State
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Start connection (Starts WS only)
    binanceService.connect();
    
    // Subscribe to updates
    const unsubscribe = binanceService.subscribe((data) => {
      setTickerDataMap(data);
      // As soon as we have data stop loading
      if (data.size > 0) {
        setIsLoading(false);
      }
    });

    // Click outside handler for filter menu
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      unsubscribe();
      binanceService.disconnect();
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Dynamically compute available quote assets present in the current dataset
  const { availableQuoteAssets, assetCounts } = useMemo(() => {
    const allData = Array.from(tickerDataMap.values());
    const counts: Record<string, number> = {};
    const presentAssets = new Set<string>();

    // Initial count for ALL
    counts['ALL'] = allData.length;

    allData.forEach((item) => {
      const quote = getQuoteAsset(item.symbol);
      if (quote) {
        presentAssets.add(quote);
        counts[quote] = (counts[quote] || 0) + 1;
      }
    });

    // Sort logic: 
    // 1. Priority group (USDT, BTC, ETH, BNB, FDUSD, USDC) at the start
    // 2. The rest sorted alphabetically
    const priority = ['USDT', 'FDUSD', 'USDC', 'BTC', 'BNB', 'ETH'];
    
    const sortedAssets = Array.from(presentAssets).sort((a, b) => {
      const idxA = priority.indexOf(a);
      const idxB = priority.indexOf(b);
      
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    return { 
      availableQuoteAssets: ['ALL', ...sortedAssets], 
      assetCounts: counts 
    };
  }, [tickerDataMap]);

  // Filter Data based on Quote Asset AND Search Query
  const filteredData = useMemo(() => {
    let data = Array.from(tickerDataMap.values());

    // 1. Filter by Quote Asset (Base Currency)
    if (!selectedAssets.includes('ALL')) {
      data = data.filter(item => {
        return selectedAssets.some(asset => item.symbol.endsWith(asset));
      });
    }
    
    // 2. Filter by Search Query (Targeting Base Asset ONLY)
    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      data = data.filter(item => {
        const quote = getQuoteAsset(item.symbol);
        const baseAsset = quote 
          ? item.symbol.substring(0, item.symbol.length - quote.length) 
          : item.symbol;
        
        return baseAsset.includes(q);
      });
    }

    return data;
  }, [tickerDataMap, selectedAssets, searchQuery]);

  // Statistics (Locked to 24h for general market sentiment)
  const stats = useMemo(() => {
    if (filteredData.length === 0) return { total: 0, up: 0, down: 0 };
    
    let up = 0;
    let down = 0;
    filteredData.forEach((t) => {
      const pct = t.changePercent24h;
      if (pct > 0) up++;
      else if (pct < 0) down++;
    });
    return { total: filteredData.length, up, down };
  }, [filteredData]);

  const toggleAsset = (asset: string) => {
    if (asset === 'ALL') {
      setSelectedAssets(['ALL']);
      return;
    }

    setSelectedAssets((prev) => {
      if (prev.includes('ALL')) {
        return [asset];
      }

      if (prev.includes(asset)) {
        const next = prev.filter((a) => a !== asset);
        return next.length === 0 ? ['ALL'] : next;
      } else {
        return [...prev, asset];
      }
    });
  };

  const filterLabel = useMemo(() => {
    if (selectedAssets.includes('ALL')) return 'All Markets';
    if (selectedAssets.length === 1) return selectedAssets[0];
    return `${selectedAssets.length} Selected`;
  }, [selectedAssets]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center">
      {/* Navbar / Header */}
      <header className="w-full bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
             {/* Binance Logo */}
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-[#F0B90B]">
                <path d="M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0115l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6595-2.7174-2.7154 7.353-7.353z"/>
             </svg>
             <h1 className="text-xl font-bold tracking-tight text-gray-700">Binance Spot Market</h1>
          </div>
          
          <div className="hidden md:flex items-center space-x-6 text-sm text-gray-500 font-medium">
             <div className="flex items-center space-x-1">
                <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-500' : 'bg-green-500'} animate-pulse`}></span>
                <span className={isLoading ? "text-yellow-600" : "text-green-600"}>
                  {isLoading ? 'Connecting...' : 'Live System'}
                </span>
             </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 flex flex-col h-[calc(100vh-64px)]">
        
        {/* Top Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
          
          {/* Market Summary Chips */}
          <div className="flex items-center space-x-4 text-sm overflow-x-auto no-scrollbar">
            <div className="px-3 py-1.5 bg-white border border-gray-200 rounded-md shadow-sm flex-shrink-0">
              <span className="text-gray-500 mr-2">Pairs</span>
              <span className="font-semibold text-gray-700">{stats.total}</span>
            </div>
            <div className="px-3 py-1.5 bg-white border border-gray-200 rounded-md shadow-sm flex-shrink-0">
              <span className="text-gray-500 mr-2">24h Up</span>
              <span className="font-semibold text-green-600">{stats.up}</span>
            </div>
            <div className="px-3 py-1.5 bg-white border border-gray-200 rounded-md shadow-sm flex-shrink-0">
              <span className="text-gray-500 mr-2">24h Down</span>
              <span className="font-semibold text-red-600">{stats.down}</span>
            </div>
          </div>

          {/* Right Side: Filter Menu & Search */}
          <div className="flex items-center gap-3 w-full md:w-auto">
            
            {/* Filter Dropdown */}
            <div className="relative" ref={filterRef}>
              <button 
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className={`
                  flex items-center justify-between w-full md:w-48 px-4 py-2 border rounded-lg shadow-sm text-sm transition-all duration-200
                  ${isFilterOpen 
                    ? 'bg-gray-100 border-gray-300' 
                    : 'bg-white border-gray-300 hover:bg-gray-50'
                  }
                `}
              >
                <div className="flex items-center truncate">
                  <span className="text-gray-500 mr-2">Base:</span>
                  <span className="font-semibold text-gray-700 truncate max-w-[100px]">{filterLabel}</span>
                </div>
                <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isFilterOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown Content */}
              {isFilterOpen && (
                <div className="absolute top-full right-0 mt-2 w-[90vw] md:w-[480px] bg-white/95 backdrop-blur-xl border border-gray-200 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[60vh] animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                  
                  {/* Dropdown Header */}
                  <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <span className="text-xs font-bold uppercase text-gray-500 tracking-wider">Filter Quote Assets</span>
                    <button 
                      onClick={() => toggleAsset('ALL')}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors px-2 py-1 rounded hover:bg-blue-50"
                    >
                      Reset to All
                    </button>
                  </div>

                  {/* Dropdown Grid */}
                  <div className="p-4 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {availableQuoteAssets.map((asset) => {
                         if (asset === 'ALL') return null;
                         const isSelected = selectedAssets.includes(asset);
                         const count = assetCounts[asset] || 0;

                         return (
                           <button
                             key={asset}
                             onClick={() => toggleAsset(asset)}
                             className={`
                               flex flex-col items-center justify-center px-2 py-2 rounded-lg text-xs border transition-all duration-200
                               ${isSelected 
                                 ? 'bg-black border-black text-white shadow-md transform scale-[1.02]' 
                                 : 'bg-white border-gray-100 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                               }
                             `}
                           >
                             <span className="font-bold mb-0.5">{asset}</span>
                             <span className={`text-[10px] ${isSelected ? 'text-gray-400' : 'text-gray-400'}`}>
                               {count}
                             </span>
                           </button>
                         );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Search Input */}
            <div className="relative flex-1 md:flex-none md:w-64">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-black focus:border-black sm:text-sm transition-shadow shadow-sm"
                placeholder="Search Token..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Table Container */}
        <div className="flex-1 w-full relative">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm z-10 rounded-lg border border-gray-200">
               <div className="flex flex-col items-center">
                 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-700 mb-2"></div>
                 <span className="text-sm text-gray-500">Connecting...</span>
               </div>
            </div>
          ) : (
             <VirtualTable 
               data={filteredData} 
               height="100%" 
             />
          )}
        </div>
        
        <div className="mt-4 text-center text-xs text-gray-400">
          Data provided by Binance Public API. Real-time updates via WebSocket.
        </div>
      </main>
    </div>
  );
};

export default App;
