"use client";

// AI 액션 버튼 — 액센트 그라데이션 + hover 쉬머. 캠페인의 제안/재제안/AI 제안/피드백, 관리 패널 AI 타일이 공유 (spec 2026-09-23 §3 B11).
// 크기는 일반 primary 버튼(px-3 py-1.5 text-caption)과 같게 한 벌로 통일 — 표면마다 다른 크기를 두지 않는다(사용자 피드백 2026-09-23).
// `text`는 배경 없는 글자 버튼(주관식 [AI 제안]처럼 제목 줄에 얹는 자리) — 그라데이션·쉬머 없음.

import { Sparkles } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type AiButtonVariant = "primary" | "tile" | "inline" | "text";

// 진한 보라(elevated) → 액센트 → 새벽 액센트(sky)까지 3단 — 두 액센트만으론 그라데이션이 단색처럼 보였다
const GRADIENT =
  "[background:linear-gradient(135deg,var(--color-accent-elevated)_0%,var(--color-accent)_55%,var(--color-accent-sky)_100%)]";
const BASE = `ai-shimmer relative inline-flex items-center gap-1.5 overflow-hidden text-on-accent hover:brightness-105 disabled:opacity-40 ${GRADIENT}`;
const TEXT_BASE = "inline-flex items-center gap-1 text-fine text-accent hover:text-accent-focus hover:underline disabled:opacity-40";
const VARIANT: Record<AiButtonVariant, string> = {
  primary: "rounded-sm px-3 py-1.5 text-caption",
  tile: "h-14 w-full rounded-md px-3 text-left",
  inline: "rounded-sm px-3 py-1.5 text-caption",
  text: "",
};

export function buildAiButtonClass(variant: AiButtonVariant): string {
  return variant === "text" ? TEXT_BASE : `${BASE} ${VARIANT[variant]}`;
}

interface AiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AiButtonVariant;
  // 기본 Sparkles. null이면 아이콘 없음
  icon?: ReactNode;
}

export function AiButton({ variant = "primary", icon, className, children, type = "button", ...rest }: AiButtonProps) {
  const size = variant === "tile" ? 16 : variant === "text" ? 12 : 14;
  return (
    <button type={type} className={`${buildAiButtonClass(variant)} ${className ?? ""}`} {...rest}>
      {icon === undefined ? <Sparkles size={size} strokeWidth={1.5} className="shrink-0" /> : icon}
      {children}
    </button>
  );
}
