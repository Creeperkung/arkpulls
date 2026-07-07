import { createHash } from "node:crypto";
import { db } from "../lib/db.js";
import { fetchGachaHistory, KNOWN_BANNERS } from "./yostarClient.js";

const BANNER_DATES: Record<string, { startAt: Date; endAt: Date }> = Object.fromEntries(
  KNOWN_BANNERS.map((b, i) => [
    b.id,
    {
      startAt: new Date(Date.UTC(2026, 4, 1 + i * 21)),
      endAt: new Date(Date.UTC(2026, 4, 22 + i * 21)),
    },
  ])
);

export async function ensureBanners(): Promise<void> {
  for (const banner of KNOWN_BANNERS) {
    await db.banner.upsert({
      where: { id: banner.id },
      update: {},
      create: { ...banner, ...BANNER_DATES[banner.id] },
    });
  }
}

export interface ImportResult {
  userId: string;
  nickname: string;
  imported: number;
  skipped: number;
}

/**
 * Import a player's pull history. Idempotent: pulls already stored
 * (same user + banner + seq) are skipped, so re-importing after new pulls
 * only appends the new ones.
 */
export async function importPulls(token: string): Promise<ImportResult> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const account = await fetchGachaHistory(token);

  await ensureBanners();

  const user = await db.user.upsert({
    where: { tokenHash },
    update: { nickname: account.nickname },
    create: { nickname: account.nickname, tokenHash },
  });

  const existing = await db.pull.findMany({
    where: { userId: user.id },
    select: { bannerId: true, seq: true },
  });
  const seen = new Set(existing.map((p) => `${p.bannerId}:${p.seq}`));

  const fresh = account.pulls.filter((p) => !seen.has(`${p.bannerId}:${p.seq}`));
  if (fresh.length > 0) {
    await db.pull.createMany({
      data: fresh.map((p) => ({ ...p, userId: user.id })),
    });
  }

  return {
    userId: user.id,
    nickname: account.nickname,
    imported: fresh.length,
    skipped: account.pulls.length - fresh.length,
  };
}
