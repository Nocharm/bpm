"use client";

// 로컬(인증 OFF) 임시 로그인 피커 — 백엔드 디렉터리(전 직원)를 조회해 검색·선택.
// 400명 규모 대응: 검색 입력 + 렌더 상한(60). 관리자(role=admin)는 배지 표시.
import { Search, UserRound, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { getDirectory, type DirectoryUser } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const RENDER_LIMIT = 60;

export function DevLoginModal({
  onPick,
  onClose,
}: {
  onPick: (loginId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getDirectory()
      .then((dir) => {
        if (!active) return;
        setUsers(dir.users);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? users.filter(
          (u) =>
            u.name.toLowerCase().includes(q) ||
            u.id.toLowerCase().includes(q) ||
            (u.department ?? "").toLowerCase().includes(q) ||
            (u.org_path ?? "").toLowerCase().includes(q),
        )
      : users;
    return base;
  }, [users, query]);

  const shown = filtered.slice(0, RENDER_LIMIT);

  return createPortal(
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClose={onClose}
    >
      <div
        data-id="dev-login-modal"
        className="flex max-h-[80vh] w-96 flex-col rounded-md bg-surface p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-body-strong text-ink">{t("login.devPick")}</p>
          <button
            type="button"
            aria-label={t("action.close")}
            className="flex h-[26px] w-[26px] items-center justify-center rounded-sm text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>

        {/* 검색 */}
        <div className="flex items-center gap-2 rounded-sm border border-hairline px-2.5 py-1.5">
          <Search size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("login.devSearch")}
            className="min-w-0 flex-1 bg-transparent text-caption text-ink outline-none placeholder:text-ink-tertiary"
          />
        </div>

        <div className="scrollbar-hidden mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {loading ? (
            <p className="p-2 text-caption text-ink-tertiary">…</p>
          ) : shown.length === 0 ? (
            <p className="p-2 text-caption text-ink-tertiary">{t("approval.transferNoResults")}</p>
          ) : (
            shown.map((user) => (
              <button
                key={user.id}
                type="button"
                data-id="dev-user-row"
                className="flex items-center gap-2 rounded-sm border border-hairline bg-surface px-2.5 py-2 text-left hover:border-accent hover:bg-accent-tint"
                onClick={() => onPick(user.id)}
              >
                <UserRound size={16} strokeWidth={1.6} className="shrink-0 text-ink-tertiary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-caption text-ink">
                    {user.name} <span className="text-fine text-ink-muted">({user.id})</span>
                  </span>
                  <span className="block truncate text-fine text-ink-tertiary">
                    {user.department}
                  </span>
                </span>
                {user.role === "admin" && (
                  <span className="shrink-0 rounded-xs border border-accent-tint-border px-1.5 py-px text-fine text-accent">
                    admin
                  </span>
                )}
              </button>
            ))
          )}
          {!loading && filtered.length > shown.length && (
            <p className="p-2 text-fine text-ink-tertiary">
              {t("login.devMore", { n: filtered.length - shown.length })}
            </p>
          )}
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
