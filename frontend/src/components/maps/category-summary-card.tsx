"use client";

// 홈 Framework 뷰 — 카테고리 행 선택 시 우측 패널에 레벨 요약(집계·관리자 + level==5면 연계 캔버스 상태,
// level<5면 서브트리 확정 현황)을 보여준다. GET /categories/{id}/summary 단일 호출, 레이아웃은
// map-detail-card.tsx 관례(헤더+섹션, 내부 스크롤)를 따른다 (Track C Task 8, §8.3).

import { Loader2, Workflow } from "lucide-react";
import { useEffect, useState } from "react";

import { getCategorySummary, type CategorySummary } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

interface CategorySummaryCardProps {
  categoryId: number;
  // 연계 캔버스 열기 — 있으면 이동, 없으면 생성 후 이동. 홈 Framework 트리 Linkage 버튼(page.tsx handleOpenLinkage)과
  // 동일 핸들러를 공유해 실패 토스트까지 일원화한다.
  onOpenCanvas: (node: { id: number; linkage_map_id: number | null }) => void;
}

export function CategorySummaryCard({ categoryId, onOpenCanvas }: CategorySummaryCardProps) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<CategorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // categoryId 변경 시 page.tsx가 key={selectedCategoryId}로 리마운트시켜 초기 state(null)로 되돌린다 —
  // map-detail-card.tsx와 동일 관례. 이 effect는 fetch만 하고 동기 setState는 하지 않는다(set-state-in-effect 회피).
  useEffect(() => {
    let active = true;
    void getCategorySummary(categoryId)
      .then((res) => {
        if (active) setSummary(res);
      })
      .catch((err) => {
        if (active) setError(humanizeApiError(err, t));
      });
    return () => {
      active = false;
    };
  }, [categoryId, t]);

  function handleRetry() {
    setError(null);
    void getCategorySummary(categoryId)
      .then((res) => setSummary(res))
      .catch((err) => setError(humanizeApiError(err, t)));
  }

  if (error) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center p-4">
        <button
          type="button"
          data-id="category-summary-retry"
          className="text-left text-caption text-error hover:underline"
          onClick={handleRetry}
        >
          {error}
        </button>
      </div>
    );
  }

  if (!summary) {
    return (
      <div
        data-id="category-summary-loading"
        className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-4"
      >
        <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-ink-tertiary" />
        <span className="text-caption text-ink-tertiary">{t("common.loading")}</span>
      </div>
    );
  }

  const l5 = summary.l5;
  const subtreeConfirm = summary.subtree_confirm;

  // 게이트 상태 필 — 캔버스 없음(중립) / Ready(added) / Blocked(error)+실패 코드 필. 상태 라벨은
  // framework.overview.* 재사용, 실패 코드 필은 framework.gateFail.*(긍정문 framework.gate.*와 별도,
  // error 톤 극성 일치. final review Finding 2) — framework-overview.tsx의 renderStatus와 동일 소스.
  const renderGateStatus = () => {
    if (!l5 || l5.linkage_map_id === null) {
      return (
        <span className="inline-flex items-center rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary">
          {t("framework.overview.noCanvas")}
        </span>
      );
    }
    if (l5.ready) {
      return (
        <span className="inline-flex items-center rounded-sm border border-added px-1.5 py-0.5 text-fine text-added">
          {t("framework.overview.ready")}
        </span>
      );
    }
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className="inline-flex items-center rounded-sm border border-error px-1.5 py-0.5 text-fine text-error">
          {t("framework.overview.blocked")}
        </span>
        {l5.failures.map((f) => (
          <span
            key={f.code}
            className="inline-flex items-center rounded-sm border border-error/40 bg-error/10 px-1.5 py-0.5 text-fine text-error"
          >
            {t(`framework.gateFail.${f.code}` as MessageKey)} ({f.count})
          </span>
        ))}
      </span>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-id="category-summary-card" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* 헤더 — 경로 브레드크럼 + 레벨 배지 */}
        <div className="flex flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-full bg-accent-tint px-2 py-0.5 text-fine text-accent">
              L{summary.level}
            </span>
            <h2 className="min-w-0 truncate text-body-strong text-ink">{summary.name}</h2>
          </div>
          <p className="truncate text-fine text-ink-tertiary" title={summary.path}>
            {summary.path}
          </p>
        </div>

        {/* 집계 3필 — 직계 하위/서브트리 L5/서브트리 맵 수 */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-sm border border-hairline p-2 text-center">
            <div className="text-body-strong text-ink">{summary.child_count}</div>
            <div className="text-fine text-ink-tertiary">{t("category.summary.children")}</div>
          </div>
          <div className="rounded-sm border border-hairline p-2 text-center">
            <div className="text-body-strong text-ink">{summary.subtree_l5_count}</div>
            <div className="text-fine text-ink-tertiary">{t("category.summary.subtreeL5")}</div>
          </div>
          <div className="rounded-sm border border-hairline p-2 text-center">
            <div className="text-body-strong text-ink">{summary.subtree_map_count}</div>
            <div className="text-fine text-ink-tertiary">{t("category.summary.subtreeMaps")}</div>
          </div>
        </div>

        {/* 관리자 필 목록 — 이름 + L{level} 캡션(권한 상속 기준 레벨) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-fine text-ink-tertiary">{t("category.summary.admins")}</span>
          {summary.admins.length === 0 ? (
            <span data-id="category-summary-no-admins" className="text-fine text-ink-tertiary">
              {t("category.summary.noAdmins")}
            </span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {summary.admins.map((a) => (
                <span
                  key={a.login_id}
                  className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-fine text-ink-secondary"
                >
                  {a.name}
                  <span className="text-ink-tertiary">L{a.level}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* L5 — 연계 캔버스 상태(최신 확정·게이트·Open canvas) */}
        {l5 && (
          <div className="flex flex-col gap-2 rounded-sm border border-hairline p-3">
            <span className="text-fine text-ink-tertiary">{t("category.summary.canvasSection")}</span>
            {l5.latest_fw ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-body text-ink">{l5.latest_fw}</span>
                {l5.confirmed_at && (
                  <span className="text-fine text-ink-tertiary">
                    {formatKstShort(l5.confirmed_at)}
                    {l5.confirmed_by ? ` · ${l5.confirmed_by}` : ""}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-fine text-ink-tertiary">{t("framework.notConfirmedShort")}</span>
            )}
            {renderGateStatus()}
            {/* 캔버스 존재 시 전원, 미존재 시 권한자만 — 트리 Linkage 버튼과 동일 규칙(node.can_edit_linkage) */}
            {(l5.linkage_map_id !== null || l5.can_edit_linkage) && (
              <button
                type="button"
                data-id="category-summary-open-canvas"
                className="inline-flex items-center gap-1 self-start rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface-alt"
                onClick={() => onOpenCanvas({ id: summary.id, linkage_map_id: l5.linkage_map_id })}
              >
                <Workflow size={14} strokeWidth={1.5} />
                {t("category.summary.openCanvas")}
              </button>
            )}
          </div>
        )}

        {/* L1~L4 — 서브트리 L5 확정 현황 3종(상호배타 집계) */}
        {subtreeConfirm && (
          <div className="flex flex-col gap-1.5">
            <span className="text-fine text-ink-tertiary">{t("category.summary.subtreeSection")}</span>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-sm border border-added/40 bg-added/10 p-2 text-center">
                <div className="text-body-strong text-added">{subtreeConfirm.confirmed}</div>
                <div className="text-fine text-added">{t("status.confirmed")}</div>
              </div>
              <div className="rounded-sm border border-error/40 bg-error/10 p-2 text-center">
                <div className="text-body-strong text-error">{subtreeConfirm.not_ready}</div>
                <div className="text-fine text-error">{t("category.summary.notReady")}</div>
              </div>
              <div className="rounded-sm border border-hairline p-2 text-center">
                <div className="text-body-strong text-ink-tertiary">{subtreeConfirm.no_canvas}</div>
                <div className="text-fine text-ink-tertiary">{t("framework.overview.noCanvas")}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
