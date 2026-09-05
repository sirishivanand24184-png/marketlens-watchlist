/**
 * marketData.ts
 * Wraps yahoo-finance2 to fetch live quotes + recent daily history.
 * Handles the "stale, delayed or conflicting data" requirement explicitly:
 *  - every quote carries the exchange's own market timestamp, not just "now"
 *  - a fetch failure for one symbol never fails the whole batch (Promise.allSettled)
 *  - retries once on transient failure before marking a symbol as unavailable
 */

import YahooFinance from "yahoo-finance2";

const yahooLogger = {
  ...console,
  warn: (...args: any[]) => {
    const message = args.map(String).join(" ");
    if (message.includes("Unsupported environment: Requires Node >= 22.0.0")) {
      return;
    }
    console.warn(...args);
  },
};

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
  logger: yahooLogger,
});

export interface Quote {
  symbol: string;
  providerSymbol?: string;
  price: number;
  currency?: string;
  dayChange?: number;
  dayChangePct?: number;
  previousClose?: number;
  volume: number;
  marketTimestamp: Date;
  marketState?: string;
  fetchedAt: Date;
  ok: boolean;
  error?: string;
}

const YAHOO_SYMBOL_ALIASES: Record<string, string> = {
  AIRTEL: "BHARTIARTL.NS",
  BHARTIARTL: "BHARTIARTL.NS",
  RELIANCE: "RELIANCE.NS",
  INFY: "INFY.NS",
  TCS: "TCS.NS",
  HDFCBANK: "HDFCBANK.NS",
  ICICIBANK: "ICICIBANK.NS",
  SBIN: "SBIN.NS",
};

async function fetchOne(symbol: string, attempt = 0): Promise<Quote> {
  const fetchedAt = new Date();
  const normalizedSymbol = symbol.trim().toUpperCase();
  const providerSymbol = YAHOO_SYMBOL_ALIASES[normalizedSymbol] ?? normalizedSymbol;
  try {
    const q = await yahooFinance.quote(providerSymbol);
    if (!q || !Number.isFinite(q.regularMarketPrice)) {
      throw new Error(`no verified quote returned for ${providerSymbol}`);
    }
    return {
      symbol: normalizedSymbol,
      providerSymbol,
      price: q.regularMarketPrice,
      currency: q.currency,
      dayChange: q.regularMarketChange,
      dayChangePct: Number.isFinite(q.regularMarketChangePercent)
        ? q.regularMarketChangePercent! / 100
        : undefined,
      previousClose: q.regularMarketPreviousClose,
      volume: q.regularMarketVolume ?? 0,
      marketTimestamp: q.regularMarketTime
        ? new Date(q.regularMarketTime)
        : fetchedAt,
      marketState: q.marketState,
      fetchedAt,
      ok: Number.isFinite(q.regularMarketPrice),
    };
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    const rateLimited = msg.includes("Too Many Requests") || msg.includes("429");

    // Rate limits are transient and the free upstream API gives no retry-after
    // header, so back off briefly instead of hammering it again immediately —
    // this is the difference between "one bad symbol" and "the whole batch
    // dies because we retried into the same 429."
    if (rateLimited && attempt < 1) {
      await new Promise((res) => setTimeout(res, 1500));
      return fetchOne(symbol, attempt + 1);
    }
    if (!rateLimited && attempt < 1) {
      return fetchOne(symbol, attempt + 1); // one retry for non-rate-limit errors
    }
    return {
      symbol: normalizedSymbol,
      providerSymbol,
      price: NaN,
      volume: 0,
      marketTimestamp: fetchedAt,
      fetchedAt,
      ok: false,
      error: rateLimited ? "rate limited by upstream" : err?.message ?? "fetch failed",
    };
  }
}

/**
 * Deterministic mock price, used ONLY as a last-resort fallback when live
 * data is unavailable AND we have no prior snapshot to fall back to (e.g.
 * first-ever run while rate-limited). Seeded from the symbol name so it's
 * stable across calls rather than random noise — and always clearly labeled
 * "simulated" in the UI, never presented as real market data.
 */
export function mockQuote(symbol: string): Quote {
  const normalizedSymbol = symbol.trim().toUpperCase();
  let seed = 0;
  for (let i = 0; i < normalizedSymbol.length; i++) seed += normalizedSymbol.charCodeAt(i);
  const price = 50 + (seed % 400) + (seed % 7) * 3.33;
  return {
    symbol: normalizedSymbol,
    price,
    currency: "USD",
    dayChange: 0,
    dayChangePct: 0,
    previousClose: price,
    volume: 1000000 + (seed % 500000),
    marketTimestamp: new Date(),
    marketState: "SIMULATED",
    fetchedAt: new Date(),
    ok: true,
  };
}
export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const settled = await Promise.allSettled(symbols.map((s) => fetchOne(s)));
  return settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          symbol: symbols[i],
          price: NaN,
          currency: undefined,
          dayChange: undefined,
          dayChangePct: undefined,
          previousClose: undefined,
          volume: 0,
          marketTimestamp: new Date(),
          marketState: undefined,
          fetchedAt: new Date(),
          ok: false,
          error: "unhandled rejection",
        }
  );
}

/** Recent daily closes, used to compute each symbol's own volatility baseline. */
export async function fetchRecentReturns(
  symbol: string,
  days = 20
): Promise<number[]> {
  const period2 = new Date();
  const period1 = new Date();
  period1.setDate(period1.getDate() - days * 2); // buffer for weekends/holidays

  const result = await yahooFinance.chart(symbol, {
    period1,
    period2,
    interval: "1d",
  });

  const closes = result.quotes
    .map((bar) => bar.close)
    .filter((close): close is number => Number.isFinite(close));
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return returns.slice(-days);
}
