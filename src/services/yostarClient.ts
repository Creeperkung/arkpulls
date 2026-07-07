// Mock of the (unofficial) Yostar gacha-history endpoint.
//
// The real integration will call the official web API with the player's
// login token and page through their pull history. Until then, this mock
// generates a plausible history using Arknights' actual published gacha
// mechanics, deterministically per token, so the rest of the system can be
// built and demoed against realistic data.
//
// Arknights rates: 6★ 2% (pity: +2% per pull after 50 pulls without a 6★),
// 5★ 8%, 4★ 50%, 3★ 40%.

import { hashString, mulberry32 } from "../lib/rng.js";

export interface RemotePull {
  bannerId: string;
  seq: number;
  rarity: 3 | 4 | 5 | 6;
  operatorName: string;
  pulledAt: Date;
}

export interface RemoteAccount {
  nickname: string;
  pulls: RemotePull[];
}

const OPERATORS: Record<number, string[]> = {
  6: ["SilverAsh", "Exusiai", "Surtr", "Thorns", "Mudrock", "Mlynar", "Texas the Omertosa"],
  5: ["Lappland", "Specter", "Ptilopsis", "Blue Poison", "Projekt Red", "Kroos the Keen Glint"],
  4: ["Cuora", "Gravel", "Myrtle", "Perfumer", "Click", "Jaye"],
  3: ["Melantha", "Fang", "Kroos", "Hibiscus", "Ansel", "Plume"],
};

export const KNOWN_BANNERS = [
  { id: "standard-58", name: "Standard Headhunting #58", type: "STANDARD", rateUp6: "SilverAsh,Mudrock" },
  { id: "limited-il-siracusano", name: "Il Siracusano [Limited]", type: "LIMITED", rateUp6: "Texas the Omertosa" },
  { id: "kernel-2", name: "Kernel Headhunting #2", type: "KERNEL", rateUp6: "Exusiai" },
];

function rollRarity(rand: () => number, pity: number): 3 | 4 | 5 | 6 {
  const sixRate = Math.min(1, 0.02 + Math.max(0, pity - 49) * 0.02);
  const r = rand();
  if (r < sixRate) return 6;
  if (r < sixRate + 0.08) return 5;
  if (r < sixRate + 0.08 + 0.5) return 4;
  return 3;
}

function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}

/**
 * Fetch a player's full gacha history. Replace the body of this function
 * with the real HTTP calls when wiring up the live endpoint — the return
 * shape is designed to match what ingestion needs.
 */
export async function fetchGachaHistory(token: string): Promise<RemoteAccount> {
  const rand = mulberry32(hashString(token));
  const nickname = `Doctor#${1000 + Math.floor(rand() * 9000)}`;
  const pulls: RemotePull[] = [];

  for (const banner of KNOWN_BANNERS) {
    const totalPulls = 20 + Math.floor(rand() * 280);
    let pity = 0;
    // Spread pulls over the ~3 weeks a banner typically runs.
    const bannerStart = Date.UTC(2026, 4, 1) + hashString(banner.id) % (1000 * 60 * 60 * 24 * 30);

    for (let seq = 0; seq < totalPulls; seq++) {
      const rarity = rollRarity(rand, pity);
      pity = rarity === 6 ? 0 : pity + 1;

      let operatorName = pick(rand, OPERATORS[rarity]);
      // Rate-up: ~50% of 6★ pulls land on the banner's rate-up operators.
      if (rarity === 6 && rand() < 0.5) {
        operatorName = pick(rand, banner.rateUp6.split(","));
      }

      pulls.push({
        bannerId: banner.id,
        seq,
        rarity,
        operatorName,
        pulledAt: new Date(bannerStart + seq * 1000 * 60 * 37),
      });
    }
  }

  return { nickname, pulls };
}
