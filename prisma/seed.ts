// Seeds the community with simulated players so the analytics endpoints
// have a realistic distribution to compare against from day one.
import { importPulls } from "../src/services/ingest.js";
import { db } from "../src/lib/db.js";

const COMMUNITY_SIZE = 50;

async function main() {
  for (let i = 0; i < COMMUNITY_SIZE; i++) {
    const result = await importPulls(`seed-user-${i}`);
    if (i % 10 === 0) {
      console.log(`seeded ${result.nickname} (${result.imported} pulls)`);
    }
  }
  const users = await db.user.count();
  const pulls = await db.pull.count();
  console.log(`done: ${users} users, ${pulls} pulls`);
}

main().finally(() => db.$disconnect());
