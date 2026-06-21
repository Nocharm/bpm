"use client";

// 맵 설정 화면 — 권한 관리 탭 셸 / Map settings page: tabbed shell for permission management.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { getMap, getMe, setDevUser } from "@/lib/api";
import { setCurrentUser } from "@/lib/current-user";
import { LOCAL_USERS, storeDevUser } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";
import { useCurrentMockUser } from "@/lib/mock/current-mock-user";
import { isApprover, usePermissions } from "@/lib/mock/permissions";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { CollaboratorsPanel } from "@/components/permissions/collaborators-panel";
import { ApproversPanel } from "@/components/permissions/approvers-panel";
import { VisibilityControl } from "@/components/permissions/visibility-control";
import { DangerZone } from "@/components/permissions/danger-zone";
import { VersionsPublishPanel } from "@/components/permissions/versions-publish-panel";
import { PendingApprovalsPanel } from "@/components/permissions/pending-approvals-panel";
import { genId } from "@/lib/id";

// ── 탭 정의 / Tab definitions ────────────────────────────────────

type TabId = "collaborators" | "approvers" | "visibility" | "versions" | "danger" | "approvals";

interface Tab {
  id: TabId;
  labelKey: "perm.tabCollaborators" | "perm.tabApprovers" | "perm.tabVisibility" | "perm.tabVersions" | "perm.tabDanger" | "perm.tabPendingApprovals";
}

// 전체 탭 목록 — approvals는 조건부 노출로 별도 처리 /
// Full tab list — approvals is shown conditionally, filtered at render.
const ALL_TABS: Tab[] = [
  { id: "collaborators", labelKey: "perm.tabCollaborators" },
  { id: "approvers", labelKey: "perm.tabApprovers" },
  { id: "visibility", labelKey: "perm.tabVisibility" },
  { id: "versions", labelKey: "perm.tabVersions" },
  { id: "danger", labelKey: "perm.tabDanger" },
  { id: "approvals", labelKey: "perm.tabPendingApprovals" },
];

// ── 메인 페이지 컴포넌트 / Main page component ────────────────────

export default function SettingsPage() {
  const params = useParams<{ mapId: string }>();
  const mapIdStr = params.mapId;
  const { t } = useI18n();

  // 맵 이름 + 서버 산정 역할(my_role) — 실패 시 id 표시 / Map name + server my_role; fall back to id.
  const [mapName, setMapName] = useState<string>(mapIdStr);
  const [serverRole, setServerRole] = useState<"viewer" | "editor" | "owner" | null>(null);
  // 서버 진실 가시성 — Visibility 화면·viewerGrantDisabled 단일 소스 / Server-truth visibility.
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  // 역할 로드 완료 여부 — 로드 전 false "No access" 깜빡임 방지 / gate no-access screen until loaded.
  const [roleLoaded, setRoleLoaded] = useState(false);

  // 맵 데이터 재조회 — 결재 승인 후 역할/가시성이 바뀌었을 수 있어 재호출(서버 진실) /
  // Refetch map data; role/visibility may have changed after an approval was applied server-side.
  const refreshMap = useCallback(async () => {
    try {
      const detail = await getMap(Number(mapIdStr));
      setMapName(detail.name);
      setServerRole(detail.my_role);
      setVisibility(detail.visibility);
    } catch {
      // 조회 실패(403/네트워크) → 역할 null 유지 → 아래 no-access 화면 / Keep id+null role on failure.
    }
  }, [mapIdStr]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (active) setRoleLoaded(false);
      try {
        const detail = await getMap(Number(mapIdStr));
        if (active) {
          setMapName(detail.name);
          setServerRole(detail.my_role);
          setVisibility(detail.visibility);
        }
      } catch {
        // 조회 실패(403/네트워크) → 역할 null 유지 → 아래 no-access 화면 / Keep id+null role on failure.
      } finally {
        if (active) setRoleLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [mapIdStr]);

  // 탭 상태 / Active tab state.
  const [activeTab, setActiveTab] = useState<TabId>("collaborators");

  // 토스트 상태 / Toast state.
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  function showToast(message: string) {
    setToasts((prev) => [{ id: genId(), message }, ...prev]);
  }
  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // Dev 유저 전환 모달 / Dev user switcher state.
  const [showDevSwitcher, setShowDevSwitcher] = useState(false);

  // 현재 mock 유저 + 권한 상태 / Current mock user and permission state.
  const currentMockUser = useCurrentMockUser();
  const permState = usePermissions();

  // 유효 역할 — 서버 산정 my_role 단일 소스(클라 재계산 폐기), sysadmin은 owner /
  // Effective role from server my_role (no client recompute); sysadmin = owner.
  const effectiveRole = currentMockUser
    ? currentMockUser.isSysadmin
      ? "owner"
      : serverRole
    : null;

  // editor 이상 여부 / Whether current user is editor+.
  const canEdit =
    effectiveRole === "editor" ||
    effectiveRole === "owner";

  // 소유자 여부 — Approvers/Visibility/Danger는 소유자 전용 /
  // Owner-only: Approvers, Visibility, Danger tabs gated to owner.
  const isOwner = effectiveRole === "owner";

  // 공개 맵이면 viewer 그랜트 비활성 — 서버 진실 가시성 기준 /
  // Disable viewer grants on public maps (from server-truth visibility).
  const isPublic = visibility === "public";

  // 결재 대기 탭 가시성 — 맵 승인자 또는 sysadmin만 표시 /
  // Pending approvals tab: visible only to map approvers or sysadmin.
  const canDecide =
    currentMockUser !== null &&
    (currentMockUser.isSysadmin || isApprover(permState, currentMockUser.id, mapIdStr));

  // 현재 유저에 맞게 탭 목록 필터 / Filter tabs for current user.
  const visibleTabs = ALL_TABS.filter((tab) => tab.id !== "approvals" || canDecide);

  // ── Dev 유저 전환 핸들러 / Dev user switch handler ────────────────

  // dev 전환은 서버(/api/me)를 다시 거쳐 현재 유저를 발행 — 신원·is_sysadmin 단일 소스 /
  // Dev switch re-fetches /api/me so the current user (incl. isSysadmin) stays server-sourced.
  async function handlePickDevUser(loginId: string) {
    storeDevUser(loginId);
    setDevUser(loginId);
    try {
      const me = await getMe();
      setCurrentUser({
        loginId: me.username,
        name: me.name || me.username,
        email: null,
        role: me.role,
        department: me.department,
        isSysadmin: me.is_sysadmin,
      });
    } catch {
      setCurrentUser(null);
    }
    setShowDevSwitcher(false);
  }

  // ── 렌더 / Render ─────────────────────────────────────────────

  // 접근 권한 없음 — sysadmin이 아니고 서버 역할 로드 완료 후 null일 때만 / No access (after role load).
  if (currentMockUser && !currentMockUser.isSysadmin && roleLoaded && effectiveRole === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-caption text-ink-tertiary">{t("perm.noAccess")}</p>
        <Link href={`/maps/${mapIdStr}`} className="text-caption text-accent hover:underline">
          {t("perm.backToEditor")}
        </Link>
      </div>
    );
  }

  return (
    <>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Dev 유저 전환 드롭다운 / Dev user switcher dropdown (inline, no new modal) */}
      {showDevSwitcher && (
        <div
          className="fixed inset-0 z-[1100]"
          onClick={() => setShowDevSwitcher(false)}
        >
          <div
            className="absolute right-4 top-14 w-72 rounded-md border border-hairline bg-surface p-3 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-caption-strong text-ink">{t("perm.devSwitcher")}</p>
            <div className="flex flex-col gap-1">
              {LOCAL_USERS.map((user) => (
                <button
                  key={user.loginId}
                  type="button"
                  className="flex items-center justify-between rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
                  onClick={() => void handlePickDevUser(user.loginId)}
                >
                  <span>
                    {user.name}{" "}
                    <span className="text-ink-tertiary">({user.loginId})</span>
                  </span>
                  <span className="text-fine text-ink-tertiary">
                    {user.department}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex h-full flex-col">
        {/* 헤더 / Header */}
        <header className="flex flex-wrap items-center gap-4 border-b border-hairline px-4 py-2">
          <Link href={`/maps/${mapIdStr}`} className="text-caption text-accent hover:underline">
            {t("perm.backToEditor")}
          </Link>
          <h1 className="text-tagline font-medium text-ink">
            {mapName} — {t("perm.settingsTitle")}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {/* 현재 mock 유저 표시 / Show current mock user */}
            {currentMockUser && (
              <span className="text-fine text-ink-tertiary">
                {currentMockUser.name} · {effectiveRole ?? "—"}
              </span>
            )}
            {/* [Dev] 유저 전환 버튼 / [Dev] switcher button */}
            <button
              type="button"
              className="rounded-sm border border-hairline px-2 py-0.5 text-fine text-ink-tertiary hover:bg-surface-alt"
              onClick={() => setShowDevSwitcher((v) => !v)}
            >
              {t("perm.devSwitcher")}
            </button>
          </div>
        </header>

        {/* 읽기 전용 알림 / Read-only notice */}
        {effectiveRole === "viewer" && (
          <div className="border-b border-hairline bg-surface-pearl px-4 py-2 text-caption text-ink-secondary">
            {t("perm.readOnly")}
          </div>
        )}

        {/* 탭 네비게이션 / Tab navigation */}
        <nav className="flex border-b border-hairline px-4">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`px-4 py-2.5 text-caption transition-colors ${
                activeTab === tab.id
                  ? "border-b-2 border-accent text-accent"
                  : "text-ink-tertiary hover:text-ink"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>

        {/* 탭 콘텐츠 / Tab content */}
        <main className="flex-1 overflow-y-auto px-4 py-4">
          {!currentMockUser ? (
            // 유저 로드 전 / Before user resolves.
            <p className="text-caption text-ink-tertiary">…</p>
          ) : activeTab === "collaborators" ? (
            <CollaboratorsPanel
              mapId={mapIdStr}
              currentUserId={currentMockUser.id}
              canEdit={canEdit}
              onToast={showToast}
              viewerGrantDisabled={isPublic}
            />
          ) : activeTab === "approvers" ? (
            <ApproversPanel
              mapId={mapIdStr}
              isOwner={isOwner}
              onToast={showToast}
            />
          ) : activeTab === "visibility" ? (
            <VisibilityControl
              mapId={mapIdStr}
              visibility={visibility}
              isOwner={isOwner}
              onToast={showToast}
            />
          ) : activeTab === "versions" ? (
            <VersionsPublishPanel
              mapId={mapIdStr}
              currentUserId={currentMockUser.id}
              canEdit={canEdit}
              onToast={showToast}
            />
          ) : activeTab === "danger" && isOwner ? (
            <DangerZone
              mapId={mapIdStr}
              currentUserId={currentMockUser.id}
              onToast={showToast}
            />
          ) : activeTab === "danger" ? (
            // 위험 구역은 소유자 전용 — 비소유자에게 숨김 /
            // Danger zone is owner-only; hidden for non-owners.
            <p className="py-4 text-caption text-ink-tertiary">{t("perm.dangerReadOnly")}</p>
          ) : activeTab === "approvals" && canDecide ? (
            // 결재 대기 — 승인자·sysadmin 전용 / Pending approvals (approver or sysadmin only).
            // 결정 후 맵 데이터(역할/가시성) 재조회 — 서버가 적용했으므로 협업자/공개범위 탭의 진실 갱신.
            <PendingApprovalsPanel
              mapId={mapIdStr}
              onDecided={() => void refreshMap()}
              onToast={(item) => showToast(item.message)}
            />
          ) : null}
        </main>
      </div>
    </>
  );
}
