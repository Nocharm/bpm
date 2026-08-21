// 인스펙터 I/O & Conditions 카드 — 레이지 세이브(버퍼 편집, 헤더 Save 버튼).
// (사용자 결정 2026-08-20: 자동 저장 → 명시 저장). 노드 전환 리셋은 부모 key 리마운트가 담당.
// SP 노드는 링크 맵 sp_* 값을 read-only 상속 렌더 — 저장 대상이 아니라 Save 버튼 없음.
"use client";

import { ChevronRight, Link2 } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import {
  DETAIL_FIELD_ICONS,
  NodeDetailsFields,
  type NodeDetailsPatch,
} from "@/components/node-details-fields";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";
import { setIoLine, type IoSide } from "@/lib/io-items";
import { readDetailsCollapsed, writeDetailsCollapsed } from "@/lib/params";

type DetailField = keyof NodeDetailsPatch;

const DETAIL_FIELDS: readonly DetailField[] = [
  "input", "output", "input_forms", "output_forms",
  "output_ids", "input_links", "output_links", "input_flags",
  "data_form", "start_condition", "end_condition",
];
// 해제 확인 팝오버 크기(px) — 뷰포트 클램프 계산용 근사치
const UNLINK_POPOVER_WIDTH = 256;
const UNLINK_POPOVER_HEIGHT = 96;
// 헤더 채움 카운트는 주 필드 5종만 — 항목별 폼은 IO의 부속값이라 세지 않는다
const COUNT_FIELDS: readonly DetailField[] = [
  "input", "output", "data_form", "start_condition", "end_condition",
];

// SP 상속 표시용 — IO 원문과 항목별 폼(줄 1:1 정렬)을 행 목록으로 결합
function splitWithForms(value: string | null | undefined, forms: string | null | undefined) {
  const formLines = (forms ?? "").split("\n");
  return (value ?? "")
    .split("\n")
    .map((v, i) => ({ text: v.trim(), form: (formLines[i] ?? "").trim() }))
    .filter((r) => r.text !== "");
}

// IO 연결 배선 — page.tsx가 그래프 전체를 아는 동작(불러오기·네비게이션·하이라이트)을 주입한다.
// 해제만은 카드가 자체 처리 — draft 수준이라 Save 전 취소가 가능해야 하기 때문 (io-linking §4-3)
export interface NodeDetailsCardIo {
  originGroupIndexes: ReadonlySet<number>;
  onImport: (side: IoSide, at: { x: number; y: number }) => void;
  onNavigate: (side: IoSide, index: number) => void;
  onHoverItem: (side: IoSide, index: number | null) => void;
  // SP 읽기전용 행 중 이 맵에 미러가 있는 인덱스 — SP 항목은 노드 열이 아니라 링크 맵 지정값이라
  // getIoItemState가 판정하지 못하므로 page가 계산해 넘긴다
  spLinkedInputIndexes?: ReadonlySet<number>;
  spLinkedOutputIndexes?: ReadonlySet<number>;
}

interface NodeDetailsCardProps {
  nodeKey: string;
  isSubprocess: boolean;
  // 노드 저장값(서버 반영분) — 버퍼(draft)가 이 위에 겹친다
  values: Record<DetailField, string>;
  io?: NodeDetailsCardIo;
  // SP 노드의 링크 맵 상속값(read-only)
  sp?: {
    input?: string | null;
    output?: string | null;
    input_forms?: string | null;
    output_forms?: string | null;
    start_condition?: string | null;
    end_condition?: string | null;
  };
  readOnly: boolean;
  onSave: (patch: NodeDetailsPatch) => void;
}

export function NodeDetailsCard({
  nodeKey, isSubprocess, values, io, sp, readOnly, onSave,
}: NodeDetailsCardProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(readDetailsCollapsed);
  // 레이지 세이브 버퍼 — 원본과 같아진 키는 제거해 dirty 판정을 정확히 유지
  const [draft, setDraft] = useState<NodeDetailsPatch>({});
  // 링크 해제 확인 — 마우스 근처 팝오버. 확인해도 draft에만 반영되어 Save 전엔 되돌릴 수 있다 (io-linking §4-3)
  const [unlinkAsk, setUnlinkAsk] = useState<{ side: IoSide; index: number; at: { x: number; y: number } } | null>(null);

  const shown = (field: DetailField): string => draft[field] ?? values[field];
  const dirty = Object.keys(draft).length > 0;

  const mergePatch = (patch: NodeDetailsPatch) => {
    setDraft((prev) => {
      const merged = { ...prev };
      for (const field of DETAIL_FIELDS) {
        const next = patch[field];
        if (next === undefined) continue;
        if (next === values[field]) delete merged[field];
        else merged[field] = next;
      }
      return merged;
    });
  };

  // 링크 줄만 비운다 — 텍스트·폼은 그대로 남아 복사본이 된다 (io-linking §2)
  const confirmUnlink = () => {
    if (!unlinkAsk) return;
    const { side, index } = unlinkAsk;
    mergePatch(
      side === "input"
        ? { input_links: setIoLine(shown("input_links"), index, "") }
        : { output_links: setIoLine(shown("output_links"), index, "") },
    );
    setUnlinkAsk(null);
  };

  const filledCount = isSubprocess
    ? [sp?.input, sp?.output, sp?.start_condition, sp?.end_condition]
        .filter((v) => (v ?? "") !== "").length
    : COUNT_FIELDS.filter((f) => shown(f) !== "").length;

  return (
    <div data-id="inspector-details" className="rounded-md border border-hairline p-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-id="inspector-details-toggle"
          data-acc-toggle
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1 text-fine font-semibold text-ink"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            writeDetailsCollapsed(next);
          }}
        >
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            className={`transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
          />
          {t("inspector.details")}
          {filledCount > 0 && <span className="font-normal text-ink-tertiary">({filledCount})</span>}
        </button>
        {!isSubprocess && !readOnly && (
          <button
            type="button"
            data-id="inspector-details-save"
            disabled={!dirty}
            className={`shrink-0 rounded-sm px-2 py-0.5 text-fine ${
              dirty ? "bg-accent text-on-accent hover:bg-accent-focus" : "text-ink-muted"
            } disabled:opacity-50`}
            onClick={() => {
              onSave(draft);
              setDraft({});
            }}
          >
            {t("section.save")}
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="ml-2 border-l border-divider pl-2">
          {isSubprocess ? (
            <>
              {/* 링크 맵 라이브 참조 — sp가 소스(지정 어트리뷰트 카드와 동일 규약).
                  IO는 항목별 데이터 폼을 " · form" 접미로 함께 상속 표시 */}
              {([
                ["input", "field.input", splitWithForms(sp?.input, sp?.input_forms), DETAIL_FIELD_ICONS.input,
                  io?.spLinkedInputIndexes],
                ["output", "field.output", splitWithForms(sp?.output, sp?.output_forms), DETAIL_FIELD_ICONS.output,
                  io?.spLinkedOutputIndexes],
              ] as const).map(([id, labelKey, items, RowIcon, linkedIndexes]) => (
                <div
                  key={id}
                  data-id={`inspector-detail-${id}`}
                  className="flex items-start justify-between gap-2 border-t border-divider py-1"
                >
                  <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-secondary">
                    <RowIcon size={12} strokeWidth={1.5} className="text-ink-muted" />
                    {t(labelKey)}
                  </span>
                  <span className="min-w-0 text-right text-caption text-ink">
                    {items.length === 0
                      ? "-"
                      : items.map((r, i) => {
                          // SP 항목은 영구 원본 — 이 맵에 미러가 있으면 링크 아이콘 + 호버 하이라이트만 (io-linking §1-7)
                          const linked = linkedIndexes?.has(i) ?? false;
                          return (
                            <span
                              key={i}
                              className="block"
                              onMouseEnter={linked ? () => io?.onHoverItem(id, i) : undefined}
                              onMouseLeave={linked ? () => io?.onHoverItem(id, null) : undefined}
                            >
                              {linked && (
                                <Link2 size={12} strokeWidth={1.5} className="mr-0.5 inline text-accent" />
                              )}
                              <span className="text-fine tabular-nums text-ink-muted">{i + 1}. </span>
                              {r.text}
                              {r.form !== "" && (
                                <span className="text-fine text-ink-tertiary"> · {r.form}</span>
                              )}
                            </span>
                          );
                        })}
                  </span>
                </div>
              ))}
              {([
                ["start-condition", "field.startCondition", sp?.start_condition, DETAIL_FIELD_ICONS.start_condition],
                ["end-condition", "field.endCondition", sp?.end_condition, DETAIL_FIELD_ICONS.end_condition],
              ] as const).map(([id, labelKey, value, RowIcon]) => (
                <div
                  key={id}
                  data-id={`inspector-detail-${id}`}
                  className="flex items-start justify-between gap-2 border-t border-divider py-1"
                >
                  <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-secondary">
                    <RowIcon size={12} strokeWidth={1.5} className="text-ink-muted" />
                    {t(labelKey)}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap text-right text-caption text-ink">
                    {value || "-"}
                  </span>
                </div>
              ))}
              <p className="mt-1.5 text-fine text-ink-tertiary">{t("subprocess.attrsFromOwner")}</p>
            </>
          ) : (
            <>
              <NodeDetailsFields
                idPrefix="inspector-detail"
                nodeKey={nodeKey}
                input={shown("input")}
                output={shown("output")}
                inputForms={shown("input_forms")}
                outputForms={shown("output_forms")}
                outputIds={shown("output_ids")}
                inputLinks={shown("input_links")}
                outputLinks={shown("output_links")}
                inputFlags={shown("input_flags")}
                io={
                  io && {
                    originGroupIndexes: io.originGroupIndexes,
                    onImport: io.onImport,
                    // 불러오기는 그래프에 즉시 커밋 — 미저장 draft와 겹치면 어느 쪽이 이길지 모호해진다
                    importDisabledReason: dirty ? t("io.importSaveFirst") : undefined,
                    onUnlink: (side, index, at) => setUnlinkAsk({ side, index, at }),
                    onNavigate: io.onNavigate,
                    onHoverItem: io.onHoverItem,
                  }
                }
                dataForm={shown("data_form")}
                startCondition={shown("start_condition")}
                endCondition={shown("end_condition")}
                readOnly={readOnly}
                onPatch={mergePatch}
              />
              {dirty && (
                <p className="py-0.5 text-fine text-ink-tertiary">{t("section.unsavedHint")}</p>
              )}
            </>
          )}
        </div>
      )}
      {unlinkAsk &&
        createPortal(
          <ModalBackdrop
            className="fixed inset-0 z-[1200]"
            style={{ background: "transparent" }}
            onClose={() => setUnlinkAsk(null)}
          >
            <div
              data-id="io-unlink-popover"
              className="fixed w-64 rounded-md border border-hairline bg-surface p-2 shadow-lg"
              style={clampToViewport(
                unlinkAsk.at.x,
                unlinkAsk.at.y,
                UNLINK_POPOVER_WIDTH,
                UNLINK_POPOVER_HEIGHT,
              )}
              onClick={(event) => event.stopPropagation()}
            >
              <p className="px-1 pb-2 text-caption text-ink-secondary">{t("io.unlinkConfirm")}</p>
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  data-id="io-unlink-cancel"
                  className="rounded-sm px-2 py-1 text-caption text-ink-tertiary hover:bg-surface-alt"
                  onClick={() => setUnlinkAsk(null)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  data-id="io-unlink-confirm"
                  className="rounded-sm bg-accent px-2 py-1 text-caption text-on-accent hover:bg-accent-focus"
                  onClick={confirmUnlink}
                >
                  {t("io.unlinkAction")}
                </button>
              </div>
            </div>
          </ModalBackdrop>,
          document.body,
        )}
    </div>
  );
}
