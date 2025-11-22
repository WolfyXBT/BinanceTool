
export default async function handler(request, response) {
  try {
    // 1. Fetch Exchange Info (to filter for TRADING status)
    // This ensures we don't show delisted or halted pairs
    const infoRes = await fetch('https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT');
    if (!infoRes.ok) throw new Error('Binance ExchangeInfo failed');
    const infoData = await infoRes.json();
    
    // Create a Set of valid symbols
    const activeSymbols = new Set(
      infoData.symbols
        .filter(s => s.status === 'TRADING')
        .map(s => s.symbol)
    );

    // 2. Fetch 24h Ticker (Base Data for all coins)
    const tickerRes = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!tickerRes.ok) throw new Error('Binance Ticker failed');
    const tickerData = await tickerRes.json();

    // 3. Filter Valid Pairs & Sort by Quote Volume
    // We only want to fetch 1h/4h data for the most popular coins to save API weight
    const validTickers = tickerData.filter(t => activeSymbols.has(t.symbol));
    
    const topTickers = validTickers
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 100) // Top 100 coins by volume
      .map(t => t.symbol);

    // 4. Fetch 1h & 4h Data for Top 100 Tickers
    // Binance requires the 'symbols' parameter for these endpoints
    const params = encodeURIComponent(JSON.stringify(topTickers));

    const [res1h, res4h] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/ticker?windowSize=1h&symbols=${params}`),
      fetch(`https://api.binance.com/api/v3/ticker?windowSize=4h&symbols=${params}`)
    ]);

    const data1h = res1h.ok ? await res1h.json() : [];
    const data4h = res4h.ok ? await res4h.json() : [];

    // Create Lookup Maps for O(1) access
    const map1h = new Map(data1h.map(i => [i.symbol, i.priceChangePercent]));
    const map4h = new Map(data4h.map(i => [i.symbol, i.priceChangePercent]));

    // 5. Construct Final Merged Response
    const result = validTickers.map(item => ({
      symbol: item.symbol,
      price: parseFloat(item.lastPrice),
      volume: parseFloat(item.quoteVolume),
      changePercent24h: parseFloat(item.priceChangePercent),
      // Only Top 100 will have these values initially, others will be null
      changePercent1h: map1h.has(item.symbol) ? parseFloat(map1h.get(item.symbol)) : null,
      changePercent4h: map4h.has(item.symbol) ? parseFloat(map4h.get(item.symbol)) : null,
    }));

    // 6. Set Cache Headers
    // s-maxage=60: Vercel CDN caches this for 60 seconds (Shared Cache)
    // stale-while-revalidate=30: Serve stale data for 30s while updating in background
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return response.status(200).json(result);

  } catch (error) {
    console.error('Snapshot Error:', error);
    return response.status(500).json({ error: 'Failed to fetch snapshot' });
  }
}
