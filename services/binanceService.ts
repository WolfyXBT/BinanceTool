
import { BinanceTickerWS, TickerData, BinanceStreamMessage } from '../types';

// Comprehensive list of known Quote Assets on Binance (Priority order for detection)
export const KNOWN_QUOTE_ASSETS = [
  // Stablecoins
  'USDT', 'FDUSD', 'USDC', 'TUSD', 'BUSD', 'USDP', 'DAI', 'EURI', 'AEUR', 'VAI', 'IDRT',
  // Major Crypto Quotes
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'TRX', 'DOGE', 'DOT',
  // Fiats
  'EUR', 'TRY', 'BRL', 'JPY', 'ZAR', 'IDR', 'RUB', 'GBP', 'AUD', 'COP', 'MXN', 'ARS', 'NGN', 'UAH', 'PLN', 'RON', 'KZT', 'VND'
];

// Helper to detect the quote asset of a symbol
export const getQuoteAsset = (symbol: string): string | null => {
  for (const asset of KNOWN_QUOTE_ASSETS) {
    if (symbol.endsWith(asset)) {
      return asset;
    }
  }
  return null;
};

// Combined Stream URL to get 24h, 1h, and 4h tickers simultaneously
// Updated with Vision domain and Port 443 priority for better connectivity
const STREAMS = '?streams=!ticker@arr/!ticker_1h@arr/!ticker_4h@arr';
const BASE_WS_URLS = [
  `wss://data-stream.binance.vision/stream${STREAMS}`,      // Vision (Often most accessible)
  `wss://stream.binance.com:443/stream${STREAMS}`,         // Main (Port 443 - Firewall friendly)
  `wss://stream.binance.com:9443/stream${STREAMS}`,        // Main (Port 9443 - Standard)
  `wss://data-stream.binance.com/stream${STREAMS}`,         // GCP Mirror
];

export class BinanceService {
  private ws: WebSocket | null = null;
  private subscribers: ((data: Map<string, TickerData>) => void)[] = [];
  private tickerMap: Map<string, TickerData> = new Map();
  private reconnectAttempt = 0;
  private maxReconnectDelay = 10000;
  private reconnectTimeoutId: any = null;
  private endpointIndex = 0;

  constructor() {}

  public connect() {
    // 1. Fetch Snapshot
    this.fetchInitialSnapshot();
    // 2. Start WebSocket (Real-time)
    this.connectWebSocket();
  }

  private async fetchInitialSnapshot() {
    console.log("[Client] Starting Initial Snapshot fetch...");
    try {
      // Attempt 1: Try fetching from our own Vercel Serverless Function
      const response = await fetch('/api/snapshot');
      
      console.log(`[Client] Server Snapshot Response: ${response.status} ${response.statusText}`);
      
      // Check for custom debug headers
      const debugStatus = response.headers.get('X-Debug-Status');
      const debugErrors = response.headers.get('X-Debug-Errors');
      if (debugStatus) {
        console.log(`[Client] Server Debug: Status=${debugStatus}, Errors=${debugErrors}`);
      }

      if (!response.ok) {
        const errorJson = await response.json();
        console.error("[Client] Server returned error JSON:", errorJson);
        throw new Error(`Server snapshot endpoint returned ${response.status}`);
      }

      const data: any[] = await response.json();
      console.log(`[Client] Successfully loaded ${data.length} records from Server.`);

      // Populate the map
      data.forEach(record => {
        this.tickerMap.set(record.symbol, {
          ...record,
          // Ensure nulls from JSON become undefined for the interface
          changePercent1h: record.changePercent1h ?? undefined,
          changePercent4h: record.changePercent4h ?? undefined,
        });
      });

      this.notify();
    } catch (error) {
      console.warn("[Client] Internal API snapshot failed. Reason:", error);
      console.warn("[Client] Triggering Fallback to Direct Public API (24h only)...");
      // Attempt 2: Fallback to Direct Client-Side Fetching
      await this.fallbackClientSideSnapshot();
    }
  }

  private async fallbackClientSideSnapshot() {
    try {
      // 1. Get Exchange Info to filter for TRADING status only
      const infoResponse = await fetch('https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT');
      if (!infoResponse.ok) throw new Error('Binance Info failed');
      const infoData = await infoResponse.json();
      
      const tradingSymbols = new Set<string>();
      if (infoData.symbols && Array.isArray(infoData.symbols)) {
        infoData.symbols.forEach((s: any) => {
          if (s.status === 'TRADING') {
            tradingSymbols.add(s.symbol);
          }
        });
      }

      // 2. Get 24h Ticker for all pairs
      const tickerResponse = await fetch('https://api.binance.com/api/v3/ticker/24hr');
      if (!tickerResponse.ok) throw new Error('Binance Ticker failed');
      const tickerData = await tickerResponse.json();

      // 3. Map and Filter
      let count = 0;
      tickerData.forEach((item: any) => {
        if (!tradingSymbols.has(item.symbol)) return;
        
        this.tickerMap.set(item.symbol, {
          symbol: item.symbol,
          price: parseFloat(item.lastPrice),
          volume: parseFloat(item.quoteVolume),
          changePercent24h: parseFloat(item.priceChangePercent),
          changePercent1h: undefined,
          changePercent4h: undefined,
        });
        count++;
      });
      
      console.log(`[Client] Fallback loaded ${count} records (24h only).`);
      this.notify();
    } catch (e) {
      console.error("[Client] Critical: All snapshot methods failed.", e);
      this.notify(); 
    }
  }

  private connectWebSocket() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    const url = BASE_WS_URLS[this.endpointIndex];
    console.log(`[Client] WebSocket Connecting to: ${url}`);

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.error("Failed to construct WebSocket", e);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log(`[Client] WebSocket Connected`);
      this.reconnectAttempt = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const message: BinanceStreamMessage = JSON.parse(event.data);
        
        // Check if it's a combined stream message
        if (!message.data) return;

        const rawData = Array.isArray(message.data) ? message.data : [message.data];
        
        const streamName = message.stream;
        const is1h = streamName.includes('1h');
        const is4h = streamName.includes('4h');
        const is24h = !is1h && !is4h; 

        rawData.forEach((item) => {
          const symbol = item.s;
          
          const existing = this.tickerMap.get(symbol) || {
            symbol: item.s,
            price: 0,
            volume: 0,
            changePercent24h: 0,
          };

          if (is24h) {
             existing.price = parseFloat(item.c);
             existing.volume = parseFloat(item.q); 
             existing.changePercent24h = parseFloat(item.P);
          } else if (is1h) {
             existing.price = parseFloat(item.c);
             existing.changePercent1h = parseFloat(item.P);
          } else if (is4h) {
             existing.price = parseFloat(item.c); 
             existing.changePercent4h = parseFloat(item.P);
          }

          this.tickerMap.set(symbol, existing);
        });

        this.notify();
      } catch (error) {
        console.error('Error parsing WebSocket message', error);
      }
    };

    this.ws.onclose = (event) => {
      console.log(`[Client] WebSocket Closed (Code: ${event.code}).`);
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = (event) => {
      console.log('[Client] WebSocket Error.');
      if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
        this.ws.close();
      }
    };
  }

  public subscribe(callback: (data: Map<string, TickerData>) => void) {
    this.subscribers.push(callback);
    if (this.tickerMap.size > 0) {
      callback(new Map(this.tickerMap));
    }
    return () => {
      this.subscribers = this.subscribers.filter((cb) => cb !== callback);
    };
  }

  private notify() {
    const snapshot = new Map(this.tickerMap);
    this.subscribers.forEach((cb) => cb(snapshot));
  }

  private scheduleReconnect() {
    this.endpointIndex = (this.endpointIndex + 1) % BASE_WS_URLS.length;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempt), this.maxReconnectDelay);
    this.reconnectAttempt++;
    
    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    
    console.log(`[Client] Reconnecting in ${delay}ms to ${BASE_WS_URLS[this.endpointIndex]}`);
    this.reconnectTimeoutId = setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  public disconnect() {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export const binanceService = new BinanceService();
