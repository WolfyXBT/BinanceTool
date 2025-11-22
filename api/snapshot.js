
export default async function handler(request, response) {
  const startTime = Date.now();
  const logs = [];

  // Local helper to log events
  const log = (msg) => {
    const time = Date.now() - startTime;
    const entry = `[${time}ms] ${msg}`;
    console.log(entry); // To Vercel Logs
    logs.push(entry);
  };

  log('Snapshot request received (Lightweight Mode - List Only)');

  const fetchWithTimeout = async (url, timeout = 5000) => {
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
    // Use GCP mirror for best performance in Tokyo/Global
    const BASE_URL = 'https://api-gcp.binance.com';

    // 1. Fetch 24h Ticker (The Base List)
    // This single request is extremely cheap (Weight 40) and safe.
    log('Step 1: Fetching 24hr ticker...');
    const tickerRes = await fetchWithTimeout(`${BASE_URL}/api/v3/ticker/24hr`);
    
    if (!tickerRes.ok) {
      const errText = await tickerRes.text();
      throw new Error(`Binance 24h API failed: ${tickerRes.status} - ${errText.substring(0, 100)}`);
    }
    
    const tickerData = await tickerRes.json();
    
    // 2. Filter & Sort
    // Only keep trading pairs with actual volume
    const validTickers = tickerData.filter(t => t.count > 0);
    
    // Sort by Volume DESC to show popular coins first
    validTickers.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

    log(`Step 2: Processing ${validTickers.length} symbols.`);

    // 3. Transform Data
    // We ONLY return the basic 24h data. 
    // We explicitly DO NOT fetch 1h/4h here to avoid API rate limits (418 Teapot).
    // Those fields will be null/undefined until WebSocket updates them.
    const result = validTickers.map(item => ({
      symbol: item.symbol,
      price: parseFloat(item.lastPrice),
      volume: parseFloat(item.quoteVolume),
      changePercent24h: parseFloat(item.priceChangePercent),
      changePercent1h: null, // Intentionally null, wait for WebSocket
      changePercent4h: null, // Intentionally null, wait for WebSocket
    }));

    // Cache Strategy: Fresh for 5 minutes (300s)
    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    response.setHeader('X-Debug-Status', 'Success-Lightweight');
    
    log('Done. Sending response.');
    return response.status(200).json(result);

  } catch (error) {
    log(`FATAL ERROR: ${error.message}`);
    console.error(error);
    return response.status(500).json({ 
      error: 'Failed to fetch snapshot', 
      message: error.message,
      logs: logs 
    });
  }
}
