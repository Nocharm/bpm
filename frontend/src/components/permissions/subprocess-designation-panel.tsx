"use client";

// 서브프로세스 지정 패널 — 오너 전용. 지정/수정 모달(부서 필수) + 해제 확인(사용처 경고·잠금 안내). (spec 2026-07-06)
// 지정 정보는 에디터 인스펙터·홈 상세와 같은 SpFieldTile(readOnly) 4열 그리드 — 빈 필드는 "미입력" 타일로
// 남겨 누락을 감추지 않고, 푸터에 최근 변경자(PersonHoverCard)·시각 (2026-10-01).

import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  BriefcaseBusiness,
  Building2,
  Clock,
  FileText,
  Link2,
  Monitor,
  Pencil,
  Repeat,
  Timer,
  User,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import {
  deleteSubprocessDesignation,
  getDirectory,
  getMap,
  type MapDetail,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  SubprocessDesignationModal,
  type DesignationForm,
} from "@/components/permissions/subprocess-designation-modal";
import { DeptPill } from "@/components/dept-pill";
import { PersonHoverCard } from "@/components/person-hover-card";
import { SpFieldTile } from "@/components/permissions/sp-field-tile";
import { formatKst } from "@/lib/datetime";
import { formatDurationHm, formatThousands } from "@/lib/duration";
import { useI18n } from "@/lib/i18n";
import { formatVersionMarker } from "@/lib/version-name";

interface SubprocessDesignationPanelProps {
  mapId: string;
  onToast: (message: string, tone?: "error") => void;
}

export function SubprocessDesignationPanel({ mapId, onToast }: SubprocessDesignationPanelProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<MapDetail | null>(null);
  // login_id → 표시명 — 최근 변경자 이름 우선 표기(디렉터리 해석, 실패 시 id)
  const [names, setNames] = useState<Record<string, string>>({});
  const [showModal, setShowModal] = useState(false);
  const [modalInitial, setModalInitial] = useState<DesignationForm>({
    department: "",
    assignee: "",
    assignee_role: "",
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
    start_condition: "",
    end_condition: "",
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getMap(Number(mapId))
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((err) => {
        if (active) setError(humanizeApiError(err, t));
      });
    void getDirectory()
      .then((dir) => {
        if (active) {
          setNames(Object.fromEntries(dir.users.map((u) => [u.id, u.name])));
        }
      })
      .catch(() => {
        // 디렉터리 실패 시 login_id 그대로 표시 — 표시용이라 치명적이지 않음
      });
    return () => {
      active = false;
    };
  }, [mapId, t]);

  if (!detail) {
    return error ? (
      <p className="text-caption text-error">{error}</p>
    ) : (
      <p className="text-caption text-ink-tertiary">…</p>
    );
  }

  const designated = detail.sp_designated_at != null;
  // 게시 버전(최대 id) — 지정 가드 + BPM 피커의 후보 스코프
  const publishedVersionId = detail.versions
    .filter((v) => v.status === "published")
    .reduce<number | null>((max, v) => (max === null || v.id > max ? v.id : max), null);
  const hasPublished = publishedVersionId !== null;

  const changedBy = detail.sp_changed_by;
  const changedByName = changedBy ? (names[changedBy] ?? changedBy) : null;

  function openModal() {
    // 재지정/수정 프리필 — 해제돼도 서버가 어트리뷰트를 유지
    setModalInitial({
      department: detail?.sp_department ?? "",
      assignee: detail?.sp_assignee ?? "",
      assignee_role: detail?.sp_assignee_role ?? "",
      system: detail?.sp_system ?? "",
      duration: detail?.sp_duration ?? "",
      touch_time: detail?.sp_touch_time ?? "",
      cost_krw: detail?.sp_cost_krw ?? "",
      cost_usd: detail?.sp_cost_usd ?? "",
      headcount: detail?.sp_headcount ?? "",
      annual_count: detail?.sp_annual_count ?? "",
      fte: detail?.sp_fte ?? "",
      total_time_fallback: detail?.sp_total_time_fallback ?? "",
      touch_time_fallback: detail?.sp_touch_time_fallback ?? "",
      system_fallback: detail?.sp_system_fallback ?? "",
      frequency_fallback: detail?.sp_frequency_fallback ?? "",
      start_condition: detail?.sp_start_condition ?? "",
      end_condition: detail?.sp_end_condition ?? "",
      url: detail?.sp_url ?? "",
      urlLabel: detail?.sp_url_label ?? "",
      input: detail?.sp_input ?? "",
      input_forms: detail?.sp_input_forms ?? "",
      input_ids: detail?.sp_input_ids ?? "",
      output: detail?.sp_output ?? "",
      output_forms: detail?.sp_output_forms ?? "",
      output_ids: detail?.sp_output_ids ?? "",
      description: detail?.description ?? "",
    });
    setError(null);
    setShowModal(true);
  }

  async function handleUndesignate() {
    setSaving(true);
    try {
      const updated = await deleteSubprocessDesignation(Number(mapId));
      setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      onToast(t("perm.sp.removed"));
    } catch (err) {
      onToast(humanizeApiError(err, t), "error");
    } finally {
      setSaving(false);
      setShowUndesignate(false);
    }
  }

  // 캔버스 노드 칩과 동일 표시형(₩/$ + 천단위 콤마) — process-node.tsx 컨벤션과 정합
  const formatCost = (raw: string | null | undefined, symbol: string): string => {
    const n = formatThousands(raw ?? "");
    return n ? `${symbol}${n}` : "";
  };
  const publishedVersion = detail.versions.find((v) => v.id === publishedVersionId) ?? null;
  const empty = t("perm.sp.empty");

  // 타일 명세 — 짧은 값 1칸, 문장·목록은 2칸(wide). 비어도 타일을 남겨 어떤 항목이 빠졌는지 보인다
  interface Tile {
    key: string;
    icon: LucideIcon;
    label: string;
    value: string;
    wide?: boolean;
    valueSize?: "caption" | "fine";
  }
  const costValue = formatCost(detail.sp_cost_krw, "₩") || formatCost(detail.sp_cost_usd, "$");
  const tiles: Tile[] = [
    { key: "role", icon: BriefcaseBusiness, label: t("field.assigneeRole"), value: detail.sp_assignee_role ?? "" },
    { key: "assignee", icon: User, label: t("field.assignee"), value: detail.sp_assignee ?? "" },
    { key: "system", icon: Monitor, label: t("field.system"), value: detail.sp_system ?? "" },
    { key: "duration", icon: Clock, label: t("field.duration"), value: formatDurationHm(detail.sp_duration ?? "") },
    { key: "touch", icon: Timer, label: t("field.touchTime"), value: formatDurationHm(detail.sp_touch_time ?? "") },
    { key: "cost", icon: Banknote, label: t("field.costKrw"), value: costValue },
    { key: "headcount", icon: Users, label: t("field.headcount"), value: detail.sp_headcount ?? "" },
    { key: "annual", icon: Repeat, label: t("field.annualCount"), value: detail.sp_annual_count ?? "" },
    { key: "fte", icon: Users, label: t("field.fte"), value: detail.sp_fte ?? "" },
    { key: "start", icon: ArrowUpFromLine, label: t("field.startCondition"), value: detail.sp_start_condition ?? "", wide: true, valueSize: "fine" },
    { key: "end", icon: ArrowDownToLine, label: t("field.endCondition"), value: detail.sp_end_condition ?? "", wide: true, valueSize: "fine" },
    { key: "input", icon: ArrowDownToLine, label: t("sp.input"), value: detail.sp_input ?? "", wide: true, valueSize: "fine" },
    { key: "output", icon: ArrowUpFromLine, label: t("sp.output"), value: detail.sp_output ?? "", wide: true, valueSize: "fine" },
    { key: "url", icon: Link2, label: t("field.url"), value: detail.sp_url ? (detail.sp_url_label || detail.sp_url) : "", wide: true, valueSize: "fine" },
    { key: "description", icon: FileText, label: t("field.description"), value: detail.description ?? "", wide: true, valueSize: "fine" },
  ];

  return (
    <div data-id="subprocess-designation-panel" className="flex flex-col gap-3">
      <p className="text-caption text-ink-tertiary">{t("perm.sp.hint")}</p>

      {designated ? (
        <div className="overflow-hidden rounded-md border border-hairline">
          {/* 헤더 — Designated + 게시본 기준 + 라이브러리 노출, 우측 액션 */}
          <div className="flex items-center gap-3 border-b border-hairline bg-surface-pearl px-3.5 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-tint text-accent">
              <Workflow size={16} strokeWidth={1.5} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-caption-strong text-ink">Designated</span>
                {publishedVersion && (
                  <span className="rounded-full bg-accent-tint px-2 py-0.5 text-fine text-accent">
                    {t("perm.sp.publishedBasis", { v: formatVersionMarker(publishedVersion, detail.versions) })}
                  </span>
                )}
              </div>
              <div className="text-fine text-ink-tertiary">{t("perm.sp.inLibrary")}</div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                data-id="subprocess-designation-edit"
                className="inline-flex items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-60"
                onClick={openModal}
                disabled={saving}
              >
                <Pencil size={14} strokeWidth={1.5} />
                {t("perm.sp.edit")}
              </button>
              <button
                type="button"
                data-id="subprocess-designation-remove"
                className="rounded-sm border border-error/40 px-2.5 py-1 text-caption text-error hover:bg-error/10 disabled:opacity-60"
                onClick={() => setShowUndesignate(true)}
                disabled={saving}
              >
                {t("perm.sp.undesignate")}
              </button>
            </div>
          </div>

          {/* 타일 그리드 — 부서는 DeptPill(조직 카드), 나머지는 읽기 타일 */}
          <div className="grid grid-cols-4 gap-2 p-3">
            <SpFieldTile
              dataId="sp-tile-department"
              icon={Building2}
              label={t("field.department")}
              value=""
              valueNode={
                detail.sp_department ? (
                  <DeptPill department={detail.sp_department} dataId="sp-tile-department-pill" />
                ) : undefined
              }
              placeholder={empty}
              wide
              readOnly
              labelFixed
            />
            {tiles.map((tile) => (
              <SpFieldTile
                key={tile.key}
                dataId={`sp-tile-${tile.key}`}
                icon={tile.icon}
                label={tile.label}
                value={tile.value}
                valueSize={tile.valueSize}
                placeholder={empty}
                wide={tile.wide}
                readOnly
                labelFixed
              />
            ))}
          </div>

          {/* 푸터 — 최근 변경자(호버 카드)·시각 */}
          {changedBy && (
            <div className="flex items-center gap-1.5 border-t border-divider px-3.5 py-2 text-fine text-ink-tertiary">
              {t("perm.sp.lastChanged")}
              <PersonHoverCard userId={changedBy} className="text-ink-secondary underline decoration-dotted underline-offset-2">
                {changedByName}
              </PersonHoverCard>
              {changedByName !== changedBy ? <span>({changedBy})</span> : null}
              {detail.sp_changed_at ? <span>· {formatKst(detail.sp_changed_at)} KST</span> : null}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-md border border-dashed border-hairline bg-surface-pearl px-3.5 py-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-alt text-ink-tertiary">
            <Workflow size={16} strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-caption-strong text-ink">{t("perm.sp.notDesignated")}</div>
            {!hasPublished && (
              <p className="text-fine text-ink-tertiary">{t("perm.sp.requiresPublished")}</p>
            )}
          </div>
          <button
            type="button"
            data-id="subprocess-designation-designate"
            className="shrink-0 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-60"
            onClick={openModal}
            disabled={!hasPublished || saving}
          >
            {t("perm.sp.designate")}
          </button>
        </div>
      )}

      {/* 지정/수정 모달 — 공용 컴포넌트(에디터 인스펙터 카드와 공유) */}
      {showModal && (
        <SubprocessDesignationModal
          mapId={Number(mapId)}
          designated={designated}
          publishedVersionId={publishedVersionId}
          initial={modalInitial}
          onSaved={(updated) => {
            setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
            onToast(t("perm.sp.saved"));
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* 해제 확인 — 사용처 경고·잠금 안내 */}
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
    </div>
  );
}
