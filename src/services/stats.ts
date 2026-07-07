import { db } from "../lib/db.js";

interface SixStarHit {
  operatorName: string;
  pityCost: number; // pulls spent since the previous 6★ (inclusive of this one)
  bannerId: string;
}

/** Walk a user's pulls per banner in order and extract 6★ pity costs. */
function extractSixStarHits(
  pulls: { bannerId: string; seq: number; rarity: number; operatorName: string }[]
): { hits: SixStarHit[]; currentPity: Record<string, number> } {
  const byBanner = new Map<string, typeof pulls>();
  for (const p of pulls) {
    const list = byBanner.get(p.bannerId) ?? [];
    list.push(p);
    byBanner.set(p.bannerId, list);
  }

  const hits: SixStarHit[] = [];
  const currentPity: Record<string, number> = {};

  for (const [bannerId, list] of byBanner) {
    list.sort((a, b) => a.seq - b.seq);
    let sinceLast = 0;
    for (const p of list) {
      sinceLast++;
      if (p.rarity === 6) {
        hits.push({ operatorName: p.operatorName, pityCost: sinceLast, bannerId });
        sinceLast = 0;
      }
    }
    currentPity[bannerId] = sinceLast;
  }

  return { hits, currentPity };
}

export async function getUserStats(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const pulls = await db.pull.findMany({
    where: { userId },
    select: { bannerId: true, seq: true, rarity: true, operatorName: true },
  });

  const byRarity: Record<number, number> = { 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const p of pulls) byRarity[p.rarity]++;

  const { hits, currentPity } = extractSixStarHits(pulls);
  const avgPity =
    hits.length > 0 ? hits.reduce((s, h) => s + h.pityCost, 0) / hits.length : null;

  return {
    userId: user.id,
    nickname: user.nickname,
    totalPulls: pulls.length,
    byRarity,
    sixStarRate: pulls.length > 0 ? byRarity[6] / pulls.length : 0,
    avgPullsPerSixStar: avgPity,
    currentPity,
    sixStars: hits,
    luck: avgPity !== null ? await luckPercentile(avgPity) : null,
  };
}

/**
 * Share of the community's 6★ hits that cost MORE pulls than this user's
 * average — i.e. 0.9 means luckier than 90% of recorded hits.
 */
async function luckPercentile(userAvgPity: number): Promise<number | null> {
  const total = await db.pull.count({ where: { rarity: 6 } });
  if (total === 0) return null;
  const distribution = await communityPityDistribution();
  const worse = distribution.reduce(
    (sum, bucket) => (bucket.pityCost > userAvgPity ? sum + bucket.count : sum),
    0
  );
  return worse / distribution.reduce((s, b) => s + b.count, 0);
}

/** Pity cost of every 6★ hit across all users, aggregated into counts. */
async function communityPityDistribution(): Promise<{ pityCost: number; count: number }[]> {
  const pulls = await db.pull.findMany({
    select: { userId: true, bannerId: true, seq: true, rarity: true, operatorName: true },
    orderBy: [{ userId: "asc" }, { bannerId: "asc" }, { seq: "asc" }],
  });

  const counts = new Map<number, number>();
  const byUser = new Map<string, typeof pulls>();
  for (const p of pulls) {
    const list = byUser.get(p.userId) ?? [];
    list.push(p);
    byUser.set(p.userId, list);
  }
  for (const list of byUser.values()) {
    for (const hit of extractSixStarHits(list).hits) {
      counts.set(hit.pityCost, (counts.get(hit.pityCost) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([pityCost, count]) => ({ pityCost, count }))
    .sort((a, b) => a.pityCost - b.pityCost);
}

export async function getCommunityStats() {
  const [users, totalPulls, sixStars] = await Promise.all([
    db.user.count(),
    db.pull.count(),
    db.pull.count({ where: { rarity: 6 } }),
  ]);

  const distribution = await communityPityDistribution();
  const totalHits = distribution.reduce((s, b) => s + b.count, 0);
  const avgPity =
    totalHits > 0
      ? distribution.reduce((s, b) => s + b.pityCost * b.count, 0) / totalHits
      : null;

  return {
    users,
    totalPulls,
    sixStars,
    observedSixStarRate: totalPulls > 0 ? sixStars / totalPulls : 0,
    avgPullsPerSixStar: avgPity,
    pityDistribution: distribution,
  };
}
