import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchQuotes, fetchRecentReturns, mockQuote } from "@/lib/marketData";
import { computeSignificance, rankByAttention } from "@/lib/significance";
import { buildDigest } from "@/lib/digest";

/**
 * GET /api/watchlist/:id/refresh
 *
 * This is the endpoint the frontend calls when the user opens their watchlist.
 * Flow:
 *  1. Load the watchlist's symbols.
 *  2. Load the most recent snapshot BEFORE this call (= "what it looked like
 *     last time you checked"). If none exists, this is a first-time view.
 *  3. Fetch live quotes + each symbol's recent volatility.
 *  4. Score every symbol's change since the last snapshot via significance.ts.
 *  5. Return the ranked, explained result WITHOUT moving the user's baseline.
 *
 * POST /api/watchlist/:id/refresh
 *
 * Repeats the same fetch and explicitly saves the verified quotes as the new
 * "seen" baseline. That makes the UI action "Mark digest as seen" meaningful:
 * simply opening the app does not erase the comparison the user came to inspect.
 */
async function buildWatchlistView(id: string) {
  const watchlist = await prisma.watchlist.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!watchlist) {
    return null;
  }
  const symbols = watchlist.items.map((i) => i.symbol);
  if (symbols.length === 0) {
    return {
      firstView: false,
      hoursSinceLastCheck: 0,
      digest: "Your watchlist is empty - add a symbol to start tracking it.",
      items: [],
      unavailable: [],
      snapshotData: {},
    };
  }

  const lastSnapshot = await prisma.watchlistSnapshot.findFirst({
    where: { watchlistId: id },
    orderBy: { viewedAt: "desc" },
  });
  const firstView = !lastSnapshot;
  const lastData = (lastSnapshot?.data as any) ?? {};
  const hoursSinceLastCheck = lastSnapshot
    ? (Date.now() - lastSnapshot.viewedAt.getTime()) / 36e5
    : 0;

  const quotes = await fetchQuotes(symbols);

  const results = await Promise.all(
    quotes.map(async (q) => {
      const prior = lastData[q.symbol];

      if (!q.ok) {
        // Upstream failed (rate limit, network, delisting, etc). Fall back to
        // the last known price from our own snapshot history instead of
        // showing nothing — clearly marked as stale so it's never confused
        // with a live quote. This is the actual "handle unreliable
        // dependencies" behavior, not just an error message.
        if (prior?.price) {
          const sig = computeSignificance({
            symbol: q.symbol,
            priceThen: prior.price,
            priceNow: prior.price,
            returns: [],
            currentVolume: prior.volume,
            avgVolume: prior.volume,
            hoursSinceLastCheck,
            marketTimestamp: lastSnapshot!.viewedAt,
            fetchedAt: new Date(),
            marketState: "STALE",
          });
          return {
            ...sig,
            priceNow: prior.price,
            currency: prior.currency,
            dayChange: prior.dayChange,
            dayChangePct: prior.dayChangePct,
            previousClose: prior.previousClose,
            marketState: "STALE",
            isNewToYou: false,
            ok: true as const,
            reasons: [
              `showing last known price — live data unavailable (${q.error})`,
            ],
            freshness: "stale" as const,
          };
        }
        // No prior snapshot either (e.g. first-ever run while the upstream
        // API is rate-limited). Rather than a blank screen, show a clearly
        // labeled simulated price so the product is still demonstrable —
        // this NEVER masquerades as real data (freshness: "simulated").
        const mock = mockQuote(q.symbol);
        return {
          symbol: q.symbol,
          score: 0,
          pctChange: 0,
          zScore: 0,
          volumeSpike: false,
          priceNow: mock.price,
          currency: mock.currency,
          dayChange: mock.dayChange,
          dayChangePct: mock.dayChangePct,
          previousClose: mock.previousClose,
          marketState: mock.marketState,
          isNewToYou: true,
          ok: true as const,
          reasons: [`simulated price — live data unavailable (${q.error})`],
          freshness: "simulated" as const,
          freshnessMinutes: 0,
        };
      }
      const returns = await fetchRecentReturns(q.providerSymbol ?? q.symbol).catch(() => []);

      const sig = computeSignificance({
        symbol: q.symbol,
        priceThen: prior?.price ?? q.price, // no prior => zero baseline change
        priceNow: q.price,
        returns,
        currentVolume: q.volume,
        avgVolume: prior?.volume,
        hoursSinceLastCheck,
        marketTimestamp: q.marketTimestamp,
        fetchedAt: q.fetchedAt,
        marketState: q.marketState,
      });

      return {
        ...sig,
        priceNow: q.price,
        currency: q.currency,
        dayChange: q.dayChange,
        dayChangePct: q.dayChangePct,
        previousClose: q.previousClose,
        marketState: q.marketState,
        providerSymbol: q.providerSymbol,
        isNewToYou: !prior,
        ok: true as const,
      };
    })
  );

  const ranked = rankByAttention(results.filter((r) => r.ok) as any);
  const failed = results.filter((r) => !r.ok);
  const baselineEligibleSymbols = new Set(
    ranked
      .filter((item) => item.freshness === "live" || item.freshness === "delayed")
      .map((item) => item.symbol)
  );
  const snapshotData = Object.fromEntries(
    quotes
      .filter((q) => q.ok && baselineEligibleSymbols.has(q.symbol))
      .map((q) => [
        q.symbol,
        {
          price: q.price,
          currency: q.currency,
          dayChange: q.dayChange,
          dayChangePct: q.dayChangePct,
          previousClose: q.previousClose,
          volume: q.volume,
          marketTimestamp: q.marketTimestamp.toISOString(),
          marketState: q.marketState,
        },
      ])
  );

  const digest = firstView
    ? `Welcome — tracking ${symbols.length} symbol${symbols.length > 1 ? "s" : ""}. Come back later and I'll tell you what changed.`
    : buildDigest(ranked as any, hoursSinceLastCheck, failed.length);

  return {
    firstView,
    hoursSinceLastCheck: Math.round(hoursSinceLastCheck * 10) / 10,
    digest,
    items: ranked,
    unavailable: failed,
    canSaveBaseline: Object.keys(snapshotData).length > 0,
    verifiedCount: baselineEligibleSymbols.size,
    snapshotData,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const view = await buildWatchlistView(params.id);
  if (!view) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { snapshotData, ...response } = view;
  return NextResponse.json(response);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const view = await buildWatchlistView(params.id);
  if (!view) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (Object.keys(view.snapshotData).length === 0) {
    return NextResponse.json(
      { error: "No verified quotes available to save as a baseline." },
      { status: 503 }
    );
  }

  await prisma.watchlistSnapshot.create({
    data: { watchlistId: params.id, data: view.snapshotData },
  });

  const { snapshotData, ...response } = view;
  return NextResponse.json({ ...response, markedSeen: true });
}
