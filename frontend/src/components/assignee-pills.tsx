"use client";

// 담당자 필 — 저장된 담당자(영문 name, 콤마 구분)를 필 목록으로. 디렉터리에서 이름을 찾으면 인물 카드
// (PersonHoverCard: 호버 0.7초/클릭 즉시 — 이름·아이디·말단 부서+조직 경로) 트리거가 되고, 못 찾으면 정적 필.
// 노드 편집 모달·지정 모달의 담당자 타일(+피커 초안)과 인스펙터 BPM 속성 담당자 행이 공유한다
// (사용자 요청 2026-09-03, 부서 말단 필과 같은 문법).

import { User, X } from "lucide-react";

import { PersonHoverCard } from "@/components/person-hover-card";
import type { DirectoryUser } from "@/lib/api";
import { parseAssignees } from "@/lib/assignee";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";

interface AssigneePillsProps {
  assignee: string;
  // data-id 접두 — `${prefix}-assignee-pill`
  dataIdPrefix: string;
  // 있으면 필마다 제거 버튼(편집 행·피커 초안)
  onRemove?: (name: string) => void;
  // 부서와 안 맞는 이름 — 오류 톤
  drifted?: readonly string[];
  align?: "start" | "end";
}

export function AssigneePills({ assignee, dataIdPrefix, onRemove, drifted = [], align = "end" }: AssigneePillsProps) {
  const { t, lang } = useI18n();
  const dir = useDirectory();
  const names = parseAssignees(assignee);
  if (names.length === 0) return null;
  // 저장값은 영문 name — 디렉터리에서 name(또는 한글명) 일치로 인물 해석
  const byName = new Map<string, DirectoryUser>();
  for (const user of dir.values()) {
    byName.set(user.name, user);
    if (user.korean_name) byName.set(user.korean_name, user);
  }
  return (
    <span className={`flex min-w-0 flex-wrap items-center gap-1 ${align === "end" ? "justify-end" : ""}`}>
      {names.map((name) => {
        const user = byName.get(name);
        const isDrift = drifted.includes(name);
        const label = user ? (lang === "ko" ? user.korean_name || user.name : user.name) : name;
        const body = (
          <>
            <User size={11} strokeWidth={1.5} className="shrink-0" />
            <span className="min-w-0 truncate">{label}</span>
          </>
        );
        return (
          <span
            key={name}
            data-id={`${dataIdPrefix}-assignee-pill`}
            data-resolved={user ? "true" : "false"}
            title={user ? `${user.name}${user.korean_name ? ` (${user.korean_name})` : ""} · ${user.department}` : name}
            className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-fine font-semibold ${
              isDrift ? "border-error/40 bg-error/10 text-error" : "border-accent-tint-border bg-accent-tint text-accent"
            }`}
          >
            {user ? (
              <PersonHoverCard userId={user.id} className="inline-flex min-w-0 items-center gap-1">
                {body}
              </PersonHoverCard>
            ) : (
              body
            )}
            {onRemove && (
              <button
                type="button"
                aria-label={t("summary.close")}
                className="shrink-0 rounded-full hover:bg-surface/60"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(name);
                }}
              >
                <X size={11} strokeWidth={1.5} />
              </button>
            )}
          </span>
        );
      })}
    </span>
  );
}
