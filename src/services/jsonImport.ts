// Paste-based import: the user copies their Headhunting History JSON from the
// Yostar Account Center (Game Info → Headhunting History) and pastes it in.
// No credentials touch our server — this is the ToS-safe import path.
//
// The account center keeps only ~90 days of records, so users re-import
// periodically and ArkPulls becomes the permanent archive. That makes
// idempotent merging essential: every import re-merges into the full history.

import { createHash } from "node:crypto";
import { db } from "../lib/db.js";

export interface NormalizedPull {
  poolName: string;
  rarity: number; // 3..6 (1-indexed stars)
  operatorName: string;
  pulledAt: Date;
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

/**
 * Accepts the shapes seen in the wild:
 *  - flat array: [{ name|charName, rarity, ts|time|pulledAt, pool|poolName|banner }]
 *  - grouped (Hypergryph-style): { data: { list: [{ ts, pool, chars: [{ name, rarity }] }] } }
 *    where one entry is a single/ten-pull sharing a timestamp
 */
export function parseExport(payload: unknown): NormalizedPull[] {
  const root = payload as Record<string, unknown>;
  const list =
    Array.isArray(payload) ? payload
    : Array.isArray(root?.list) ? root.list
    : Array.isArray((root?.data as Record<string, unknown>)?.list)
      ? ((root.data as Record<string, unknown>).list as unknown[])
      : null;

  if (!list) {
    throw new ImportFormatError(
      "Unrecognized JSON shape: expected an array of pulls, or an object with data.list"
    );
  }

  const raw: { poolName: string; rarity: number; operatorName: string; pulledAt: Date }[] = [];

  for (const entry of list as Record<string, unknown>[]) {
    const pulledAt = toDate(entry.ts ?? entry.time ?? entry.pulledAt);
    const poolName = str(entry.pool ?? entry.poolName ?? entry.banner) ?? "Unknown banner";
    if (!pulledAt) continue;

    const chars = Array.isArray(entry.chars) ? (entry.chars as Record<string, unknown>[]) : [entry];
    for (const c of chars) {
      const operatorName = str(c.name ?? c.charName);
      const rarity = typeof c.rarity === "number" ? c.rarity : null;
      if (!operatorName || rarity === null) continue;
      raw.push({ poolName, rarity, operatorName, pulledAt });
    }
  }

  if (raw.length === 0) {
    throw new ImportFormatError("No pull records found in the pasted JSON");
  }

  // Game data uses 0-indexed rarity (6★ = 5); web exports may be 1-indexed.
  // A real export always contains the lowest tier in bulk, so a 2 means
  // 0-indexed and a 6 means 1-indexed. Ambiguous payloads default to 1-indexed.
  const rarities = raw.map((p) => p.rarity);
  const zeroIndexed = Math.min(...rarities) <= 2 && Math.max(...rarities) <= 5;
  const pulls = raw.map((p) => ({
    ...p,
    rarity: zeroIndexed ? p.rarity + 1 : p.rarity,
  }));

  const bad = pulls.find((p) => p.rarity < 3 || p.rarity > 6);
  if (bad) {
    throw new ImportFormatError(`Rarity out of range for "${bad.operatorName}": ${bad.rarity}`);
  }

  return pulls;
}

function bannerIdFor(poolName: string): string {
  return "import-" + poolName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
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

  const byPool = new Map<string, NormalizedPull[]>();
  for (const p of pulls) {
    const list = byPool.get(p.poolName) ?? [];
    list.push(p);
    byPool.set(p.poolName, list);
  }

  let imported = 0;
  let skipped = 0;

  for (const [poolName, incoming] of byPool) {
    const bannerId = bannerIdFor(poolName);
    const times = incoming.map((p) => p.pulledAt.getTime());

    await db.banner.upsert({
      where: { id: bannerId },
      update: {},
      create: {
        id: bannerId,
        name: poolName,
        type: "IMPORTED",
        rateUp6: "",
        startAt: new Date(Math.min(...times)),
        endAt: new Date(Math.max(...times)),
      },
    });

    const existing = await db.pull.findMany({
      where: { userId: user.id, bannerId },
      select: { rarity: true, operatorName: true, pulledAt: true },
    });

    // Multiset merge: final occurrence count per key = max(existing, incoming).
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
