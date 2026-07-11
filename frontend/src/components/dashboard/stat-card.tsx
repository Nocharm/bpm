// 좌 레일 요약 스탯 — 라벨·큰 값·보조 설명. 값이 아직 없으면 "—".

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent";
}) {
  return (
    <div
      data-id="dashboard-stat-card"
      className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface px-4 py-3"
    >
      <span className="text-fine uppercase tracking-wide text-ink-tertiary">{label}</span>
      <span
        className={`text-tagline ${tone === "accent" ? "text-accent" : "text-ink"}`}
      >
        {value}
      </span>
      {hint ? <span className="text-fine text-ink-tertiary">{hint}</span> : null}
    </div>
  );
}
