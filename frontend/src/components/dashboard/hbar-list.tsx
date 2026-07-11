// 가로 막대 리스트 — 버전 상태 분포와 부서 커버리지가 공유. 라벨·막대·값 3열.

export interface HBarRow {
  label: string;
  value: number;
  hint?: string; // 값 우측 보조 표기(예: "게시 3")
  tone?: string; // 막대 색 — "var(--color-*)" 문자열. 미지정 시 액센트
}

export function HBarList({ rows }: { rows: HBarRow[] }) {
  const peak = Math.max(1, ...rows.map((row) => row.value)); // 0 나눗셈 차단

  return (
    <ul data-id="dashboard-hbar-list" className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-caption text-ink-secondary">
            {row.label}
          </span>
          <span className="h-2 flex-1 rounded-sm bg-surface-alt">
            <span
              className="block h-full rounded-sm"
              style={{
                width: `${(row.value / peak) * 100}%`,
                backgroundColor: row.tone ?? "var(--color-accent)",
              }}
            />
          </span>
          <span className="w-24 shrink-0 text-right text-caption-strong tabular-nums text-ink">
            {row.value.toLocaleString()}
            {row.hint ? (
              <span className="ml-1.5 text-fine text-ink-tertiary">{row.hint}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
