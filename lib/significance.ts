/**
 * significance.ts
 *
 * This is the differentiator of the whole project. Instead of a flat rule like
 * "flag anything that moved >2%", we score each move against the STOCK'S OWN
 * recent behavior. A 2% move on a historically sleepy blue-chip is a bigger
 * deal than a 2% move on a stock that swings 5% most days.
 *
 * Inputs you'd wire up from PriceHistory:
 *  - returns: last N days of daily returns for this symbol (as decimals, e.g. 0.013)
 *  - currentReturn: the move since the user's last snapshot
 *  - currentVolume / avgVolume: for volume-spike detection
 *  - hoursSinceLastCheck: staleness of the user's own last view
 */

export interface SignificanceInput {
  symbol: string;
  priceThen: number;
  priceNow: number;
  returns: number[];       // recent daily returns, e.g. last 14-20 sessions
  currentVolume?: number;
  avgVolume?: number;
  hoursSinceLastCheck: number;
  marketTimestamp: Date;   // freshness of the price itself
  fetchedAt: Date;
  marketState?: string;
}

export interface SignificanceResult {
  symbol: string;
  pctChange: number;
  zScore: number;          // move size in units of the stock's own volatility
  volumeSpike: boolean;
  score: number;           // 0-100 composite "deserves attention" score
  reasons: string[];       // human-readable explanation, shown in the UI
  freshness: "live" | "delayed" | "stale" | "simulated";
  freshnessMinutes: number;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function classifyFreshness(
  marketTimestamp: Date,
  fetchedAt: Date,
  marketState?: string
): { freshness: SignificanceResult["freshness"]; minutes: number } {
  const gapMs = fetchedAt.getTime() - marketTimestamp.getTime();
  const minutes = Math.round(gapMs / 60000);
  const state = marketState?.toUpperCase();

  // A last-close quote during pre/post/closed market is still verified market
  // data. It is not "live", but it should be baseline-eligible unless it is
  // several days old.
  if (state && state !== "REGULAR") {
    if (minutes <= 60 * 72) return { freshness: "delayed", minutes };
    return { freshness: "stale", minutes };
  }

  if (minutes <= 5) return { freshness: "live", minutes };
  if (minutes <= 30) return { freshness: "delayed", minutes };
  return { freshness: "stale", minutes };
}

export function computeSignificance(input: SignificanceInput): SignificanceResult {
  const pctChange = (input.priceNow - input.priceThen) / input.priceThen;
  const sigma = stddev(input.returns) || 0.01; // floor to avoid div-by-zero on new listings
  const zScore = pctChange / sigma;

  const volumeSpike =
    !!input.currentVolume &&
    !!input.avgVolume &&
    input.currentVolume > input.avgVolume * 1.75;

  const { freshness, minutes } = classifyFreshness(
    input.marketTimestamp,
    input.fetchedAt,
    input.marketState
  );

  // Composite score: magnitude-relative-to-self is the dominant term,
  // volume spike and "you've been away a while" add weight, staleness
  // discounts confidence (a stale stale price shouldn't rank as urgent).
  let score = Math.min(80, Math.abs(zScore) * 30);
  if (volumeSpike) score += 15;
  if (input.hoursSinceLastCheck > 72) score += 10;
  if (freshness === "stale") score *= 0.5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const reasons: string[] = [];
  reasons.push(
    `${pctChange >= 0 ? "+" : ""}${(pctChange * 100).toFixed(1)}% since you last checked`
  );
  if (Math.abs(zScore) >= 2) {
    reasons.push(
      `${Math.abs(zScore).toFixed(1)}x this stock's normal daily volatility`
    );
  }
  if (volumeSpike) reasons.push("unusually high volume");
  if (freshness !== "live") {
    reasons.push(`price is ${minutes}m old (${freshness})`);
  }

  return {
    symbol: input.symbol,
    pctChange,
    zScore,
    volumeSpike,
    score,
    reasons,
    freshness,
    freshnessMinutes: minutes,
  };
}

/** Ranks a batch of symbols by attention score, most-deserving first. */
export function rankByAttention(
  results: SignificanceResult[]
): SignificanceResult[] {
  return [...results].sort((a, b) => b.score - a.score);
}
