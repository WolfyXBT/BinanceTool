
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
const BASE_WS_URLS = [
  'wss://stream.binance.com:9443/stream?streams=!ticker@arr/!ticker_1h@arr/!ticker_4h@arr',
  'wss://stream.binance.com/stream?streams=!ticker@arr/!ticker_1h@arr/!ticker_4h@arr',
  'wss://data-stream.binance.com/stream?streams=!ticker@arr/!ticker_1h@arr/!ticker_4h@arr',
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
    try {
      // Attempt 1: Try fetching from our own Vercel Serverless Function
      // This is the best path: it handles CORS, solves network blocks, and provides 1h/4h data.
      const response = await fetch('/api/snapshot');
      
      if (!response.ok) {
        // If this fails (e.g., 404 in local dev), throw to trigger fallback
        throw new Error(`Server snapshot endpoint returned ${response.status}`);
      }

      const data: any[] = await response.json();

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
      console.warn("Internal API snapshot failed (expected in local dev), falling back to public Binance API.", error);
      // Attempt 2: Fallback to Direct Client-Side Fetching
      await this.fallbackClientSideSnapshot();
    }
  }

  private async fallbackClientSideSnapshot() {
    try {
      // 1. Get Exchange Info to filter for TRADING status only
      // Note: Using a public proxy or direct if allowed. Direct usually works if no CORS issues, 
      // otherwise the user might need a VPN or this might fail too (in which case WS is the last resort).
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
      tickerData.forEach((item: any) => {
        if (!tradingSymbols.has(item.symbol)) return;
        
        // Note: Client-side fallback cannot efficiently get 1h/4h for all pairs due to API limits.
        // Those columns will remain empty until WebSocket updates arrive.
        this.tickerMap.set(item.symbol, {
          symbol: item.symbol,
          price: parseFloat(item.lastPrice),
          volume: parseFloat(item.quoteVolume),
          changePercent24h: parseFloat(item.priceChangePercent),
          changePercent1h: undefined,
          changePercent4h: undefined,
        });
      });
      
      this.notify();
    } catch (e) {
      console.error("Critical: All snapshot methods failed. Waiting for WebSocket.", e);
      // Notify empty to at least stop the loading spinner if the app logic permits
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
    console.log(`Attempting connection to: ${url}`);

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.error("Failed to construct WebSocket", e);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log(`Binance WebSocket Connected to ${url}`);
      this.reconnectAttempt = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const message: BinanceStreamMessage = JSON.parse(event.data);
        
        // Check if it's a combined stream message
        if (!message.data) return;

        const rawData = Array.isArray(message.data) ? message.data : [message.data];
        
        // Determine which timeframe this update belongs to based on stream name
        const streamName = message.stream;
        const is1h = streamName.includes('1h');
        const is4h = streamName.includes('4h');
        const is24h = !is1h && !is4h; // Default ticker is 24h

        rawData.forEach((item) => {
          const symbol = item.s;
          
          // Get existing record or create new one
          const existing = this.tickerMap.get(symbol) || {
            symbol: item.s,
            price: 0,
            volume: 0,
            changePercent24h: 0,
          };

          // Update fields based on which stream provided the data
          if (is24h) {
             existing.price = parseFloat(item.c);
             existing.volume = parseFloat(item.q); // Quote Volume
             existing.changePercent24h = parseFloat(item.P);
          } else if (is1h) {
             existing.price = parseFloat(item.c); // Always update price to be latest
             existing.changePercent1h = parseFloat(item.P);
          } else if (is4h) {
             existing.price = parseFloat(item.c); // Always update price to be latest
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
      console.log(`Binance WebSocket Closed (Code: ${event.code}). Reconnecting...`);
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = (event) => {
      console.error('Binance WebSocket Error', event);
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
    
    console.log(`Reconnecting in ${delay}ms to ${BASE_WS_URLS[this.endpointIndex]}`);
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
