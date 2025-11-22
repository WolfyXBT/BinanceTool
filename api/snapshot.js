
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

  log('Snapshot request received (Vercel Pro Optimized - 5min Cache)');

  const fetchWithTimeout = async (url, timeout = 9000) => {
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
    // Use GCP mirror for best performance in Tokyo
    const BASE_URL = 'https://api-gcp.binance.com';

    // 1. Fetch 24h Ticker (The Base List)
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
    
    // Sort by Volume DESC
    validTickers.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

    // VERCEL PRO UPGRADE: 
    // Full Market Coverage enabled by 5-minute cache strategy.
    // Setting limit to 3000 covers all ~2400 active pairs on Binance.
    const TOP_N = 3000; 
    const BATCH_SIZE = 80; // Safe limit for URL length
    const topTickersSubset = validTickers.slice(0, TOP_N);
    
    log(`Step 2: Processing ${topTickersSubset.length} symbols (Full Market Coverage)`);

    // Helper to chunk array
    const chunkArray = (arr, size) => {
      const res = [];
      for (let i = 0; i < arr.length; i += size) {
        res.push(arr.slice(i, i + size));
      }
      return res;
    };

    const symbolBatches = chunkArray(topTickersSubset.map(t => t.symbol), BATCH_SIZE);
    
    let map1h = new Map();
    let map4h = new Map();
    let partialErrors = [];

    // 3. Fetch 1h & 4h Data in Parallel Batches
    log(`Step 3: Firing requests for ${symbolBatches.length} batches...`);

    const processBatch = async (batchSymbols, batchIndex) => {
      const params = encodeURIComponent(JSON.stringify(batchSymbols));
      try {
        const [res1h, res4h] = await Promise.all([
          fetchWithTimeout(`${BASE_URL}/api/v3/ticker?windowSize=1h&symbols=${params}`),
          fetchWithTimeout(`${BASE_URL}/api/v3/ticker?windowSize=4h&symbols=${params}`)
        ]);

        if (res1h.ok) {
          const data = await res1h.json();
          data.forEach(i => map1h.set(i.symbol, i.priceChangePercent));
        } else {
          partialErrors.push(`B${batchIndex}-1h:${res1h.status}`);
        }

        if (res4h.ok) {
          const data = await res4h.json();
          data.forEach(i => map4h.set(i.symbol, i.priceChangePercent));
        } else {
          partialErrors.push(`B${batchIndex}-4h:${res4h.status}`);
        }
      } catch (e) {
        partialErrors.push(`B${batchIndex}-Err:${e.message}`);
      }
    };

    // Execute all batch requests in parallel
    await Promise.all(symbolBatches.map((batch, idx) => processBatch(batch, idx)));

    log(`Step 3 Done. 1h Map Size: ${map1h.size}, 4h Map Size: ${map4h.size}`);

    // 4. Merge Data
    const result = validTickers.map(item => ({
      symbol: item.symbol,
      price: parseFloat(item.lastPrice),
      volume: parseFloat(item.quoteVolume),
      changePercent24h: parseFloat(item.priceChangePercent),
      changePercent1h: map1h.has(item.symbol) ? parseFloat(map1h.get(item.symbol)) : null,
      changePercent4h: map4h.has(item.symbol) ? parseFloat(map4h.get(item.symbol)) : null,
    }));

    // Cache Strategy: Fresh for 5 minutes (300s), Stale allowed for 1 minute while updating
    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
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
      logs: logs 
    });
  }
}
