
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

  log('Snapshot request received');

  const fetchWithTimeout = async (url, timeout = 5000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      log(`Fetching: ${url}`);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      log(`Fetch status: ${res.status} for ${url}`);
      return res;
    } catch (e) {
      clearTimeout(id);
      log(`Fetch error for ${url}: ${e.name} - ${e.message}`);
      throw e;
    }
  };

  try {
    const BASE_URL = 'https://api-gcp.binance.com';

    // 1. Fetch 24h Ticker
    log('Step 1: Fetching 24hr ticker...');
    const tickerRes = await fetchWithTimeout(`${BASE_URL}/api/v3/ticker/24hr`);
    
    if (!tickerRes.ok) {
      const errText = await tickerRes.text();
      throw new Error(`Binance 24h API failed: ${tickerRes.status} - ${errText.substring(0, 100)}`);
    }
    
    const tickerData = await tickerRes.json();
    log(`Step 1 Success: Got ${tickerData.length} tickers`);

    // 2. Filter & Sort
    const validTickers = tickerData.filter(t => t.count > 0);
    const topTickersObj = validTickers
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 80);
      
    const topSymbols = topTickersObj.map(t => t.symbol);
    log(`Step 2: Selected Top ${topSymbols.length} symbols for detail fetch`);

    // 3. Fetch 1h & 4h Data
    const params = encodeURIComponent(JSON.stringify(topSymbols));
    let map1h = new Map();
    let map4h = new Map();
    let partialErrors = [];

    try {
      log('Step 3: Fetching 1h & 4h details...');
      const [res1h, res4h] = await Promise.all([
        fetchWithTimeout(`${BASE_URL}/api/v3/ticker?windowSize=1h&symbols=${params}`),
        fetchWithTimeout(`${BASE_URL}/api/v3/ticker?windowSize=4h&symbols=${params}`)
      ]);

      if (res1h.ok) {
        const data1h = await res1h.json();
        data1h.forEach(i => map1h.set(i.symbol, i.priceChangePercent));
        log(`Step 3a: Parsed ${data1h.length} 1h records`);
      } else {
        log(`Step 3a Failed: 1h status ${res1h.status}`);
        partialErrors.push(`1h:${res1h.status}`);
      }

      if (res4h.ok) {
        const data4h = await res4h.json();
        data4h.forEach(i => map4h.set(i.symbol, i.priceChangePercent));
        log(`Step 3b: Parsed ${data4h.length} 4h records`);
      } else {
        log(`Step 3b Failed: 4h status ${res4h.status}`);
        partialErrors.push(`4h:${res4h.status}`);
      }

    } catch (e) {
      log(`Step 3 CRITICAL FAIL: ${e.message}`);
      partialErrors.push(e.message);
    }

    // 4. Merge
    const result = validTickers.map(item => ({
      symbol: item.symbol,
      price: parseFloat(item.lastPrice),
      volume: parseFloat(item.quoteVolume),
      changePercent24h: parseFloat(item.priceChangePercent),
      changePercent1h: map1h.has(item.symbol) ? parseFloat(map1h.get(item.symbol)) : null,
      changePercent4h: map4h.has(item.symbol) ? parseFloat(map4h.get(item.symbol)) : null,
    }));

    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    
    // Add Debug Headers so you can see in browser Network tab
    response.setHeader('X-Debug-Status', partialErrors.length > 0 ? 'Partial' : 'Success');
    if (partialErrors.length > 0) {
        response.setHeader('X-Debug-Errors', partialErrors.join('; '));
    }
    
    log('Done. Sending response.');
    return response.status(200).json(result);

  } catch (error) {
    log(`FATAL ERROR: ${error.message}`);
    console.error(error);
    return response.status(500).json({ 
      error: 'Failed to fetch snapshot', 
      message: error.message,
      logs: logs // Return logs to client for easier debugging
    });
  }
}
