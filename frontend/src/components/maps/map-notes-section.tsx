"use client";

// 맵/L5 노트 섹션 — 인터뷰 노트(예외 규칙·VOC·흐름 인용) + 사용자 노트. 상세 카드·에디터 맵 탭·SP 요약 모달·
// L5 연계 캔버스 공용. 쓰기는 맵=오너, L5=체인 권한자/sysadmin(서버 can_edit) — 나머지는 열람 + 안내 문구
// (design 2026-09-03 followups §3). 필(kind)은 프리셋 칩 또는 '[' 자동완성(현재 노트 kind + 프리셋).

import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  createCategoryNote,
  createMapNote,
  deleteCategoryNote,
  deleteMapNote,
  getCategoryNotes,
  getMapNotes,
  updateCategoryNote,
  updateMapNote,
  type MapNote,
  type MapNoteBody,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

export type NotesScope = { mapId: number } | { categoryId: number };

interface MapNotesSectionProps {
  scope: NotesScope;
  // 맵 스코프 쓰기 권한(오너) — 부모가 판정. L5 스코프는 서버 응답 can_edit가 진실이라 무시된다
  canEdit?: boolean;
  onToast?: (message: string) => void;
}

// 프리셋 kind — 임포트가 쓰는 어휘와 동일. 라벨은 i18n, 그 외 kind는 원문 표기
const PRESET_KINDS = ["note", "exception", "voc", "rule_basis", "open_item"] as const;
const KIND_LABEL: Record<string, MessageKey> = {
  note: "notes.kind.note",
  exception: "notes.kind.exception",
  voc: "notes.kind.voc",
  rule_basis: "notes.kind.ruleBasis",
  open_item: "notes.kind.openItem",
  flow: "notes.kind.flow",
  entry: "notes.kind.entry",
  task_note: "notes.kind.taskNote",
};

interface Draft {
  id: number | null; // null = 새 노트
  kind: string;
  title: string;
  text: string;
}

const scopeKey = (scope: NotesScope): string => ("mapId" in scope ? `map:${scope.mapId}` : `cat:${scope.categoryId}`);

// '[' 자동완성 — 입력값이 '['로 시작하면 괄호 안 텍스트로 후보를 거른다. 저장값은 괄호 없는 kind
const stripBrackets = (raw: string): string => raw.replace(/^\[/, "").replace(/\]$/, "").trim();

export function MapNotesSection({ scope, canEdit = false, onToast }: MapNotesSectionProps) {
  const { t } = useI18n();
  const key = scopeKey(scope);
  const [loaded, setLoaded] = useState<{ key: string; notes: MapNote[]; canEdit: boolean } | null>(null);
  // 기본 접힘 — 노트는 참고 정보라 필요할 때만 펼친다 (사용자 결정 2026-08-20)
  const [collapsed, setCollapsed] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<MapNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kindOpen, setKindOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const load = "mapId" in scope
      ? getMapNotes(scope.mapId).then((rows) => ({ notes: rows, canEdit }))
      : getCategoryNotes(scope.categoryId).then((body) => ({ notes: body.notes, canEdit: body.can_edit }));
    void load
      .then((result) => {
        if (active) setLoaded({ key, ...result });
      })
      .catch(() => {
        // 로드 실패 = 섹션 숨김 — 노트는 부가 정보라 카드 본문을 막지 않는다
      });
    return () => {
      active = false;
    };
    // scope 객체는 매 렌더 새로 만들어질 수 있어 key 문자열로 의존 — canEdit 변화는 부모 리마운트가 담당
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const notes = loaded?.key === key ? loaded.notes : [];
  const effectiveCanEdit = loaded?.key === key ? loaded.canEdit : false;
  if (loaded?.key !== key) return null;
  if (notes.length === 0 && !effectiveCanEdit) return null;

  const kindLabel = (kind: string): string => (KIND_LABEL[kind] ? t(KIND_LABEL[kind]) : kind);
  const kindSuggestions = (query: string): string[] => {
    const pool = [...new Set([...PRESET_KINDS, ...notes.map((n) => n.kind)])];
    const q = stripBrackets(query).toLowerCase();
    return pool.filter((k) => q === "" || k.toLowerCase().includes(q)).slice(0, 8);
  };

  function openNew() {
    setCollapsed(false);
    setError(null);
    setDraft({ id: null, kind: "note", title: "", text: "" });
  }

  function openEdit(note: MapNote) {
    setError(null);
    setDraft({ id: note.id, kind: note.kind, title: note.title ?? "", text: note.text });
  }

  async function save() {
    if (!draft) return;
    const body: MapNoteBody = {
      kind: stripBrackets(draft.kind) || "note",
      title: draft.title.trim() || null,
      text: draft.text.trim(),
    };
    if (body.text === "") return;
    setBusy(true);
    setError(null);
    try {
      let saved: MapNote;
      if ("mapId" in scope) {
        saved = draft.id === null
          ? await createMapNote(scope.mapId, body)
          : await updateMapNote(scope.mapId, draft.id, body);
      } else {
        saved = draft.id === null
          ? await createCategoryNote(scope.categoryId, body)
          : await updateCategoryNote(scope.categoryId, draft.id, body);
      }
      setLoaded((prev) =>
        prev && prev.key === key
          ? {
              ...prev,
              notes: draft.id === null
                ? [...prev.notes, saved]
                : prev.notes.map((n) => (n.id === saved.id ? saved : n)),
            }
          : prev,
      );
      setDraft(null);
      onToast?.(t("notes.saved"));
    } catch (err) {
      setError(humanizeApiError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      if ("mapId" in scope) await deleteMapNote(scope.mapId, deleting.id);
      else await deleteCategoryNote(scope.categoryId, deleting.id);
      setLoaded((prev) =>
        prev && prev.key === key ? { ...prev, notes: prev.notes.filter((n) => n.id !== deleting.id) } : prev,
      );
      onToast?.(t("notes.deleted"));
    } catch (err) {
      setError(humanizeApiError(err, t));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  const renderForm = () =>
    draft && (
      <li data-id="map-note-form" className="flex flex-col gap-1.5 rounded-sm border border-accent-tint-border bg-accent-tint/30 p-2">
        {/* kind — 프리셋 칩 + 자유 입력('[' 자동완성) */}
        <div className="flex flex-wrap items-center gap-1">
          {PRESET_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              data-id={`map-note-kind-${k}`}
              className={`rounded-sm border px-1.5 py-0.5 text-fine uppercase ${
                stripBrackets(draft.kind) === k
                  ? "border-accent bg-accent-tint text-accent"
                  : "border-hairline bg-surface text-ink-secondary hover:bg-surface-alt"
              }`}
              onClick={() => setDraft({ ...draft, kind: k })}
            >
              {kindLabel(k)}
            </button>
          ))}
          <div className="relative">
            <input
              data-id="map-note-kind-input"
              className="w-32 rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink focus:border-accent focus:outline-none"
              placeholder={t("notes.kindPlaceholder")}
              value={draft.kind}
              onFocus={() => setKindOpen(draft.kind.startsWith("["))}
              onBlur={() => window.setTimeout(() => setKindOpen(false), 120)}
              onChange={(e) => {
                const raw = e.target.value;
                // '[' 하나만 쳤을 때 닫는 괄호를 자동으로 붙이고 캐럿을 안쪽에 둔다
                if (raw === "[") {
                  const el = e.target;
                  setDraft({ ...draft, kind: "[]" });
                  setKindOpen(true);
                  window.requestAnimationFrame(() => el.setSelectionRange(1, 1));
                  return;
                }
                setDraft({ ...draft, kind: raw });
                setKindOpen(raw.startsWith("["));
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setKindOpen(false);
                if (e.key === "Enter") {
                  e.preventDefault();
                  const first = kindSuggestions(draft.kind)[0];
                  if (kindOpen && first) setDraft({ ...draft, kind: first });
                  setKindOpen(false);
                }
              }}
            />
            {kindOpen && kindSuggestions(draft.kind).length > 0 && (
              <ul
                data-id="map-note-kind-suggest"
                className="absolute left-0 top-full z-[1250] mt-0.5 w-40 rounded-sm border border-hairline bg-surface py-0.5 shadow-md"
              >
                {kindSuggestions(draft.kind).map((k) => (
                  <li key={k}>
                    <button
                      type="button"
                      data-id={`map-note-kind-suggest-${k}`}
                      className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-fine text-ink hover:bg-surface-alt"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setDraft({ ...draft, kind: k });
                        setKindOpen(false);
                      }}
                    >
                      <span className="uppercase text-ink-secondary">{k}</span>
                      {KIND_LABEL[k] && <span className="text-ink-tertiary">{kindLabel(k)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <input
          data-id="map-note-title-input"
          className="rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink focus:border-accent focus:outline-none"
          placeholder={t("notes.titlePlaceholder")}
          maxLength={300}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <textarea
          data-id="map-note-text-input"
          className="min-h-[3.5rem] resize-y rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink focus:border-accent focus:outline-none"
          placeholder={t("notes.textPlaceholder")}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
        {error && <p className="text-fine text-error">{error}</p>}
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            data-id="map-note-cancel"
            className="rounded-sm px-2 py-0.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={() => setDraft(null)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            data-id="map-note-save"
            disabled={busy || draft.text.trim() === ""}
            className="rounded-sm bg-accent px-2 py-0.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => void save()}
          >
            {t("notes.save")}
          </button>
        </div>
      </li>
    );

  return (
    <div data-id="map-notes-section" className="rounded-md border border-hairline bg-surface p-3">
      <div className="flex items-center gap-1">
        {/* 아코디언 — 기본 접힘, 인스펙터 카드(수행 지표 등)와 동일 패턴 (사용자 결정 2026-08-20) */}
        <button
          type="button"
          data-id="map-notes-toggle"
          data-acc-toggle
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1 text-fine font-semibold text-ink"
        >
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            className={`shrink-0 transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
          />
          {t("notes.title")}
          <span className="font-normal text-ink-tertiary">({notes.length})</span>
        </button>
        {effectiveCanEdit && (
          <button
            type="button"
            data-id="map-notes-add"
            aria-label={t("notes.add")}
            title={t("notes.add")}
            className="shrink-0 rounded-sm p-0.5 text-accent hover:bg-accent-tint"
            onClick={openNew}
          >
            <Plus size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {!collapsed && (
        <ul className="scroll-soft mt-1.5 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {draft?.id === null && renderForm()}
          {notes.map((note) =>
            draft?.id === note.id ? (
              <li key={note.id}>{renderForm()}</li>
            ) : (
              <li key={note.id} data-id={`map-note-${note.id}`} className="group flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-fine uppercase ${
                      note.kind === "exception"
                        ? "border-error/40 bg-error/10 text-error"
                        : "border-hairline bg-surface-alt text-ink-secondary"
                    }`}
                  >
                    {kindLabel(note.kind)}
                  </span>
                  {note.title && <span className="min-w-0 truncate text-caption-strong text-ink">{note.title}</span>}
                  <span className="ml-auto shrink-0 text-fine text-ink-tertiary">
                    {note.source === "consultant-import" ? t("notes.imported") : ""}
                    {note.edited_at ? ` · ${t("notes.edited")}` : ""}
                  </span>
                  {effectiveCanEdit && (
                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        data-id={`map-note-edit-${note.id}`}
                        aria-label={t("notes.edit")}
                        className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                        onClick={() => openEdit(note)}
                      >
                        <Pencil size={12} strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        data-id={`map-note-delete-${note.id}`}
                        aria-label={t("notes.delete")}
                        className="rounded-sm p-0.5 text-ink-tertiary hover:bg-error/10 hover:text-error"
                        onClick={() => setDeleting(note)}
                      >
                        <Trash2 size={12} strokeWidth={1.5} />
                      </button>
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-caption text-ink-secondary">{note.text}</p>
              </li>
            ),
          )}
          {!effectiveCanEdit && (
            <li data-id="map-notes-readonly-hint" className="text-fine text-ink-tertiary">
              {"mapId" in scope ? t("notes.readOnlyMap") : t("notes.readOnlyCategory")}
            </li>
          )}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog
          title={t("notes.deleteTitle")}
          message={deleting.title || deleting.text.slice(0, 80)}
          confirmLabel={t("notes.delete")}
          cancelLabel={t("common.cancel")}
          confirmDisabled={busy}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
