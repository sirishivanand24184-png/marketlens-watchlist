"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Freshness = "live" | "delayed" | "stale" | "simulated";

type Item = {
  symbol: string;
  priceNow?: number;
  currency?: string;
  dayChange?: number;
  dayChangePct?: number;
  previousClose?: number;
  pctChange?: number;
  zScore?: number;
  volumeSpike?: boolean;
  score?: number;
  reasons?: string[];
  freshness?: Freshness;
  freshnessMinutes?: number;
  marketState?: string;
  isNewToYou?: boolean;
  ok: boolean;
  error?: string;
};

type Meta = {
  firstView?: boolean;
  hoursSinceLastCheck?: number;
  digest?: string;
  markedSeen?: boolean;
  canSaveBaseline?: boolean;
  verifiedCount?: number;
};

type AppStatus = {
  label: string;
  tone: string;
  verified: boolean;
  message: string;
};

const DEMO_USER_ID = "demo-user";
const SITE_NAME = "MarketLens";
const SITE_TAGLINE = "Meaningful moves, minus the noise.";
const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "TSLA"];
const COMPANY_NAMES: Record<string, string> = {
  AAPL: "Apple",
  MSFT: "Microsoft",
  TSLA: "Tesla",
  GOOGL: "Alphabet",
  AMZN: "Amazon",
  NVDA: "Nvidia",
  META: "Meta",
  RELIANCE: "Reliance Industries",
  INFY: "Infosys",
  TCS: "Tata Consultancy Services",
  AIRTEL: "Bharti Airtel",
};

const DEMO_SCENARIO_ITEMS: Item[] = [
  {
    symbol: "TSLA",
    priceNow: 358,
    currency: "USD",
    dayChange: 22.8,
    dayChangePct: 0.068,
    previousClose: 335.2,
    pctChange: 0.068,
    zScore: 2.3,
    volumeSpike: true,
    score: 82,
    reasons: ["+6.8% since you last checked", "2.3x this stock's normal daily volatility", "unusually high volume"],
    freshness: "live",
    freshnessMinutes: 1,
    ok: true,
  },
  {
    symbol: "AAPL",
    priceNow: 355.98,
    currency: "USD",
    dayChange: -7.64,
    dayChangePct: -0.021,
    previousClose: 363.62,
    pctChange: -0.021,
    zScore: -1.6,
    volumeSpike: false,
    score: 46,
    reasons: ["-2.1% since you last checked", "larger than its recent baseline move"],
    freshness: "live",
    freshnessMinutes: 2,
    ok: true,
  },
  {
    symbol: "MSFT",
    priceNow: 383.98,
    currency: "USD",
    dayChange: 0.77,
    dayChangePct: 0.002,
    previousClose: 383.21,
    pctChange: 0.002,
    zScore: 0.3,
    volumeSpike: false,
    score: 8,
    reasons: ["+0.2% since you last checked"],
    freshness: "live",
    freshnessMinutes: 1,
    ok: true,
  },
];

function formatPrice(value?: number, currency = "USD") {
  if (!Number.isFinite(value)) return "--";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value!);
  } catch {
    return `${currency} ${value!.toFixed(2)}`;
  }
}

function formatPct(value?: number) {
  if (!Number.isFinite(value)) return "0.0%";
  const pct = value! * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function attentionLabel(score = 0) {
  if (score >= 60) return "High attention";
  if (score >= 30) return "Medium attention";
  return "Quiet";
}

function rowAttentionLabel(item: Item, needsBaseline: boolean) {
  if (needsBaseline && (item.score ?? 0) < 30) return "Baseline needed";
  return attentionLabel(item.score);
}

function attentionTone(score = 0) {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "quiet";
}

function isVerified(item: Item) {
  return item.freshness === "live" || item.freshness === "delayed";
}

function scorePercent(score = 0) {
  return `${Math.max(0, Math.min(100, score))}%`;
}

function visibleMovePct(item: Item, showSessionMove: boolean) {
  return showSessionMove && Number.isFinite(item.dayChangePct) ? item.dayChangePct : item.pctChange;
}

function visibleMoveLabel(showSessionMove: boolean) {
  return showSessionMove ? "today" : "since baseline";
}

function timeAgo(hours = 0) {
  if (hours <= 0.05) return "just now";
  if (hours < 1) return "less than 1h ago";
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Sparkline({
  pctChange = 0,
  symbol,
  verified,
}: {
  pctChange?: number;
  symbol: string;
  verified: boolean;
}) {
  if (!verified) {
    return <div className="sparkline unavailable">Verified trend unavailable</div>;
  }

  const seed = symbol.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const trend = Math.max(-1, Math.min(1, pctChange * 16));
  const bars = Array.from({ length: 14 }, (_, i) => {
    const wave = Math.sin((seed + i) * 0.8) * 14;
    const slope = trend * i * 3.2;
    return Math.max(18, Math.min(86, 42 + wave + slope));
  });

  return (
    <div className="sparkline" aria-hidden="true">
      {bars.map((height, index) => (
        <span key={index} style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

function ScoreBreakdown({ item, hoursSinceLastCheck = 0 }: { item: Item; hoursSinceLastCheck?: number }) {
  const score = item.score ?? 0;
  const movement = Math.min(60, Math.round(Math.abs(item.zScore ?? 0) * 22));
  const volume = item.volumeSpike ? 15 : 0;
  const visitGap = hoursSinceLastCheck > 72 ? 10 : 0;
  const freshness = item.freshness === "stale" ? -Math.round(score * 0.5) : item.freshness === "simulated" ? -20 : 0;

  return (
    <details className="scoreDetails">
      <summary>Why {score}?</summary>
      <div className="scoreGrid">
        <span>Price movement</span>
        <strong>+{movement}</strong>
        <span>Unusual volume</span>
        <strong>+{volume}</strong>
        <span>Change since visit</span>
        <strong>+{visitGap}</strong>
        <span>Data freshness</span>
        <strong>{freshness}</strong>
        <span className="scoreTotal">Attention score</span>
        <strong className="scoreTotal">{score}</strong>
      </div>
    </details>
  );
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<Meta>({});
  const [watchlistId, setWatchlistId] = useState<string | null>(null);
  const [symbolInput, setSymbolInput] = useState("");
  const [notice, setNotice] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const setupStarted = useRef(false);

  async function ensureWatchlist(): Promise<string> {
    const cached = localStorage.getItem("watchlistId");
    if (cached) return cached;

    const created = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: DEMO_USER_ID, name: "My Watchlist" }),
    }).then((r) => r.json());

    const addResults = await Promise.allSettled(
      DEFAULT_SYMBOLS.map((symbol) =>
        fetch(`/api/watchlist/${created.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
        }).then((r) => {
          if (!r.ok) throw new Error(`failed to add ${symbol}`);
        })
      )
    );
    const anySucceeded = addResults.some((r) => r.status === "fulfilled");
    if (!anySucceeded) {
      throw new Error("Could not add any default symbols");
    }

    localStorage.setItem("watchlistId", created.id);
    return created.id;
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const id = await ensureWatchlist();
      setWatchlistId(id);
      const res = await fetch(`/api/watchlist/${id}/refresh`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not refresh watchlist");
      setItems(data.items ?? []);
      setMeta(data);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function addSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!watchlistId || !symbolInput.trim()) return;
    setActionLoading(true);
    setNotice("");
    try {
      const symbol = symbolInput.trim().toUpperCase();
      const res = await fetch(`/api/watchlist/${watchlistId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Could not add ${symbol}`);
      setSymbolInput("");
      setNotice(`${symbol} added to your watchlist.`);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not add symbol");
    } finally {
      setActionLoading(false);
    }
  }

  async function removeSymbol(symbol: string) {
    if (!watchlistId) return;
    setActionLoading(true);
    setNotice("");
    try {
      const res = await fetch(`/api/watchlist/${watchlistId}?symbol=${encodeURIComponent(symbol)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Could not remove ${symbol}`);
      setNotice(`${symbol} removed.`);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not remove symbol");
    } finally {
      setActionLoading(false);
    }
  }

  async function markSeen() {
    if (!watchlistId) return;
    setActionLoading(true);
    setNotice("");
    try {
      const res = await fetch(`/api/watchlist/${watchlistId}/refresh`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save the current baseline");
      setNotice("Digest marked as seen. Future changes will compare against this snapshot.");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not mark digest as seen");
    } finally {
      setActionLoading(false);
    }
  }

  useEffect(() => {
    if (setupStarted.current) return;
    setupStarted.current = true;
    load();
  }, []);

  const displayItems = demoMode ? DEMO_SCENARIO_ITEMS : items;
  const hasVerifiedQuotes =
    !demoMode &&
    (typeof meta.canSaveBaseline === "boolean"
      ? meta.canSaveBaseline
      : items.some((item) => item.freshness === "live" || item.freshness === "delayed"));
  const allUnverified = !demoMode && items.length > 0 && !hasVerifiedQuotes;
  const needsFirstBaseline =
    !demoMode &&
    hasVerifiedQuotes &&
    displayItems.length > 0 &&
    displayItems.every((item) => item.isNewToYou);
  const baselineFresh =
    !demoMode &&
    hasVerifiedQuotes &&
    !needsFirstBaseline &&
    displayItems.length > 0 &&
    (meta.hoursSinceLastCheck ?? 999) <= 0.1 &&
    displayItems.every((item) => (item.score ?? 0) === 0);
  const showSessionMoves = !demoMode && hasVerifiedQuotes && (needsFirstBaseline || baselineFresh);
  const highAndMedium = displayItems.filter((item) => (item.score ?? 0) >= 30);
  const quiet = displayItems.filter((item) => (item.score ?? 0) < 30);
  const verifiedDisplayCount = demoMode ? displayItems.length : meta.verifiedCount ?? displayItems.filter(isVerified).length;
  const averageScore =
    displayItems.length === 0
      ? 0
      : Math.round(displayItems.reduce((sum, item) => sum + (item.score ?? 0), 0) / displayItems.length);
  const topAttention = displayItems[0] ?? null;
  const biggestMove = useMemo(
    () =>
      displayItems.reduce<Item | null>((winner, item) => {
        if (!winner) return item;
        return Math.abs(visibleMovePct(item, showSessionMoves) ?? 0) >
          Math.abs(visibleMovePct(winner, showSessionMoves) ?? 0)
          ? item
          : winner;
      }, null),
    [displayItems, showSessionMoves]
  );
  const status: AppStatus = useMemo(() => {
    if (demoMode) {
      return {
        label: "DEMO SCENARIO",
        tone: "demo",
        verified: true,
        message: "Fixed test data for demonstrating attention ranking. It never saves or overwrites your verified baseline.",
      };
    }
    const hasSimulated = items.some((item) => item.freshness === "simulated");
    const hasStale = items.some((item) => item.freshness === "stale");
    const hasDelayed = items.some((item) => item.freshness === "delayed");
    const canSaveBaseline = !!meta.canSaveBaseline;
    if (canSaveBaseline && (hasSimulated || hasStale)) {
      return {
        label: "PARTIAL",
        tone: "partial",
        verified: true,
        message: "Some symbols are unverified, but verified quotes can still be saved for eligible symbols.",
      };
    }
    if (hasSimulated) {
      return {
        label: "SIMULATED",
        tone: "simulated",
        verified: false,
        message: "Live market data is temporarily unavailable. Simulated fallback values cannot be saved as your baseline.",
      };
    }
    if (hasStale) {
      return {
        label: "STALE",
        tone: "stale",
        verified: false,
        message: "Showing the last verified snapshot while the provider is unavailable. Refresh before saving a new baseline.",
      };
    }
    if (hasDelayed) {
      return {
        label: "DELAYED",
        tone: "delayed",
        verified: true,
        message: "Delayed provider data is available and can be saved as the next comparison baseline.",
      };
    }
    return {
      label: "LIVE",
      tone: "live",
      verified: true,
      message: "Verified quotes are available. Marking the digest as seen will save a new baseline.",
    };
  }, [demoMode, items, meta.canSaveBaseline]);
  const heroHeadline = loading
    ? "Checking your watchlist..."
    : demoMode
    ? "Demo scenario: 2 stocks need attention"
    : allUnverified
    ? "Live market data temporarily unavailable"
    : needsFirstBaseline
    ? "Save your first verified baseline"
    : baselineFresh
    ? "Baseline saved. Monitoring changes"
    : highAndMedium.length > 0
    ? `${highAndMedium.length} stock${highAndMedium.length > 1 ? "s" : ""} need your attention`
    : "No meaningful moves right now";
  const heroDigest = demoMode
    ? "Fixed test data shows how the attention algorithm ranks meaningful movement: TSLA is high, AAPL is medium, and MSFT is quiet. This scenario is separate from your real watchlist and cannot update snapshots."
    : allUnverified
    ? "Your watchlist is preserved. Meaningful-change detection will resume when verified quotes are available."
    : needsFirstBaseline
    ? "Verified prices are available. Mark this digest as seen once to create the baseline; the next visit will compare against it."
    : baselineFresh
    ? "Your current verified prices are saved. Come back later or refresh after market movement to see what changed."
    : meta.digest ?? "Live prices, baseline snapshots, and attention scores will appear here.";
  const pulseTitle = demoMode
    ? "Scenario signal"
    : allUnverified
    ? "Provider fallback"
    : needsFirstBaseline
    ? "Baseline pending"
    : baselineFresh
    ? "Monitoring"
    : highAndMedium.length > 0
    ? "Attention required"
    : "Quiet market";
  const pulseDetail = demoMode
    ? "Fixed test data is showing the ranking engine at full strength."
    : allUnverified
    ? "No verified quote is eligible for baseline saving right now."
    : needsFirstBaseline
    ? `${verifiedDisplayCount} verified quotes are ready to become your first snapshot.`
    : baselineFresh
    ? `${verifiedDisplayCount} symbols are now watched against the saved baseline.`
    : highAndMedium.length > 0
    ? `${topAttention?.symbol} is the highest-priority signal in this watchlist.`
    : `${verifiedDisplayCount} verified symbols are inside their expected range.`;
  const tapeItems = displayItems.slice(0, 5);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brandBlock">
          <span className="brandMark" aria-hidden="true">
            ML
          </span>
          <div>
            <p className="eyebrow">{SITE_NAME}</p>
            <h1>{SITE_TAGLINE}</h1>
          </div>
        </div>
        <nav className="navLinks" aria-label="Product areas">
          <a href="#watchlist">Watchlist</a>
          <a href="#signals">Attention</a>
          <a href="#baseline">Baseline</a>
          <a href="#baseline">Data status</a>
        </nav>
        <div className="topActions">
          <span className={`status ${status.tone}`} title={status.message}>
            <span />
            {status.label}
          </span>
          <button className="ghostButton" onClick={load} disabled={loading || actionLoading}>
            Refresh
          </button>
          <button className={`ghostButton ${demoMode ? "active" : ""}`} onClick={() => setDemoMode((value) => !value)}>
            {demoMode ? "Real watchlist" : "Demo scenario"}
          </button>
        </div>
      </header>

      <section className="marketTape" aria-label="Market tape">
        <div className="tapeLead">
          <strong>{demoMode ? "Demo tape" : "Watchlist tape"} </strong>
          <span>{status.label}</span>
        </div>
        {tapeItems.length === 0 && <div className="tickerPill emptyTicker">Add a symbol to start the tape</div>}
        {tapeItems.map((item) => {
          const move = visibleMovePct(item, showSessionMoves);
          const positive = (move ?? 0) >= 0;
          return (
            <div className="tickerPill" key={`tape-${item.symbol}`}>
              <strong>{item.symbol}</strong>
              <span>{formatPrice(item.priceNow, item.currency)}</span>
              <small className={positive ? "positive" : "negative"}>
                {formatPct(move)} {showSessionMoves ? "today" : "base"}
              </small>
            </div>
          );
        })}
      </section>

      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner success">{notice}</div>}

      <section className="heroBand">
        <div>
          <p className="muted">{demoMode ? "Fixed test scenario" : meta.firstView ? "Welcome back setup" : `Last seen ${timeAgo(meta.hoursSinceLastCheck)}`}</p>
          <h2>{heroHeadline}</h2>
          <p className="digest">{heroDigest}</p>
          {(allUnverified || demoMode) && <p className="statusNote">{status.message}</p>}
        </div>
        <aside className="sideStack">
          <div className={`pulsePanel ${status.tone}`}>
            <div className="pulseTop">
              <span>{pulseTitle}</span>
              <strong>{demoMode ? "82" : topAttention ? topAttention.score ?? 0 : 0}</strong>
            </div>
            <p>{pulseDetail}</p>
            <div className="pulseMeter">
              <span style={{ width: demoMode ? "82%" : scorePercent(topAttention?.score ?? 0) }} />
            </div>
          </div>
          <form className="addPanel" onSubmit={addSymbol} aria-disabled={demoMode}>
            <label htmlFor="symbol">Add stock</label>
            <div>
              <input
                id="symbol"
                value={symbolInput}
                onChange={(event) => setSymbolInput(event.target.value)}
                placeholder="Search symbol"
                maxLength={16}
                disabled={demoMode}
              />
              <button disabled={demoMode || actionLoading || !symbolInput.trim()}>Add</button>
            </div>
          </form>
        </aside>
      </section>

      <section className="signalGrid" id="baseline" aria-label="Market signal state">
        <div className="signalTile">
          <span>Verified Feed</span>
          <strong>{verifiedDisplayCount}/{displayItems.length || 0}</strong>
          <small>{status.label.toLowerCase()}</small>
        </div>
        <div className={`signalTile ${needsFirstBaseline ? "attention" : baselineFresh ? "good" : ""}`}>
          <span>Baseline</span>
          <strong>{needsFirstBaseline ? "Ready" : baselineFresh ? "Saved" : allUnverified ? "Paused" : "Active"}</strong>
          <small>{needsFirstBaseline ? "one click away" : timeAgo(meta.hoursSinceLastCheck)}</small>
        </div>
        <div className={`signalTile ${averageScore >= 30 ? "attention" : "good"}`}>
          <span>Average Score</span>
          <strong>{averageScore}</strong>
          <small>{averageScore >= 30 ? "watch closely" : "calm"}</small>
        </div>
      </section>

      <section className="summaryGrid" aria-label="Watchlist summary">
        <div className="summaryCard">
          <span>Watching</span>
          <strong>{displayItems.length}</strong>
          <small>{demoMode ? "demo stocks" : "stocks"}</small>
        </div>
        <div className={`summaryCard ${allUnverified ? "warning" : highAndMedium.length > 0 ? "hot" : ""}`}>
          <span>Need Attention</span>
          <strong>{highAndMedium.length}</strong>
          <small>{allUnverified ? "unknown until verified" : `${verifiedDisplayCount} verified`}</small>
        </div>
        <div className={`summaryCard ${allUnverified ? "warning" : ""}`}>
          <span>Biggest Move</span>
          <strong>{allUnverified ? "Unavailable" : biggestMove?.symbol ?? "--"}</strong>
          <small>
            {allUnverified
              ? "verified quotes required"
              : biggestMove
              ? `${formatPct(visibleMovePct(biggestMove, showSessionMoves))} ${visibleMoveLabel(showSessionMoves)}`
              : "waiting for data"}
          </small>
        </div>
      </section>

      <section className="sectionHeader" id="signals">
        <div>
          <p className="eyebrow">Since Your Last Visit</p>
          <h3>{demoMode ? "Demo attention ranking" : "Ranked by attention"}</h3>
        </div>
        <button className="primaryButton" onClick={markSeen} disabled={demoMode || baselineFresh || !status.verified || loading || actionLoading || items.length === 0}>
          {demoMode ? "Demo only" : baselineFresh ? "Baseline saved" : status.verified ? "Mark digest as seen" : "Waiting for verified quotes"}
        </button>
      </section>

      {loading && <div className="loading">Loading market data...</div>}

      {!loading && allUnverified && (
        <div className="quietState warning">
          <span>Meaningful-change detection is paused because every visible quote is unverified.</span>
          <button className="inlineButton" onClick={() => setDemoMode(true)}>
            View demo scenario
          </button>
        </div>
      )}

      {!loading && needsFirstBaseline && (
        <div className="quietState baseline">Verified prices are ready. Save this as your first baseline to unlock change detection.</div>
      )}

      {!loading && baselineFresh && (
        <div className="quietState baseline">Baseline saved successfully. The next meaningful move will appear here.</div>
      )}

      {!loading && !allUnverified && !needsFirstBaseline && !baselineFresh && highAndMedium.length === 0 && displayItems.length > 0 && (
        <div className="quietState">Everything is inside its normal range. Your baseline is still ready for the next move.</div>
      )}

      <div className="attentionList">
        {highAndMedium.map((item) => (
          <article key={item.symbol} className={`stockCard ${attentionTone(item.score)}`}>
            <div className="stockTop">
              <div>
                <div className="symbolLine">
                  <strong>{item.symbol}</strong>
                  <span>{COMPANY_NAMES[item.symbol] ?? "Tracked stock"}</span>
                </div>
                <p>
                  {attentionLabel(item.score)} / Score {item.score ?? 0}
                </p>
              </div>
              <div className="priceBlock">
                <strong>{formatPrice(item.priceNow, item.currency)}</strong>
                <span className={(visibleMovePct(item, showSessionMoves) ?? 0) >= 0 ? "positive" : "negative"}>
                  {formatPct(visibleMovePct(item, showSessionMoves))} {visibleMoveLabel(showSessionMoves)}
                </span>
              </div>
            </div>
            <div className="attentionMeter">
              <span style={{ width: scorePercent(item.score ?? 0) }} />
            </div>
            <Sparkline symbol={item.symbol} pctChange={visibleMovePct(item, showSessionMoves)} verified={demoMode || item.freshness === "live" || item.freshness === "delayed"} />
            <div className="reasonBox">
              <strong>Meaningful change</strong>
              {(item.reasons ?? ["No explanation returned"]).map((reason) => (
                <span key={reason}>{reason}</span>
              ))}
            </div>
            <div className="cardFooter">
              <span>Baseline {timeAgo(meta.hoursSinceLastCheck)} -&gt; now</span>
              <span className={`freshness ${item.freshness}`}>
                {item.freshness ?? "live"}
                {item.marketState ? ` / ${item.marketState}` : ""}
              </span>
            </div>
            <ScoreBreakdown item={item} hoursSinceLastCheck={meta.hoursSinceLastCheck} />
          </article>
        ))}
      </div>

      <section className="allList" id="watchlist">
        <div className="sectionHeader compact">
          <div>
            <p className="eyebrow">All Watchlist</p>
            <h3>Full watchlist</h3>
          </div>
        </div>
        {displayItems.length === 0 && !loading && <div className="empty">Add a symbol to start tracking what changed.</div>}
        {[...quiet, ...highAndMedium].map((item) => (
          <div className={`watchRow ${attentionTone(item.score)}`} key={`row-${item.symbol}`}>
            <div className="rowIdentity">
              <strong>{item.symbol}</strong>
              <span>{COMPANY_NAMES[item.symbol] ?? "Tracked stock"}</span>
              <small>{item.marketState ? `${item.freshness ?? "live"} / ${item.marketState}` : item.freshness ?? "live"}</small>
            </div>
            <Sparkline symbol={item.symbol} pctChange={visibleMovePct(item, showSessionMoves)} verified={demoMode || item.freshness === "live" || item.freshness === "delayed"} />
            <div className="rowPrice">
              <span>{formatPrice(item.priceNow, item.currency)}</span>
              <strong className={(visibleMovePct(item, showSessionMoves) ?? 0) >= 0 ? "positive" : "negative"}>
                {formatPct(visibleMovePct(item, showSessionMoves))} {visibleMoveLabel(showSessionMoves)}
              </strong>
            </div>
            <div className="rowScore">
              <span className={`quietBadge ${needsFirstBaseline && (item.score ?? 0) < 30 ? "pending" : attentionTone(item.score)}`}>
                {rowAttentionLabel(item, needsFirstBaseline)}
              </span>
              <div className="miniMeter">
                <span style={{ width: scorePercent(item.score ?? 0) }} />
              </div>
            </div>
            <button className="iconButton" onClick={() => removeSymbol(item.symbol)} disabled={demoMode || actionLoading} title={`Remove ${item.symbol}`}>
              Remove
            </button>
          </div>
        ))}
      </section>

      <style jsx>{`
        :global(*) {
          box-sizing: border-box;
        }

        :global(body) {
          margin: 0;
          background:
            linear-gradient(90deg, rgba(20, 184, 166, 0.08) 1px, transparent 1px),
            linear-gradient(180deg, #07111f 0, #0f172a 470px, #eef5f1 470px, #f8faf7 100%);
          background-size: 72px 100%, auto;
          color: #17202a;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        button,
        input {
          font: inherit;
        }

        button {
          cursor: pointer;
        }

        button:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .shell {
          width: min(1240px, calc(100% - 40px));
          margin: 0 auto;
          padding: 28px 0 64px;
        }

        .topbar,
        .heroBand,
        .sectionHeader,
        .stockTop,
        .cardFooter,
        .watchRow,
        .topActions,
        .symbolLine {
          display: flex;
          align-items: center;
        }

        .topbar,
        .sectionHeader,
        .stockTop,
        .cardFooter {
          justify-content: space-between;
          gap: 18px;
        }

        .topbar {
          display: grid;
          grid-template-columns: minmax(320px, 1fr) auto auto;
          align-items: center;
          position: relative;
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 8px;
          background:
            linear-gradient(135deg, rgba(20, 184, 166, 0.16), rgba(37, 99, 235, 0.06) 42%, transparent 70%),
            rgba(8, 16, 30, 0.88);
          padding: 16px 18px;
          box-shadow: 0 28px 70px rgba(2, 6, 23, 0.28);
          backdrop-filter: blur(14px);
        }

        .brandBlock {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
        }

        .brandMark {
          display: grid;
          flex: 0 0 auto;
          width: 48px;
          height: 48px;
          place-items: center;
          border: 1px solid rgba(153, 246, 228, 0.38);
          border-radius: 8px;
          background:
            linear-gradient(135deg, #5eead4, #38bdf8);
          color: #07111f;
          font-weight: 950;
          letter-spacing: 0;
          box-shadow: 0 14px 30px rgba(45, 212, 191, 0.18);
        }

        .navLinks {
          display: flex;
          align-items: center;
          gap: 6px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.52);
          padding: 5px;
        }

        .navLinks a {
          border-radius: 6px;
          color: #cbd5e1;
          font-size: 12px;
          font-weight: 850;
          padding: 8px 10px;
          text-decoration: none;
          white-space: nowrap;
          transition: background 120ms ease, color 120ms ease;
        }

        .navLinks a:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #f8fafc;
        }

        .eyebrow {
          margin: 0 0 6px;
          color: #64748b;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        .topbar .eyebrow {
          color: #5eead4;
        }

        h1,
        h2,
        h3,
        p {
          margin-top: 0;
        }

        h1 {
          margin-bottom: 0;
          font-size: clamp(30px, 42px, 46px);
          line-height: 1.05;
          color: #f8fafc;
        }

        h2 {
          max-width: 680px;
          margin-bottom: 14px;
          font-size: clamp(34px, 46px, 52px);
          line-height: 1.04;
        }

        h3 {
          margin-bottom: 0;
          font-size: 24px;
        }

        .topActions {
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-height: 36px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.94);
          padding: 0 13px;
          font-size: 12px;
          font-weight: 800;
        }

        .status span {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #17a765;
        }

        .status.simulated span,
        .status.stale span {
          background: #d97706;
        }

        .status.delayed span {
          background: #ca8a04;
        }

        .status.partial span,
        .status.demo span {
          background: #2563eb;
        }

        .ghostButton,
        .primaryButton,
        .addPanel button,
        .iconButton {
          border: 0;
          border-radius: 8px;
          font-weight: 800;
        }

        .ghostButton {
          min-height: 36px;
          background: rgba(255, 255, 255, 0.11);
          color: #f8fafc;
          padding: 0 14px;
          transition: transform 120ms ease, background 120ms ease, box-shadow 120ms ease;
        }

        .ghostButton.active {
          background: #ccfbf1;
          color: #115e59;
        }

        .ghostButton:hover:not(:disabled),
        .iconButton:hover:not(:disabled),
        .primaryButton:hover:not(:disabled),
        .addPanel button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
        }

        .marketTape {
          display: grid;
          grid-template-columns: auto repeat(5, minmax(128px, 1fr));
          gap: 8px;
          margin-top: 12px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 8px;
          background: rgba(8, 16, 30, 0.72);
          padding: 10px;
          box-shadow: 0 20px 50px rgba(2, 6, 23, 0.18);
        }

        .tapeLead,
        .tickerPill {
          min-height: 52px;
          border-radius: 7px;
          background: rgba(255, 255, 255, 0.08);
          padding: 9px 12px;
        }

        .tapeLead {
          display: grid;
          align-content: center;
          min-width: 150px;
          color: #e2e8f0;
        }

        .tapeLead strong,
        .tickerPill strong {
          font-size: 12px;
          font-weight: 950;
          text-transform: uppercase;
        }

        .tapeLead span {
          color: #94a3b8;
          font-size: 12px;
          font-weight: 800;
        }

        .tickerPill {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 2px 10px;
          color: #f8fafc;
        }

        .tickerPill span {
          justify-self: end;
          color: #e2e8f0;
          font-size: 13px;
          font-weight: 850;
        }

        .tickerPill small {
          grid-column: 1 / -1;
          font-size: 12px;
          font-weight: 900;
        }

        .emptyTicker {
          grid-column: span 2;
          align-content: center;
          color: #cbd5e1;
          font-weight: 850;
        }

        .primaryButton,
        .addPanel button {
          background: #0f766e;
          color: white;
          min-height: 44px;
          padding: 0 16px;
        }

        .heroBand {
          align-items: stretch;
          margin-top: 22px;
          border: 1px solid rgba(209, 231, 225, 0.92);
          border-radius: 8px;
          background:
            linear-gradient(135deg, #ffffff 0, #ffffff 58%, #ecfdf5 100%);
          padding: 34px;
          gap: 28px;
          box-shadow: 0 30px 70px rgba(2, 6, 23, 0.2);
        }

        .heroBand h2 {
          color: #07111f;
          text-wrap: balance;
        }

        .heroBand .muted,
        .heroBand .digest {
          color: #52637a;
        }

        .heroBand .statusNote {
          display: inline-block;
          margin-top: 8px;
          border-color: rgba(251, 191, 36, 0.42);
          background: rgba(120, 53, 15, 0.36);
          color: #fed7aa;
        }

        .heroBand > div:first-child {
          flex: 1 1 auto;
        }

        .sideStack {
          display: grid;
          align-self: center;
          width: min(400px, 100%);
          gap: 12px;
        }

        .pulsePanel {
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 8px;
          background:
            linear-gradient(135deg, rgba(94, 234, 212, 0.2), transparent 44%),
            #07111f;
          color: white;
          padding: 20px;
          box-shadow: 0 22px 48px rgba(2, 6, 23, 0.28);
        }

        .pulsePanel.delayed,
        .pulsePanel.partial {
          background:
            linear-gradient(135deg, rgba(245, 158, 11, 0.18), transparent 42%),
            #111827;
        }

        .pulsePanel.demo {
          background:
            linear-gradient(135deg, rgba(20, 184, 166, 0.24), transparent 42%),
            #0f172a;
        }

        .pulsePanel.simulated,
        .pulsePanel.stale {
          background: #3b2607;
        }

        .pulseTop {
          display: flex;
          align-items: start;
          justify-content: space-between;
          gap: 14px;
        }

        .pulseTop span {
          color: #cbd5e1;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .pulseTop strong {
          font-size: 56px;
          line-height: 0.9;
        }

        .pulsePanel p {
          margin: 14px 0 16px;
          color: #dbeafe;
          line-height: 1.45;
        }

        .pulseMeter,
        .attentionMeter,
        .miniMeter {
          overflow: hidden;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.24);
        }

        .pulseMeter {
          height: 9px;
        }

        .pulseMeter span,
        .attentionMeter span,
        .miniMeter span {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #10b981, #f59e0b, #ef4444);
        }

        .muted,
        .digest,
        .symbolLine span,
        .stockTop p,
        .cardFooter,
        .watchRow div span,
        .summaryCard small {
          color: #64748b;
        }

        .digest {
          max-width: 760px;
          margin-bottom: 0;
          font-size: 16px;
          line-height: 1.55;
          color: #475569;
        }

        .statusNote {
          max-width: 760px;
          margin: 14px 0 0;
          border-left: 4px solid #d97706;
          background: #fff7ed;
          padding: 10px 12px;
          color: #92400e;
          font-size: 14px;
          font-weight: 800;
        }

        .heroBand .statusNote {
          display: inline-block;
          margin-top: 8px;
          border-color: rgba(251, 191, 36, 0.42);
          background: rgba(120, 53, 15, 0.36);
          color: #fed7aa;
        }

        .addPanel {
          width: 100%;
          align-self: center;
          border: 1px solid #d7e4df;
          border-radius: 8px;
          background: white;
          padding: 16px;
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.1);
        }

        .addPanel label {
          display: block;
          margin-bottom: 10px;
          color: #344054;
          font-size: 13px;
          font-weight: 800;
        }

        .addPanel div {
          display: flex;
          gap: 8px;
        }

        .addPanel input {
          min-width: 0;
          flex: 1;
          border: 1px solid #cfd8e3;
          border-radius: 8px;
          padding: 0 12px;
          min-height: 44px;
          text-transform: uppercase;
        }

        .summaryGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
          margin: 18px 0 34px;
        }

        .signalGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin: 14px 0 0;
        }

        .signalTile {
          border: 1px solid rgba(203, 213, 225, 0.92);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.92);
          padding: 16px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
        }

        .signalTile span {
          display: block;
          color: #697586;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .signalTile strong {
          display: block;
          margin-top: 8px;
          font-size: 24px;
          line-height: 1;
        }

        .signalTile small {
          display: block;
          margin-top: 4px;
          color: #64748b;
        }

        .signalTile.good {
          border-color: #bbf7d0;
          background: #f0fdf4;
        }

        .signalTile.attention {
          border-color: #fed7aa;
          background: #fff7ed;
        }

        .summaryCard,
        .stockCard,
        .quietState,
        .empty,
        .banner {
          border: 1px solid rgba(203, 213, 225, 0.95);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.96);
        }

        .summaryCard {
          position: relative;
          min-height: 136px;
          padding: 20px;
          overflow: hidden;
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.08);
        }

        .summaryCard::after {
          position: absolute;
          top: 18px;
          right: 18px;
          width: 34px;
          height: 34px;
          border-radius: 999px;
          background: #dbeafe;
          color: #475569;
          content: "";
        }

        .summaryCard.hot::after {
          background: #fff1f2;
          box-shadow: inset 0 0 0 10px #dc2626;
        }

        .summaryCard.warning::after {
          background: #fff7ed;
          box-shadow: inset 0 0 0 10px #d97706;
        }

        .summaryCard span {
          color: #697586;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
        }

        .summaryCard strong {
          display: block;
          margin-top: 16px;
          font-size: 42px;
          line-height: 1;
          word-break: break-word;
        }

        .sectionHeader {
          margin: 34px 0 16px;
        }

        .sectionHeader.compact {
          margin-top: 34px;
        }

        .attentionList {
          display: grid;
          gap: 14px;
        }

        .stockCard {
          padding: 22px;
          box-shadow: 0 22px 42px rgba(15, 23, 42, 0.12);
          border-left: 6px solid #94a3b8;
        }

        .stockCard.high {
          border-left-color: #dc2626;
        }

        .stockCard.medium {
          border-left-color: #d97706;
        }

        .symbolLine {
          gap: 12px;
          flex-wrap: wrap;
        }

        .symbolLine strong {
          font-size: 30px;
        }

        .stockTop p {
          margin: 4px 0 0;
          font-weight: 700;
        }

        .attentionMeter {
          height: 8px;
          margin-top: 18px;
        }

        .priceBlock {
          text-align: right;
        }

        .priceBlock strong {
          display: block;
          font-size: 27px;
        }

        .positive {
          color: #047857;
          font-weight: 900;
        }

        .negative {
          color: #dc2626;
          font-weight: 900;
        }

        .sparkline {
          display: flex;
          align-items: end;
          justify-content: center;
          gap: 5px;
          height: 74px;
          margin: 18px 0;
          border-radius: 8px;
          background: linear-gradient(180deg, #ffffff, #eef6f4);
          padding: 12px;
          overflow: hidden;
        }

        .sparkline.unavailable {
          align-items: center;
          border: 1px dashed #cbd5e1;
          background: #f8fafc;
          color: #94a3b8;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
        }

        .sparkline span {
          width: 100%;
          min-width: 5px;
          border-radius: 4px 4px 0 0;
          background: linear-gradient(180deg, #14b8a6, #0f766e);
        }

        .reasonBox {
          display: grid;
          gap: 6px;
          border-radius: 8px;
          background: #f6fbf9;
          padding: 14px;
          color: #475569;
        }

        .reasonBox strong {
          color: #17202a;
        }

        .cardFooter {
          margin-top: 14px;
          font-size: 13px;
        }

        .freshness,
        .quietBadge {
          border-radius: 999px;
          background: #e8f4ef;
          color: #08784a;
          padding: 5px 9px;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .freshness.simulated,
        .freshness.stale {
          background: #fff3d7;
          color: #a45b00;
        }

        .freshness.delayed,
        .quietBadge.medium {
          background: #fff7ed;
          color: #b45309;
        }

        .quietBadge.high {
          background: #fff1f2;
          color: #be123c;
        }

        .quietBadge.pending {
          background: #eef2ff;
          color: #3730a3;
        }

        .scoreDetails {
          margin-top: 14px;
          color: #334155;
        }

        .scoreDetails summary {
          width: max-content;
          max-width: 100%;
          cursor: pointer;
          font-weight: 900;
        }

        .scoreGrid {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px 18px;
          width: min(360px, 100%);
          margin-top: 12px;
          border-top: 1px solid #dbe1e8;
          padding-top: 12px;
        }

        .scoreTotal {
          border-top: 1px solid #dbe1e8;
          padding-top: 8px;
          color: #17202a;
        }

        .quietState,
        .empty,
        .loading,
        .banner {
          padding: 16px;
          color: #475569;
        }

        .quietState.warning {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          border-color: #fed7aa;
          background: #fff7ed;
          color: #92400e;
        }

        .quietState.baseline {
          border-color: #99f6e4;
          background: #ecfdf5;
          color: #0f766e;
          font-weight: 800;
        }

        .inlineButton {
          min-height: 36px;
          border: 0;
          border-radius: 8px;
          background: #17202a;
          color: white;
          padding: 0 12px;
          font-weight: 900;
          white-space: nowrap;
        }

        .banner {
          margin-top: 18px;
          font-weight: 800;
        }

        .banner.error {
          border-color: #fecaca;
          background: #fff1f2;
          color: #be123c;
        }

        .banner.success {
          border-color: #bbf7d0;
          background: #f0fdf4;
          color: #15803d;
        }

        .allList {
          margin-top: 12px;
          border-radius: 8px;
        }

        .watchRow {
          display: grid;
          grid-template-columns: minmax(170px, 1fr) minmax(180px, 0.8fr) minmax(132px, auto) minmax(158px, 0.7fr) auto;
          gap: 16px;
          min-height: 96px;
          align-items: center;
          margin-bottom: 12px;
          border: 1px solid rgba(203, 213, 225, 0.95);
          border-radius: 8px;
          background:
            linear-gradient(90deg, #ffffff, #fbfefd);
          padding: 16px;
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.08);
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        }

        .watchRow:hover {
          transform: translateY(-2px);
          border-color: #7dd3c7;
          box-shadow: 0 24px 44px rgba(15, 23, 42, 0.12);
        }

        .watchRow.high {
          border-left: 5px solid #dc2626;
        }

        .watchRow.medium {
          border-left: 5px solid #d97706;
        }

        .watchRow.quiet {
          border-left: 5px solid #cbd5e1;
        }

        .rowIdentity strong,
        .rowIdentity span,
        .rowIdentity small,
        .rowPrice span,
        .rowPrice strong {
          display: block;
        }

        .rowIdentity small {
          margin-top: 5px;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .watchRow .sparkline {
          height: 58px;
          margin: 0;
          padding: 8px;
        }

        .rowPrice {
          text-align: right;
        }

        .rowPrice span {
          color: #17202a;
          font-size: 17px;
          font-weight: 900;
        }

        .rowScore {
          display: grid;
          gap: 8px;
        }

        .miniMeter {
          height: 6px;
        }

        .iconButton {
          min-height: 36px;
          background: #eef3f7;
          color: #334155;
          padding: 0 12px;
        }

        @media (max-width: 1100px) {
          .topbar {
            grid-template-columns: 1fr auto;
          }

          .navLinks {
            grid-column: 1 / -1;
            grid-row: 2;
            width: fit-content;
          }

          .marketTape {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .tapeLead {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 820px) {
          .heroBand,
          .sectionHeader,
          .stockTop,
          .cardFooter {
            align-items: stretch;
            flex-direction: column;
          }

          .topbar {
            grid-template-columns: 1fr;
            align-items: stretch;
          }

          .brandBlock {
            align-items: flex-start;
          }

          .navLinks {
            overflow-x: auto;
          }

          .marketTape {
            grid-template-columns: 1fr 1fr;
          }

          .tapeLead,
          .emptyTicker {
            grid-column: 1 / -1;
          }

          .topActions {
            justify-content: flex-start;
          }

          .summaryGrid {
            grid-template-columns: 1fr;
          }

          .signalGrid {
            grid-template-columns: 1fr;
          }

          .priceBlock {
            text-align: left;
          }

          .watchRow {
            grid-template-columns: 1fr 1fr;
          }

          .watchRow .sparkline {
            grid-column: 1 / -1;
          }

          .rowPrice {
            text-align: left;
          }
        }

        @media (max-width: 520px) {
          .shell {
            width: min(100% - 20px, 1240px);
            padding-top: 28px;
          }

          .addPanel div {
            flex-direction: column;
          }

          .watchRow {
            grid-template-columns: 1fr;
            align-items: stretch;
          }
        }
      `}</style>
    </main>
  );
}
