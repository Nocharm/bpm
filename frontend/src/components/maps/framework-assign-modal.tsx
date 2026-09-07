"use client";

// 업무 체계 카테고리 연결/해제 + 슬롯 이양 — 상세 카드 카테고리 필/유령 필에서 오너 전용으로 오픈 (Phase 2).
// 카테고리 선택은 조직도식 lazy 트리(listCategoryNodes) — 가장 하위(리프) 카테고리만 선택 가능,
// 선택 행은 accent 강조, 미선택이면 연결 버튼 비활성(2026-08-12 캐스케이드 셀렉트에서 개편).
// 이양 대상 맵 목록은 v1: 클라 listMaps() 지연 로드(서버 검색은 스케일 하드닝 트랙, 브리프 폴백).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Clock, Network, TriangleAlert, Undo2, X } from "lucide-react";

import {
  getApiErrorDetail,
  getCategoryChain,
  getPendingSlotChange,
  listCategoryNodes,
  listMaps,
  postSlotChange,
  withdrawSlotChange,
  type CategoryNode,
  type MapSummary,
  type PendingSlotChange,
  type SlotChangeIn,
  type SlotChangeOut,
} from "@/lib/api";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { SearchSelect } from "@/components/search-select";
import { SlotChangeDialog } from "@/components/maps/slot-change-dialog";
import { UserPill } from "@/components/user-pill";
import { isSlotAction, SLOT_ACTION_KEY } from "@/lib/framework-slot-state";
import { useI18n } from "@/lib/i18n";
import { useSectionMotion } from "@/lib/use-closing-keys";

interface FrameworkAssignModalProps {
  mapId: number;
  currentCategoryId: number | null | undefined;
  currentPath: string | null | undefined;
  onClose: () => void;
  onChanged: () => void;
  // 슬롯 변경 적용/요청 성공 토스트 — 호출부에 토스트 표시 수단이 없으면 생략(무시).
  onToast?: (message: string) => void;
  // 대기 배너의 철회 버튼 노출 판정(로그인 사용자==요청자). 없으면(null) 철회 버튼 숨김.
  currentUser: string | null;
}

export function FrameworkAssignModal({
  mapId,
  currentCategoryId,
  currentPath,
  onClose,
  onChanged,
  onToast,
  currentUser,
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
  // dry-run 프리뷰 결과 대기 중인 액션 — SlotChangeDialog로 넘겨 self_apply 즉시 적용/그 외 승인 요청을 안내한다.
  const [pending, setPending] = useState<{ body: SlotChangeIn; preview: SlotChangeOut } | null>(null);
  // 이 맵에 걸린 미결 슬롯 변경 요청 — undefined=조회 전, null=없음. 있으면 배너 노출 + 연결/해제/이양 버튼 잠금.
  const [pendingReq, setPendingReq] = useState<PendingSlotChange | null | undefined>(undefined);
  // 미결 조회 실패 — "없음"으로 오인하면 이미 대기 중인 변경 위에 덮어쓸 수 있어 fail-closed로 버튼을 계속 잠근다
  // (리뷰 라운드1 #2b). 재조회는 모달을 닫았다 다시 여는 remount로 이뤄진다.
  const [pendingReqFailed, setPendingReqFailed] = useState(false);
  // 대기 요청 유무와 무관하게 연결/해제/이양을 잠가야 하면 true.
  const pendingLocked = Boolean(pendingReq) || pendingReqFailed;
  // 철회 진행 중 — 더블클릭으로 withdrawSlotChange가 두 번 나가지 않도록.
  const [withdrawing, setWithdrawing] = useState(false);

  // 아코디언 펼침 모션 — 노드별 userOpenedIds 추적(자동 드릴인은 static, 사용자가 직접 편
  // 노드만 open 애니메이션)을 공용 훅으로 이관(F4) — framework-tree-picker.tsx와 중복이던 배선.
  const { closingKeys, getSectionClass, openSection, closeSection } = useSectionMotion<number>();

  // 자동 드릴인 상한 — 단일 후보 체인이라도 무한히 파고들지 않게(tree-picker AUTO_DRILL_MAX와 동일 값).
  const AUTO_DRILL_MAX = 6;
  // 비동기 재귀 중 최신 캐시를 읽기 위한 ref 미러 (framework-tree-picker.tsx stateRef와 동일 패턴 —
  // setChildrenByParent 직후에도 클로저는 갱신 전 값을 들고 있는 문제를 피한다).
  const childrenByParentRef = useRef(childrenByParent);
  useEffect(() => {
    childrenByParentRef.current = childrenByParent;
  }, [childrenByParent]);

  // 방금 로드된 kids가 정확히 하나고 막다른 리프가 아니면(자식 있음 또는 L5) 그 자식도 열고 계속 판다.
  // L5(선택 가능한 종착점)에 닿으면 열기만 하고 자동 선택은 하지 않은 채 멈춘다(사용자 요청 2026-09-07).
  async function continueAutoDrill(kids: CategoryNode[], hop: number): Promise<void> {
    if (hop >= AUTO_DRILL_MAX || kids.length !== 1) return;
    const only = kids[0];
    const isInertLeaf = only.child_count === 0 && only.level !== 5;
    if (isInertLeaf) return; // 더 펼칠 것도 고를 것도 없는 막다른 길 — 열지 않는다
    openSection(only.id, false); // F5: 닫히는 중이던 고스트가 방금 재펼침을 덮지 않게 먼저 취소 — static으로 렌더
    setOpenIds((prev) => new Set(prev).add(only.id));
    if (only.level === 5) return; // 선택 가능한 종착점 — 자동 선택 없이 멈춘다
    const cached = childrenByParentRef.current.get(only.id);
    if (cached !== undefined) {
      await continueAutoDrill(cached, hop + 1);
      return;
    }
    setLoadingIds((prev) => new Set(prev).add(only.id));
    try {
      const nextKids = await listCategoryNodes(only.id);
      setChildrenByParent((prev) => new Map(prev).set(only.id, nextKids));
      await continueAutoDrill(nextKids, hop + 1);
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(only.id);
        return next;
      });
    }
  }

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

  // 미결 슬롯 변경 조회 — 있으면 배너로 진행 상황을 보여주고 연결/해제/이양을 잠근다.
  // 조회 실패는 "없음"으로 취급하지 않는다 — 실제로 대기 중인데 놓치면 그 위에 덮어쓸 수 있으므로
  // fail-closed: 에러를 보여주고 버튼은 계속 잠근 채로 둔다(리뷰 라운드1 #2b).
  useEffect(() => {
    let active = true;
    getPendingSlotChange(mapId)
      .then((result) => {
        if (active) {
          setPendingReq(result);
          setPendingReqFailed(false);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPendingReqFailed(true);
        setError(getApiErrorDetail(err));
      });
    return () => {
      active = false;
    };
  }, [mapId]);

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
      closeSection(node.id); // 고스트 렌더로 accordion-close 재생 후 언마운트
      setOpenIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
      return;
    }
    openSection(node.id, true); // 사용자가 직접 편 노드만 accordion-open 재생
    setOpenIds((prev) => new Set(prev).add(node.id));
    const cachedKids = childrenByParent.get(node.id);
    if (cachedKids !== undefined) {
      void continueAutoDrill(cachedKids, 0); // 캐시 경로도 동일 규칙(단일 후보 자동 드릴인)
      return;
    }
    if (loadingIds.has(node.id)) return; // 이미 인플라이트 — 응답 도착 시 채워질 뿐
    setLoadingIds((prev) => new Set(prev).add(node.id));
    void listCategoryNodes(node.id)
      .then((nodes) => {
        setChildrenByParent((prev) => new Map(prev).set(node.id, nodes));
        void continueAutoDrill(nodes, 0);
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

  function openTransfer() {
    setTransferOpen(true);
    if (transferMaps === null) {
      void listMaps()
        .then(setTransferMaps)
        .catch((err: unknown) => setError(getApiErrorDetail(err)));
    }
  }

  // 공용 실행기 — dry-run으로 승인자·영향을 미리 보고 SlotChangeDialog(pending)로 넘긴다.
  // self_apply 여부는 다이얼로그가 판단해 즉시 적용/승인 요청 문구를 가른다 (Track C Task 4).
  async function planChange(body: SlotChangeIn) {
    setSubmitting(true);
    setError(null);
    try {
      const preview = await postSlotChange(mapId, { ...body, dry_run: true });
      setPending({ body, preview });
    } catch (err) {
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
    // 접힘 애니메이션 중(고스트) — open은 이미 false, 콘텐츠만 accordion-close 재생 동안 남긴다.
    const isClosing = closingKeys.has(node.id);
    const showContent = open || isClosing;
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
          ) : (
            <ChevronRight
              size={14}
              strokeWidth={1.5}
              className={`shrink-0 motion-safe:transition-transform motion-safe:duration-150 ease-smooth ${open ? "rotate-90" : ""}`}
            />
          )}
          <span className="min-w-0 truncate">{node.name}</span>
          {selected && <Check size={14} strokeWidth={2} className="ml-auto shrink-0" />}
        </button>
        {showContent && (
          // 로딩 문구는 애니메이션 래퍼 밖 — 콘텐츠(children ul) 도착 후에만 마운트해 빈 박스 위에서
          // accordion-open이 헛도는 것을 막는다 (F1, framework-tree.tsx와 동일 패턴).
          loadingIds.has(node.id) ? (
            <p style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }} className="py-0.5 text-fine text-ink-tertiary">
              {t("common.loading")}
            </p>
          ) : (
            children.length > 0 && (
              <div className={getSectionClass(node.id)}>
                <ul className="flex flex-col">{children.map((c) => renderNode(c, depth + 1))}</ul>
              </div>
            )
          )
        )}
      </li>
    );
  };

  // 이양 대상은 슬롯 없는 일반 맵만 — 이미 슬롯(카테고리/컨설턴트 코드) 가진 맵·framework/word 맵·자기 자신 제외.
  // owner가 아닌 맵은 제외 — 이양 대상은 호출자가 owner도 겸해야 한다(서버 assert_map_role 미러, F6).
  const mapOptions = (transferMaps ?? [])
    .filter(
      (m) =>
        m.id !== mapId &&
        m.my_role === "owner" &&
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

        {pendingReq && (
          <div data-id="slot-pending-banner" className="flex items-start gap-2.5 rounded-sm border border-changed/40 bg-changed/10 px-3 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-changed/20 text-changed">
              <Clock size={14} strokeWidth={1.5} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-fine font-semibold text-changed">
                  {t("slot.pendingBannerLead", {
                    action: isSlotAction(pendingReq.request.payload.action)
                      ? t(SLOT_ACTION_KEY[pendingReq.request.payload.action])
                      : "",
                  })}
                </span>
                <span className="rounded-full bg-changed/20 px-1.5 py-0.5 text-fine font-semibold text-changed">
                  {t("slot.pendingBannerProgress", {
                    done: String(pendingReq.sides.length - pendingReq.remaining.length),
                    total: String(pendingReq.sides.length),
                  })}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-fine text-ink-tertiary">
                <span>{t("slot.pendingBannerBy")}</span>
                <UserPill loginId={pendingReq.request.requested_by} />
                {/* 오너가 바뀐 뒤 열면 "내 요청이 아님"을 드러낸다 — 철회권은 서버 can_withdraw가 정한다 */}
                {currentUser !== null && pendingReq.request.requested_by !== currentUser && (
                  <span
                    data-id="slot-pending-other"
                    className="rounded-full border border-hairline px-1.5 py-0.5 text-fine text-ink-secondary"
                  >
                    {t("slot.pendingBannerOther")}
                  </span>
                )}
              </div>
              {pendingReq.can_withdraw && (
                <button
                  type="button"
                  data-id="slot-withdraw-btn"
                  disabled={withdrawing}
                  className="inline-flex w-fit items-center gap-1 text-caption text-accent hover:underline disabled:opacity-40"
                  onClick={() => {
                    if (withdrawing) return;
                    setWithdrawing(true);
                    void withdrawSlotChange(mapId)
                      .then(() => setPendingReq(null))
                      .catch((err: unknown) => setError(getApiErrorDetail(err)))
                      .finally(() => setWithdrawing(false));
                  }}
                >
                  <Undo2 size={12} strokeWidth={1.5} />
                  {t("slot.withdraw")}
                </button>
              )}
            </div>
          </div>
        )}

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
            disabled={selectedId === null || submitting || pendingLocked}
            className="flex-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={requestAssign}
          >
            {t("home.frameworkAssign")}
          </button>
          {currentCategoryId != null && (
            <button
              type="button"
              data-id="framework-unassign-btn"
              disabled={submitting || pendingLocked}
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
                  disabled={!transferTargetId || submitting || pendingLocked}
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
          <SlotChangeDialog
            mapId={mapId}
            body={pending.body}
            preview={pending.preview}
            onDone={(out) => {
              setPending(null);
              onChanged();
              onClose();
              onToast?.(out.mode === "requested" ? t("slot.requestedToast") : t("slot.appliedToast"));
            }}
            onClose={() => setPending(null)}
          />
        )}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
