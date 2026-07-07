// Paste-based import: the user copies their Headhunting History JSON from the
// Yostar Account Center (Game Info → Headhunting History) and pastes it in.
// No credentials touch our server — this is the ToS-safe import path.
//
// The account center keeps only ~90 days of records, so users re-import
// periodically and ArkPulls becomes the permanent archive. That makes
// idempotent merging essential: every import re-merges into the full history.
//
// Confirmed real Account Center shape (paginated, 10 rows per page):
//   { "code": 0, "data": { "rows": [{ "charName": "Ambriel", "star": "4星",
//     "poolId": "LIMITED_EN_39_0_1", "poolName": "...", "type": "Limited
//     Headhunting", "at": 1777289675771 }], "count": 156 } }
// Users paste one page at a time (merges are idempotent) or several page
// responses combined into a JSON array.

import { createHash } from "node:crypto";
import { db } from "../lib/db.js";

export interface NormalizedPull {
  bannerId: string;
  bannerName: string;
  bannerType: string;
  rarity: number; // 3..6 (1-indexed stars)
  operatorName: string;
  pulledAt: Date;
  // True for pulls from a grouped `chars` array, where a whole ten-pull shares
  // one timestamp and the same operator can legitimately repeat at the same
  // key. Flat rows have per-pull ms timestamps, so an identical row within one
  // paste can only be a duplicated/overlapping page and is dropped.
  allowDuplicates: boolean;
}

class ImportFormatError extends Error {}
export { ImportFormatError };

function toDate(ts: unknown): Date | null {
  if (typeof ts === "number") {
    // Heuristic: values below 1e12 are unix seconds, above are milliseconds.
    return new Date(ts < 1e12 ? ts * 1000 : ts);
  }
  if (typeof ts === "string") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** "4星" / "4 star" / "4" → 4. Star strings are always 1-indexed. */
function starToRarity(star: unknown): number | null {
  const s = str(star);
  if (!s) return null;
  const m = s.match(/^\d/);
  return m ? Number(m[0]) : null;
}

type Entry = Record<string, unknown>;

function isWrapper(v: unknown): v is Entry {
  return (
    typeof v === "object" &&
    v !== null &&
    ("rows" in v || "list" in v || "data" in v)
  );
}

/** Pull the record array out of a page response, a bare array, or an array of pages. */
function extractEntries(payload: unknown): Entry[] | null {
  if (Array.isArray(payload)) {
    // Either a flat array of pulls, an array of page responses, or a mix.
    return (payload as unknown[]).flatMap((item) =>
      isWrapper(item) ? extractEntries(item) ?? [] : [item as Entry]
    );
  }
  if (!isWrapper(payload)) return null;
  for (const container of [payload, payload.data as Entry]) {
    if (typeof container === "object" && container !== null) {
      if (Array.isArray(container.rows)) return container.rows as Entry[];
      if (Array.isArray(container.list)) return container.list as Entry[];
    }
  }
  return null;
}

export function parseExport(payload: unknown): NormalizedPull[] {
  const entries = extractEntries(payload);
  if (!entries || entries.length === 0) {
    throw new ImportFormatError(
      "Unrecognized JSON shape: expected the Account Center response (data.rows), an array of pulls, or an array of page responses"
    );
  }

  const raw: (Omit<NormalizedPull, "rarity"> & { rarity: number; starRarity: boolean })[] = [];

  for (const entry of entries) {
    const pulledAtEntry = toDate(entry.at ?? entry.ts ?? entry.time ?? entry.pulledAt);
    const poolName = str(entry.poolName ?? entry.pool ?? entry.banner) ?? "Unknown banner";
    const poolId = str(entry.poolId);
    const poolType = str(entry.typeName ?? entry.type) ?? "IMPORTED";

    // Grouped shape nests operators under `chars`; the real Account Center
    // shape is flat (one operator per row).
    const grouped = Array.isArray(entry.chars);
    const chars = grouped ? (entry.chars as Entry[]) : [entry];
    for (const c of chars) {
      const operatorName = str(c.charName ?? c.name);
      const pulledAt = toDate(c.at ?? c.ts) ?? pulledAtEntry;
      const fromStar = starToRarity(c.star);
      const rarity = fromStar ?? (typeof c.rarity === "number" ? c.rarity : null);
      if (!operatorName || rarity === null || !pulledAt) continue;
      raw.push({
        bannerId: "import-" + slug(poolId ?? poolName),
        bannerName: poolName,
        bannerType: poolType,
        operatorName,
        rarity,
        starRarity: fromStar !== null,
        pulledAt,
        allowDuplicates: grouped,
      });
    }
  }

  if (raw.length === 0) {
    throw new ImportFormatError("No pull records found in the pasted JSON");
  }

  // Star strings ("4星") are 1-indexed by definition. Numeric `rarity` fields
  // may be 0-indexed (game data calls a 6★ rarity 5): a real history always
  // contains the lowest tier in bulk, so a 2 means 0-indexed and a 6 means
  // 1-indexed; ambiguous payloads default to 1-indexed.
  const numeric = raw.filter((p) => !p.starRarity).map((p) => p.rarity);
  const zeroIndexed =
    numeric.length > 0 && Math.min(...numeric) <= 2 && Math.max(...numeric) <= 5;

  const pulls: NormalizedPull[] = raw.map(({ starRarity, ...p }) => ({
    ...p,
    rarity: !starRarity && zeroIndexed ? p.rarity + 1 : p.rarity,
  }));

  const bad = pulls.find((p) => p.rarity < 3 || p.rarity > 6);
  if (bad) {
    throw new ImportFormatError(`Rarity out of range for "${bad.operatorName}": ${bad.rarity}`);
  }

  return pulls;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const pullKey = (p: { pulledAt: Date; operatorName: string; rarity: number }) =>
  `${p.pulledAt.getTime()}:${p.operatorName}:${p.rarity}`;

export interface JsonImportResult {
  userId: string;
  nickname: string;
  imported: number;
  skipped: number;
}

/**
 * Merge pasted pulls into the account's stored history.
 *
 * Dedup is per (timestamp, operator, rarity) as a multiset — a ten-pull can
 * legitimately contain the same operator twice at the same timestamp, so for
 * each key we keep max(existing, incoming) occurrences. Because an import can
 * contain pulls older than what's stored, each affected banner's sequence is
 * rewritten in chronological order (pity extraction depends on seq order).
 */
export async function importJsonPulls(account: string, payload: unknown): Promise<JsonImportResult> {
  const pulls = parseExport(payload);
  const tokenHash = createHash("sha256").update(`json:${account}`).digest("hex");

  const user = await db.user.upsert({
    where: { tokenHash },
    update: {},
    create: { nickname: account, tokenHash },
  });

  let imported = 0;
  let skipped = 0;

  // Drop exact duplicates within the paste itself (overlapping or repeated
  // pages), except where the grouped shape makes same-key repeats legitimate.
  const seenInPaste = new Set<string>();
  const byBanner = new Map<string, NormalizedPull[]>();
  for (const p of pulls) {
    if (!p.allowDuplicates) {
      const k = `${p.bannerId}|${pullKey(p)}`;
      if (seenInPaste.has(k)) {
        skipped++;
        continue;
      }
      seenInPaste.add(k);
    }
    const list = byBanner.get(p.bannerId) ?? [];
    list.push(p);
    byBanner.set(p.bannerId, list);
  }

  for (const [bannerId, incoming] of byBanner) {
    const times = incoming.map((p) => p.pulledAt.getTime());

    await db.banner.upsert({
      where: { id: bannerId },
      update: {},
      create: {
        id: bannerId,
        name: incoming[0].bannerName,
        type: incoming[0].bannerType,
        rateUp6: "",
        startAt: new Date(Math.min(...times)),
        endAt: new Date(Math.max(...times)),
      },
    });

    const existing = await db.pull.findMany({
      where: { userId: user.id, bannerId },
      select: { rarity: true, operatorName: true, pulledAt: true },
    });

    // Multiset merge vs stored history: final count per key = max(existing, incoming).
    const existingCount = new Map<string, number>();
    for (const p of existing) {
      const k = pullKey(p);
      existingCount.set(k, (existingCount.get(k) ?? 0) + 1);
    }

    const merged = [...existing];
    const seenIncoming = new Map<string, number>();
    for (const p of incoming) {
      const k = pullKey(p);
      const nth = (seenIncoming.get(k) ?? 0) + 1;
      seenIncoming.set(k, nth);
      if (nth > (existingCount.get(k) ?? 0)) {
        merged.push({ rarity: p.rarity, operatorName: p.operatorName, pulledAt: p.pulledAt });
        imported++;
      } else {
        skipped++;
      }
    }

    merged.sort((a, b) => a.pulledAt.getTime() - b.pulledAt.getTime());

    await db.$transaction([
      db.pull.deleteMany({ where: { userId: user.id, bannerId } }),
      db.pull.createMany({
        data: merged.map((p, seq) => ({ ...p, userId: user.id, bannerId, seq })),
      }),
    ]);
  }

  return { userId: user.id, nickname: user.nickname, imported, skipped };
}
