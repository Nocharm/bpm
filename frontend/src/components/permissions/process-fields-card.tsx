// 설정 > 상세 — 인터뷰 승격 필드 검토 편집 카드(오너 전용). 대표 필드 편집 + FallbackHint(원문·수정)
// 로 이관 후 검토 작업(GMP 선정·시간 정량화)을 지원한다. 저장은 PATCH /maps/{id}/process-fields
// (SP 지정 여부와 무관 — design 2026-08-19 §5).
"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getMap, patchProcessFields, type MapSummary, type ProcessFieldsBody } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { FallbackHint } from "@/components/fallback-hint";
import { ParamInput } from "@/components/param-input";
import { formatGmp, getGmpBadgeStyle, GMP_OPTIONS } from "@/lib/gmp";
import { useI18n } from "@/lib/i18n";

interface ProcessFieldsCardProps {
  mapId: string;
  onToast: (message: string) => void;
}

const INPUT_CLASS =
  "min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink focus:border-accent focus:outline-none";

export function ProcessFieldsCard({ mapId, onToast }: ProcessFieldsCardProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<MapSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 편집 버퍼 — 서버 값에서 시작, blur 시 변경분만 PATCH
  const [startCondition, setStartCondition] = useState("");
  const [endCondition, setEndCondition] = useState("");
  // GMP 변경 안내 — 분류가 색을 자동 지정하므로, 바뀐 색을 마우스 위치에서 알리고 되돌리기 제공
  // (사용자 결정 2026-08-20: 닫기 버튼이 마우스 지점에 오도록 배치)
  const [gmpNotice, setGmpNotice] = useState<{ prev: string; next: string; x: number; y: number } | null>(null);
  const gmpPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    let active = true;
    void getMap(Number(mapId))
      .then((d) => {
        if (!active) return;
        setDetail(d);
        setStartCondition(d.sp_start_condition ?? "");
        setEndCondition(d.sp_end_condition ?? "");
      })
      .catch(() => {
        // 조회 실패는 카드 비표시 — 설정 페이지 다른 카드가 이미 에러를 표면화한다
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  if (detail === null) return null;

  async function save(patch: ProcessFieldsBody) {
    try {
      const updated = await patchProcessFields(Number(mapId), patch);
      setDetail(updated);
      onToast(t("perm.processFields.saved"));
    } catch (err) {
      setError(humanizeApiError(err, t));
    }
  }

  const frequencyFallback = detail.sp_frequency_fallback ?? "";

  return (
    <div data-id="settings-process-fields" className="flex max-w-xl flex-col gap-2">
      <div className="text-fine uppercase tracking-wide text-ink-tertiary">
        {t("perm.processFields.title")}
      </div>
      {error && <p className="text-caption text-error">{error}</p>}

      {/* GMP — 3값 셀렉트(+미분류), 폴백 원문 보고 선정. 분류가 배지 색을 자동 지정 */}
      <div className="flex items-center gap-2">
        <span className="w-32 shrink-0 text-caption text-ink-secondary">GMP</span>
        <select
          data-id="process-fields-gmp"
          className={INPUT_CLASS}
          value={detail.sp_gmp ?? ""}
          onPointerDown={(e) => {
            gmpPointer.current = { x: e.clientX, y: e.clientY };
          }}
          onChange={(e) => {
            const prev = detail.sp_gmp ?? "";
            const next = e.target.value;
            void save({ gmp: next });
            if (next !== prev) {
              setGmpNotice({ prev, next, ...gmpPointer.current });
            }
          }}
        >
          <option value="">{t("perm.processFields.gmpUnset")}</option>
          {GMP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {formatGmp(detail.sp_gmp) && (
          <span
            data-id="process-fields-gmp-badge"
            className="shrink-0 rounded-full px-1.5 py-0.5 text-fine"
            style={getGmpBadgeStyle(detail.sp_gmp)}
          >
            {formatGmp(detail.sp_gmp)}
          </span>
        )}
        <FallbackHint
          dataId="process-fields-gmp-hint"
          fallback={detail.sp_gmp_fallback}
          onSaveFallback={(text) => void save({ gmp_fallback: text })}
        />
      </div>
      {gmpNotice !== null &&
        createPortal(
          // 닫기(X) 버튼 중심이 셀렉트를 클릭한 마우스 지점에 오도록 우상단 기준 배치
          <div
            data-id="process-fields-gmp-notice"
            className="fixed z-[1360] w-[260px] rounded-md border border-hairline bg-surface p-3 shadow-lg"
            style={{
              left: Math.max(8, Math.min(gmpNotice.x - 260 + 22, window.innerWidth - 268)),
              top: Math.max(8, gmpNotice.y - 22),
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-fine font-semibold text-ink-secondary">
                  {t("perm.processFields.gmpChanged")}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  {gmpNotice.next ? (
                    <span className="rounded-full px-1.5 py-0.5 text-fine" style={getGmpBadgeStyle(gmpNotice.next)}>
                      {formatGmp(gmpNotice.next)}
                    </span>
                  ) : (
                    <span className="rounded-full bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary">
                      {t("perm.processFields.gmpUnset")}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                data-id="process-fields-gmp-notice-close"
                aria-label="Dismiss"
                className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt"
                onClick={() => setGmpNotice(null)}
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                data-id="process-fields-gmp-notice-undo"
                className="rounded-sm px-2 py-0.5 text-caption text-accent hover:bg-accent-tint"
                onClick={() => {
                  void save({ gmp: gmpNotice.prev });
                  setGmpNotice(null);
                }}
              >
                {t("perm.processFields.gmpUndo")}
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/* 시작/종료 조건 — 자유 텍스트, blur 저장 */}
      <div className="flex items-center gap-2">
        <span className="w-32 shrink-0 text-caption text-ink-secondary">{t("field.startCondition")}</span>
        <input
          data-id="process-fields-start-condition"
          className={INPUT_CLASS}
          value={startCondition}
          onChange={(e) => setStartCondition(e.target.value)}
          onBlur={() => {
            if (startCondition !== (detail.sp_start_condition ?? "")) {
              void save({ start_condition: startCondition });
            }
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-32 shrink-0 text-caption text-ink-secondary">{t("field.endCondition")}</span>
        <input
          data-id="process-fields-end-condition"
          className={INPUT_CLASS}
          value={endCondition}
          onChange={(e) => setEndCondition(e.target.value)}
          onBlur={() => {
            if (endCondition !== (detail.sp_end_condition ?? "")) {
              void save({ end_condition: endCondition });
            }
          }}
        />
      </div>

      {/* 시간 대표값 — duration(총시간)·touch_time(실작업), 폴백 원문 힌트 동반 */}
      <div className="flex items-center gap-2">
        <span className="w-32 shrink-0 text-caption text-ink-secondary">{t("field.duration")}</span>
        <ParamInput
          field="duration"
          dataId="process-fields-duration"
          className={INPUT_CLASS}
          value={detail.sp_duration ?? ""}
          ariaLabel={t("field.duration")}
          onCommit={(next) => void save({ duration: next })}
        />
        <FallbackHint
          dataId="process-fields-duration-hint"
          fallback={detail.sp_total_time_fallback}
          onSaveFallback={(text) => void save({ total_time_fallback: text })}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-32 shrink-0 text-caption text-ink-secondary">{t("field.touchTime")}</span>
        <ParamInput
          field="touch_time"
          dataId="process-fields-touch-time"
          className={INPUT_CLASS}
          value={detail.sp_touch_time ?? ""}
          ariaLabel={t("field.touchTime")}
          onCommit={(next) => void save({ touch_time: next })}
        />
        <FallbackHint
          dataId="process-fields-touch-time-hint"
          fallback={detail.sp_touch_time_fallback}
          onSaveFallback={(text) => void save({ touch_time_fallback: text })}
        />
      </div>

      {/* 시스템 — 원문 대표값 + 폴백(라이브러리화 전 검토 원천, design 2026-08-19 §3) */}
      <div className="flex items-center gap-2">
        <span className="w-32 shrink-0 text-caption text-ink-secondary">{t("field.system")}</span>
        <input
          data-id="process-fields-system"
          className={INPUT_CLASS}
          maxLength={100}
          defaultValue={detail.sp_system ?? ""}
          onBlur={(e) => {
            if (e.target.value !== (detail.sp_system ?? "")) void save({ system: e.target.value });
          }}
        />
        <FallbackHint
          dataId="process-fields-system-hint"
          fallback={detail.sp_system_fallback}
          onSaveFallback={(text) => void save({ system_fallback: text })}
        />
      </div>

      {/* 빈도 원문 — 대표(annual_count)는 이 맵을 참조하는 SP 노드 행에 입력 (design 2026-08-19 §1.2) */}
      {frequencyFallback !== "" && (
        <div className="flex items-start gap-2" data-id="process-fields-frequency">
          <span className="w-32 shrink-0 text-caption text-ink-secondary">{t("field.annualCount")}</span>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <p className="min-w-0 text-caption text-ink-tertiary">{t("perm.processFields.frequencyNote")}</p>
            <FallbackHint
              dataId="process-fields-frequency-hint"
              fallback={frequencyFallback}
              onSaveFallback={(text) => void save({ frequency_fallback: text })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
