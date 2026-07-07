export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[var(--ink)]">{value}</div>
      {sub && <div className="mt-0.5 text-sm text-[var(--ink-2)]">{sub}</div>}
    </div>
  );
}
