"use client";

// 선택된 맵 상세 — 가시성·역할·버전(승인 상태)·허용 인원. 홈 우측 패널 + 에디터 인스펙터 빈 상태 공용 /
// Map detail: visibility, role, versions (approval status), allowed members.
// 데이터는 getMap(+editor+면 listMapPermissions/listGroups). 선택 변경 시 key로 remount.

import Link from "next/link";
import { Fragment, type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowUpRight,
  Building,
  Building2,
  Copy,
  Crown,
  Eye,
  Globe,
  Hand,
  Hourglass,
  House,
  Landmark,
  Loader2,
  Lock,
  Network,
  PencilLine,
  Puzzle,
  RotateCcw,
  Settings,
  Trash2,
  TriangleAlert,
  User,
  Users,
  UsersRound,
  X,
  Zap,
} from "lucide-react";

import {
  getDirectory,
  getMap,
  listGroups,
  listMapPermissions,
  withdrawApprovalRequest,
  type DirectoryDept,
  type DirectoryUser,
  type Group,
  type MapDetail,
  type MapPermission,
  type PrincipalType,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { DeleteMapDialog } from "@/components/maps/delete-map-dialog";
import { FrameworkAssignModal } from "@/components/maps/framework-assign-modal";
import { VersionTimeline } from "@/components/maps/version-timeline";
import { AddCollaborator } from "@/components/permissions/add-collaborator";
import { HoverSwapPill } from "@/components/permissions/hover-swap-pill";
import { RoleBadge } from "@/components/permissions/role-badge";
import { UndoLastApplyModal } from "@/components/permissions/undo-last-apply-modal";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import {
  buildKoreanDeptByPath,
  buildOrgPathChain,
  formatDeptName,
  formatTitleWithPosition,
} from "@/lib/korean-dept";
import type { MapRole } from "@/lib/mock/permissions";
import {
  applyStagedOps,
  forecastStagedOp,
  removeStagedOp,
  upsertStagedOp,
  type AppliedOpRecord,
  type StagedOp,
} from "@/lib/permission-staging";
import { buildUndoPlan, executeUndoPlan } from "@/lib/permission-undo";
import { formatDocStamp, needsRegenerate } from "@/lib/word-map-home";

// 역할 정렬 순위 — 허용 인원 행을 owner→editor→viewer 클러스터로 (batch2 ④)
const ROLE_ORDER: Record<string, number> = { owner: 0, editor: 1, viewer: 2 };

// 역할/Remove 필 고정폭 — Owner/Editor/Viewer/Remove(EN 기준 최장, Pretendard text-fine 12px 실측
// 57.2px)에 여유를 둔 값. RoleBadge와 Remove/staged 필이 전부 이 폭을 공유해야 hover 스왑 시
// 크기가 바뀌지 않는다(governance-r5 V1, R5-1). pending 배지는 문구가 길어 예외(콘텐츠 폭 유지).
const ROLE_PILL_WIDTH_CLASS = "w-[60px] inline-flex items-center justify-center text-center whitespace-nowrap";

// 개인(user) 그룹 1차 클램프 — 3.3행만 보이고 나머지는 내부 스크롤(전체 펼치기 버튼으로 해제, W3).
// 행 높이 50px = 아이콘 h-9(36px, 텍스트 2줄보다 큰 지배 요소) + py-1.5(12px) + border(2px) 실측 합산,
// 행 간격 4px(gap-1). 3.3행 = 3행 온전 + 4행째 살짝 잘림("더 있음" 암시, 홈 3.5클램프 선례와 동일 의도).
const MEMBERS_ROW_HEIGHT_PX = 50;
const MEMBERS_CLAMP_MAX_HEIGHT_PX = MEMBERS_ROW_HEIGHT_PX * 3.3 + 4 * 3;
// 클램프 발동 임계 — 이 개수 이하면 클램프도 버튼도 없다(홈 ClampedList와 동일 규칙).
const MEMBERS_CLAMP_VISIBLE = 3;

// 멤버 그룹 표시 순서 — 개인 → 팀 → 유저 그룹 / member group order: individuals, teams, user groups.
const MEMBER_GROUPS: { type: string; labelKey: MessageKey }[] = [
  { type: "user", labelKey: "home.memberUser" },
  { type: "department", labelKey: "home.memberDept" },
  { type: "group", labelKey: "home.memberGroup" },
];

// 부서 org_path("A/B/C")의 말단 세그먼트만 / leaf segment of a dept org_path (HM-3).
function deptLeaf(orgPath: string): string {
  const parts = orgPath.split("/");
  return parts[parts.length - 1] || orgPath;
}

// 조직 레벨 순위(낮을수록 위): 센터 > 담당(Department) > 팀 > 그룹 > 파트. 이름 접미사로 판별(KO/EN). (HM-3)
function deptLevelRank(leaf: string): number {
  const s = leaf.toLowerCase();
  if (s.includes("센터") || s.includes("center")) return 0;
  if (s.includes("팀") || s.includes("team")) return 2;
  if (s.includes("그룹") || s.includes("group")) return 3;
  if (s.includes("파트") || s.includes("part")) return 4;
  return 1; // 담당(Department) / 그 외 기본
}

// 조직 레벨별 아이콘 — 센터/담당/팀/그룹/파트 (deptLevelRank 순서) (HM)
const LEVEL_ICONS = [Landmark, Building2, Building, House, Puzzle];

// 멤버 행 아이콘 — 부서는 레벨별, 그룹은 UsersRound, 유저는 User(본인이면 'me' 배지) (HM)
// 접힌 카드 2줄 높이 기준 확대(22px) — 컨테이너가 세로 중앙 정렬 (member-card design 2026-07-09)
function MemberIcon({ perm, isMe }: { perm: MapPermission; isMe: boolean }) {
  if (perm.principal_type === "user") {
    if (isMe) {
      // 본인 — 손든 사람 아이콘 + 작은 ME, 악센트 선색으로 강조
      return (
        <span
          data-id="member-me-badge"
          title="me"
          className="inline-flex shrink-0 flex-col items-center text-accent"
        >
          <Hand size={20} strokeWidth={2} />
          <span className="text-[9px] font-bold leading-none">ME</span>
        </span>
      );
    }
    return <User size={22} strokeWidth={1.5} />;
  }
  if (perm.principal_type === "group") return <UsersRound size={22} strokeWidth={1.5} />;
  const Icon = LEVEL_ICONS[deptLevelRank(deptLeaf(perm.principal_id))] ?? Building2;
  return <Icon size={22} strokeWidth={1.5} />;
}

// 멤버 컬럼 고스트 — 권한·디렉터리·그룹 로딩 동안 우측 컬럼 폭을 미리 차지해,
// 버전 프레임이 전체 폭으로 나왔다가 줄어드는 리플로우를 방지. 실제 멤버 행(아이콘·2줄·역할 배지) 치수 모사.
function MembersSkeleton() {
  return (
    <div aria-hidden className="flex animate-pulse flex-col gap-1" data-id="map-detail-members-ghost">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-2 rounded-sm border border-hairline bg-surface py-1.5 pl-1.5 pr-2.5"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="h-9 w-9 shrink-0 rounded-full bg-surface-alt" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="h-3 w-3/5 rounded-xs bg-surface-alt" />
              <span className="h-2.5 w-2/5 rounded-xs bg-surface-alt" />
            </span>
          </span>
          <span className="h-4 w-12 shrink-0 rounded-sm bg-surface-alt" />
        </div>
      ))}
    </div>
  );
}

interface MapDetailCardProps {
  mapId: number;
  // 하단 버튼바(열기·설정·삭제) 표시 — 홈=true, 에디터 인스펙터=false / footer toggle.
  showFooter?: boolean;
  onDelete?: (mapId: number) => void;
  // 승인본 복사 — 홈이 이름 입력 모달·생성·강조를 처리 (F12). 없으면 복사 버튼 미노출.
  onCopy?: (mapId: number, name: string) => void;
  // word 맵 승격 진입 — 홈이 승격 다이얼로그를 처리(design 2026-07-24 §6). 없으면 버튼 미노출.
  onPromote?: (mapId: number, name: string) => void;
  // 일부 섹션만 렌더 — 에디터 맵 탭=멤버 카드, 활동 탭=버전 타임라인 재사용 / render only members or versions.
  only?: "members" | "versions";
  // 값이 바뀌면 재조회 — 승인 단계 진행 시 버전 기록 실시간 갱신용 / bump to refetch (live version record).
  reloadKey?: number;
  // 버전 타임라인 "이 버전으로 가기" — 에디터에서 switchVersion 연결. 없으면 버튼 미노출.
  onGoToVersion?: (id: number) => void;
  // 현재 보고 있는 버전 — 그 카드엔 "이 버전으로 가기" 숨김.
  currentVersionId?: number | null;
  // 카테고리 연결/해제/이양 성공 알림 — 홈 FrameworkTree 캐시 무효화용(page.tsx만 전달, fix round 1 #1).
  onFrameworkChanged?: () => void;
}

export function MapDetailCard({
  mapId,
  showFooter = true,
  onDelete,
  onCopy,
  onPromote,
  only,
  reloadKey,
  onGoToVersion,
  onFrameworkChanged,
  currentVersionId,
}: MapDetailCardProps) {
  const { t, lang } = useI18n();
  const me = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const loginId = me?.loginId ?? null;
  const orgPath = me?.orgPath ?? "";
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 허용 인원 — 접근 권한자(viewer+)면 조회. 서버 GET /permissions 게이트도 viewer+ (B1) / members for any role with access.
  const [members, setMembers] = useState<MapPermission[] | null>(null);
  // 멤버 섹션 상태 — loading(고스트 표시)/ready/hidden(권한 없음·첫 조회 실패). 재조회(reloadKey) 중엔 기존 값 유지.
  const [membersStatus, setMembersStatus] = useState<"loading" | "ready" | "hidden">("loading");
  // 내가 속한 그룹 id(문자열) — 멤버 하이라이트용 / my group ids for the "mine" highlight.
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());
  // loginId → 표시명 — 멤버(유저) 행을 "이름(아이디)"로 보여주기 위함 (#5)
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  // loginId → 한글이름 — 언어 토글 표시용(없으면 영문 폴백) (member-card design 2026-07-09)
  const [koreanNameById, setKoreanNameById] = useState<Map<string, string>>(new Map());
  // 그룹 id → 그룹 이름 — 그룹 카드가 id를 그대로 노출하던 누락 수정
  const [groupNameById, setGroupNameById] = useState<Map<string, string>>(new Map());
  // 디렉터리 파생 — 멤버 2번째 줄(유저 직급·말단org, 부서 카운트) (H2) / directory-derived maps for the 2nd line.
  const [titleById, setTitleById] = useState<Map<string, string>>(new Map());
  const [orgPathById, setOrgPathById] = useState<Map<string, string>>(new Map());
  // org_path → 확정 한글 부서명(dept_info) — 이름과 같은 규칙으로 부서도 언어 토글 (없으면 영문 폴백)
  const [koreanDeptByPath, setKoreanDeptByPath] = useState<Map<string, string>>(new Map());
  // 그룹 id → {구성원수, 상태} — 그룹 멤버 2번째 줄 (H2) / group id → {count, status}.
  const [groupInfo, setGroupInfo] = useState<Map<string, { count: number; status: string }>>(new Map());
  // 호버한 부서(팀)의 org_path — 상위/하위 팀 하이라이트 + 상위 소속 노출 (H2) / hovered dept path.
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  // 삭제 확인 다이얼로그 표시 여부 / delete confirm dialog visibility.
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 카테고리 연결/이양 모달 표시 여부 (Phase 2) / framework assign modal visibility.
  const [frameworkModalOpen, setFrameworkModalOpen] = useState(false);
  // 모달 성공 시 내부 재조회 트리거 — 부모의 reloadKey 없이도 detail을 최신화 (기존 reloadKey 패턴과 동일 기법).
  const [localReloadKey, setLocalReloadKey] = useState(0);
  // B: 카드 내 멤버 추가 피커용 raw 디렉터리/그룹 (파생 Map과 별도 보존)
  const [dirUsersRaw, setDirUsersRaw] = useState<DirectoryUser[]>([]);
  const [dirDeptsRaw, setDirDeptsRaw] = useState<DirectoryDept[]>([]);
  const [groupsRaw, setGroupsRaw] = useState<Group[]>([]);
  // 편집 스택 — 화면에 쌓인 add/remove, Save 전까지 서버에 반영되지 않는다(R2 QA 피드백, 협업자 패널과 대칭).
  const [stagedOps, setStagedOps] = useState<StagedOp[]>([]);
  const [savingStaged, setSavingStaged] = useState(false);
  // 스택 저장 부분 실패 — 배너 채널(카드 전체를 죽이는 fatal error와 분리, 최종 리뷰 픽스 아래 참고).
  const [stagedSaveError, setStagedSaveError] = useState<string | null>(null);
  // 방금 적립된 add op — 해당 고스트 행에 플래시 강조. 1.2s 후 자연 소멸 (R2 QA 피드백).
  const [lastAddedKey, setLastAddedKey] = useState<string | null>(null);
  // 되돌리기 — 직전 저장 1회분 records. 메모리만(페이지 이탈 시 소멸, 영속 안 함) — 패널과 대칭.
  const [lastApply, setLastApply] = useState<AppliedOpRecord[] | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  // 펼친 버전·멤버 — 클릭 토글, 여러 개 동시 / expanded version & member ids (click-toggle).
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
  // 개인(user) 그룹 3.3행 클램프 해제 여부 — 컴포넌트 state만, 영속 불요(W3).
  const [membersUserExpanded, setMembersUserExpanded] = useState(false);
  const toggleVersion = (id: number) =>
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleMember = (id: string) =>
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const collapseVersions = () => setExpandedVersions(new Set());
  const collapseMembers = () => setExpandedMembers(new Set());

  // 멤버 제거/추가는 즉시 API를 부르지 않고 스택에 적립만 — Save에서 일괄 실행 (trivial setState라 plain
  // function으로: React Compiler가 useCallback 수동 deps와 어긋나면 빌드가 깨진다, frontend/AGENTS.md).
  function handleRemoveMember(perm: MapPermission) {
    setStagedOps((ops) => upsertStagedOp(ops, { kind: "remove", permissionId: perm.id }));
  }

  function handleAddMember(principalType: PrincipalType, principalId: string, role: "viewer" | "editor") {
    setStagedOps((ops) => upsertStagedOp(ops, { kind: "add", principalType, principalId, role }));
    setLastAddedKey(`${principalType}:${principalId}`);
    window.setTimeout(() => setLastAddedKey(null), 1200); // 플래시 애니메이션 후 리셋(재추가 시 재발화)
  }

  function handleCancelStaged(op: StagedOp) {
    setStagedOps((ops) => removeStagedOp(ops, op));
  }

  // 본인이 낸 승인 대기 요청 회수 — 서버 마커(pending_change)를 직접 지우므로 저장 핸들러와 동일한
  // 재조회 경로(localReloadKey)로 반영. 카드엔 onToast가 없어 에러는 기존 stagedSaveError 배너로.
  async function handleWithdrawPending(perm: MapPermission) {
    if (!perm.pending_change) return;
    try {
      await withdrawApprovalRequest(perm.pending_change.request_id);
      setLocalReloadKey((k) => k + 1);
    } catch (err) {
      setStagedSaveError(humanizeApiError(err, t));
    }
  }

  // 방금 적립된 고스트 행을 화면 안으로 — 페이지 이탈 없이 "nearest"만 사용.
  useEffect(() => {
    if (!lastAddedKey) return;
    document.querySelector(`[data-id="staged-add-${lastAddedKey}"]`)?.scrollIntoView({ block: "nearest" });
  }, [lastAddedKey]);

  // Save — 스택을 일괄 실행. 실패가 있을 때만 배너로 표시(fatal error state와는 별도 채널) — 부분 실패는
  // 이 브랜치가 의도적으로 만드는 정상 플로우 결과(R1 상호배제 409, 강등 승인대기 409)라 카드 전체를 죽이면
  // 안 되고 복구 가능해야 한다(최종 리뷰 픽스). 성공/승인대기는 재조회(reload)의 최신 목록·pending 배지로 이미 반영된다.
  async function handleSaveStaged() {
    setStagedSaveError(null);
    setSavingStaged(true);
    try {
      const result = await applyStagedOps(mapId, stagedOps, new Map((members ?? []).map((m) => [m.id, m])));
      if (result.failed.length > 0) {
        const summary = t("perm.staged.result", {
          applied: result.applied,
          pending: result.pending,
          failed: result.failed.length,
        });
        const failureText = result.failed.map((f) => humanizeApiError(f.message, t)).join(" · ");
        setStagedSaveError(`${summary} — ${failureText}`);
      }
      const kept = result.records.filter((r) => r.outcome !== "failed");
      setLastApply(kept.length > 0 ? kept : null);
      setStagedOps([]);
      setLocalReloadKey((k) => k + 1);
    } finally {
      setSavingStaged(false);
    }
  }

  function handleCancelAllStaged() {
    setStagedOps([]); // 저장 안 하면 작업 취소 — 서버 호출 없이 스택만 비움
  }

  useEffect(() => {
    let active = true;
    void getMap(mapId)
      .then(async (d) => {
        if (!active) return;
        setDetail(d);
        if (d.my_role !== null) {
          try {
            const [perms, groups, dir] = await Promise.all([
              listMapPermissions(mapId),
              listGroups(),
              getDirectory(),
            ]);
            if (!active) return;
            setMembers(perms);
            setMembersStatus("ready");
            setDirUsersRaw(dir.users);
            setDirDeptsRaw(dir.departments);
            setGroupsRaw(groups);
            setNameById(new Map(dir.users.map((u) => [u.id, u.name])));
            setKoreanNameById(new Map(dir.users.map((u) => [u.id, u.korean_name ?? ""])));
            setTitleById(
              new Map(dir.users.map((u) => [u.id, formatTitleWithPosition(u.title ?? "", u.position ?? "")])),
            );
            setOrgPathById(new Map(dir.users.map((u) => [u.id, u.org_path ?? ""])));
            setKoreanDeptByPath(buildKoreanDeptByPath(dir.departments, dir.users));
            setGroupInfo(
              new Map(groups.map((g) => [String(g.id), { count: g.members.length, status: g.status }])),
            );
            setGroupNameById(new Map(groups.map((g) => [String(g.id), g.name])));
            if (loginId) {
              setMyGroupIds(
                new Set(
                  groups
                    .filter((g) =>
                      g.members.some((m) => m.member_type === "user" && m.member_id === loginId),
                    )
                    .map((g) => String(g.id)),
                ),
              );
            }
          } catch {
            // 멤버/그룹 조회 실패 — 첫 로딩이면 섹션 숨김, 재조회면 기존 값 유지 / hide on first load only.
            setMembersStatus((s) => (s === "ready" ? s : "hidden"));
          }
        } else {
          setMembersStatus("hidden");
        }
      })
      .catch((err) => {
        if (active) setError(humanizeApiError(err, t));
      });
    return () => {
      active = false;
    };
  }, [mapId, loginId, reloadKey, localReloadKey, t]);

  if (error) {
    return <p className="p-4 text-caption text-error">{error}</p>;
  }
  if (!detail) {
    // 첫 로딩 — '…' 텍스트 대신 박스 중앙 스피너 + 라벨
    return (
      <div
        data-id="map-detail-loading"
        className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-4"
      >
        <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-ink-tertiary" />
        <span className="text-caption text-ink-tertiary">{t("common.loading")}</span>
      </div>
    );
  }

  const isOwner = detail.my_role === "owner";
  // 오우닝 부서 org_path — 멤버 컬럼에 협업 부서 행처럼 노출(인스펙터/상세 공용). const라 클로저 내 narrowing 유지.
  const owningDeptPath = detail.owning_department;
  // 멤버 추가/제거 편집 게이트 — 백엔드 기준 editor+ (sysadmin은 서버 my_role이 owner로 해석됨)
  const canManageMembers =
    detail !== null && (detail.my_role === "editor" || detail.my_role === "owner");

  // 편집 스택 파생 — 추가 예정 목록 + permissionId별 remove 예정 조회(협업자 패널과 동일 규칙, C4).
  const stagedAdds = stagedOps.filter((op): op is StagedOp & { kind: "add" } => op.kind === "add");
  const stagedRemoveIds = new Set(
    stagedOps.filter((op): op is StagedOp & { kind: "remove" } => op.kind === "remove").map((op) => op.permissionId),
  );

  // 나의 소속(직접 user / 내 그룹 / 내 부서) 여부 — 하이라이트 / is this grant "mine"?
  // 부서: org_path 정확일치 또는 prefix("…/") 경계 (belongs_to_department 규약, HM-2).
  const isMine = (perm: MapPermission): boolean =>
    (perm.principal_type === "user" && perm.principal_id === loginId) ||
    (perm.principal_type === "group" && myGroupIds.has(perm.principal_id)) ||
    (perm.principal_type === "department" &&
      orgPath !== "" &&
      (orgPath === perm.principal_id || orgPath.startsWith(`${perm.principal_id}/`)));

  // 오너 행 — 오우닝 부서 블록 바로 아래 별도 섹션으로 노출(R2 QA 피드백). user 그룹 루프에서는 제외된다.
  const ownerRows = members?.filter((m) => m.principal_type === "user" && m.role === "owner") ?? [];

  // 되돌리기 모달의 이름 해석 — 스택 추가행(위 stagedAdds 렌더)과 동일 소스(nameById/groupNameById/formatDeptName).
  function resolveUndoName(type: PrincipalType, id: string): string {
    if (type === "user") return nameById.get(id) ?? id;
    if (type === "group") return groupNameById.get(id) ?? id;
    return formatDeptName(id, lang, koreanDeptByPath);
  }

  // 직전 저장 1회분의 역방향을 실행 — 카드엔 onToast가 없어 성공 표기는 저장 핸들러와 동일하게
  // 실패시에만 stagedSaveError 배너로(성공/승인대기는 재조회 반영만, 저장 결과 표기와 일관되게).
  async function handleUndoConfirm() {
    if (!lastApply) return;
    setUndoBusy(true);
    try {
      const summary = await executeUndoPlan(mapId, buildUndoPlan(lastApply, isOwner));
      if (summary.failed.length > 0) {
        const text = t("perm.undo.result", {
          done: summary.done,
          pending: summary.pending,
          failed: summary.failed.length,
        });
        const failureText = summary.failed.map((f) => humanizeApiError(f.message, t)).join(" · ");
        setStagedSaveError(`${text} — ${failureText}`);
      }
      setLastApply(null); // 1회성 — 재저장 전까지 Undo 불가
      setUndoOpen(false);
      setLocalReloadKey((k) => k + 1);
    } finally {
      setUndoBusy(false);
    }
  }

  // 멤버 행 렌더 — user/department/group 그룹 루프와 오너 섹션이 공유하는 단일 경로 (중복 최소화).
  // owner 행도 이 경로를 타지만 canManageMembers && perm.role !== "owner" 가드가 편집 어포던스(X 버튼)만
  // 자연히 걸러낸다 — owner-row 보호 불변식(B/R4)은 별도 분기 없이 유지된다.
  function renderMemberRow(perm: MapPermission, showRoleBoundary: boolean) {
    // 호버한 팀의 상위/하위 팀이면 하이라이트 (멤버수 중복 인지) (H2)
    const related =
      hoveredPath !== null &&
      perm.principal_type === "department" &&
      perm.principal_id !== hoveredPath &&
      (hoveredPath.startsWith(`${perm.principal_id}/`) ||
        perm.principal_id.startsWith(`${hoveredPath}/`));
    // 유저 펼침 — 클릭 토글(여러 개 동시) (H2c)
    const memberOpen = perm.principal_type === "user" && expandedMembers.has(perm.principal_id);
    // 행 내용 — 유저=이름/부서(클릭 시 아이디·타이틀·부서레벨 펼침) · 부서=말단/구성원수(호버 시 상위) · 그룹=id/구성원수·상태 (H2c)
    let nameLine: ReactNode;
    let restNode: ReactNode = null;
    if (perm.principal_type === "user") {
      const enName = nameById.get(perm.principal_id) ?? perm.principal_id;
      const krName = koreanNameById.get(perm.principal_id) ?? "";
      // 언어 토글: ko=한글(없으면 영문), en=영문. 반대 언어는 펼침 필로.
      nameLine = lang === "ko" ? krName || enName : enName;
      const altName = lang === "ko" ? (krName ? enName : "") : krName;
      const path = orgPathById.get(perm.principal_id) ?? "";
      const title = titleById.get(perm.principal_id) ?? "";
      const levelPaths = buildOrgPathChain(path).reverse(); // 작은→큰 / leaf→root
      restNode = (
        <>
          {/* 평소: 말단 부서 (펼치면 숨김) */}
          {path && !memberOpen && (
            <span className="block truncate text-fine text-ink-tertiary">
              {formatDeptName(path, lang, koreanDeptByPath)}
            </span>
          )}
          {/* 펼침: 아이디·타이틀·부서 레벨(작은→큰)을 필로 — 괄호 없이 (H2c) */}
          <span
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
              memberOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <span className="overflow-hidden">
              {/* 아이디·타이틀·부서 레벨을 각 1행씩 — 배경 투명, 테두리는 하이라이트(me) 행에서도 보이게 divider (H2c) */}
              <span className="mt-1 flex flex-col items-start gap-1">
                {altName && (
                  <span
                    data-id="member-alt-name"
                    className="rounded-xs border border-ink-tertiary/40 px-1.5 py-0.5 text-fine text-ink-secondary"
                  >
                    {altName}
                  </span>
                )}
                <span className="rounded-xs border border-ink-tertiary/40 px-1.5 py-0.5 text-fine text-ink-secondary">
                  {perm.principal_id}
                </span>
                {title && (
                  <span className="rounded-xs border border-accent-tint-border px-1.5 py-0.5 text-fine text-accent">
                    {title}
                  </span>
                )}
                {levelPaths.map((lv) => (
                  <span
                    key={lv}
                    className="rounded-xs border border-ink-tertiary/40 px-1.5 py-0.5 text-fine text-ink-tertiary"
                  >
                    {formatDeptName(lv, lang, koreanDeptByPath)}
                  </span>
                ))}
              </span>
            </span>
          </span>
        </>
      );
    } else if (perm.principal_type === "group") {
      nameLine = groupNameById.get(perm.principal_id) ?? perm.principal_id;
      const g = groupInfo.get(perm.principal_id);
      if (g) {
        const status = t(
          g.status === "pending"
            ? "home.groupPending"
            : g.status === "rejected"
              ? "home.groupRejected"
              : "home.groupActive",
        );
        restNode = (
          <span className="flex min-w-0 items-center gap-1 text-fine text-ink-tertiary">
            <Users size={11} strokeWidth={1.5} className="shrink-0" />
            {g.count}
            <span className="truncate">· {status}</span>
          </span>
        );
      }
    } else {
      nameLine = formatDeptName(perm.principal_id, lang, koreanDeptByPath);
      const count = [...orgPathById.values()].filter(
        (p) => p === perm.principal_id || p.startsWith(`${perm.principal_id}/`),
      ).length;
      // 상위 경로 — 루트 부서면 자기 자신 (기존 동작 유지)
      const chain = buildOrgPathChain(perm.principal_id);
      const parent = (chain.length > 1 ? chain.slice(0, -1) : chain)
        .map((p) => formatDeptName(p, lang, koreanDeptByPath))
        .join(" › ");
      restNode = (
        <span className="flex min-w-0 items-center gap-1 text-fine text-ink-tertiary">
          <Users size={11} strokeWidth={1.5} className="shrink-0" />
          {count}
          {parent && <span className="hidden truncate group-hover/member:inline">· {parent}</span>}
        </span>
      );
    }
    // 스택에 이 행을 겨냥한 제거 예정이 있는지 — 있으면 톤다운 + 태그 + 개별 취소 (C4).
    const stagedRemove = stagedRemoveIds.has(perm.id);
    // 옛 X버튼과 동일 조건 — 역할 필 자리에 hover/focus 시 Remove 필로 스왑 (U4).
    const removable = canManageMembers && perm.role !== "owner" && !stagedRemove && !perm.pending_change;
    return (
      <Fragment key={perm.id}>
        {/* 역할 클러스터 경계 — 회색 가로선 구분 (batch2 ④) */}
        {showRoleBoundary && <div aria-hidden className="my-0.5 border-t border-hairline" />}
        <div
          role={perm.principal_type === "user" ? "button" : undefined}
          tabIndex={perm.principal_type === "user" ? 0 : undefined}
          onClick={perm.principal_type === "user" ? () => toggleMember(perm.principal_id) : undefined}
          onKeyDown={
            perm.principal_type === "user"
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleMember(perm.principal_id);
                  }
                }
              : undefined
          }
          onMouseEnter={
            perm.principal_type === "department" ? () => setHoveredPath(perm.principal_id) : undefined
          }
          onMouseLeave={perm.principal_type === "department" ? () => setHoveredPath(null) : undefined}
          // 유저 행=클릭 토글(펼침) · 부서=호버(상위/관련 팀) (H2c/H2)
          // named group — 인스펙터가 이 카드를 <details className="group ...">로 감싸므로(map-inspector-tab.tsx),
          // 이름 없는 group을 쓰면 그 조상까지 호버 시 전 행이 동시에 스왑된다(governance-r5 V1, R5-2).
          className={`group/member flex items-start justify-between gap-2 rounded-sm border py-1.5 pl-1.5 pr-2.5 transition-colors ${
            perm.principal_type === "user" ? "cursor-pointer hover:ring-1 hover:ring-accent-tint-border" : ""
          } ${stagedRemove ? "opacity-60" : ""} ${
            isMine(perm)
              ? "border-accent bg-accent/10"
              : related
                ? "border-accent-tint-border bg-accent-tint/40"
                : "border-hairline bg-surface"
          }`}
        >
          <span className="flex min-w-0 items-start gap-1.5 text-caption text-ink">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center self-start text-ink-muted">
              <MemberIcon perm={perm} isMe={perm.principal_type === "user" && perm.principal_id === loginId} />
            </span>
            {/* 1줄: 이름/말단/그룹 · 이하: 부서/펼침 (H2c) */}
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate">{nameLine}</span>
              {restNode}
            </span>
          </span>
          <span className="flex flex-col items-end gap-0.5">
            <span className="flex items-center gap-1">
              {/* 역할 필 자리 — hover/focus 시 같은 자리·같은 크기의 빨간 Remove 필로 페이드 전환 (U4, R5-1/R5-3).
                  RoleBadge 자체가 ROLE_PILL_WIDTH_CLASS로 고정폭이라 이 wrapper는 배지 크기에 자동으로
                  맞춰지고, absolute inset-0 오버레이도 그 폭을 그대로 물려받는다(별도 min-w 불필요). */}
              <span className="relative inline-flex items-center justify-center">
                <span
                  className={
                    removable
                      ? "transition-opacity duration-150 group-hover/member:opacity-0 group-focus-within/member:opacity-0"
                      : ""
                  }
                >
                  <RoleBadge role={perm.role as MapRole} className={ROLE_PILL_WIDTH_CLASS} />
                </span>
                {removable && (
                  <button
                    type="button"
                    data-id={`map-detail-remove-member-${perm.id}`}
                    aria-label="Remove member"
                    // opacity/pointer-events(display 토글 아님) — 부서/그룹 행은 상위에 tabIndex가
                    // 없어 group-focus-within만으론 못 열림, 버튼 자체가 Tab 순서에 남아 있어야
                    // focus:opacity-100로 직접 도달 가능(display:none은 Tab에서 완전히 제외됨).
                    // 버튼은 투명 히트영역(래퍼=라인박스 24px), 실제 필은 배지와 동일 지오메트리의
                    // 내부 span — inset-0을 필에 직접 주면 상하 6px 커져 R5-1 위반.
                    className="absolute inset-0 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-150 focus:pointer-events-auto focus:opacity-100 group-hover/member:pointer-events-auto group-hover/member:opacity-100 group-focus-within/member:pointer-events-auto group-focus-within/member:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveMember(perm);
                    }}
                  >
                    <span
                      className={`rounded-sm border border-error bg-surface px-1.5 py-0.5 text-fine text-error transition-colors hover:bg-error/10 ${ROLE_PILL_WIDTH_CLASS}`}
                    >
                      {t("perm.removePill")}
                    </span>
                  </button>
                )}
              </span>
              {/* 상세 태그 — 서버 진실(pending_change)일 때만, 즉시성용 로컬 마커는 배지까지만.
                  본인이 낸 요청이면 호버 시 회수(Withdraw)로 스왑 / hover-swaps to Withdraw for the requester. */}
              {perm.pending_change && (
                perm.pending_change.requested_by === loginId ? (
                  <HoverSwapPill
                    dataId={`map-detail-pending-withdraw-${perm.id}`}
                    title={t("perm.pending.by", {
                      name: nameById.get(perm.pending_change.requested_by) ?? perm.pending_change.requested_by,
                    })}
                    swapLabel={t("perm.pending.withdraw")}
                    onActivate={() => void handleWithdrawPending(perm)}
                    className="max-w-full"
                    base={
                      <span className="min-w-0 max-w-full truncate rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed">
                        {perm.role} → {perm.pending_change.to_role ?? t("perm.pending.removed")} · {t("perm.pending.tag")}
                      </span>
                    }
                  />
                ) : (
                  <span
                    className="min-w-0 max-w-full truncate rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed"
                    title={t("perm.pending.by", {
                      name: nameById.get(perm.pending_change.requested_by) ?? perm.pending_change.requested_by,
                    })}
                  >
                    {perm.role} → {perm.pending_change.to_role ?? t("perm.pending.removed")} · {t("perm.pending.tag")}
                  </span>
                )
              )}
            </span>
            {/* 스택 제거 태그 — 좌측 소속(부서) 줄과 같은 높이 대역에 오도록 2번째 줄로 배치 (C4, R5-4).
                예고 아이콘(즉시/승인)을 달고, 호버 시 같은 자리 Cancel 필로 스왑 (HoverSwapPill). */}
            {stagedRemove && (
              <HoverSwapPill
                dataId={`map-detail-staged-cancel-${perm.id}`}
                title={t(
                  forecastStagedOp({ kind: "remove", permissionId: perm.id }, perm.role, isOwner) === "approval"
                    ? "perm.staged.forecastApproval"
                    : "perm.staged.forecastInstant",
                )}
                swapLabel={t("perm.staged.cancelPill")}
                onActivate={() => handleCancelStaged({ kind: "remove", permissionId: perm.id })}
                base={
                  // ROLE_PILL_WIDTH_CLASS는 고정 w-[60px]라 아이콘+문구가 넘친다 — 이 필에서만
                  // min-w-[60px]로 완화(공유 상수는 불변, brief Step 4 주의사항).
                  <span className="inline-flex min-w-[60px] items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-error px-1.5 py-0.5 text-fine text-error">
                    {forecastStagedOp({ kind: "remove", permissionId: perm.id }, perm.role, isOwner) === "approval" ? (
                      <Hourglass size={12} strokeWidth={1.5} />
                    ) : (
                      <Zap size={12} strokeWidth={1.5} />
                    )}
                    {t("perm.staged.remove")}
                  </span>
                }
              />
            )}
          </span>
        </div>
      </Fragment>
    );
  }

  const body = (
    <>
      {!only && (
        <>
      {/* 업무 체계 카테고리 — 경로가 있으면 최상단 전용 행(긴 L1~L5 경로가 우측 필 무리를 키워
          타이틀이 세로로 쥐어짜지는 것 방지), 없으면 오너의 연결 유령 필만 기존 우측 무리에 유지 */}
      {detail.category_path && (
        <div className="flex text-fine">
          {isOwner ? (
            <button
              type="button"
              data-id="map-detail-category"
              title={detail.category_path}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 text-accent"
              onClick={() => setFrameworkModalOpen(true)}
            >
              <Network size={12} strokeWidth={1.5} className="shrink-0" />
              <span className="min-w-0 truncate">{detail.category_path}</span>
            </button>
          ) : (
            <span
              data-id="map-detail-category"
              title={detail.category_path}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 text-accent"
            >
              <Network size={12} strokeWidth={1.5} className="shrink-0" />
              <span className="min-w-0 truncate">{detail.category_path}</span>
            </span>
          )}
        </div>
      )}
      {/* 헤더 — 좌: 타이틀 / 우: 공개·역할·오우닝 부서 필 (Open 버튼 제거 — 열기는 카드 타이틀 링크) */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-body-strong text-ink">{detail.name}</h2>
          {detail.sp_designated_at && (
            <span
              data-id="map-detail-sp"
              title={t("home.spBadgeTip")}
              className="shrink-0 rounded-sm border border-hairline bg-accent-tint px-1.5 py-0.5 text-fine text-accent"
            >
              {t("home.spBadge")}
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-fine text-ink-tertiary">
          {/* 공개 범위 — 반투명 필 + 아이콘 (public=green/private=중립, visibilityPillClass 색 의미 유지) */}
          <span
            data-id="map-detail-visibility"
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
              detail.visibility === "public" ? "bg-added/10 text-added" : "bg-ink/5 text-ink-secondary"
            }`}
          >
            {detail.visibility === "public" ? (
              <Globe size={12} strokeWidth={1.5} />
            ) : (
              <Lock size={12} strokeWidth={1.5} />
            )}
            {t(detail.visibility === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
          </span>
          {/* 내 역할 — RoleBadge 색 의미(owner=accent/editor=green/viewer=중립)를 반투명 필로 */}
          {detail.my_role && (
            <span
              data-id="map-detail-role"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                detail.my_role === "owner"
                  ? "bg-accent/10 text-accent"
                  : detail.my_role === "editor"
                    ? "bg-added/10 text-added"
                    : "bg-ink/5 text-ink-secondary"
              }`}
            >
              {detail.my_role === "owner" ? (
                <Crown size={12} strokeWidth={1.5} />
              ) : detail.my_role === "editor" ? (
                <PencilLine size={12} strokeWidth={1.5} />
              ) : (
                <Eye size={12} strokeWidth={1.5} />
              )}
              {t(
                detail.my_role === "owner"
                  ? "perm.roleOwner"
                  : detail.my_role === "editor"
                    ? "perm.roleEditor"
                    : "perm.roleViewer",
              )}
            </span>
          )}
          {/* 오우닝 부서 — 지정 시 부서명 필(한글명 우선), 미지정 시 홈 카드와 동일한 경고 필 */}
          {detail.owning_department ? (
            <span
              data-id="map-detail-owning-dept"
              title={t("perm.owningDept.title")}
              className="inline-flex items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 text-accent"
            >
              <Building2 size={12} strokeWidth={1.5} />
              {formatDeptName(detail.owning_department, lang, koreanDeptByPath)}
            </span>
          ) : (
            <span
              data-id="map-detail-owning-missing"
              title={t("home.owningMissingNote")}
              className="inline-flex items-center gap-1 rounded-full bg-error/10 px-2 py-0.5 text-error"
            >
              <TriangleAlert size={12} strokeWidth={1.5} />
              {t("home.owningMissingBadge")}
            </span>
          )}
          {/* 업무 체계 연결 유령 필(미연결 오너 전용) — 연결된 경로 필은 위 최상단 행으로 이동 (Phase 2) */}
          {isOwner && !detail.category_path && (
            <button
              type="button"
              data-id="map-detail-category"
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-hairline px-2 py-0.5 text-ink-tertiary hover:border-accent hover:text-accent"
              onClick={() => setFrameworkModalOpen(true)}
            >
              <Network size={12} strokeWidth={1.5} />
              {t("home.frameworkAssign")}
            </button>
          )}
        </div>
      </div>

      {/* word 맵 문서 메타 — 문서명·섹션 수·재임포트/생성 타임스탬프·재생성 힌트 (design 2026-07-24 §2) */}
      {detail.mode === "word" && (
        <div data-id="word-doc-meta" className="flex flex-col gap-0.5">
          <p className="truncate text-fine text-ink-tertiary">
            {detail.doc_name || "(no document)"} · {detail.doc_sections?.length ?? 0} sections
          </p>
          {formatDocStamp(detail.doc_imported_at) && (
            <p className="text-fine text-ink-tertiary">Imported {formatDocStamp(detail.doc_imported_at)}</p>
          )}
          {formatDocStamp(detail.doc_generated_at) && (
            <p className="text-fine text-ink-tertiary">Generated {formatDocStamp(detail.doc_generated_at)}</p>
          )}
          {needsRegenerate(detail) && (
            <p className="text-fine text-changed">Re-imported after last generation — regenerate the document.</p>
          )}
        </div>
      )}

      <div
        data-id="map-detail-description"
        className="rounded-sm border border-hairline bg-surface p-3 text-caption text-ink"
      >
        {detail.description ? (
          detail.description
        ) : (
          <span className="text-ink-tertiary">{t("home.descEmpty")}</span>
        )}
      </div>

      {/* 지정 I/O — sp_input/sp_output 중 하나라도 있으면 노출 (Phase 2) */}
      {(detail.sp_input || detail.sp_output) && (
        <div
          data-id="map-detail-io"
          className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface p-3 text-caption text-ink"
        >
          {detail.sp_input && (
            <p>
              <span className="text-ink-tertiary">{t("home.ioInput")}: </span>
              {detail.sp_input}
            </p>
          )}
          {detail.sp_output && (
            <p>
              <span className="text-ink-tertiary">{t("home.ioOutput")}: </span>
              {detail.sp_output}
            </p>
          )}
        </div>
      )}

      {frameworkModalOpen && (
        <FrameworkAssignModal
          mapId={detail.id}
          currentCategoryId={detail.category_id}
          currentPath={detail.category_path}
          hasConsultantCode={Boolean(detail.consultant_code)}
          onClose={() => setFrameworkModalOpen(false)}
          onChanged={() => {
            setLocalReloadKey((n) => n + 1);
            onFrameworkChanged?.();
          }}
        />
      )}
        </>
      )}

      {/* 버전 · 허용 인원 — 좌우 배치(2:1) + 사이 세로 구분선 / Versions:members = 2:1 with a vertical divider */}
      <div className="flex flex-col gap-4 sm:flex-row">
        {only !== "members" && (
        <div data-id="map-detail-versions" className="flex min-w-0 flex-[2] flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-fine uppercase tracking-wide text-ink-tertiary">{t("home.versions")}</p>
            {expandedVersions.size > 0 && (
              <button
                type="button"
                data-id="collapse-versions"
                className="shrink-0 text-fine text-accent hover:underline"
                onClick={collapseVersions}
              >
                {t("home.collapseAll")}
              </button>
            )}
          </div>
          {detail.versions.length === 0 ? (
            <p className="text-caption text-ink-tertiary">{t("perm.version.noVersions")}</p>
          ) : (
            <VersionTimeline
              versions={detail.versions}
              nameById={nameById}
              expandedIds={expandedVersions}
              onToggle={toggleVersion}
              onGoToVersion={onGoToVersion}
              currentVersionId={currentVersionId}
            />
          )}
        </div>
        )}

        {/* 허용 인원 (editor+ only) — 개인 → 팀 → 유저 그룹 순, 그룹 사이 스페이서, 내 소속 하이라이트.
            로딩 중엔 고스트로 컬럼 폭을 먼저 확보(버전 프레임 리플로우 방지) */}
        {only !== "versions" && membersStatus !== "hidden" && (
          <div
            className={`flex min-w-0 flex-1 flex-col gap-1 ${
              only === "members" ? "" : "sm:border-l sm:border-hairline sm:pl-4"
            }`}
          >
            {/* 오우닝 부서 — 협업 부서 행과 같은 스타일(레벨 아이콘·부서명)로 멤버 최상단 노출. 항상 editor·고정.
                인스펙터(members-only)엔 헤더 필이 없어 여기서만 보이고, 상세 카드엔 헤더 필과 함께 상세 행으로 노출. */}
            {owningDeptPath && (
              <div data-id="map-detail-owning-member" className="flex flex-col gap-1">
                <p className="text-fine text-ink-tertiary">{t("perm.owningDept.title")}</p>
                <div className="flex items-start justify-between gap-2 rounded-sm border border-accent-tint-border bg-accent-tint/40 py-1.5 pl-1.5 pr-2.5">
                  <span className="flex min-w-0 items-start gap-1.5 text-caption text-ink">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center self-start text-ink-muted">
                      {(() => {
                        const Icon = LEVEL_ICONS[deptLevelRank(deptLeaf(owningDeptPath))] ?? Building2;
                        return <Icon size={22} strokeWidth={1.5} />;
                      })()}
                    </span>
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate">{formatDeptName(owningDeptPath, lang, koreanDeptByPath)}</span>
                      <span className="flex items-center gap-1 text-fine text-ink-tertiary">
                        <Lock size={11} strokeWidth={1.5} className="shrink-0" />
                        {t("perm.owningDept.lockedEditor")}
                      </span>
                    </span>
                  </span>
                  <RoleBadge role="editor" />
                </div>
              </div>
            )}
            {/* 오너 섹션 — 오우닝 부서 블록 바로 아래, user 그룹보다 우선 노출 (R2 QA 피드백).
                renderMemberRow 재사용 — 편집 어포던스는 owner-row 가드로 자연히 빠진다(X 버튼 없음). */}
            {ownerRows.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-fine text-ink-tertiary">{t("home.memberOwner")}</p>
                {ownerRows.map((perm) => renderMemberRow(perm, false))}
              </div>
            )}
            {only !== "members" && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-fine uppercase tracking-wide text-ink-tertiary">{t("home.members")}</p>
                {expandedMembers.size > 0 && (
                  <button
                    type="button"
                    data-id="collapse-members"
                    className="shrink-0 text-fine text-accent hover:underline"
                    onClick={collapseMembers}
                  >
                    {t("home.collapseAll")}
                  </button>
                )}
              </div>
            )}
            {members === null ? (
              <MembersSkeleton />
            ) : members.length === 0 ? (
              <p className="text-caption text-ink-tertiary">{t("home.membersEmpty")}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {MEMBER_GROUPS.map((g) => {
                  // 오너는 별도 섹션(오우닝 부서 블록 아래)에서 렌더 — user 그룹에서는 제외 (R2 QA 피드백)
                  const unsorted = members.filter(
                    (m) => m.principal_type === g.type && (g.type !== "user" || m.role !== "owner"),
                  );
                  if (unsorted.length === 0) return null;
                  // 역할 우선(owner→editor→viewer), 같은 역할 안에서 부서는 레벨 순 —
                  // sort는 stable이라 그 외는 원순서 유지 (batch2 ④)
                  const rows = [...unsorted].sort((a, b) => {
                    const d = (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3);
                    if (d !== 0) return d;
                    return g.type === "department"
                      ? deptLevelRank(deptLeaf(a.principal_id)) -
                          deptLevelRank(deptLeaf(b.principal_id))
                      : 0;
                  });
                  const rowNodes = rows.map((perm, i) =>
                    renderMemberRow(perm, i > 0 && rows[i - 1].role !== perm.role),
                  );
                  // 개인 그룹만 3.3행 클램프 대상 — 부서/그룹 그룹·오너 섹션은 클램프 없음 (W3).
                  const clampable = g.type === "user" && rows.length > MEMBERS_CLAMP_VISIBLE;
                  return (
                    <div key={g.type} className="flex flex-col gap-1">
                      <p className="text-fine text-ink-tertiary">{t(g.labelKey)}</p>
                      {clampable ? (
                        <>
                          <div
                            data-id="map-detail-members-scroll"
                            className="clamp-size flex flex-col gap-1 overflow-x-hidden overflow-y-auto"
                            style={{
                              maxHeight: membersUserExpanded
                                ? "max-content"
                                : `${MEMBERS_CLAMP_MAX_HEIGHT_PX}px`,
                            }}
                          >
                            {rowNodes}
                          </div>
                          <button
                            type="button"
                            data-id="map-detail-members-expand"
                            aria-expanded={membersUserExpanded}
                            onClick={() => setMembersUserExpanded((v) => !v)}
                            className="w-full rounded-sm py-1 text-center text-fine text-accent hover:bg-divider hover:underline"
                          >
                            {membersUserExpanded
                              ? t("home.membersCollapse")
                              : t("home.membersShowAll", { count: rows.length })}
                          </button>
                        </>
                      ) : (
                        rowNodes
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* 스택에 적립된 추가 예정 — 고스트 행(점선 테두리) + 태그 + 개별 취소 X (C4) /
                Staged "to add" rows — dashed ghost row with a tag and a per-row cancel. */}
            {stagedAdds.map((op) => {
              const name =
                op.principalType === "user"
                  ? nameById.get(op.principalId) ?? op.principalId
                  : op.principalType === "group"
                    ? groupNameById.get(op.principalId) ?? op.principalId
                    : formatDeptName(op.principalId, lang, koreanDeptByPath);
              const Icon =
                op.principalType === "user"
                  ? User
                  : op.principalType === "group"
                    ? UsersRound
                    : LEVEL_ICONS[deptLevelRank(deptLeaf(op.principalId))] ?? Building2;
              const addKey = `${op.principalType}:${op.principalId}`;
              return (
                <div
                  key={`add:${addKey}`}
                  data-id={`staged-add-${addKey}`}
                  className={`flex items-center justify-between gap-2 rounded-sm border border-dashed border-hairline py-1.5 pl-1.5 pr-2.5 ${
                    lastAddedKey === addKey ? "motion-safe:animate-[picker-flash_1200ms_ease-in-out]" : ""
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-caption text-ink">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center text-ink-muted">
                      <Icon size={22} strokeWidth={1.5} />
                    </span>
                    <span className="truncate">{name}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <HoverSwapPill
                      dataId={`map-detail-staged-add-cancel-${addKey}`}
                      title={t("perm.staged.forecastInstant")}
                      swapLabel={t("perm.staged.cancelPill")}
                      onActivate={() => handleCancelStaged(op)}
                      base={
                        <span className="inline-flex items-center gap-1 rounded-sm border border-added px-1.5 py-0.5 text-fine text-added">
                          <Zap size={12} strokeWidth={1.5} />
                          {t("perm.staged.add")}
                        </span>
                      }
                    />
                    <RoleBadge role={op.role} />
                  </span>
                </div>
              );
            })}
            {canManageMembers && members !== null && (
              <div data-id="map-detail-add-member">
                <AddCollaborator
                  dirUsers={dirUsersRaw}
                  dirDepts={dirDeptsRaw}
                  groups={groupsRaw}
                  excludeIds={
                    new Set([...members.map((m) => m.principal_id), ...stagedAdds.map((op) => op.principalId)])
                  }
                  viewerGrantDisabled={detail?.visibility === "public"}
                  onAdd={handleAddMember}
                />
              </div>
            )}
            {/* Save/Cancel — 스택에 쌓인 게 있을 때만 노출 / Save/Cancel bar, shown only while ops are staged */}
            {stagedOps.length > 0 && (
              <div className="mt-2 flex items-center justify-end gap-2 border-t border-hairline pt-2">
                <button
                  type="button"
                  data-id="perm-staged-cancel"
                  disabled={savingStaged}
                  className="rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
                  onClick={handleCancelAllStaged}
                >
                  {t("perm.staged.cancel")}
                </button>
                <button
                  type="button"
                  data-id="perm-staged-save"
                  disabled={savingStaged}
                  className="inline-flex items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
                  onClick={() => void handleSaveStaged()}
                >
                  {savingStaged && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
                  {t("perm.staged.save")}
                </button>
              </div>
            )}
            {/* 되돌리기 — 스택이 비어 있고 직전 저장분이 있을 때만(Save 바와 배타적, 동시 노출 안 함) /
                Undo bar: only when the stack is empty and a last apply exists (never coexists with Save bar). */}
            {stagedOps.length === 0 && lastApply && (
              <div className="mt-2 flex items-center justify-end border-t border-hairline pt-2">
                <button
                  type="button"
                  data-id="perm-undo-last"
                  title={t("perm.undo.buttonTitle")}
                  className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={() => setUndoOpen(true)}
                >
                  <RotateCcw size={14} strokeWidth={1.5} />
                  {t("perm.undo.button")}
                </button>
              </div>
            )}
            {undoOpen && lastApply && (
              <UndoLastApplyModal
                items={buildUndoPlan(lastApply, isOwner)}
                resolveName={resolveUndoName}
                busy={undoBusy}
                onClose={() => setUndoOpen(false)}
                onConfirm={() => void handleUndoConfirm()}
              />
            )}
            {/* 부분 실패 배너 — Save 시점엔 stagedOps가 이미 비워지므로 위 바와 독립 조건.
                dismissible: 리마운트 없이도 X로 닫아 카드 나머지를 계속 쓸 수 있어야 한다 (최종 리뷰 픽스). */}
            {stagedSaveError && (
              <div
                data-id="perm-staged-error"
                className="mt-2 flex items-start justify-between gap-2 rounded-sm border border-hairline bg-surface px-2 py-1.5 text-fine text-error"
              >
                <span className="min-w-0 flex-1">{stagedSaveError}</span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="shrink-0 rounded-sm p-0.5 text-error hover:bg-surface-alt"
                  onClick={() => setStagedSaveError(null)}
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  // 에디터 인스펙터(footer 없음) — 부모 스크롤에 자연 배치 / embedded: flow in parent, no footer.
  if (!showFooter) {
    return <div className="flex flex-col gap-3">{body}</div>;
  }

  // 승인본(approved/published)이 있어야 복사 가능 — 없으면 버튼 숨김(백엔드 409 회피) /
  // Copy needs an approved/published version; hide otherwise (avoids backend 409).
  const hasApprovedVersion = detail.versions.some(
    (v) => v.status === "approved" || v.status === "published",
  );

  // 홈 우측 패널 — 내부 스크롤 + 하단 고정 버튼바 / home: internal scroll + pinned footer.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{body}</div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-hairline p-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/maps/${detail.id}/settings`}
            className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface"
          >
            <Settings size={14} strokeWidth={1.5} />
            {t("perm.settingsTitle")}
          </Link>
          {hasApprovedVersion && onCopy && (
            <button
              type="button"
              data-id="map-detail-copy"
              className="flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface"
              onClick={() => onCopy(detail.id, detail.name)}
            >
              <Copy size={14} strokeWidth={1.5} />
              {t("home.copyFromApproved")}
            </button>
          )}
          {detail.mode === "word" && onPromote && (
            <button
              type="button"
              data-id="map-detail-promote"
              className="flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface"
              onClick={() => onPromote(detail.id, detail.name)}
            >
              <ArrowUpRight size={14} strokeWidth={1.5} />
              Convert to process map
            </button>
          )}
        </div>
        {isOwner && onDelete && (
          <button
            type="button"
            data-id="map-detail-delete"
            className="inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-caption text-error hover:bg-surface"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} strokeWidth={1.5} />
            {t("home.delete")}
          </button>
        )}
      </div>
      {confirmDelete && onDelete && (
        <DeleteMapDialog
          mapName={detail.name}
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete(detail.id);
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
