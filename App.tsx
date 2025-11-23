
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
  
  // Track current sorted order for lazy loading priority
  const [sortedSymbols, setSortedSymbols] = useState<string[]>([]);
  
  // Favorites State
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('binance_favorites');
      if (saved) {
        try {
          return new Set(JSON.parse(saved));
        } catch (error) {
          console.error("Error parsing favorites from localStorage:", error);
          return new Set();
        }
      }
    }
    return new Set();
  });
  const [viewMode, setViewMode] = useState<'market' | 'favorites'>('market');

  // Filter Menu State
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Start connection (Fetches Snapshot + Starts WS)
    binanceService.connect();
    
    // Subscribe to updates
    const unsubscribe = binanceService.subscribe((data) => {
      setTickerDataMap(data);
      // As soon as we have data stop loading
      if (data.size > 0) {
        setIsLoading(false);
      }
    });

    // Timeout fallback: If data hasn't loaded in 10 seconds, stop loading.
    // This handles cases where API fetch fails entirely due to network blocks.
    const timeoutId = setTimeout(() => {
      setIsLoading(false);
    }, 10000);

    // Click outside handler for filter menu
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
      binanceService.disconnect();
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // --- Progressive Hydration Loop ---
  // This effect runs periodically to fill in missing 1h/4h data from top to bottom
  useEffect(() => {
    // If we have no data or no sort order, do nothing
    if (tickerDataMap.size === 0 || sortedSymbols.length === 0) return;

    const fillNextEmpty = async () => {
      // Find the first symbol in the CURRENT visual order that has missing data
      const targetSymbol = sortedSymbols.find(symbol => {
        const item = tickerDataMap.get(symbol);
        // We want to fill if 1h OR 4h is undefined
        return item && (item.changePercent1h === undefined || item.changePercent4h === undefined);
      });

      if (targetSymbol) {
        // Fetch detailed stats for this specific symbol
        // The service handles rate limiting logic if we call this too fast, but we'll control it here too
        await binanceService.fetchDetailedStats(targetSymbol);
      }
    };

    // Run this check every 200ms (5 times per second)
    // This creates a safe rate of ~300 requests per minute (Limit is 6000)
    const intervalId = setInterval(fillNextEmpty, 200);

    return () => clearInterval(intervalId);
  }, [sortedSymbols, tickerDataMap]); 
  // Dependency on tickerDataMap ensures we re-evaluate after an update
  // Dependency on sortedSymbols ensures we restart from the top if sort changes
  // ----------------------------------

  // Persist favorites to localStorage
  const toggleFavorite = (symbol: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      localStorage.setItem('binance_favorites', JSON.stringify(Array.from(next)));
      return next;
    });
  };

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

  // Filter Data based on Quote Asset, Search Query AND View Mode
  const filteredData = useMemo(() => {
    let data = Array.from(tickerDataMap.values());

    // 0. Filter by View Mode (Favorites)
    if (viewMode === 'favorites') {
      data = data.filter(item => favorites.has(item.symbol));
    }

    // 1. Filter by Quote Asset (Base Currency) - Only apply if NOT in favorites mode, or if user wants to filter favorites
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
  }, [tickerDataMap, selectedAssets, searchQuery, viewMode, favorites]);

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
             <h1 className="text-xl font-bold tracking-tight text-gray-700">Binance Spot Market</h1>
          </div>
          
          <div className="hidden md:flex items-center space-x-6 text-sm text-gray-500 font-medium">
             <div className="flex items-center space-x-1">
                <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-500' : 'bg-green-500'} animate-pulse`}></span>
                <span className={isLoading ? "text-yellow-600" : "text-green-600"}>
                  {isLoading ? 'Loading Data...' : 'Live System'}
                </span>
             </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 flex flex-col h-[calc(100vh-64px)]">
        
        {/* Top Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
          
          {/* Left: View Switcher & Market Summary */}
          <div className="flex items-center gap-4">
            {/* View Switcher (Segmented Control) */}
            <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
              <button
                onClick={() => setViewMode('market')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                  viewMode === 'market' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Market
              </button>
              <button
                onClick={() => setViewMode('favorites')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 flex items-center gap-1.5 ${
                  viewMode === 'favorites' 
                    ? 'bg-white text-yellow-600 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
                </svg>
                Favorites
              </button>
            </div>

            {/* Stats (Hidden on small mobile to save space) */}
            <div className="hidden lg:flex items-center space-x-4 text-sm">
              <div className="px-3 py-1.5 bg-white border border-gray-200 rounded-md shadow-sm flex-shrink-0">
                <span className="text-gray-500 mr-2">Pairs</span>
                <span className="font-semibold text-gray-700">{stats.total}</span>
              </div>
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
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center bg-gray-50/50">
                    <span className="text-xs font-bold uppercase text-gray-500 tracking-wider">Filter Quote Assets</span>
                  </div>

                  {/* Dropdown Grid */}
                  <div className="p-4 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {availableQuoteAssets.map((asset) => {
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
                             <span className="font-bold mb-0.5">{asset === 'ALL' ? 'ALL MARKETS' : asset}</span>
                             <span className={`text-[10px] ${isSelected ? 'text-gray-400' : 'text-gray-400'}`}>
                               {asset === 'ALL' ? stats.total : count}
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
                 <span className="text-sm text-gray-500">Loading Data...</span>
               </div>
            </div>
          ) : (
             filteredData.length > 0 ? (
               <VirtualTable 
                 data={filteredData} 
                 height="100%"
                 favorites={favorites}
                 onToggleFavorite={toggleFavorite}
                 onSortedIdsChange={setSortedSymbols}
               />
             ) : (
               <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-white border border-gray-200 rounded-lg">
                 {viewMode === 'favorites' ? (
                   <>
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mb-2 text-gray-300">
                       <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                     </svg>
                     <p className="text-lg font-medium text-gray-500">No favorites yet</p>
                     <p className="text-sm mt-1">Click the star icon on any market to add it here.</p>
                   </>
                 ) : (
                   <>
                     <p className="text-lg font-medium text-gray-500">No markets found</p>
                     <p className="text-sm mt-1">
                       {tickerDataMap.size === 0 ? "Check your network connection." : "Try adjusting your search or filters."}
                     </p>
                   </>
                 )}
               </div>
             )
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
