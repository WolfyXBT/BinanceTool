
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
    this.connectWebSocket();
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
