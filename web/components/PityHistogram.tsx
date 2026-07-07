"use client";

import { useState } from "react";

export interface PityBucket {
  pityCost: number;
  count: number;
}

interface Hovered {
  pity: number;
  count: number;
  xPct: number;
  yPct: number;
}

const VIEW_W = 720;
const VIEW_H = 260;
const M = { top: 16, right: 12, bottom: 28, left: 40 };
const PLOT_W = VIEW_W - M.left - M.right;
const PLOT_H = VIEW_H - M.top - M.bottom;
const SOFT_PITY = 50;

/** Bar with 4px-rounded top corners, flat base anchored to the baseline. */
function roundedTopBar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + h}`,
    "Z",
  ].join(" ");
}

function niceTicks(max: number): number[] {
  const step = max <= 20 ? 5 : max <= 50 ? 10 : Math.ceil(max / 4 / 10) * 10;
  const ticks = [];
  for (let v = step; v <= max; v += step) ticks.push(v);
  return ticks;
}

export function PityHistogram({
  distribution,
  userAvg,
}: {
  distribution: PityBucket[];
  userAvg?: number | null;
}) {
  const [hovered, setHovered] = useState<Hovered | null>(null);

  const counts = new Map(distribution.map((b) => [b.pityCost, b.count]));
  const maxPity = Math.max(60, ...distribution.map((b) => b.pityCost));
  const maxCount = Math.max(1, ...distribution.map((b) => b.count));
  const yMax = Math.max(...niceTicks(maxCount), maxCount);

  const slotW = PLOT_W / maxPity;
  const barW = Math.max(1, slotW - 2); // 2px surface gap between bars
  const xFor = (pity: number) => M.left + (pity - 1) * slotW;
  const yFor = (count: number) => M.top + PLOT_H * (1 - count / yMax);

  const peak = distribution.reduce(
    (best, b) => (b.count > best.count ? b : best),
    { pityCost: 0, count: 0 }
  );

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        role="img"
        aria-label="Histogram of pulls needed per 6-star across the community"
        onMouseLeave={() => setHovered(null)}
      >
        {/* gridlines + y ticks */}
        {niceTicks(yMax).map((v) => (
          <g key={v}>
            <line
              x1={M.left}
              x2={VIEW_W - M.right}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text
              x={M.left - 6}
              y={yFor(v) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--muted)"
            >
              {v}
            </text>
          </g>
        ))}

        {/* baseline */}
        <line
          x1={M.left}
          x2={VIEW_W - M.right}
          y1={M.top + PLOT_H}
          y2={M.top + PLOT_H}
          stroke="var(--baseline)"
          strokeWidth={1}
        />

        {/* x ticks every 10 pulls */}
        {Array.from({ length: Math.floor(maxPity / 10) }, (_, i) => (i + 1) * 10).map((v) => (
          <text
            key={v}
            x={xFor(v) + barW / 2}
            y={M.top + PLOT_H + 16}
            textAnchor="middle"
            fontSize={10}
            fill="var(--muted)"
          >
            {v}
          </text>
        ))}

        {/* soft-pity reference line */}
        <line
          x1={xFor(SOFT_PITY)}
          x2={xFor(SOFT_PITY)}
          y1={M.top}
          y2={M.top + PLOT_H}
          stroke="var(--muted)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <text
          x={xFor(SOFT_PITY) + 4}
          y={M.top + 10}
          fontSize={10}
          fill="var(--muted)"
        >
          soft pity
        </text>

        {/* bars */}
        {Array.from({ length: maxPity }, (_, i) => i + 1).map((pity) => {
          const count = counts.get(pity) ?? 0;
          if (count === 0) return null;
          const y = yFor(count);
          return (
            <path
              key={pity}
              d={roundedTopBar(xFor(pity), y, barW, M.top + PLOT_H - y)}
              fill="var(--series-1)"
              opacity={hovered && hovered.pity !== pity ? 0.55 : 1}
            />
          );
        })}

        {/* direct label on the peak only */}
        {peak.count > 0 && (
          <text
            x={xFor(peak.pityCost) + barW / 2}
            y={yFor(peak.count) - 5}
            textAnchor="middle"
            fontSize={10}
            fill="var(--ink-2)"
          >
            {peak.count}
          </text>
        )}

        {/* user's average marker */}
        {userAvg != null && (
          <g>
            <line
              x1={xFor(Math.round(userAvg))}
              x2={xFor(Math.round(userAvg))}
              y1={M.top}
              y2={M.top + PLOT_H}
              stroke="var(--ink)"
              strokeWidth={1.5}
            />
            <text
              x={xFor(Math.round(userAvg)) + 4}
              y={M.top + 24}
              fontSize={10}
              fontWeight={600}
              fill="var(--ink)"
            >
              you Ø{userAvg.toFixed(1)}
            </text>
          </g>
        )}

        {/* hover hit targets: full plot height, one per pity value */}
        {Array.from({ length: maxPity }, (_, i) => i + 1).map((pity) => (
          <rect
            key={pity}
            x={xFor(pity) - 1}
            y={M.top}
            width={slotW}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() =>
              setHovered({
                pity,
                count: counts.get(pity) ?? 0,
                xPct: ((xFor(pity) + barW / 2) / VIEW_W) * 100,
                yPct: (yFor(counts.get(pity) ?? 0) / VIEW_H) * 100,
              })
            }
          />
        ))}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs shadow-sm"
          style={{ left: `${hovered.xPct}%`, top: `calc(${hovered.yPct}% - 6px)` }}
        >
          <span className="font-semibold text-[var(--ink)]">{hovered.count}</span>{" "}
          <span className="text-[var(--ink-2)]">
            6★{hovered.count === 1 ? "" : "s"} took {hovered.pity} pull
            {hovered.pity === 1 ? "" : "s"}
          </span>
        </div>
      )}

      <div className="mt-2 text-xs text-[var(--muted)]">
        Pulls since previous 6★ (x) vs how many community 6★s cost that much (y)
      </div>
    </div>
  );
}
