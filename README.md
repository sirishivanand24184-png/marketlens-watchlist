# Smart Market Watchlist - Code by Groww 2026

## Product Idea

Smart Market Watchlist is not another flat list of stock prices. It answers the question a returning investor actually has:

**What changed since I last checked, and what deserves my limited attention now?**

The app keeps a watchlist, stores explicit viewed-price baselines, compares later verified quotes against that baseline, ranks stocks by significance, and explains the score behind each alert.

## How to Judge the App

1. Open the app and add/remove symbols from the watchlist.
2. Click **Mark digest as seen** when verified quotes are available. This saves the current verified prices as the comparison baseline.
3. Return later or refresh after prices change. The app ranks symbols by meaningful movement since that saved baseline.
4. Open **Why score?** on an attention card to see the components behind the ranking.
5. If the upstream quote provider is unavailable, click **Demo scenario**. This uses fixed, explicitly labelled test data to demonstrate the attention algorithm without pretending it is live market data.

## Challenge Coverage

### Create and Manage a Watchlist

- The UI supports adding and removing stock symbols.
- The API uses an idempotent upsert for adding symbols and a tolerant delete for already-removed symbols.
- Symbols are normalized and validated before persistence.

### Return Later and See What Changed

- `WatchlistSnapshot` stores the user's last acknowledged baseline in Postgres.
- `GET /api/watchlist/[id]/refresh` shows the current comparison without moving the baseline.
- `POST /api/watchlist/[id]/refresh` is the explicit acknowledgement action behind **Mark digest as seen**.
- Simulated and stale fallback data cannot overwrite the verified baseline.

### Prioritize Meaningful Changes

- `lib/significance.ts` scores each stock relative to its own recent volatility, not a single flat percent threshold.
- Price movement, volatility-adjusted z-score, unusual volume, visit gap, and freshness all influence the attention score.
- The UI sorts by score and labels each symbol as `High attention`, `Medium attention`, or `Quiet`.

### Handle Stale, Delayed or Conflicting Data

- Each quote tracks both provider market time and local fetch time.
- Data is classified as `LIVE`, `DELAYED`, `STALE`, `SIMULATED`, or `PARTIAL`.
- Closed-market quotes, such as a Friday US close viewed on Saturday in India, are treated as verified `DELAYED` data rather than fake/stale data.
- Stale prices are down-weighted and are not baseline-eligible.
- If all symbols are unverified, the UI says **Live market data temporarily unavailable** instead of claiming there were no meaningful moves.

## Setup

```bash
npm install
```

Create a `.env` file with a Postgres connection string:

```bash
DATABASE_URL="postgresql://..."
```

Then initialize Prisma and run the app:

```bash
npx prisma migrate dev --name init
npm run dev
```

Open `http://localhost:3000`. If port `3000` is busy, Next will choose another local port.

## Verification

```bash
npm run typecheck
npm run build
```

## Architecture

```text
app/page.tsx                         product UI, demo scenario, add/remove, mark-seen flow
app/api/watchlist/route.ts            create and list watchlists
app/api/watchlist/[id]/route.ts       add/remove symbols
app/api/watchlist/[id]/refresh        compare current data to baseline; save baseline only on POST
lib/marketData.ts                     quote provider wrapper, retries, simulated fallback
lib/significance.ts                   meaningful-change scoring engine
lib/digest.ts                         deterministic watchlist summary
lib/db.ts                             Prisma client
prisma/schema.prisma                  User, Watchlist, WatchlistItem, WatchlistSnapshot, PriceHistory
```

## Future Improvements

- Move quote refresh to a scheduled worker for larger watchlists.
- Add provider redundancy with a paid or exchange-backed market data source.
- Store richer intraday history for real sparklines instead of compact generated trend hints.
- Add tests around baseline eligibility, outage states, and score thresholds.
