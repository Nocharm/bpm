"use client";

// 역할 칩 — 단일 역할(assignee_role)을 캔버스 담당자 줄·인스펙터 읽기 행·타일 값에 표시. 인물 필(AssigneePills,
// 중립 톤 알약)과 한눈에 구분되는 액센트 틴트 사각 라운드 + BriefcaseBusiness 아이콘 (design 2026-09-11 §4.1).
// 노드 안은 mono(흑백) — 인물 필과 같은 중립 톤.

import { BriefcaseBusiness } from "lucide-react";

interface RoleChipProps {
  role: string;
  dataId: string;
  tone?: "accent" | "mono";
}

export function RoleChip({ role, dataId, tone = "accent" }: RoleChipProps) {
  if (role.trim() === "") return null;
  const toneClass =
    tone === "mono"
      ? "border-hairline bg-surface-alt text-ink-secondary"
      : "border-accent-tint-border bg-accent-tint text-accent";
  return (
    <span
      data-id={dataId}
      title={role}
      className={`inline-flex max-w-full items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine ${toneClass}`}
    >
      <BriefcaseBusiness size={11} strokeWidth={1.5} className="shrink-0" />
      <span className="min-w-0 truncate">{role}</span>
    </span>
  );
}
