
import { BinanceTickerWS, TickerData, BinanceStreamMessage } from '../types';

// REST API Interface for Snapshot
interface BinanceTickerREST {
  symbol: string;
  lastPrice: string;
  quoteVolume: string; // We use Quote Volume (Turnover)
  priceChangePercent: string;
}

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
// Format: base_url/stream?streams=stream1/stream2/...
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
    // 1. Fetch Snapshot immediately (HTTP)
    this.fetchInitialSnapshot();
    // 2. Start WebSocket (Real-time)
    this.connectWebSocket();
  }

  private async fetchInitialSnapshot() {
    try {
      // Run both fetches in parallel for speed
      const [infoRes, tickerRes] = await Promise.all([
        // Fetch Exchange Info to get the direct "TRADING" status of symbols
        fetch('https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT'),
        // Fetch standard 24hr statistics
        fetch('https://api.binance.com/api/v3/ticker/24hr')
      ]);

      if (!infoRes.ok || !tickerRes.ok) {
        throw new Error('Failed to fetch API data');
      }

      const infoData = await infoRes.json();
      const tickerData: BinanceTickerREST[] = await tickerRes.json();

      // Create a Set of symbols that are explicitly in 'TRADING' status
      const activeSymbols = new Set<string>();
      if (infoData.symbols && Array.isArray(infoData.symbols)) {
        infoData.symbols.forEach((s: any) => {
          if (s.status === 'TRADING') {
            activeSymbols.add(s.symbol);
          }
        });
      }

      tickerData.forEach(item => {
        const symbol = item.symbol;
        
        // FILTER: Only allow symbols that are legally "TRADING" according to Exchange Info.
        // This replaces the previous quoteVolume check with a direct status check.
        if (!activeSymbols.has(symbol)) {
          return;
        }

        const quoteVolume = parseFloat(item.quoteVolume);

        // Note: REST API does not provide 1h/4h data, only 24h.
        // 1h/4h columns will remain empty until WebSocket updates arrive.
        const newRecord: TickerData = {
          symbol: symbol,
          price: parseFloat(item.lastPrice),
          volume: quoteVolume, // Quote Volume
          changePercent24h: parseFloat(item.priceChangePercent),
        };

        // We map it directly. If WS has already updated it (race condition), 
        // we might overwrite newer data with older snapshot data, 
        // but usually snapshot finishes before WS connects. 
        const existing = this.tickerMap.get(symbol);
        if (!existing) {
           this.tickerMap.set(symbol, newRecord);
        } else {
           // Update standard fields
           existing.price = newRecord.price;
           existing.volume = newRecord.volume;
           existing.changePercent24h = newRecord.changePercent24h;
        }
      });

      this.notify();
    } catch (error) {
      console.error("Failed to fetch initial snapshot:", error);
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
