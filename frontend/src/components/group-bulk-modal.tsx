"use client";

// 그룹 멤버 일괄 편집 — 색상 일괄, 속성 일괄(설정/비우기, 기존값 추가·교체·건너뛰기), 중단(닫기) (#5 2026-06-15)
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

export type BulkAttrField = "assignee" | "department" | "system" | "duration";
export type BulkAction = "set" | "clear";
export type BulkPolicy = "append" | "replace" | "skip";

const ATTR_FIELDS: BulkAttrField[] = ["assignee", "department", "system", "duration"];
const FIELD_LABEL_KEY: Record<BulkAttrField, MessageKey> = {
  assignee: "field.assignee",
  department: "field.department",
  system: "field.system",
  duration: "field.duration",
};

interface BulkMember {
  assignee: string;
  department: string;
  system: string;
  duration: string;
}

interface GroupBulkModalProps {
  members: BulkMember[];
  colorPresets: string[];
  onApplyColor: (color: string) => void;
  onApplyAttribute: (
    field: BulkAttrField,
    action: BulkAction,
    value: string,
    policy: BulkPolicy,
  ) => void;
  onClose: () => void;
}

export function GroupBulkModal({
  members,
  colorPresets,
  onApplyColor,
  onApplyAttribute,
  onClose,
}: GroupBulkModalProps) {
  const { t } = useI18n();
  const [field, setField] = useState<BulkAttrField>("assignee");
  const [action, setAction] = useState<BulkAction>("set");
  const [value, setValue] = useState("");
  const [policy, setPolicy] = useState<BulkPolicy>("replace");

  // Esc로 중단
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // 선택 속성에 이미 값이 있는 멤버 수 — 설정 시 충돌 처리 단계 노출 여부
  const conflictCount = members.filter((m) => m[field].trim() !== "").length;
  const btn =
    "rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt disabled:opacity-40";

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClick={onClose}
    >
      <div
        className="w-96 rounded-md bg-surface p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-body-strong text-ink">{t("bulk.title")}</p>
          <span className="text-fine text-ink-tertiary">
            {t("bulk.members", { n: members.length })}
          </span>
        </div>

        {/* 색상 일괄 — 스와치 클릭 즉시 멤버 전원 적용 */}
        <p className="mb-1 text-caption-strong text-ink-secondary">{t("bulk.color")}</p>
        <div className="mb-3 flex flex-wrap gap-1">
          {colorPresets
            .filter((preset) => preset)
            .map((preset) => (
              <button
                key={preset}
                type="button"
                className="h-5 w-5 rounded-full border border-hairline"
                style={{ background: preset }}
                title={preset}
                aria-label={preset}
                onClick={() => onApplyColor(preset)}
              />
            ))}
        </div>

        {/* 속성 일괄 */}
        <p className="mb-1 text-caption-strong text-ink-secondary">{t("bulk.attribute")}</p>
        <div className="flex flex-col gap-2">
          <select
            className="rounded-sm border border-hairline px-2 py-1 text-caption"
            value={field}
            onChange={(event) => setField(event.target.value as BulkAttrField)}
          >
            {ATTR_FIELDS.map((f) => (
              <option key={f} value={f}>
                {t(FIELD_LABEL_KEY[f])}
              </option>
            ))}
          </select>

          <div className="flex gap-3 text-caption">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={action === "set"}
                onChange={() => setAction("set")}
              />
              {t("bulk.actionSet")}
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={action === "clear"}
                onChange={() => setAction("clear")}
              />
              {t("bulk.actionClear")}
            </label>
          </div>

          {action === "set" && (
            <input
              className="rounded-sm border border-hairline px-2 py-1 text-caption"
              placeholder={t("bulk.value")}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}

          {/* 충돌 처리 — 설정인데 이미 값 있는 멤버가 있을 때만 */}
          {action === "set" && conflictCount > 0 && (
            <div className="rounded-sm bg-surface-alt p-2 text-caption">
              <p className="mb-1 text-fine text-ink-tertiary">
                {t("bulk.conflict", { n: conflictCount })}
              </p>
              <div className="flex flex-col gap-1">
                {(["replace", "append", "skip"] as BulkPolicy[]).map((p) => (
                  <label key={p} className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={policy === p}
                      onChange={() => setPolicy(p)}
                    />
                    {t(`bulk.${p}` as MessageKey)}
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className={btn}
            disabled={action === "set" && value.trim() === ""}
            onClick={() => onApplyAttribute(field, action, value.trim(), policy)}
          >
            {t("bulk.apply")}
          </button>
        </div>

        <div className="mt-3 flex justify-end border-t border-hairline pt-3">
          <button type="button" className={btn} onClick={onClose}>
            {t("bulk.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
