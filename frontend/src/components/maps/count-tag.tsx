// 맵 개수 태그 — 접힌 행에만 붙는다. 펼치면 내용(자식 행·자기 카드)이 아래 다 보여 롤업 숫자는 중복이고,
// 조상 체인을 따라 태그가 줄줄이 남으면 그게 노이즈가 된다.
// 액센트는 선택·활성 전용 토큰이라 카운트엔 중립색만 쓴다.
// 설계: 2026-08-04-home-dept-list-revision-design.md R1·R2
"use client";

interface CountTagProps {
  count: number;
}

export function CountTag({ count }: CountTagProps) {
  return (
    <span
      data-id="org-node-count"
      className="ml-auto shrink-0 rounded-full bg-surface-alt px-2 py-0.5 text-fine text-ink-tertiary"
    >
      {count}
    </span>
  );
}
