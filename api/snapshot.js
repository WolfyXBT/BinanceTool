
export default async function handler(request, response) {
  // Helper to fetch with timeout to prevent Vercel function from hanging
  const fetchWithTimeout = async (url, timeout = 4000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  };

  try {
    // Use Google Cloud Platform mirror which is often faster/friendlier for cloud deployments
    const BASE_URL = 'https://api-gcp.binance.com';

    // 1. Fetch 24h Ticker ONLY (Skip exchangeInfo to save time & bandwidth)
    // We use 'count > 0' to filter out dead/delisted pairs effectively
    const tickerRes = await fetchWithTimeout(`${BASE_URL}/api/v3/ticker/24hr`);
    if (!tickerRes.ok) throw new Error('Binance Ticker failed');
    const tickerData = await tickerRes.json();

    // 2. Filter & Sort
    // Keep only symbols with trades in last 24h (active)
    const validTickers = tickerData.filter(t => t.count > 0); 
    
    // Sort by Quote Volume (Turnover) to get the most popular coins
    const topTickersObj = validTickers
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 80); // Limit to Top 80 to ensure 100% success rate within timeout
      
    const topSymbols = topTickersObj.map(t => t.symbol);

    // 3. Fetch 1h & 4h Data (Parallel)
    const params = encodeURIComponent(JSON.stringify(topSymbols));
    
    let map1h = new Map();
    let map4h = new Map();

    try {
      const [res1h, res4h] = await Promise.all([
        fetchWithTimeout(`${BASE_URL}/api/v3/ticker?windowSize=1h&symbols=${params}`),
        fetchWithTimeout(`${BASE_URL}/api/v3/ticker?windowSize=4h&symbols=${params}`)
      ]);

      if (res1h.ok) {
        const data1h = await res1h.json();
        data1h.forEach(i => map1h.set(i.symbol, i.priceChangePercent));
      }
      if (res4h.ok) {
        const data4h = await res4h.json();
        data4h.forEach(i => map4h.set(i.symbol, i.priceChangePercent));
      }
    } catch (e) {
      console.warn("1h/4h fetch failed, returning partial data", e);
      // We suppress error here to ensure at least the 24h data returns successfully
    }

    // 4. Merge Data
    const result = validTickers.map(item => ({
      symbol: item.symbol,
      price: parseFloat(item.lastPrice),
      volume: parseFloat(item.quoteVolume),
      changePercent24h: parseFloat(item.priceChangePercent),
      // Only map if we successfully fetched the data
      changePercent1h: map1h.has(item.symbol) ? parseFloat(map1h.get(item.symbol)) : null,
      changePercent4h: map4h.has(item.symbol) ? parseFloat(map4h.get(item.symbol)) : null,
    }));

    // 5. Set Cache Headers (Cache for 60 seconds)
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return response.status(200).json(result);

  } catch (error) {
    console.error('Snapshot Fatal Error:', error);
    return response.status(500).json({ error: 'Failed to fetch snapshot', details: error.message });
  }
}
