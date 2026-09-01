// 가로 막대 리스트 — 버전 상태 분포와 부서 커버리지가 공유. 라벨·막대·값 3열.
// 다크(하늘) 유리 카드 전제 — 기본 막대는 accent-sky, 텍스트는 canvas 계열.

export interface HBarRow {
  label: string;
  value: number;
  hint?: string; // 값 우측 보조 표기(예: "게시 3")
  tone?: string; // 막대 색 — "var(--color-*)"/color-mix 문자열. 미지정 시 accent-sky
}

export interface HBarListProps {
  rows: HBarRow[];
}

export function HBarList({ rows }: HBarListProps) {
  const peak = Math.max(1, ...rows.map((row) => row.value)); // 0 나눗셈 차단

  return (
    <ul data-id="dashboard-hbar-list" className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-caption text-canvas/75">
            {row.label}
          </span>
          <span className="h-2 flex-1 rounded-sm bg-surface/15">
            <span
              className="block h-full rounded-sm"
              style={{
                width: `${(row.value / peak) * 100}%`,
                backgroundColor: row.tone ?? "var(--color-accent-sky)",
              }}
            />
          </span>
          <span className="w-24 shrink-0 text-right text-caption-strong tabular-nums text-canvas">
            {row.value.toLocaleString()}
            {row.hint ? (
              <span className="ml-1.5 text-fine text-canvas/55">{row.hint}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
