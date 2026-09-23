"use client";

// AI 액션 버튼 — 액센트 그라데이션 + hover 쉬머. 캠페인의 제안/재제안/AI 제안/피드백, 관리 패널 AI 타일이 공유 (spec 2026-09-23 §3 B11).

import { Sparkles } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type AiButtonVariant = "primary" | "tile" | "inline";

const BASE =
  "ai-shimmer relative inline-flex items-center gap-1.5 overflow-hidden text-on-accent hover:brightness-105 disabled:opacity-40 " +
  "[background:linear-gradient(135deg,var(--color-accent),var(--color-accent-focus))]";
const VARIANT: Record<AiButtonVariant, string> = {
  primary: "rounded-sm px-3 py-1.5 text-caption",
  tile: "h-14 w-full rounded-md px-3 text-left",
  inline: "rounded-sm px-2 py-1 text-fine",
};

export function buildAiButtonClass(variant: AiButtonVariant): string {
  return `${BASE} ${VARIANT[variant]}`;
}

interface AiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AiButtonVariant;
  // 기본 Sparkles. null이면 아이콘 없음
  icon?: ReactNode;
}

export function AiButton({ variant = "primary", icon, className, children, type = "button", ...rest }: AiButtonProps) {
  const size = variant === "tile" ? 16 : 14;
  return (
    <button type={type} className={`${buildAiButtonClass(variant)} ${className ?? ""}`} {...rest}>
      {icon === undefined ? <Sparkles size={size} strokeWidth={1.5} className="shrink-0" /> : icon}
      {children}
    </button>
  );
}
