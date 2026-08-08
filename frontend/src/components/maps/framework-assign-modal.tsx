"use client";

// 업무 체계 카테고리 연결/해제 + 슬롯 이양 — 상세 카드 카테고리 필/유령 필에서 오너 전용으로 오픈 (Phase 2).
// 레벨별 캐스케이드 셀렉트(listCategoryNodes lazy, 루트부터)로 아무 깊이(비-리프 포함)나 연결 가능
// (설계 §2.2). 선택 체인 갱신(하위 리셋)은 순수 헬퍼(lib/category-cascade.ts)로 분리해 유닛 테스트.
// 이양 대상 맵 목록은 v1: 클라 listMaps() 지연 로드(서버 검색은 스케일 하드닝 트랙, 브리프 폴백).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Network, X } from "lucide-react";

import {
  getApiErrorDetail,
  listCategoryNodes,
  listMaps,
  postFrameworkTransfer,
  putMapCategory,
  type CategoryNode,
  type MapSummary,
} from "@/lib/api";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { SearchSelect } from "@/components/search-select";
import { pickCascadeLevel } from "@/lib/category-cascade";
import { useI18n } from "@/lib/i18n";

interface FrameworkAssignModalProps {
  mapId: number;
  currentCategoryId: number | null | undefined;
  currentPath: string | null | undefined;
  hasConsultantCode: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export function FrameworkAssignModal({
  mapId,
  currentCategoryId,
  currentPath,
  hasConsultantCode,
  onClose,
  onChanged,
}: FrameworkAssignModalProps) {
  const { t } = useI18n();
  // 레벨별 선택 체인 — depth i는 chain[i](카테고리 id). 재선택 시 pickCascadeLevel이 하위를 리셋.
  const [chain, setChain] = useState<number[]>([]);
  // depth별 옵션 — [0]=루트, [i+1]=chain[i]의 자식(리프면 없음 → 더 이상 select가 나타나지 않는다).
  const [optionsByDepth, setOptionsByDepth] = useState<CategoryNode[][]>([]);
  const [loadingRoot, setLoadingRoot] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 이양 섹션 — 펼칠 때 1회 지연 로드.
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferMaps, setTransferMaps] = useState<MapSummary[] | null>(null);
  const [transferTargetId, setTransferTargetId] = useState("");

  // 루트 1회 로드.
  useEffect(() => {
    let active = true;
    void listCategoryNodes().then((nodes) => {
      if (active) {
        setOptionsByDepth([nodes]);
        setLoadingRoot(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 체인 끝(마지막 선택)의 자식을 lazy 로드 — 있으면 다음 레벨 select가 나타난다.
  useEffect(() => {
    if (chain.length === 0) return;
    const depth = chain.length - 1;
    const parentId = chain[depth];
    if (optionsByDepth[depth + 1]) return; // 이미 로드됨
    let active = true;
    void listCategoryNodes(parentId).then((nodes) => {
      if (active && nodes.length > 0) {
        setOptionsByDepth((prev) => {
          const next = prev.slice(0, depth + 1);
          next[depth + 1] = nodes;
          return next;
        });
      }
    });
    return () => {
      active = false;
    };
  }, [chain, optionsByDepth]);

  function pickAt(depth: number, categoryId: number) {
    setChain((prev) => pickCascadeLevel(prev, depth, categoryId));
    // 체인과 정합 유지 — 재선택된 depth보다 깊은 옵션은 폐기(위 effect가 새 부모 기준으로 다시 채운다).
    setOptionsByDepth((prev) => prev.slice(0, depth + 1));
  }

  function openTransfer() {
    setTransferOpen(true);
    if (transferMaps === null) {
      void listMaps()
        .then(setTransferMaps)
        .catch((err: unknown) => setError(getApiErrorDetail(err)));
    }
  }

  async function handleAssign() {
    if (chain.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await putMapCategory(mapId, chain[chain.length - 1]);
      onChanged();
      onClose();
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnassign() {
    setSubmitting(true);
    setError(null);
    try {
      await putMapCategory(mapId, null);
      onChanged();
      onClose();
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTransfer() {
    if (!transferTargetId) return;
    setSubmitting(true);
    setError(null);
    try {
      await postFrameworkTransfer(mapId, Number(transferTargetId));
      onChanged();
      onClose();
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setSubmitting(false);
    }
  }

  const mapOptions = (transferMaps ?? [])
    .filter((m) => m.id !== mapId)
    .map((m) => ({ value: String(m.id), label: m.name }));

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="framework-assign-modal"
        className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
              <Network size={18} strokeWidth={1.5} />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-body-strong text-ink">{t("home.frameworkTitle")}</h2>
              <p className="truncate text-fine text-ink-tertiary">
                {currentPath
                  ? t("home.frameworkCurrent", { path: currentPath })
                  : t("home.frameworkNotConnected")}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("summary.close")}
            title={t("summary.close")}
            className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div data-id="framework-cascade" className="flex flex-col gap-2 rounded-sm bg-surface-alt p-2">
          <p className="text-fine text-ink-tertiary">{t("home.frameworkPickCategory")}</p>
          {loadingRoot ? (
            <p className="text-caption text-ink-tertiary">{t("common.loading")}</p>
          ) : (
            optionsByDepth.map((options, depth) => (
              <select
                key={depth}
                data-id={`framework-cascade-level-${depth}`}
                className="w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink"
                value={chain[depth] ?? ""}
                onChange={(event) => pickAt(depth, Number(event.target.value))}
              >
                <option value="" disabled>
                  {t("home.frameworkPickCategory")}
                </option>
                {options.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            ))
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-id="framework-assign-btn"
            disabled={chain.length === 0 || submitting}
            className="flex-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => void handleAssign()}
          >
            {t("home.frameworkAssign")}
          </button>
          {currentCategoryId != null && (
            <button
              type="button"
              data-id="framework-unassign-btn"
              disabled={submitting}
              className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
              onClick={() => void handleUnassign()}
            >
              {t("home.frameworkUnassign")}
            </button>
          )}
        </div>

        {hasConsultantCode && (
          <div className="flex flex-col gap-2 border-t border-hairline pt-3">
            {!transferOpen ? (
              <button
                type="button"
                data-id="framework-transfer-open"
                className="self-start text-caption text-accent hover:underline"
                onClick={openTransfer}
              >
                {t("home.frameworkTransfer")}
              </button>
            ) : (
              <>
                <p className="text-fine text-ink-tertiary">{t("home.frameworkTransferPick")}</p>
                <SearchSelect
                  value={transferTargetId}
                  options={mapOptions}
                  emptyLabel={t("home.frameworkTransferPick")}
                  placeholder={t("field.searchPlaceholder")}
                  onChange={setTransferTargetId}
                />
                <button
                  type="button"
                  data-id="framework-transfer-btn"
                  disabled={!transferTargetId || submitting}
                  className="self-end rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
                  onClick={() => void handleTransfer()}
                >
                  {t("home.frameworkTransfer")}
                </button>
              </>
            )}
          </div>
        )}

        {error && <p className="text-caption text-error">{error}</p>}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
