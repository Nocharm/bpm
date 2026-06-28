"use client";

// 상단바 맵 이름 드롭다운 — 박스형 트리거 + 드롭다운(검색·최근 맵·새 맵).
// 맵 행은 바로 이동하지 않고 호버/클릭 → 하위메뉴(맵 열기 · 링크노드로 추가) → 확인 모달 순.
// 편집 화면(isEditing)이면 이동 확인 모달에 미저장 손실 안내. 비공개(private) 맵은 목록에서 제외.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronRight, Link2, Network, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { listMaps, type MapSummary } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { VERSION_STATUS_LABEL } from "@/lib/version-status";

interface MapNameDropdownProps {
  mapId: number;
  mapName: string;
  canToRoot: boolean;
  isEditing: boolean;
  onToRoot: () => void;
  onAddLinkNode: (linkedMapId: number, name: string) => void;
}

type Pending = { kind: "open" | "link"; map: MapSummary };

export function MapNameDropdown({
  mapId,
  mapName,
  canToRoot,
  isEditing,
  onToRoot,
  onAddLinkNode,
}: MapNameDropdownProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 열 때 1회 지연 로드 + 검색 포커스. Esc로 닫기.
  useEffect(() => {
    if (!open) return;
    if (maps === null) void listMaps().then(setMaps).catch(() => setMaps([]));
    searchRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, maps]);

  const q = query.trim().toLowerCase();
  // 비공개 맵 제외 + 검색어 필터
  const filtered = (maps ?? []).filter(
    (m) => m.visibility !== "private" && (!q || m.name.toLowerCase().includes(q)),
  );

  function closeAll() {
    setOpen(false);
    setActiveId(null);
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption font-medium text-ink hover:bg-surface-alt"
        onClick={() => setOpen((v) => !v)}
        title={t("editor.mapMenu")}
      >
        <span className="max-w-[16rem] truncate">{mapName}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="text-ink-tertiary" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-[1001] mt-1 w-80 rounded-md border border-hairline bg-surface py-2 shadow-lg">
            <div className="px-2 pb-2">
              <input
                ref={searchRef}
                className="w-full rounded-sm border border-hairline px-2 py-1.5 text-caption"
                placeholder={t("editor.loadOtherMap")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            {canToRoot && (
              <div className="border-b border-divider pb-1">
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                  onClick={() => {
                    closeAll();
                    onToRoot();
                  }}
                >
                  {t("editor.toRoot")}
                </button>
              </div>
            )}

            <div className="px-3 pb-1 pt-2 text-fine text-ink-tertiary">{t("editor.recentMaps")}</div>
            <div className="max-h-72 overflow-auto">
              {filtered.map((m) => {
                const isCurrent = m.id === mapId;
                const subtitle = [
                  m.latest_version_status ? t(VERSION_STATUS_LABEL[m.latest_version_status]) : null,
                  formatKstShort(m.updated_at),
                ]
                  .filter(Boolean)
                  .join(" · ");
                const tile = (
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm ${
                      isCurrent ? "bg-accent-tint text-accent" : "bg-surface-alt text-ink-secondary"
                    }`}
                  >
                    <Network size={16} strokeWidth={1.5} />
                  </span>
                );
                const text = (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption font-medium text-ink">{m.name}</span>
                    <span className="block truncate text-fine text-ink-tertiary">{subtitle}</span>
                  </span>
                );

                // 현재 맵 — 액션 없이 체크만
                if (isCurrent) {
                  return (
                    <div key={m.id} className="flex items-center gap-2.5 bg-accent-tint/40 px-3 py-2">
                      {tile}
                      {text}
                      <Check size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
                    </div>
                  );
                }

                // 다른 맵 — 호버/클릭으로 하위메뉴(맵 열기 · 링크노드 추가) 인라인 펼침.
                // 우측 flyout은 스크롤 컨테이너 overflow에 잘려 인라인 아코디언으로 처리.
                const active = activeId === m.id;
                return (
                  <div key={m.id} onMouseEnter={() => setActiveId(m.id)}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                        active ? "bg-surface-alt" : "hover:bg-surface-alt"
                      }`}
                      onClick={() => setActiveId(m.id)}
                    >
                      {tile}
                      {text}
                      <ChevronRight
                        size={16}
                        strokeWidth={1.5}
                        className={`shrink-0 text-ink-tertiary transition-transform ${active ? "rotate-90" : ""}`}
                      />
                    </button>
                    {active && (
                      <div className="flex flex-col bg-surface-alt/40 pb-1 pl-14 pr-3">
                        <button
                          type="button"
                          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                          onClick={() => {
                            // 편집 중이 아니면 잃을 변경이 없으니 즉시 이동, 편집 중이면 확인 모달
                            if (!isEditing) {
                              closeAll();
                              router.push(`/maps/${m.id}`);
                              return;
                            }
                            setOpen(false);
                            setPending({ kind: "open", map: m });
                          }}
                        >
                          <ArrowRight size={14} strokeWidth={1.5} className="text-ink-tertiary" />
                          {t("editor.mapGo")}
                        </button>
                        {isEditing && (
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                            onClick={() => {
                              setOpen(false);
                              setPending({ kind: "link", map: m });
                            }}
                          >
                            <Link2 size={14} strokeWidth={1.5} className="text-ink-tertiary" />
                            {t("editor.mapAddLink")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {maps !== null && filtered.length === 0 && (
                <div className="px-3 py-2 text-caption text-ink-tertiary">{t("editor.noMapsFound")}</div>
              )}
            </div>

            <div className="mt-1 border-t border-divider pt-1">
              <Link
                href="/"
                className="flex items-center gap-2 px-3 py-1.5 text-caption font-medium text-accent hover:bg-surface-alt"
                onClick={() => setOpen(false)}
              >
                <Plus size={16} strokeWidth={1.5} />
                {t("editor.newMap")}
              </Link>
            </div>
          </div>
        </>
      )}

      {pending?.kind === "open" && (
        <ConfirmDialog
          icon={<ArrowRight size={28} strokeWidth={1.5} />}
          title={t("editor.confirmOpenMapTitle")}
          lines={[
            { icon: <ArrowRight size={14} strokeWidth={1.5} />, text: t("editor.confirmOpenMapBody", { name: pending.map.name }) },
            { icon: <AlertTriangle size={14} strokeWidth={1.5} />, text: t("editor.unsavedNotice"), tone: "error" },
          ]}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const target = pending.map.id;
            setPending(null);
            closeAll();
            router.push(`/maps/${target}`);
          }}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === "link" && (
        <ConfirmDialog
          icon={<Link2 size={28} strokeWidth={1.5} />}
          title={t("editor.confirmAddLinkTitle")}
          lines={[
            { icon: <Link2 size={14} strokeWidth={1.5} />, text: t("editor.confirmAddLinkBody", { name: pending.map.name }) },
          ]}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const { id, name } = pending.map;
            setPending(null);
            closeAll();
            onAddLinkNode(id, name);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
