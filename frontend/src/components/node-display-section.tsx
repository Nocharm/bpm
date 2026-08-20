// Node display(캔버스 노드 표시 정보) 토글 섹션 — 인스펙터 맵 탭·속성 탭 기본 화면 공용.
// 카테고리 계단 구성(속성/수행 지표/입출력·조건) + 행 전체 클릭 토글(사용자 결정 2026-08-20).
"use client";

import {
  Building2,
  ChevronRight,
  Link,
  LogIn,
  LogOut,
  Play,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import type { NodeDisplayToggle } from "@/lib/node-actions";

const TOGGLE_ICONS: Record<NodeDisplayToggle, LucideIcon> = {
  assignee: UserRound,
  department: Building2,
  system: Server,
  url: Link,
  gmp: ShieldCheck,
  params: SlidersHorizontal,
  input: LogIn,
  output: LogOut,
  conditions: Play,
};

const TOGGLE_LABEL_KEY: Record<NodeDisplayToggle, MessageKey> = {
  assignee: "field.assignee",
  department: "field.department",
  system: "field.system",
  url: "field.url",
  gmp: "field.gmp",
  params: "field.params",
  input: "field.input",
  output: "field.output",
  conditions: "field.conditions",
};

// 카테고리 구성 — 벌크 편집·인스펙터 카드와 동일 3분류(라벨 키 재사용)
const TOGGLE_CATEGORIES: { key: string; labelKey: MessageKey; fields: NodeDisplayToggle[] }[] = [
  { key: "attributes", labelKey: "bulk.catAttributes", fields: ["assignee", "department", "system", "url", "gmp"] },
  { key: "metrics", labelKey: "inspector.parameters", fields: ["params"] },
  // 인풋/아웃풋은 별도, 조건은 하나로 묶음 (사용자 결정 2026-08-20)
  { key: "details", labelKey: "inspector.details", fields: ["input", "output", "conditions"] },
];

interface NodeDisplaySectionProps {
  displayFields: NodeDisplayToggle[];
  onToggle: (field: NodeDisplayToggle) => void;
  // 표면별 data-id 접두("inspector" | "properties") — 같은 화면에 중복 마운트되지 않게 구분
  idPrefix: string;
}

export function NodeDisplaySection({ displayFields, onToggle, idPrefix }: NodeDisplaySectionProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(true);
  const onCount = displayFields.length;

  return (
    <div data-id={`${idPrefix}-node-display-section`} className="rounded-md border border-hairline p-3">
      <button
        type="button"
        data-id={`${idPrefix}-node-display-toggle`}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-1 text-fine font-semibold text-ink"
      >
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className={`shrink-0 transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
        />
        {t("inspector.nodeDisplay")}
        {onCount > 0 && <span className="font-normal text-ink-tertiary">({onCount})</span>}
        <span className="font-normal text-ink-tertiary">· {t("inspector.mapWide")}</span>
      </button>
      {!collapsed && (
        <div className="mt-1 flex flex-col gap-1">
          {TOGGLE_CATEGORIES.map(({ key, labelKey, fields }) => (
            <div key={key}>
              <p className="py-0.5 text-fine text-ink-tertiary">{t(labelKey)}</p>
              {/* 계단 구성 — 카테고리 아래 들여쓰기 + 세로선(카드 아코디언과 동일 시각 언어) */}
              <div className="ml-2 border-l border-divider pl-2">
                {fields.map((field) => {
                  const on = displayFields.includes(field);
                  const Icon = TOGGLE_ICONS[field];
                  return (
                    // 행 전체가 토글 — 스위치만 노리지 않아도 켜고 끌 수 있게 (사용자 결정 2026-08-20)
                    <button
                      key={field}
                      type="button"
                      role="switch"
                      aria-checked={on}
                      data-id={`${idPrefix}-node-display-${field}`}
                      onClick={() => onToggle(field)}
                      className="flex w-full items-center justify-between rounded-sm px-1 py-1 text-caption text-ink-secondary hover:bg-surface-alt"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Icon size={14} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                        <span className="truncate">{t(TOGGLE_LABEL_KEY[field])}</span>
                      </span>
                      <span
                        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
                          on ? "bg-accent" : "bg-border-strong"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-3 w-3 rounded-full bg-surface transition-all ${
                            on ? "left-3.5" : "left-0.5"
                          }`}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
