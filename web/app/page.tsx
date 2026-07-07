"use client";

import { FormEvent, useEffect, useState } from "react";
import { PityHistogram, PityBucket } from "@/components/PityHistogram";
import { StatTile } from "@/components/StatTile";

interface CommunityStats {
  users: number;
  totalPulls: number;
  sixStars: number;
  observedSixStarRate: number;
  avgPullsPerSixStar: number | null;
  pityDistribution: PityBucket[];
}

interface UserStats {
  userId: string;
  nickname: string;
  totalPulls: number;
  byRarity: Record<string, number>;
  sixStarRate: number;
  avgPullsPerSixStar: number | null;
  currentPity: Record<string, number>;
  luck: number | null;
}

interface Banner {
  id: string;
  name: string;
}

export default function Home() {
  const [community, setCommunity] = useState<CommunityStats | null>(null);
  const [banners, setBanners] = useState<Record<string, string>>({});
  const [user, setUser] = useState<UserStats | null>(null);
  const [mode, setMode] = useState<"token" | "json">("token");
  const [token, setToken] = useState("");
  const [account, setAccount] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCommunity() {
    const res = await fetch("/api/community/stats");
    setCommunity(await res.json());
  }

  useEffect(() => {
    loadCommunity().catch(() => setError("API unreachable — is the backend running?"));
    fetch("/api/banners")
      .then((r) => r.json())
      .then((list: Banner[]) =>
        setBanners(Object.fromEntries(list.map((b) => [b.id, b.name])))
      )
      .catch(() => {});
  }, []);

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let body: string;
      if (mode === "token") {
        body = JSON.stringify({ token });
      } else {
        let payload: unknown;
        try {
          payload = JSON.parse(jsonText);
        } catch {
          // Several page responses pasted back-to-back: turn `}{` seams into
          // an array and retry before giving up.
          try {
            payload = JSON.parse("[" + jsonText.trim().replace(/}\s*{/g, "},{") + "]");
          } catch {
            throw new Error(
              "That doesn't look like valid JSON — copy each page's full response and try again."
            );
          }
        }
        body = JSON.stringify({ account, payload });
      }
      const res = await fetch(mode === "token" ? "/api/import" : "/api/import/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? "Import failed — is the API running?");
      }
      const { userId } = await res.json();
      const stats = await fetch(`/api/users/${userId}/stats`);
      setUser(await stats.json());
      await loadCommunity();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = mode === "token" ? token.length > 0 : account.length > 0 && jsonText.length > 0;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">ArkPulls</h1>
        <p className="mt-1 text-[var(--ink-2)]">
          Arknights gacha analytics — track your pity, compare your luck.
        </p>
      </header>

      <form
        onSubmit={handleImport}
        className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4"
      >
        <div className="mb-3 flex gap-1 rounded-md border border-[var(--border)] p-0.5 text-sm w-fit">
          {(["token", "json"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1 ${
                mode === m
                  ? "bg-[var(--series-1)] font-medium text-white"
                  : "text-[var(--ink-2)]"
              }`}
            >
              {m === "token" ? "Demo token" : "Paste JSON export"}
            </button>
          ))}
        </div>

        {mode === "token" ? (
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Yostar account token (any string works in demo mode)"
              className="min-w-64 flex-1 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--series-1)]"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--ink-2)]">
              In the{" "}
              <a
                href="https://account.yo-star.com/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Yostar Account Center
              </a>
              , open Game Info → Headhunting History and copy each page&apos;s JSON response
              (10 pulls per page — DevTools → Network). Paste one page at a time or several
              back-to-back; imports merge, and duplicates are skipped automatically. Yostar
              only keeps 90 days — ArkPulls archives every import permanently.
            </p>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="Account name (pick one and reuse it every import)"
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--series-1)]"
            />
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder='{"code": 0, "data": {"rows": [{"charName": "Ambriel", "star": "4星", "poolName": "...", "at": 1777289675771}], "count": 156}}'
              rows={5}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 font-mono text-xs outline-none placeholder:text-[var(--muted)] focus:border-[var(--series-1)]"
            />
          </div>
        )}

        <div className="mt-3">
          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="rounded-md bg-[var(--series-1)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import my pulls"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-[#d03b3b]">{error}</p>}
      </form>

      {user && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">{user.nickname}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Total pulls" value={user.totalPulls.toLocaleString()} />
            <StatTile
              label="6★ pulled"
              value={String(user.byRarity["6"] ?? 0)}
              sub={`${(user.sixStarRate * 100).toFixed(2)}% rate`}
            />
            <StatTile
              label="Avg pulls per 6★"
              value={user.avgPullsPerSixStar?.toFixed(1) ?? "—"}
            />
            <StatTile
              label="Luck"
              value={user.luck != null ? `top ${(100 - user.luck * 100).toFixed(0)}%` : "—"}
              sub={
                user.luck != null
                  ? `luckier than ${(user.luck * 100).toFixed(0)}% of Doctors`
                  : undefined
              }
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(user.currentPity).map(([bannerId, pity]) => (
              <span
                key={bannerId}
                className="rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1 text-xs text-[var(--ink-2)]"
              >
                {banners[bannerId] ?? bannerId}: <b className="text-[var(--ink)]">{pity}</b> pity
              </span>
            ))}
          </div>
        </section>
      )}

      {community && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Community</h2>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Doctors" value={community.users.toLocaleString()} />
            <StatTile label="Pulls recorded" value={community.totalPulls.toLocaleString()} />
            <StatTile
              label="Observed 6★ rate"
              value={`${(community.observedSixStarRate * 100).toFixed(2)}%`}
            />
            <StatTile
              label="Avg pulls per 6★"
              value={community.avgPullsPerSixStar?.toFixed(1) ?? "—"}
            />
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
            <h3 className="mb-3 text-sm font-medium text-[var(--ink-2)]">
              Pulls needed per 6★, across the community
            </h3>
            <PityHistogram
              distribution={community.pityDistribution}
              userAvg={user?.avgPullsPerSixStar}
            />
          </div>
        </section>
      )}
    </main>
  );
}
