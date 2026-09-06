"use client";

// 업무 체계 카테고리 연결/해제 + 슬롯 이양 — 상세 카드 카테고리 필/유령 필에서 오너 전용으로 오픈 (Phase 2).
// 카테고리 선택은 조직도식 lazy 트리(listCategoryNodes) — 가장 하위(리프) 카테고리만 선택 가능,
// 선택 행은 accent 강조, 미선택이면 연결 버튼 비활성(2026-08-12 캐스케이드 셀렉트에서 개편).
// 이양 대상 맵 목록은 v1: 클라 listMaps() 지연 로드(서버 검색은 스케일 하드닝 트랙, 브리프 폴백).

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, Network, ShieldCheck, TriangleAlert, X } from "lucide-react";

import {
  getApiErrorDetail,
  getCategoryChain,
  listCategoryNodes,
  listMaps,
  postSlotChange,
  type CategoryNode,
  type MapSummary,
  type SlotChangeIn,
  type SlotChangeOut,
} from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { SearchSelect } from "@/components/search-select";
import { useI18n } from "@/lib/i18n";

interface FrameworkAssignModalProps {
  mapId: number;
  currentCategoryId: number | null | undefined;
  currentPath: string | null | undefined;
  onClose: () => void;
  onChanged: () => void;
}

export function FrameworkAssignModal({
  mapId,
  currentCategoryId,
  currentPath,
  onClose,
  onChanged,
}: FrameworkAssignModalProps) {
  const { t } = useI18n();
  // 조직도식 lazy 트리 — 자식 캐시(null 키=루트)·펼침·선택(리프만)·인플라이트.
  const [childrenByParent, setChildrenByParent] = useState<Map<number | null, CategoryNode[]>>(new Map());
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  const [loadingRoot, setLoadingRoot] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 이양 섹션 — 펼칠 때 1회 지연 로드.
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferMaps, setTransferMaps] = useState<MapSummary[] | null>(null);
  const [transferTargetId, setTransferTargetId] = useState("");
  // 현 슬롯 카테고리 레벨 — 레거시 비-L5 슬롯은 이양 차단(서버 409 미러, 2026-08-30 확정)
  const [currentLevel, setCurrentLevel] = useState<number | null>(null);
  // dry-run 프리뷰 결과 대기 중인 액션 — self_apply면 안내 모달로 승인 없이 바로 적용,
  // 아니면 error에 승인 필요 안내를 띄운다(승인 요청 생성은 트랙 C, spec 2026-09-06 §4.1)
  const [pending, setPending] = useState<{ body: SlotChangeIn; preview: SlotChangeOut } | null>(null);

  // 초기 로드 — currentCategoryId가 있으면 조상 체인(getCategoryChain)을 받아 그 경로를 미리 펼치고,
  // 현재 지정이 리프면 선택 상태로 시딩(재지정 시 루트부터 다시 탐색하지 않도록). 없으면 루트만 로드.
  useEffect(() => {
    let active = true;
    async function init() {
      if (currentCategoryId == null) {
        const roots = await listCategoryNodes();
        if (active) {
          setChildrenByParent(new Map([[null, roots]]));
          setLoadingRoot(false);
        }
        return;
      }
      const chainNodes = await getCategoryChain(currentCategoryId);
      const ids = chainNodes.map((n) => n.id);
      const parents: (number | null)[] = [null, ...ids];
      const lists = await Promise.all(parents.map((p) => listCategoryNodes(p ?? undefined)));
      if (!active) return;
      setChildrenByParent(new Map(parents.map((p, i) => [p, lists[i]] as const)));
      // 자식 있는 조상만 펼침 — 리프(현재 지정)는 펼칠 게 없다.
      setOpenIds(new Set(ids.filter((_, i) => lists[i + 1].length > 0)));
      const last = chainNodes[chainNodes.length - 1];
      setCurrentLevel(last?.level ?? null);
      // 선택 시딩도 L5만 — 레거시 비-L5 지정을 그대로 재배정 대상으로 올리지 않는다 (2026-08-30)
      if (last && last.level === 5) setSelectedId(last.id);
      setLoadingRoot(false);
    }
    void init().catch((err: unknown) => {
      // 실패해도 로딩 스피너가 영원히 남지 않도록 해제 — 기존 하단 에러 텍스트로 안내.
      if (active) {
        setLoadingRoot(false);
        setError(getApiErrorDetail(err));
      }
    });
    return () => {
      active = false;
    };
  }, [currentCategoryId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 행 클릭 — 리프(child_count 0)는 선택, 상위 카테고리는 펼침/접힘 전용(선택 불가).
  function handleNodeClick(node: CategoryNode) {
    // 맵 슬롯은 L5 전용(2026-08-30 확정) — 리프여도 L5가 아니면 선택 불가(서버 422 미러)
    if (node.level === 5) {
      setSelectedId(node.id);
      return;
    }
    if (node.child_count === 0) {
      return; // 비-L5 말단 — 선택도 펼침도 없음
    }
    if (openIds.has(node.id)) {
      setOpenIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
      return;
    }
    setOpenIds((prev) => new Set(prev).add(node.id));
    if (!childrenByParent.has(node.id) && !loadingIds.has(node.id)) {
      setLoadingIds((prev) => new Set(prev).add(node.id));
      void listCategoryNodes(node.id)
        .then((nodes) => {
          setChildrenByParent((prev) => new Map(prev).set(node.id, nodes));
        })
        .catch((err: unknown) => setError(getApiErrorDetail(err)))
        .finally(() => {
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(node.id);
            return next;
          });
        });
    }
  }

  function openTransfer() {
    setTransferOpen(true);
    if (transferMaps === null) {
      void listMaps()
        .then(setTransferMaps)
        .catch((err: unknown) => setError(getApiErrorDetail(err)));
    }
  }

  // 공용 실행기 — dry-run으로 승인자·영향을 미리 보고, self_apply면 안내 모달(pending)로 넘긴다.
  // self_apply가 아니면 승인 필요 안내를 바로 보여준다(요청 생성 UI는 트랙 C).
  async function planChange(body: SlotChangeIn) {
    setSubmitting(true);
    setError(null);
    try {
      const preview = await postSlotChange(mapId, { ...body, dry_run: true });
      if (!preview.self_apply) {
        const names = preview.sides.flatMap((s) => s.approvers);
        setError(
          names.length > 0
            ? t("home.frameworkSlotNeedsApproval", { names: names.join(", ") })
            : t("home.frameworkSlotNoApprovers"),
        );
        return;
      }
      setPending({ body, preview });
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function applyPending() {
    if (pending === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await postSlotChange(mapId, pending.body);
      setPending(null);
      onChanged();
      onClose();
    } catch (err) {
      // 실패 시에도 안내 모달을 닫아야 아래 error 줄이 보인다 — 안 닫으면 모달이 떠 있는 채로 조용히 멈춘 것처럼 보인다
      setPending(null);
      setError(getApiErrorDetail(err));
    } finally {
      setSubmitting(false);
    }
  }

  // 연결 버튼 — 슬롯 없음=assign, 다른 L5로 변경=move. 같은 L5 재선택은 무동작.
  function requestAssign() {
    if (selectedId === null) return;
    if (currentCategoryId == null) void planChange({ action: "assign", to_category_id: selectedId });
    else if (selectedId !== currentCategoryId) void planChange({ action: "move", to_category_id: selectedId });
  }

  // 트리 행 — 상위는 쉐브론 토글, L5만 선택 가능(맵 슬롯 L5 전용, 2026-08-30). 선택 행은 accent 틴트+체크.
  const renderNode = (node: CategoryNode, depth: number): ReactNode => {
    const isLeaf = node.child_count === 0;
    const selectable = node.level === 5;
    const open = openIds.has(node.id);
    const children = childrenByParent.get(node.id) ?? [];
    const selected = selectedId === node.id;
    return (
      <li key={node.id} className="flex flex-col">
        <button
          type="button"
          data-id={`framework-pick-${node.id}`}
          aria-pressed={selectable ? selected : undefined}
          aria-expanded={isLeaf ? undefined : open}
          onClick={() => handleNodeClick(node)}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
          className={`flex w-full items-center gap-1.5 rounded-sm py-1 pr-1.5 text-left text-caption ${
            selected
              ? "bg-accent-tint text-accent"
              : selectable
                ? "text-ink hover:bg-divider"
                : isLeaf
                  ? "cursor-default text-ink-tertiary" // 비-L5 말단 — 선택 불가 표시
                  : "text-ink-secondary hover:bg-divider"
          }`}
        >
          {isLeaf ? (
            <span className="inline-block w-3.5 shrink-0" /> // 쉐브론 폭만큼 자리 맞춤 — 리프 정렬 유지
          ) : open ? (
            <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />
          )}
          <span className="min-w-0 truncate">{node.name}</span>
          {selected && <Check size={14} strokeWidth={2} className="ml-auto shrink-0" />}
        </button>
        {open &&
          (loadingIds.has(node.id) ? (
            <p style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }} className="py-0.5 text-fine text-ink-tertiary">
              {t("common.loading")}
            </p>
          ) : (
            children.length > 0 && (
              <ul className="flex flex-col">{children.map((c) => renderNode(c, depth + 1))}</ul>
            )
          ))}
      </li>
    );
  };

  // 이양 대상은 슬롯 없는 일반 맵만 — 이미 슬롯(카테고리/컨설턴트 코드) 가진 맵·framework/word 맵·자기 자신 제외.
  const mapOptions = (transferMaps ?? [])
    .filter(
      (m) =>
        m.id !== mapId &&
        (m.mode ?? "normal") === "normal" &&
        m.category_id == null &&
        m.consultant_code == null,
    )
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

        <div data-id="framework-pick-tree" className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-sm bg-surface-alt p-2">
          <p className="text-fine text-ink-tertiary">{t("home.frameworkPickLeafHint")}</p>
          {loadingRoot ? (
            <p className="text-caption text-ink-tertiary">{t("common.loading")}</p>
          ) : (childrenByParent.get(null) ?? []).length === 0 ? (
            <p className="text-caption text-ink-tertiary">{t("home.frameworkEmpty")}</p>
          ) : (
            <ul className="flex flex-col">
              {(childrenByParent.get(null) ?? []).map((node) => renderNode(node, 0))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-id="framework-assign-btn"
            disabled={selectedId === null || submitting}
            className="flex-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={requestAssign}
          >
            {t("home.frameworkAssign")}
          </button>
          {currentCategoryId != null && (
            <button
              type="button"
              data-id="framework-unassign-btn"
              disabled={submitting}
              className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
              onClick={() => void planChange({ action: "unassign" })}
            >
              {t("home.frameworkUnassign")}
            </button>
          )}
        </div>

        {currentCategoryId != null && (
          <div className="flex flex-col gap-2 border-t border-hairline pt-3">
            {currentLevel !== null && currentLevel !== 5 ? (
              // 레거시 비-L5 슬롯 — 이양 대신 L5 재배정 유도. 아이콘+틴트 배너로 시인성 확보 (서버 409 미러)
              <div
                data-id="framework-transfer-l5only"
                className="flex items-start gap-2 rounded-sm border border-changed/40 bg-changed/10 px-2.5 py-2"
              >
                <TriangleAlert size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-changed" />
                <div className="flex min-w-0 flex-col gap-0.5 text-fine">
                  <span className="font-semibold text-changed">
                    {t("home.frameworkTransferL5OnlyTitle")}
                  </span>
                  <span className="text-ink-secondary">{t("home.frameworkTransferL5OnlyDesc")}</span>
                </div>
              </div>
            ) : !transferOpen ? (
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
                <p className="text-fine text-ink-tertiary">{t("home.frameworkTransferPickMode")}</p>
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
                  onClick={() => void planChange({ action: "replace", to_map_id: Number(transferTargetId) })}
                >
                  {t("home.frameworkTransfer")}
                </button>
              </>
            )}
          </div>
        )}

        {error && <p className="text-caption text-error">{error}</p>}

        {pending !== null && (
          <ConfirmDialog
            icon={<ShieldCheck size={28} strokeWidth={1.5} />}
            title={t("home.frameworkSelfApplyTitle")}
            message={`${t("home.frameworkSelfApplyDesc")} · ${t("home.frameworkImpactSummary", {
              home: String(pending.preview.impact.home_canvas_nodes),
              other: String(pending.preview.impact.other_canvas_nodes),
              refs: String(pending.preview.impact.referencing_maps),
            })}`}
            confirmLabel={t("home.frameworkApplyNow")}
            cancelLabel={t("summary.cancel")}
            danger={pending.body.action === "unassign" || pending.body.action === "delete"}
            confirmDisabled={submitting}
            onConfirm={() => void applyPending()}
            onClose={() => setPending(null)}
          />
        )}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
