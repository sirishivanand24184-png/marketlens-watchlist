/**
 * digest.ts
 *
 * Turns the ranked, scored watchlist into a short natural-language summary —
 * "what happened and what deserves attention" instead of a raw list.
 *
 * Deliberately rule-based, not an LLM call: it's deterministic, has zero
 * external dependency to explain or fail live during a demo, and every
 * sentence traces directly back to a number you can point to in
 * significance.ts. That traceability matters more here than fancier prose.
 */

import { SignificanceResult } from "./significance";

export interface DigestInput extends SignificanceResult {
  priceNow: number;
  isNewToYou?: boolean;
}

const HIGH_ATTENTION = 60;
const MODERATE_ATTENTION = 30;

function describeMove(item: DigestInput): string {
  const dir = item.pctChange >= 0 ? "up" : "down";
  const pct = Math.abs(item.pctChange * 100).toFixed(1);
  return `${item.symbol} is ${dir} ${pct}%`;
}

/**
 * Builds a 2-4 sentence digest. Structure:
 *  1. Headline: how many symbols actually moved meaningfully, out of how many tracked.
 *  2. The single most attention-worthy symbol, with its "why."
 *  3. Any data-quality caveat (stale/conflicting), stated plainly, not hidden.
 *  4. A quiet-market reassurance line if nothing crossed the threshold — silence
 *     is itself a signal worth stating explicitly, not an empty screen.
 */
export function buildDigest(
  items: DigestInput[],
  hoursSinceLastCheck: number,
  unavailableCount = 0
): string {
  if (items.length === 0) {
    return "Your watchlist is empty — add a symbol to start tracking it.";
  }

  const simulatedCount = items.filter((i) => i.freshness === "simulated").length;
  if (simulatedCount === items.length) {
    // Every symbol is running on the fallback path — lead with that fact
    // since it's more important than anything else in the digest right now.
    return `Live market data is currently unavailable (upstream rate limit), so all ${items.length} prices below are simulated placeholders, not real quotes. Try again shortly for live data.`;
  }

  const flagged = items.filter((i) => i.score >= MODERATE_ATTENTION);
  const staleCount = items.filter((i) => i.freshness === "stale").length;
  const partialSimCount = simulatedCount; // > 0 but < items.length at this point
  const newCount = items.filter((i) => i.isNewToYou).length;

  const sentences: string[] = [];

  const timeframe =
    hoursSinceLastCheck < 1
      ? "since your last check"
      : hoursSinceLastCheck < 48
      ? `over the last ${Math.round(hoursSinceLastCheck)}h`
      : `over the last ${Math.round(hoursSinceLastCheck / 24)} days`;

  if (flagged.length === 0) {
    sentences.push(
      `Quiet ${timeframe} — none of your ${items.length} symbols moved outside their normal range.`
    );
  } else {
    sentences.push(
      `${flagged.length} of your ${items.length} symbols moved meaningfully ${timeframe}.`
    );
    const top = flagged[0];
    const topLine = `${describeMove(top)} — ${(top.reasons ?? []).join(", ")}.`;
    sentences.push(topLine.charAt(0).toUpperCase() + topLine.slice(1));

    if (flagged.length > 1) {
      const rest = flagged
        .slice(1, 3)
        .map((i) => describeMove(i))
        .join(", ");
      sentences.push(`Also worth a look: ${rest}.`);
    }
  }

  if (newCount > 0) {
    sentences.push(
      `${newCount} symbol${newCount > 1 ? "s were" : " was"} just added, so there's no prior baseline yet.`
    );
  }

  if (staleCount > 0 || unavailableCount > 0 || partialSimCount > 0) {
    const parts = [];
    if (staleCount > 0) parts.push(`${staleCount} price${staleCount > 1 ? "s look" : " looks"} stale`);
    if (partialSimCount > 0) parts.push(`${partialSimCount} symbol${partialSimCount > 1 ? "s are" : " is"} showing simulated data (live feed unavailable)`);
    if (unavailableCount > 0) parts.push(`${unavailableCount} symbol${unavailableCount > 1 ? "s" : ""} couldn't be fetched`);
    sentences.push(`Heads up: ${parts.join(" and ")} — treat those with caution.`);
  }

  return sentences.join(" ");
}