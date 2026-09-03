"use client";

// 읽기 전용 BPM 속성 행 — 부서(말단 필→조직 모달)·담당자(인물 필→인물 카드)·시스템(+원문 메모 힌트)·GMP(선택)·
// URL(링크 필). 인스펙터 속성 탭의 일반 노드 읽기 전용(뷰어·잠금·게시본)과 SP 노드의 링크 맵 상속 표시가
// 같은 컴포넌트를 쓴다 — 행 높이·스페이서(URL 위 구분선)는 편집 행과 동일 (사용자 요청 2026-09-03).

import { Building2, Link as LinkIcon, Monitor, ShieldCheck, Users } from "lucide-react";
import type { ReactNode } from "react";

import { AssigneePills } from "@/components/assignee-pills";
import { DeptPill } from "@/components/dept-pill";
import { FallbackHint } from "@/components/fallback-hint";
import { formatGmp, getGmpBadgeStyle } from "@/lib/gmp";
import { useI18n } from "@/lib/i18n";
import { INSPECTOR_ROW, INSPECTOR_ROW_LABEL } from "@/lib/inspector-row";

interface AttributeReadRowsProps {
  department: string;
  assignee: string;
  system: string;
  // 시스템 원문 메모 — 있으면 행머리 아이콘이 호버 시 메모 아이콘(읽기)
  systemNote?: string | null;
  // GMP 분류 — undefined면 행을 그리지 않는다(SP 상속 행은 GMP를 캔버스 필로만 보인다)
  gmp?: string;
  url: string;
  urlLabel: string;
  // data-id 접두 — `${prefix}-department-pill` / `${prefix}-assignee-pill` / `${prefix}-field-*`
  dataIdPrefix: string;
  // 행 아래 안내(SP: 링크 맵 오너가 설정)
  footnote?: ReactNode;
}

const EMPTY = <span className="text-caption text-ink">-</span>;

export function AttributeReadRows({
  department, assignee, system, systemNote, gmp, url, urlLabel, dataIdPrefix, footnote,
}: AttributeReadRowsProps) {
  const { t } = useI18n();
  const note = (systemNote ?? "").trim();
  return (
    <>
      <div className={INSPECTOR_ROW} data-id={`${dataIdPrefix}-row-department`}>
        <span className={INSPECTOR_ROW_LABEL}>
          <Building2 size={12} strokeWidth={1.5} className="text-ink-muted" />
          {t("field.department")}
        </span>
        {department.trim() !== "" ? <DeptPill department={department} dataId={`${dataIdPrefix}-department-pill`} /> : EMPTY}
      </div>
      <div className="flex min-h-8 items-start justify-between gap-2 py-1" data-id={`${dataIdPrefix}-row-assignee`}>
        <span className={`${INSPECTOR_ROW_LABEL} mt-1`}>
          <Users size={12} strokeWidth={1.5} className="text-ink-muted" />
          {t("field.assignee")}
        </span>
        {assignee.trim() !== "" ? (
          <AssigneePills assignee={assignee} dataIdPrefix={dataIdPrefix} />
        ) : (
          <span className="mt-1 text-caption text-ink">-</span>
        )}
      </div>
      <div className={`${INSPECTOR_ROW} group`} data-id={`${dataIdPrefix}-row-system`}>
        <span className={INSPECTOR_ROW_LABEL}>
          {note !== "" ? (
            <FallbackHint
              dataId={`${dataIdPrefix}-system-hint`}
              fallback={note}
              restIcon={Monitor}
              iconSize={12}
              padded={false}
              restClassName="text-ink-muted"
            />
          ) : (
            <Monitor size={12} strokeWidth={1.5} className="text-ink-muted" />
          )}
          {t("field.system")}
        </span>
        <span className="min-w-0 truncate text-right text-caption text-ink" title={system || undefined}>
          {system || "-"}
        </span>
      </div>
      {gmp !== undefined && (
        <div className={INSPECTOR_ROW} data-id={`${dataIdPrefix}-row-gmp`}>
          <span className={INSPECTOR_ROW_LABEL}>
            <ShieldCheck size={12} strokeWidth={1.5} className="text-ink-muted" />
            {t("field.gmp")}
          </span>
          {gmp !== "" ? (
            <span
              data-id={`${dataIdPrefix}-field-gmp`}
              className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-fine"
              style={getGmpBadgeStyle(gmp)}
            >
              {formatGmp(gmp)}
            </span>
          ) : (
            <span data-id={`${dataIdPrefix}-field-gmp`} className="text-caption text-ink-tertiary">-</span>
          )}
        </div>
      )}
      <div className={`${INSPECTOR_ROW} border-t border-divider`} data-id={`${dataIdPrefix}-row-url`}>
        <span className={INSPECTOR_ROW_LABEL}>
          <LinkIcon size={12} strokeWidth={1.5} className="text-ink-muted" />
          {t("field.url")}
        </span>
        {url.trim() !== "" ? (
          // 링크 필 — 새 탭. 라벨이 있으면 라벨, 없으면 URL(말줄임)
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            data-id={`${dataIdPrefix}-url-pill`}
            title={url}
            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink transition-colors hover:border-accent hover:text-accent"
          >
            <span className="min-w-0 truncate">{urlLabel.trim() || url}</span>
          </a>
        ) : (
          EMPTY
        )}
      </div>
      {footnote}
    </>
  );
}
