"use client";

// 인스펙터 서브프로세스 카드 — 지정 상태 표시 + 지정/수정/해제.
// 지정은 다른 맵이 이 맵을 서브프로세스 노드로 연결(임베드)하기 위한 절차 — 노트로 안내.
// 변경은 게시된 버전이 열린 상태에서 오너·관리자만 가능(비활성 시 사유 노트 표시).

import { ArrowRight, ArrowUpRight, BadgeCheck, Boxes, ChevronRight, Info, Network, Workflow } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ApiError,
  createSpDesignationRequest,
  deleteSubprocessDesignation,
  getMap,
  getPendingSpDesignationRequest,
  type ApprovalRequest,
  type MapDetail,
  type SubprocessUsage,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  SubprocessDesignationModal,
  type DesignationForm,
} from "@/components/permissions/subprocess-designation-modal";
import { Tooltip } from "@/components/tooltip";
import { formatKstShort } from "@/lib/datetime";
import { formatDurationHm, formatThousands } from "@/lib/duration";
import { useI18n } from "@/lib/i18n";

// 카드 접힘 — 기본 접힘, 세션 동안 유지(sessionStorage) + 탭 간(에디터 노드/맵/승인탭 3마운트) 공유.
const SP_OPEN_KEY = "bpm.inspector.spOpen";

interface SubprocessInspectorCardProps {
  mapId: number;
  canManage: boolean; // 게시 버전 열림 && (오너 || sysadmin)
  disabledReason: string | null; // canManage=false일 때 비활성 사유(i18n 처리된 문자열, 표시용)
  // disabledReason의 구분값 — 문자열 비교 대신 이걸로 분기(R10)
  disabledReasonKind?: "needPublished" | "ownerOnly" | null;
  onToast?: (message: string, tone?: "error") => void;
  // 지정/해제 성공 후 — page.tsx가 usage를 재조회해 Subprocess 탭 노출을 동기화
  onDesignationChange?: () => void;
  // needPublished 사유일 때 "게시본 가기" 버튼 — page.tsx의 switchVersion 위임(R10)
  onGoToPublished?: (versionId: number) => void;
  // 역참조(Linked from) — page.tsx의 spUsage 공유(카드별 재조회 방지). 지정된 맵에서만 섹션 노출.
  usage?: SubprocessUsage | null;
}

export function SubprocessInspectorCard({
  mapId,
  canManage,
  disabledReason,
  disabledReasonKind,
  onToast,
  onDesignationChange,
  onGoToPublished,
  usage,
}: SubprocessInspectorCardProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalInitial, setModalInitial] = useState<DesignationForm>({
    department: "",
    assignee: "",
    system: "",
    duration: "",
    touch_time: "",
    cost_krw: "",
    cost_usd: "",
    headcount: "",
    annual_count: "",
    fte: "",
    total_time_fallback: "",
    touch_time_fallback: "",
    system_fallback: "",
    frequency_fallback: "",
    url: "",
    urlLabel: "",
    input: "",
    input_forms: "",
    input_ids: "",
    output: "",
    output_forms: "",
    output_ids: "",
    description: "",
  });
  const [showUndesignate, setShowUndesignate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  // 등록 요청(kind==="ownerOnly" && 미지정) 전용 — pending 조회 결과·발송 상태(R10)
  const [spPending, setSpPending] = useState<ApprovalRequest | null>(null);
  const [spRequestBusy, setSpRequestBusy] = useState(false);
  const [spRequestError, setSpRequestError] = useState<string | null>(null);
  useEffect(() => {
    const stored = window.sessionStorage.getItem(SP_OPEN_KEY);
    if (stored !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(stored === "1"); // one-time hydration restore from sessionStorage
    }
  }, []);
  // Linked from 하위 아코디언 — 기본 접힘·영속 없음(매번 눌러서 연다, 사용자 결정 2026-08-27)
  const [linkedOpen, setLinkedOpen] = useState(false);
  const toggleOpen = () => {
    const next = !open;
    window.sessionStorage.setItem(SP_OPEN_KEY, next ? "1" : "0");
    setOpen(next);
    if (!next) setLinkedOpen(false); // 카드를 접으면 하위 섹션도 초기화
  };

  useEffect(() => {
    let active = true;
    void getMap(mapId)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch(() => {
        // 조회 실패 시 카드만 비표시(인스펙터 다른 섹션에 영향 없음)
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  // designated는 훅 의존값이라 조기 return보다 앞에 계산(detail 로드 전엔 false 취급)
  const designated = detail !== null && detail.sp_designated_at != null;

  // 미지정+ownerOnly일 때만 등록 요청 pending 조회 — 그 외 분기는 요청 버튼 자체가 안 보이므로 생략
  useEffect(() => {
    if (disabledReasonKind !== "ownerOnly" || designated) return;
    let active = true;
    void getPendingSpDesignationRequest(mapId)
      .then((req) => {
        if (active) setSpPending(req);
      })
      .catch(() => {
        // 조회 실패 — 버튼만 노출, 클릭 시 서버가 재검증
      });
    return () => {
      active = false;
    };
  }, [mapId, disabledReasonKind, designated]);

  const handleRequestRegistration = async () => {
    setSpRequestBusy(true);
    setSpRequestError(null);
    try {
      // 발원=자기 맵(from_map_id=mapId) — 카드가 보고 있는 맵 자신의 지정을 오너에게 요청
      const created = await createSpDesignationRequest(mapId, mapId);
      setSpPending(created);
      onToast?.(t("library.requestSent"));
    } catch (err) {
      setSpRequestError(humanizeApiError(err, t));
      if (err instanceof ApiError && err.status === 409) {
        // 이미 대기 중인 요청 — 최신 상태로 갱신해 pending 뷰로 전환
        try {
          setSpPending(await getPendingSpDesignationRequest(mapId));
        } catch {
          // 재조회 실패 — 에러 문구만 유지
        }
      }
    } finally {
      setSpRequestBusy(false);
    }
  };

  if (!detail) return null;

  const publishedVersionId = detail.versions
    .filter((version) => version.status === "published")
    .reduce<number | null>((max, version) => (max === null || version.id > max ? version.id : max), null);

  const openModal = () => {
    setModalInitial({
      department: detail.sp_department ?? "",
      assignee: detail.sp_assignee ?? "",
      system: detail.sp_system ?? "",
      duration: detail.sp_duration ?? "",
      touch_time: detail.sp_touch_time ?? "",
      cost_krw: detail.sp_cost_krw ?? "",
      cost_usd: detail.sp_cost_usd ?? "",
      headcount: detail.sp_headcount ?? "",
      annual_count: detail.sp_annual_count ?? "",
      fte: detail.sp_fte ?? "",
      total_time_fallback: detail.sp_total_time_fallback ?? "",
      touch_time_fallback: detail.sp_touch_time_fallback ?? "",
      system_fallback: detail.sp_system_fallback ?? "",
      frequency_fallback: detail.sp_frequency_fallback ?? "",
      url: detail.sp_url ?? "",
      urlLabel: detail.sp_url_label ?? "",
      input: detail.sp_input ?? "",
      input_forms: detail.sp_input_forms ?? "",
      input_ids: detail.sp_input_ids ?? "",
      output: detail.sp_output ?? "",
      output_forms: detail.sp_output_forms ?? "",
      output_ids: detail.sp_output_ids ?? "",
      description: detail.description ?? "",
    });
    setShowModal(true);
  };

  const handleUndesignate = async () => {
    setSaving(true);
    try {
      const updated = await deleteSubprocessDesignation(mapId);
      setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      onToast?.(t("perm.sp.removed"));
      onDesignationChange?.();
    } catch (err) {
      onToast?.(humanizeApiError(err, t), "error");
    } finally {
      setSaving(false);
      setShowUndesignate(false);
    }
  };

  // 캔버스 노드 칩과 동일 표시형(₩/$ + 천단위 콤마) — process-node.tsx 컨벤션과 정합
  const formatCost = (raw: string | null | undefined, symbol: string): string => {
    const n = formatThousands(raw ?? "");
    return n ? `${symbol}${n}` : "";
  };

  const attrRows: { label: string; value: string | null | undefined }[] = [
    { label: t("field.department"), value: detail.sp_department },
    { label: t("field.assignee"), value: detail.sp_assignee },
    { label: t("field.system"), value: detail.sp_system },
    { label: t("field.duration"), value: formatDurationHm(detail.sp_duration ?? "") },
    { label: t("field.costKrw"), value: formatCost(detail.sp_cost_krw, "₩") },
    { label: t("field.costUsd"), value: formatCost(detail.sp_cost_usd, "$") },
    { label: t("field.headcount"), value: detail.sp_headcount },
    { label: t("field.annualCount"), value: detail.sp_annual_count },
    { label: t("field.fte"), value: detail.sp_fte },
    ...(detail.sp_input ? [{ label: t("sp.input"), value: detail.sp_input }] : []),
    ...(detail.sp_output ? [{ label: t("sp.output"), value: detail.sp_output }] : []),
    ...(detail.description ? [{ label: t("field.description"), value: detail.description }] : []),
  ];

  return (
    <section data-id="sp-inspector-card" className="rounded-md border border-hairline bg-surface-alt/50 p-3">
      <button
        type="button"
        data-id="sp-inspector-toggle"
        data-acc-toggle
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={toggleOpen}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-fine font-semibold text-ink-tertiary">
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          />
          <Workflow size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
          <span className="truncate">{t("inspector.spTitle")}</span>
          {/* 연결 절차 안내 — 호버 툴팁(제목 옆) */}
          <span onClick={(e) => e.stopPropagation()}>
            {/* 안내 툴팁 — 문장 대신 아이콘+키워드 행, 보완 설명은 회색 보조 텍스트 (사용자 결정 2026-08-20) */}
            <Tooltip
              content={
                <span className="flex flex-col gap-1.5 py-0.5">
                  <span className="flex items-center gap-1.5">
                    <Network size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
                    <span className="text-caption-strong text-ink">{t("inspector.spNoteKwLibrary")}</span>
                    <span className="text-fine text-ink-tertiary">{t("inspector.spNoteKwLibrarySub")}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Boxes size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
                    <span className="text-caption-strong text-ink">{t("inspector.spNoteKwEmbed")}</span>
                    <span className="text-fine text-ink-tertiary">{t("inspector.spNoteKwEmbedSub")}</span>
                  </span>
                  <span className="border-t border-divider pt-1 text-fine text-ink-tertiary">
                    {t("inspector.spNoteHint")}
                  </span>
                </span>
              }
            >
              <Info
                size={14}
                strokeWidth={1.5}
                className="shrink-0 text-ink-tertiary transition-colors hover:text-accent"
              />
            </Tooltip>
          </span>
        </span>
        {/* 지정 상태 뱃지 — 영어 고정(승인상태 뱃지 규칙과 동일). 접힘 상태에서도 항상 보임(헤더는 항상 렌더) */}
        {designated ? (
          <span className="shrink-0 rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent">
            Designated
          </span>
        ) : (
          <span className="shrink-0 rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-tertiary">
            Not designated
          </span>
        )}
      </button>

      {open && (
        <>
          {designated && (
            <div className="mt-2 flex flex-col">
              {attrRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="shrink-0 text-fine text-ink-secondary">{row.label}</span>
                  <span className="min-w-0 truncate text-fine text-ink">{row.value || "-"}</span>
                </div>
              ))}
            </div>
          )}

          {/* 액션 행 — 좌측 지정/수정+해제, 우측(ml-auto) 사유별 액션(R10에서 이동, R6 W4). 버튼이 항상 있어 행 자체가 앵커.
              라벨은 한 줄 고정(nowrap) — 폭이 모자라면 마지막 버튼이 다음 줄로 내려간다(flex-wrap, 사용자 요청 2026-09-03). */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {designated ? (
              <>
                <button
                  type="button"
                  data-id="sp-inspector-edit"
                  className="whitespace-nowrap rounded-sm bg-accent px-2.5 py-1 text-fine text-on-accent hover:bg-accent-focus disabled:opacity-40"
                  onClick={openModal}
                  disabled={!canManage || saving}
                >
                  {t("perm.sp.edit")}
                </button>
                <button
                  type="button"
                  data-id="sp-inspector-remove"
                  className="whitespace-nowrap rounded-sm border border-error/40 px-2.5 py-1 text-fine text-error hover:bg-error/10 disabled:opacity-40"
                  onClick={() => setShowUndesignate(true)}
                  disabled={!canManage || saving}
                >
                  {t("perm.sp.undesignate")}
                </button>
              </>
            ) : (
              <button
                type="button"
                data-id="sp-inspector-designate"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm bg-accent px-2.5 py-1 text-fine text-on-accent hover:bg-accent-focus disabled:opacity-40"
                onClick={openModal}
                disabled={!canManage || saving}
              >
                <Workflow size={14} strokeWidth={1.5} />
                {t("perm.sp.designate")}
              </button>
            )}

            {!canManage && disabledReason && (
              <>
                {disabledReasonKind === "needPublished" && publishedVersionId !== null && onGoToPublished && (
                  <button
                    type="button"
                    data-id="sp-go-published"
                    className="ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt"
                    onClick={() => onGoToPublished(publishedVersionId)}
                  >
                    <ArrowRight size={14} strokeWidth={1.5} />
                    {t("inbox.sp.goPublished")}
                  </button>
                )}

                {disabledReasonKind === "ownerOnly" &&
                  !designated &&
                  (spPending ? (
                    <Tooltip
                      content={`${spPending.requested_by} · ${formatKstShort(spPending.created_at)}`}
                      className="ml-auto"
                    >
                      <span className="inline-flex">
                        <button
                          type="button"
                          data-id="sp-request-registration"
                          className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt disabled:opacity-40"
                          disabled
                        >
                          <BadgeCheck size={14} strokeWidth={1.5} />
                          {t("sp.request.pendingLabel")}
                        </button>
                      </span>
                    </Tooltip>
                  ) : (
                    <button
                      type="button"
                      data-id="sp-request-registration"
                      className="ml-auto inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt disabled:opacity-40"
                      onClick={() => void handleRequestRegistration()}
                      disabled={spRequestBusy}
                    >
                      <BadgeCheck size={14} strokeWidth={1.5} />
                      {t("sp.request.ctaSelf")}
                    </button>
                  ))}
              </>
            )}
          </div>

          {/* 비활성 사유 — 순수 노트(버튼은 위 액션 행으로 이동, R6 W4) */}
          {!canManage && disabledReason && (
            <p data-id="sp-inspector-reason" className="mt-1.5 text-fine text-ink-tertiary">
              {disabledReason}
            </p>
          )}
          {spRequestError && (
            <p data-id="sp-request-error" className="mt-1 text-fine text-error">
              {spRequestError}
            </p>
          )}

          {/* Linked from — 역참조 목록(Subprocess 탭과 동일 행 디자인). 지정된 맵에서만. */}
          {designated && usage?.designated && (
            <div className="mt-2 border-t border-divider pt-2">
              <button
                type="button"
                data-id="sp-linked-from-toggle"
                data-acc-toggle
                aria-expanded={linkedOpen}
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => setLinkedOpen((v) => !v)}
              >
                <span className="flex items-center gap-1.5 text-fine font-semibold text-ink-tertiary">
                  <ChevronRight
                    size={12}
                    strokeWidth={1.5}
                    className={`shrink-0 transition-transform duration-150 ${linkedOpen ? "rotate-90" : ""}`}
                  />
                  {t("inspector.spUsageLinkedFrom")}
                </span>
                <span className="shrink-0 text-fine text-ink-tertiary">{usage.used_by.length}</span>
              </button>
              {linkedOpen && (
                <div className="mt-1.5">
                  {usage.used_by.length === 0 ? (
                    <p className="rounded-sm border border-hairline bg-surface px-2.5 py-2 text-fine text-ink-tertiary">
                      {t("inspector.spUsageEmpty")}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {usage.used_by.map((entry) => (
                        <li key={entry.map_id}>
                          <Link
                            href={`/maps/${entry.map_id}`}
                            data-id="sp-card-linked-row"
                            className="group flex items-center gap-2 rounded-sm border border-hairline bg-surface px-2.5 py-1.5 transition-colors hover:bg-surface-alt"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-caption text-ink">{entry.name}</span>
                              {entry.owning_department && (
                                <span
                                  title={entry.owning_department}
                                  className="block truncate text-fine text-ink-tertiary"
                                >
                                  {entry.owning_department}
                                </span>
                              )}
                            </span>
                            {entry.node_count > 1 && (
                              <span
                                title={t("inspector.spUsageLinkCount", { n: entry.node_count })}
                                className="shrink-0 rounded-xs bg-accent-tint px-1.5 py-0.5 text-fine text-accent"
                              >
                                ×{entry.node_count}
                              </span>
                            )}
                            <ArrowUpRight
                              size={14}
                              strokeWidth={1.5}
                              className="shrink-0 text-ink-tertiary transition-colors group-hover:text-accent"
                            />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {usage.hidden_count > 0 && (
                    <p className="mt-1.5 text-fine text-ink-tertiary">
                      {t("inspector.spUsageHidden", { n: usage.hidden_count })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showModal && (
        <SubprocessDesignationModal
          mapId={mapId}
          designated={designated}
          publishedVersionId={publishedVersionId}
          initial={modalInitial}
          onSaved={(updated) => {
            setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
            onToast?.(t("perm.sp.saved"));
            onDesignationChange?.();
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}

      {showUndesignate && (
        <ConfirmDialog
          title={t("perm.sp.undesignateTitle")}
          message={t("perm.sp.undesignateWarn")}
          confirmLabel={t("perm.sp.undesignate")}
          cancelLabel={t("perm.sp.cancel")}
          danger
          icon={<Workflow size={28} strokeWidth={1.5} />}
          onConfirm={() => void handleUndesignate()}
          onClose={() => setShowUndesignate(false)}
        />
      )}
    </section>
  );
}
