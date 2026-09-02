"use client";

// 연계 캔버스 확정 섹션 — 일반 맵의 ApprovalPanel 자리를 대체 (2026-08-28 개선판).
// 마이너 확정은 최신 스냅샷 대비 레이아웃 외 변경이 있을 때만(버튼 비활성 + 서버 409 미러),
// 버튼 아래에 변경 요약(비교 diff 재활용: computeVersionDiff + 엣지 시그니처)을 노출한다.
// 메이저 승급은 가시성 있는 토글 행 + 확인 모달(직전 라인 중간 마이너 영구삭제 안내) 경유.
import { Archive, BadgeCheck, Check, Crosshair, Info, Trash2, TriangleAlert, Undo2, Workflow, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  confirmFrameworkVersion,
  createFwConfirmRequest,
  getConfirmReadiness,
  getPendingFwConfirmRequest,
  withdrawFwConfirmRequest,
  type ApprovalRequest,
  type ConfirmReadiness,
  type FrameworkConfirmResult,
  type VersionSummary,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { type AppNode } from "@/lib/canvas";
import { buildGateChecklist } from "@/lib/framework-gates";
import { useI18n } from "@/lib/i18n";
import {
  ChangeSummaryDisclosure,
  useChangeSummary,
  type LiveEdgeShape,
} from "@/components/change-summary-section";
import { ConfirmDialog } from "@/components/confirm-dialog";

export interface FrameworkConfirmSectionProps {
  mapId: number;
  canConfirm: boolean; // 직속 L5 관리자 또는 sysadmin — 스스로 확정 가능 (Track B Task 6, 의미 변경)
  canRequest: boolean; // 체인 상위 관리자(editor 파생) — 확정 위임 요청만 가능
  currentUser: string | null; // 요청자 본인 판정(Withdraw 버튼 노출) — page.tsx username 소스
  versions: VersionSummary[]; // 스냅샷 라벨(vX.Y) 파싱 소스 — VersionDetail도 호환
  liveNodes: AppNode[];
  liveEdges: LiveEdgeShape[];
  onConfirmed: (result: FrameworkConfirmResult) => void; // 부모가 versions 갱신·토스트
  onError: (message: string) => void;
  onFocusNode?: (nodeId: string) => void; // 게이트 위반 노드로 이동(캔버스 아웃라인 유틸 재사용)
}

interface FwSnapshot {
  id: number;
  label: string;
  major: number;
  minor: number;
}

// versions에서 확정 스냅샷(vX.Y confirmed)만 파싱 — 서버 fw_major/minor를 라벨로 복원
function parseSnapshots(versions: VersionSummary[]): FwSnapshot[] {
  const out: FwSnapshot[] = [];
  for (const v of versions) {
    if (v.status !== "confirmed") continue;
    const m = /^v(\d+)\.(\d+)$/.exec(v.label);
    if (!m) continue;
    out.push({ id: v.id, label: v.label, major: Number(m[1]), minor: Number(m[2]) });
  }
  return out.sort((a, b) => a.major - b.major || a.minor - b.minor);
}

// 메이저 승급 영향 요약 — 유지/영구삭제 버전을 아이콘+필 행으로. 토글(compact)·모달 배너 공용 (2026-08-29)
function MajorImpactRows({
  keep, pruned, compact = false,
}: {
  keep: string[];
  pruned: string[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  const iconSize = compact ? 12 : 14;
  const pill = compact ? "px-1 text-[11px]" : "px-1.5 text-fine";
  const label = compact ? "text-[11px]" : "text-fine";
  return (
    <span data-id="framework-major-impact" className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <Archive size={iconSize} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        <span className={`${label} text-ink-secondary`}>{t("framework.majorModalKeep")}</span>
        {keep.map((entry) => (
          <span
            key={entry}
            className={`rounded-full border border-added/40 bg-added/10 font-semibold text-added ${pill}`}
          >
            {entry}
          </span>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Trash2
          size={iconSize}
          strokeWidth={1.5}
          className={`shrink-0 ${pruned.length > 0 ? "text-error" : "text-ink-tertiary"}`}
        />
        <span className={`${label} text-ink-secondary`}>{t("framework.majorModalDelete")}</span>
        {pruned.length > 0 ? (
          pruned.map((entry) => (
            <span
              key={entry}
              className={`rounded-full border border-error/40 bg-error/10 font-semibold text-error line-through ${pill}`}
            >
              {entry}
            </span>
          ))
        ) : (
          <span className={`rounded-full border border-hairline bg-surface text-ink-tertiary ${pill}`}>
            {t("framework.majorModalNone")}
          </span>
        )}
      </span>
    </span>
  );
}

export function FrameworkConfirmSection({
  mapId, canConfirm, canRequest, currentUser, versions, liveNodes, liveEdges, onConfirmed, onError, onFocusNode,
}: FrameworkConfirmSectionProps) {
  const { t } = useI18n();
  const [major, setMajor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [majorModalOpen, setMajorModalOpen] = useState(false);

  // 확정 게이트 체크리스트 — 마운트+확정 성공 시 즉시 1회, 이후 라이브 그래프 변경은 디바운스(과도 폴링 금지)
  const [readiness, setReadiness] = useState<ConfirmReadiness | null>(null);
  const [readinessRefreshKey, setReadinessRefreshKey] = useState(0);
  useEffect(() => {
    if (!canConfirm) return;
    let active = true;
    void getConfirmReadiness(mapId)
      .then((r) => { if (active) setReadiness(r); })
      .catch(() => { if (active) setReadiness(null); });
    return () => { active = false; };
  }, [canConfirm, mapId, readinessRefreshKey]);
  // 이 effect의 첫 발화(마운트 시점)는 위 즉시조회 effect와 중복이라 ref로 스킵 —
  // 이후 liveNodes/liveEdges가 실제로 바뀔 때만 디바운스 재조회한다.
  const readinessDebounceSkipRef = useRef(true);
  useEffect(() => {
    if (!canConfirm) return;
    if (readinessDebounceSkipRef.current) {
      readinessDebounceSkipRef.current = false;
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void getConfirmReadiness(mapId)
        .then((r) => { if (active) setReadiness(r); })
        .catch(() => { if (active) setReadiness(null); });
    }, 800);
    return () => { active = false; clearTimeout(timer); };
  }, [canConfirm, mapId, liveNodes, liveEdges]);
  const gateChecklist = useMemo(() => buildGateChecklist(readiness), [readiness]);

  // 확정 위임 요청 — canConfirm=false && canRequest=true 인 체인 상위 관리자용 CTA
  const [pendingRequest, setPendingRequest] = useState<ApprovalRequest | null>(null);
  const [requestNote, setRequestNote] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  useEffect(() => {
    if (canConfirm || !canRequest) return;
    let active = true;
    void getPendingFwConfirmRequest(mapId).then((req) => { if (active) setPendingRequest(req); });
    return () => { active = false; };
  }, [mapId, canConfirm, canRequest]);

  function submitRequest() {
    setRequestBusy(true);
    createFwConfirmRequest(mapId, requestNote.trim())
      .then((req) => {
        setPendingRequest(req);
        setRequestNote("");
      })
      .catch((err) => onError(humanizeApiError(err, t)))
      .finally(() => setRequestBusy(false));
  }

  // 철회 성공 시 pending 재조회로 CTA(입력폼)에 복귀 — 로컬 null 대입 대신 서버를 다시 신뢰
  function withdrawRequest() {
    setWithdrawBusy(true);
    withdrawFwConfirmRequest(mapId)
      .then(() => getPendingFwConfirmRequest(mapId))
      .then((req) => setPendingRequest(req))
      .catch((err) => onError(humanizeApiError(err, t)))
      .finally(() => setWithdrawBusy(false));
  }

  const snapshots = useMemo(() => parseSnapshots(versions), [versions]);
  const latest = snapshots.at(-1) ?? null;
  // 메이저 승급 시 영구삭제될 직전 라인 중간 마이너 — 안내 모달·프룬 미리보기
  const pruneTargets = useMemo(() => {
    if (latest === null) return [];
    return snapshots
      .filter((s) => s.major === latest.major && s.minor > 0 && s.minor < latest.minor)
      .map((s) => s.label);
  }, [snapshots, latest]);
  // 승급 시 유지되는 직전 라인 — X.0과 최종본(같으면 1개)
  const keepLabels =
    latest === null ? [] : [`v${latest.major}.0`, ...(latest.minor > 0 ? [latest.label] : [])];

  // 변경 요약 — 최신 스냅샷 기준, 공유 훅(비교 diff 재활용) (2026-08-30 #3 추출)
  const summary = useChangeSummary(latest?.id ?? null, liveNodes, liveEdges);

  const hasChanges =
    latest === null || // 최초 확정 — 비교 기준 없음(항상 확정 가능)
    summary === null || // 기준 로딩 실패 시 낙관 활성 — 최종 판정은 서버 409
    summary.total > 0;

  function runConfirm(promoteMajor: boolean) {
    setBusy(true);
    confirmFrameworkVersion(mapId, promoteMajor)
      .then((result) => {
        setMajor(false);
        setReadinessRefreshKey((k) => k + 1); // 확정 성공 — 게이트 체크리스트 재조회
        onConfirmed(result);
      })
      .catch((err) => onError(humanizeApiError(err, t)))
      .finally(() => setBusy(false));
  }

  const nextMajorLabel = `v${(latest?.major ?? 0) + 1}.0`;

  return (
    <div data-id="framework-confirm-section" className="flex flex-col gap-2 p-3">
      {/* 최신 확정 캡션 — 라벨은 초록 필, 이력 없음은 muted 필 (2026-08-29 시인성) */}
      <div data-id="framework-latest-caption" className="flex flex-wrap items-center gap-1.5">
        <Workflow size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        <span className="text-caption text-ink-secondary">{t("framework.latestLabel")}</span>
        {latest !== null ? (
          <span className="rounded-full border border-added/40 bg-added/10 px-1.5 text-fine font-semibold text-added">
            {latest.label}
          </span>
        ) : (
          <span className="rounded-full border border-hairline bg-surface-alt px-1.5 text-fine text-ink-tertiary">
            {t("framework.notConfirmedShort")}
          </span>
        )}
      </div>
      {canConfirm && (
        <>
          {/* 메이저 승급 토글 — 체크박스보다 가시성 있는 설명 행 (2026-08-28 개선) */}
          <label
            data-id="framework-confirm-major"
            className={`flex cursor-pointer items-start gap-2 rounded-sm border px-2 py-1.5 transition-colors duration-150 ${
              major ? "border-accent-tint-border bg-accent-tint" : "border-hairline hover:bg-surface-alt"
            }`}
          >
            {/* 커스텀 체크 — 네이티브 대신 앱 공통 언어(rounded-sm·hairline→accent·Check 아이콘) (2026-08-29) */}
            <span className="relative mt-0.5 h-4 w-4 shrink-0">
              <input
                type="checkbox"
                checked={major}
                onChange={() => setMajor((value) => !value)}
                className="peer absolute inset-0 h-4 w-4 cursor-pointer appearance-none rounded-sm border border-hairline bg-surface transition-colors duration-150 checked:border-accent checked:bg-accent hover:border-accent"
              />
              <Check
                size={12}
                strokeWidth={2.5}
                className="pointer-events-none absolute left-0.5 top-0.5 text-on-accent opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
              />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={`text-caption-strong ${major ? "text-accent" : "text-ink"}`}>
                  {t("framework.majorVersion")}
                </span>
                {/* 승급 목표 버전 필 — 체크 시에도 대비 유지되게 bg-surface (2026-08-29 시인성) */}
                <span className="rounded-full border border-accent-tint-border bg-surface px-1.5 text-fine font-semibold text-accent">
                  {nextMajorLabel}
                </span>
              </span>
              {/* 영향 요약은 체크 시에만 아코디언 리빌 — 체크 행위가 읽기를 유도 (사용자 피드백 2026-08-29).
                  grid-rows 0fr→1fr 하우스 패턴, span에 display:grid 적용(라벨 내부 유효 마크업 유지). */}
              <span
                className={`grid transition-all duration-350 ease-smooth ${
                  major ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <span className="min-w-0 overflow-hidden">
                  <span className="block pt-0.5">
                    {latest !== null ? (
                      <MajorImpactRows compact keep={keepLabels} pruned={pruneTargets} />
                    ) : (
                      <span className="text-fine text-ink-tertiary">
                        {t("framework.majorDescFirst", { label: nextMajorLabel })}
                      </span>
                    )}
                  </span>
                </span>
              </span>
            </span>
          </label>

          {/* 확정 게이트 체크리스트 — 6종 고정, 위반 행은 사유+개수+위반 노드 이동 (Track B Task 6) */}
          <div data-id="framework-gate-checklist" className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface-alt/40 p-1.5">
            <span className="text-fine font-semibold text-ink-secondary">{t("framework.gate.title")}</span>
            <ul className="flex flex-col gap-0.5">
              {gateChecklist.map((row) => (
                <li key={row.code} className="flex items-center gap-1.5 text-fine">
                  {row.passed ? (
                    <Check size={12} strokeWidth={2} className="shrink-0 text-ink-tertiary" />
                  ) : (
                    <X size={12} strokeWidth={2} className="shrink-0 text-error" />
                  )}
                  <span className={row.passed ? "text-ink-tertiary" : "text-error"}>
                    {t(`framework.gate.${row.code}` as const)}
                    {!row.passed && ` (${row.count})`}
                  </span>
                  {!row.passed && row.nodeIds.length > 0 && onFocusNode && (
                    <button
                      type="button"
                      data-id={`framework-gate-locate-${row.code}`}
                      onClick={() => onFocusNode(row.nodeIds[0])}
                      className="ml-auto flex shrink-0 items-center gap-1 text-fine text-accent hover:underline"
                    >
                      <Crosshair size={12} strokeWidth={1.5} />
                      {t("framework.gate.locate")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            data-id="framework-confirm-button"
            // readiness===null(로딩 전/실패)도 !readiness?.ready로 잠금 — 첫 게이트 조회가 끝나기 전엔
            // 확정을 허용하지 않는다(낙관 통과로 바꾸지 말 것).
            disabled={busy || (!major && !hasChanges) || !readiness?.ready}
            className="flex items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-50"
            onClick={() => {
              if (major) setMajorModalOpen(true);
              else runConfirm(false);
            }}
          >
            <BadgeCheck size={16} strokeWidth={1.5} />
            {t("framework.confirmChanges")}
          </button>
          {!major && !hasChanges && (
            <p data-id="framework-no-changes" className="flex flex-wrap items-center gap-1.5 text-fine text-ink-tertiary">
              <Info size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="rounded-full border border-hairline bg-surface-alt px-1.5 font-semibold text-ink-secondary">
                {latest?.label ?? ""}
              </span>
              <span>{t("framework.noChangesAfter")}</span>
            </p>
          )}
        </>
      )}

      {/* 확정 위임 요청 CTA — 체인 상위 관리자(canConfirm=false, canRequest=true)용 (Track B Task 6) */}
      {!canConfirm && canRequest && (
        <div data-id="framework-request-confirm-block" className="flex flex-col gap-1.5">
          {pendingRequest ? (
            <p
              data-id="framework-request-confirm-pending"
              className="flex flex-wrap items-center gap-1.5 rounded-sm border border-hairline bg-surface-alt px-2 py-1.5 text-fine text-ink-secondary"
            >
              <Info size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              {t("framework.requestedBy", {
                name: String(pendingRequest.payload?.actor_name ?? pendingRequest.requested_by),
              })}
              {currentUser !== null && pendingRequest.requested_by === currentUser && (
                <button
                  type="button"
                  data-id="framework-request-withdraw"
                  className="ml-auto flex items-center gap-1 rounded-sm px-1.5 py-1 text-fine text-ink-secondary hover:bg-surface-alt disabled:opacity-50"
                  onClick={withdrawRequest}
                  disabled={withdrawBusy}
                >
                  <Undo2 size={12} strokeWidth={1.5} />
                  {t("framework.withdrawRequest")}
                </button>
              )}
            </p>
          ) : (
            <>
              <input
                data-id="framework-request-confirm-note"
                className="rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink outline-none focus:border-accent"
                placeholder={t("framework.requestNotePlaceholder")}
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
              />
              <button
                type="button"
                data-id="framework-request-confirm"
                disabled={requestBusy}
                className="flex items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-50"
                onClick={submitRequest}
              >
                <BadgeCheck size={16} strokeWidth={1.5} />
                {t("framework.requestConfirm")}
              </button>
            </>
          )}
        </div>
      )}

      {/* 변경 요약 — 최신 확정본 대비, 접힘 1줄→펼침 상세 (2026-08-30 #3, 공유 컴포넌트) */}
      {latest !== null && summary !== null && summary.total > 0 && (
        <div className="border-t border-divider pt-2">
          <ChangeSummaryDisclosure baseLabel={latest.label} summary={summary} dataIdPrefix="framework" />
        </div>
      )}

      {/* 메이저 승급 안내 모달 — 유지/삭제 버전을 아이콘+필 행으로 시각화(시인성) (2026-08-29 개선) */}
      {majorModalOpen && (
        <ConfirmDialog
          title={t("framework.majorModalTitle", { label: nextMajorLabel })}
          confirmLabel={t("framework.confirmChanges")}
          cancelLabel={t("common.cancel")}
          danger={pruneTargets.length > 0}
          icon={<TriangleAlert size={18} strokeWidth={1.5} />}
          banner={
            latest === null ? undefined : (
              <div data-id="framework-major-banner">
                <MajorImpactRows keep={keepLabels} pruned={pruneTargets} />
              </div>
            )
          }
          lines={
            pruneTargets.length > 0
              ? [
                  {
                    icon: <TriangleAlert size={14} strokeWidth={1.5} />,
                    text: t("framework.majorModalIrreversible"),
                    tone: "error",
                  },
                ]
              : undefined
          }
          onConfirm={() => {
            setMajorModalOpen(false);
            runConfirm(true);
          }}
          onClose={() => setMajorModalOpen(false)}
        />
      )}
    </div>
  );
}
