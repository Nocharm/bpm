"use client";

// 그룹 멤버 일괄 편집 — 그룹명, 색상 일괄, 속성 일괄(설정/비우기 + 충돌 처리: 교체/추가/건너뛰기/개별 선택), 중단 (#5 2026-06-15)
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

export type BulkAttrField = "assignee" | "department" | "system" | "duration";
export type BulkAction = "set" | "clear";
// 충돌 처리: 교체/추가(콤마)/건너뛰기/개별 선택. null=미선택(필수)
export type BulkPolicy = "replace" | "append" | "skip" | "individual";

const ATTR_FIELDS: BulkAttrField[] = ["assignee", "department", "system", "duration"];
const FIELD_LABEL_KEY: Record<BulkAttrField, MessageKey> = {
  assignee: "field.assignee",
  department: "field.department",
  system: "field.system",
  duration: "field.duration",
};

export interface BulkMember {
  id: string;
  label: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
}

type Update = { id: string; value: string };

interface GroupBulkModalProps {
  groupLabel: string;
  members: BulkMember[];
  colorPresets: string[];
  onRenameGroup: (label: string) => void;
  onApplyColor: (color: string) => void;
  onApplyAttribute: (field: BulkAttrField, updates: Update[]) => void;
  onClose: () => void;
}

export function GroupBulkModal({
  groupLabel,
  members,
  colorPresets,
  onRenameGroup,
  onApplyColor,
  onApplyAttribute,
  onClose,
}: GroupBulkModalProps) {
  const { t } = useI18n();
  const [field, setField] = useState<BulkAttrField>("assignee");
  const [action, setAction] = useState<BulkAction>("set");
  const [value, setValue] = useState("");
  const [policy, setPolicy] = useState<BulkPolicy | null>(null); // 디폴트 없음 — 필수
  const [showConflicts, setShowConflicts] = useState(false);
  // 개별 선택 마법사 — 충돌 멤버를 순차 처리
  const [wizard, setWizard] = useState<{ step: number; resolved: Update[] } | null>(null);

  // Esc로 중단
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // 충돌 = 기존 값이 있고 새 값과 다른 멤버. 동일한 값은 자동 스킵(충돌 아님)
  const conflicts = members.filter(
    (m) => m[field].trim() !== "" && m[field].trim() !== value.trim(),
  );
  const hasConflict = action === "set" && conflicts.length > 0;
  const btn =
    "rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt disabled:opacity-40";

  const finish = (updates: Update[]) => {
    onApplyAttribute(field, updates);
    setWizard(null);
  };

  const apply = () => {
    if (action === "clear") {
      finish(members.map((m) => ({ id: m.id, value: "" })));
      return;
    }
    if (!hasConflict) {
      finish(members.map((m) => ({ id: m.id, value })));
      return;
    }
    if (policy === null) {
      return; // 충돌 처리 미선택 — 진행 불가
    }
    if (policy === "individual") {
      // 빈 값 멤버는 즉시 설정, 충돌 멤버는 마법사로
      const base = members
        .filter((m) => m[field].trim() === "")
        .map((m) => ({ id: m.id, value }));
      setWizard({ step: 0, resolved: base });
      return;
    }
    const updates = members.flatMap<Update>((m) => {
      const existing = m[field].trim();
      if (existing === "") return [{ id: m.id, value }];
      if (existing === value.trim()) return []; // 동일 값 — 자동 스킵
      if (policy === "replace") return [{ id: m.id, value }];
      if (policy === "append") return [{ id: m.id, value: `${m[field]}, ${value}` }];
      return []; // skip
    });
    finish(updates);
  };

  const resolveStep = (choice: "replace" | "append" | "skip") => {
    if (!wizard) return;
    const member = conflicts[wizard.step];
    const resolved = [...wizard.resolved];
    if (choice === "replace") resolved.push({ id: member.id, value });
    else if (choice === "append")
      resolved.push({ id: member.id, value: `${member[field]}, ${value}` });
    // skip → 추가 안 함
    const next = wizard.step + 1;
    if (next >= conflicts.length) {
      finish(resolved);
    } else {
      setWizard({ step: next, resolved });
    }
  };

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
        {wizard ? (
          /* 개별 선택 마법사 — 충돌 멤버 순차 처리 + 진행률 */
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-body-strong text-ink">{t("bulk.individual")}</p>
              <span className="text-fine text-ink-tertiary">
                {t("bulk.step", { done: wizard.step + 1, total: conflicts.length })}
              </span>
            </div>
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${((wizard.step + 1) / conflicts.length) * 100}%` }}
              />
            </div>
            <p className="mb-1 text-caption text-ink">
              {conflicts[wizard.step].label || conflicts[wizard.step].id}
            </p>
            <p className="mb-1 text-fine text-ink-tertiary">
              {t("bulk.existing")}: {conflicts[wizard.step][field]}
            </p>
            <p className="mb-3 text-fine text-ink-tertiary">
              {t("bulk.value")}: {value}
            </p>
            <div className="flex gap-1">
              <button type="button" className={btn} onClick={() => resolveStep("replace")}>
                {t("bulk.replace")}
              </button>
              <button type="button" className={btn} onClick={() => resolveStep("append")}>
                {t("bulk.append")}
              </button>
              <button type="button" className={btn} onClick={() => resolveStep("skip")}>
                {t("bulk.skip")}
              </button>
            </div>
            <div className="mt-3 flex justify-end border-t border-hairline pt-3">
              <button type="button" className={btn} onClick={() => setWizard(null)}>
                {t("bulk.close")}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-body-strong text-ink">{t("bulk.title")}</p>
              <span className="text-fine text-ink-tertiary">
                {t("bulk.members", { n: members.length })}
              </span>
            </div>

            {/* 그룹 이름 */}
            <p className="mb-1 text-caption-strong text-ink-secondary">{t("bulk.groupName")}</p>
            <input
              className="mb-3 w-full rounded-sm border border-hairline px-2 py-1 text-caption"
              defaultValue={groupLabel}
              placeholder={t("group.untitled")}
              onBlur={(event) => onRenameGroup(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />

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
                onChange={(event) => {
                  setField(event.target.value as BulkAttrField);
                  setPolicy(null);
                }}
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

              {/* 충돌 처리 — 설정인데 이미 값 있는 멤버가 있을 때만. 디폴트 없음(필수) */}
              {hasConflict && (
                <div className="rounded-sm bg-surface-alt p-2 text-caption">
                  {/* 5-3 호버 시 기존 데이터 팝오버 */}
                  <div
                    className="relative mb-1 inline-block"
                    onMouseEnter={() => setShowConflicts(true)}
                    onMouseLeave={() => setShowConflicts(false)}
                  >
                    <span className="cursor-help text-fine text-ink-tertiary underline decoration-dotted">
                      {t("bulk.conflict", { n: conflicts.length })}
                    </span>
                    {showConflicts && (
                      <div className="absolute left-0 top-full z-10 mt-1 max-h-40 w-64 overflow-y-auto rounded-sm border border-hairline bg-surface p-2 shadow-lg">
                        <ul className="flex flex-col gap-0.5">
                          {conflicts.map((m) => (
                            <li key={m.id} className="flex justify-between gap-2 text-fine">
                              <span className="truncate text-ink-tertiary">
                                {m.label || m.id}
                              </span>
                              <span className="shrink-0 text-ink">{m[field]}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {(["replace", "append", "skip", "individual"] as BulkPolicy[]).map((p) => (
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
                disabled={
                  (action === "set" && value.trim() === "") ||
                  (hasConflict && policy === null)
                }
                onClick={apply}
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
        )}
      </div>
    </div>,
    document.body,
  );
}
