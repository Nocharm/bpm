"use client";

// 거버넌스 확인 — dry-run governance[]를 맵별로 묶어 "현재 → 전달"을 보여주고, 행마다 유지/교체 드롭다운.
// 굵은 값 = 적용 뒤 남는 값, 버려지는 값은 취소선. 체크한 (code, field)만 apply가 교체 (spec 2026-09-03 §6).
// apply 결과 보기(applied=true)는 드롭다운 대신 적용/유지 배지. 오너·승인자는 사용자 필, 행 호버=우측 그 맵 강조.
// notes 행은 내용이 다를 때만 서버가 내려보내고(같으면 행 없음), 행 호버 시 뜨는 "변경사항 자세히"로
// git diff식 요약을 아코디언으로 편다 (사용자 결정 2026-09-09).

import { ArrowRight, Check, ChevronDown, GitCompare, ListChecks, Repeat, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { GovernanceDiff, GovernanceField, NoteChange } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { governanceKey, groupGovernanceDiffs, type ReportRelations } from "@/lib/interview-report";
import {
  orderByRelation,
  relationClass,
  type RelatedTags,
  type ReportFocus,
} from "@/lib/interview-report-focus";
import { useFlipOrder } from "@/lib/use-flip-order";

import { PersonPill } from "./person-pill";
import { PILL_BASE, ROW_STATE_CLASS } from "./report-bits";
import { ReportSection } from "./report-section";

const FIELD_LABEL: Record<GovernanceField, MessageKey> = {
  owner: "framework.governance.field.owner",
  department: "framework.governance.field.department",
  approvers: "framework.governance.field.approvers",
  notes: "framework.governance.field.notes",
};

const LOGIN_RE = /^[\w.@-]+$/;

// 값 한 쪽 — final(적용 뒤 남는 값)은 굵게, 아니면 취소선+흐림. 오너·승인자는 로그인 → 사용자 필
function GovernanceValue({ text, field, final }: { text: string; field: GovernanceField; final: boolean }) {
  const { t } = useI18n();
  if (!text) {
    return (
      <span className={final ? "font-semibold text-ink" : "text-ink-tertiary line-through"}>
        {t("framework.governance.empty")}
      </span>
    );
  }
  if (field === "owner" || field === "approvers") {
    const logins = text.split(",").map((s) => s.trim()).filter(Boolean);
    return (
      <span className={`inline-flex min-w-0 flex-wrap items-center gap-1 ${final ? "" : "opacity-55 [&_span]:line-through"}`}>
        {logins.map((login) =>
          LOGIN_RE.test(login) ? <PersonPill key={login} login={login} /> : <span key={login}>{login}</span>,
        )}
      </span>
    );
  }
  return (
    <span className={`min-w-0 truncate ${final ? "font-semibold text-ink" : "text-ink-tertiary line-through"}`} title={text}>
      {text}
    </span>
  );
}

// 유지/교체 드롭다운 — 트리거는 그대로 두고 **펼친 목록만** 앱 디자인으로 바꾼다. 네이티브 select의
// option 목록은 OS가 그려 리포트 톤과 어긋났다 (사용자 지시 2026-09-09).
// 목록은 body 포털 + fixed — 섹션 본문이 max-h 스크롤이라 absolute면 잘린다(SearchSelect와 같은 계약).
const MENU_WIDTH = 132; // px — 두 옵션 라벨 + 아이콘이 줄바꿈 없이 들어가는 폭

function KeepReplaceMenu({
  replace,
  dataId,
  onSelect,
}: {
  replace: boolean;
  dataId: string;
  onSelect: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      // 아래 공간이 모자라면 위로 뒤집는다 — 섹션 하단 행에서 목록이 화면 밖으로 나가지 않게
      const below = window.innerHeight - rect.bottom;
      const height = 72; // 옵션 2개 + 패딩
      setPos({
        left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
        top: below < height ? rect.top - height - 4 : rect.bottom + 4,
      });
    };
    updatePos(); // DOM 측정은 커밋 후에만 — pos=null 동안은 안 그리므로 엉뚱한 자리로 깜빡이지 않는다
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true); // capture — 섹션 내부 스크롤까지 따라간다
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open]);

  const choose = (next: boolean) => {
    setOpen(false);
    if (next !== replace) onSelect(next);
  };
  const options: { value: boolean; label: string; Icon: typeof Undo2 }[] = [
    { value: false, label: t("framework.governance.keepShort"), Icon: Undo2 },
    { value: true, label: t("framework.governance.replace"), Icon: Repeat },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-id={dataId}
        data-state={replace ? "replace" : "keep"}
        aria-expanded={open}
        className={`inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine transition-colors duration-150 ${
          replace
            ? "border-changed/40 bg-changed/10 text-changed hover:bg-changed/20"
            : "border-hairline bg-surface text-ink-secondary hover:bg-surface-alt"
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        {replace ? <Repeat size={12} strokeWidth={1.5} /> : <Undo2 size={12} strokeWidth={1.5} />}
        {replace ? t("framework.governance.replace") : t("framework.governance.keepShort")}
        <ChevronDown
          size={11}
          strokeWidth={1.5}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[1240]" onClick={() => setOpen(false)} />
            <div
              data-id={`${dataId}-menu`}
              role="listbox"
              style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
              className="fixed z-[1250] rounded-md border border-hairline bg-surface py-1 shadow-lg"
            >
              {options.map(({ value, label, Icon }) => {
                const active = value === replace;
                return (
                  <button
                    key={label}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-id={`${dataId}-${value ? "replace" : "keep"}`}
                    className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-fine hover:bg-surface-alt ${
                      active ? "text-ink" : "text-ink-secondary"
                    }`}
                    onClick={() => choose(value)}
                  >
                    <Icon size={12} strokeWidth={1.5} className={value ? "text-changed" : "text-ink-tertiary"} />
                    <span className="flex-1 truncate">{label}</span>
                    {active && <Check size={12} strokeWidth={1.7} className="shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

const NOTE_OP_LABEL: Record<NoteChange["op"], MessageKey> = {
  added: "framework.governance.noteAdded",
  removed: "framework.governance.noteRemoved",
  changed: "framework.governance.noteChanged",
};

const NOTE_OP_TONE: Record<NoteChange["op"], string> = {
  added: "border-added/40 bg-added/10 text-added",
  removed: "border-removed/40 bg-removed/10 text-removed",
  changed: "border-changed/40 bg-changed/10 text-changed",
};

/** git diff 한 덩어리 — `-` 사라질 본문, `+` 남을 본문. 줄 단위로 잘라 실제 diff처럼 읽히게 한다. */
function NoteDiffLines({ sign, text, tone }: { sign: "+" | "-"; text: string; tone: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <span key={i} className={`flex gap-1.5 px-2 ${tone}`}>
          <span className="shrink-0 select-none opacity-60">{sign}</span>
          <span className="min-w-0 whitespace-pre-wrap break-words">{line}</span>
        </span>
      ))}
    </>
  );
}

/** 노트 내용 차이 요약 — 항목마다 (종류 · 제목) 헤더 + 본문 diff 줄. */
function NoteDiffBody({ changes, dataId }: { changes: NoteChange[]; dataId: string }) {
  const { t } = useI18n();
  return (
    <ul data-id={dataId} className="flex flex-col gap-1.5 py-1.5 font-mono text-fine">
      {changes.map((change, i) => (
        <li key={i} className="overflow-hidden rounded-sm border border-hairline bg-surface-alt/60">
          <span className="flex items-center gap-1.5 border-b border-divider px-2 py-1">
            <span className={`${PILL_BASE} ${NOTE_OP_TONE[change.op]}`}>{t(NOTE_OP_LABEL[change.op])}</span>
            <span className="truncate font-sans text-ink-secondary">{change.kind}</span>
            <span className="min-w-0 truncate font-sans text-ink">
              {change.title || t("framework.governance.noteUntitled")}
            </span>
          </span>
          <span className="flex flex-col py-1">
            {change.op !== "added" && (
              <NoteDiffLines
                sign="-"
                text={change.op === "changed" ? change.prev_text : change.text}
                tone="bg-removed/5 text-removed"
              />
            )}
            {change.op !== "removed" && <NoteDiffLines sign="+" text={change.text} tone="bg-added/5 text-added" />}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface GovernanceSectionProps {
  diffs: GovernanceDiff[];
  checked: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onToggleAll: (next: boolean) => void;
  applied: boolean;
  relations: ReportRelations;
  focus: ReportFocus | null;
  onHover: (tags: RelatedTags | null) => void;
}

export function GovernanceSection({
  diffs,
  checked,
  onToggle,
  onToggleAll,
  applied,
  relations,
  focus,
  onHover,
}: GovernanceSectionProps) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  // 노트 diff 아코디언은 한 번에 하나만 — 섹션이 max-h 스크롤이라 여러 개가 열리면 행을 잃는다
  const [openNotes, setOpenNotes] = useState<string | null>(null);
  const groups = groupGovernanceDiffs(diffs);
  const tagsOf = (code: string): RelatedTags => {
    const file = relations.fileOfMap.get(code);
    return { maps: [code], files: file === undefined ? [] : [file] };
  };
  const ordered = orderByRelation(groups, (group) => tagsOf(group.code), focus);
  useFlipOrder(bodyRef, ordered.map((g) => g.code).join("|"));
  const allChecked = diffs.length > 0 && diffs.every((d) => checked.has(governanceKey(d)));

  return (
    <ReportSection
      dataId="import-governance-review"
      title={t("framework.governance.title")}
      Icon={ListChecks}
      pills={
        <>
          <span
            data-id="import-governance-count"
            className={`${PILL_BASE} tabular-nums ${
              diffs.length > 0 ? "border-changed/40 bg-changed/10 text-changed" : "border-hairline bg-surface-alt text-ink-secondary"
            }`}
          >
            {diffs.length}
          </span>
          {diffs.length > 0 && (
            <span className="hidden truncate text-fine text-ink-tertiary lg:inline">{t("framework.report.governanceBold")}</span>
          )}
          {!applied && diffs.length > 0 && (
            <button
              type="button"
              data-id="import-governance-check-all"
              className="shrink-0 rounded-sm px-1.5 py-0.5 text-fine text-accent hover:bg-accent-tint"
              onClick={() => onToggleAll(!allChecked)}
            >
              {allChecked ? t("framework.governance.clear") : t("framework.governance.checkAll")}
            </button>
          )}
        </>
      }
      tip={t("framework.report.governanceTip")}
      isEmpty={groups.length === 0}
      emptyText={t("framework.governance.none")}
      emptyDataId="import-governance-none"
      bodyRef={bodyRef}
      bodyClassName="max-h-80"
    >
      <ul className="flex flex-col">
        {ordered.map((group) => {
          const tags = tagsOf(group.code);
          const state = relationClass(tags, focus, true);
          return (
            <li
              key={group.code}
              data-flip-key={group.code}
              data-id={`import-governance-map-${group.code}`}
              className={`border-b border-divider transition-[background-color,opacity] duration-350 ease-smooth last:border-b-0 ${
                ROW_STATE_CLASS[state]
              }`}
              onMouseEnter={() => onHover(tags)}
              onMouseLeave={() => onHover(null)}
            >
              <div className="flex items-baseline gap-1.5 px-2.5 pt-1.5">
                <span className="truncate text-caption-strong text-ink">{group.name}</span>
                <span className="shrink-0 font-mono text-fine text-ink-tertiary">{group.code}</span>
              </div>
              <ul className="flex flex-col gap-0.5 px-2.5 pb-1.5 pt-0.5">
                {group.diffs.map((d) => {
                  const key = governanceKey(d);
                  const replace = applied ? d.applied : checked.has(key);
                  const noteChanges = d.note_changes ?? [];
                  const open = openNotes === key;
                  return (
                    <li
                      key={key}
                      data-id={`import-governance-row-${d.code}-${d.field}`}
                      className="group flex flex-col text-fine"
                    >
                      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 py-0.5">
                        <span className="text-ink-secondary">{t(FIELD_LABEL[d.field])}</span>
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <GovernanceValue text={d.current} field={d.field} final={!replace} />
                          <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                          <GovernanceValue text={d.delivered} field={d.field} final={replace} />
                          {noteChanges.length > 0 && (
                            <button
                              type="button"
                              data-id={`import-governance-note-details-${d.code}`}
                              aria-expanded={open}
                              className={`inline-flex shrink-0 items-center gap-1 rounded-sm border border-accent/40 bg-surface px-1.5 py-px text-accent transition-opacity duration-150 hover:bg-accent-tint ${
                                open ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                              }`}
                              onClick={() => setOpenNotes(open ? null : key)}
                            >
                              <GitCompare size={11} strokeWidth={1.5} />
                              {open ? t("framework.governance.noteDetailsHide") : t("framework.governance.noteDetails")}
                              <ChevronDown
                                size={11}
                                strokeWidth={1.5}
                                className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                              />
                            </button>
                          )}
                        </div>
                        {applied ? (
                          <span
                            data-id={`import-governance-result-${d.code}-${d.field}`}
                            className={`${PILL_BASE} justify-center ${
                              d.applied ? "border-changed/40 bg-changed/10 text-changed" : "border-hairline bg-surface text-ink-tertiary"
                            }`}
                          >
                            {d.applied ? t("framework.governance.applied") : t("framework.governance.kept")}
                          </span>
                        ) : (
                          <KeepReplaceMenu
                            replace={replace}
                            dataId={`import-governance-select-${d.code}-${d.field}`}
                            onSelect={() => onToggle(key)}
                          />
                        )}
                      </div>
                      {noteChanges.length > 0 && (
                        <div
                          className={`grid transition-[grid-template-rows] duration-350 ease-smooth ${
                            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                          }`}
                        >
                          <div className="overflow-hidden">
                            <NoteDiffBody changes={noteChanges} dataId={`import-governance-note-diff-${d.code}`} />
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </ReportSection>
  );
}
