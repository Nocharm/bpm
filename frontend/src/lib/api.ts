// 백엔드 REST 클라이언트. /api는 nginx(운영) 또는 next.config rewrites(로컬)가 backend로 프록시.

export type VersionStatus =
  | "draft"
  | "pending"
  | "approved"
  | "published"
  | "rejected";

export interface VersionSummary {
  id: number;
  label: string;
  status: VersionStatus;
  submitted_by: string | null;
  reject_reason: string | null;
}

export interface MapSummary {
  id: number;
  name: string;
  description: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // 서버가 산정한 호출자의 유효 역할 — 게이팅 단일 소스 (클라 재계산 폐기)
  my_role: "viewer" | "editor" | "owner" | null;
  // 맵 공개 범위 — Visibility 화면 표시·토글의 서버 진실
  visibility: "public" | "private";
}

export interface MapDetail extends MapSummary {
  versions: VersionSummary[];
}

export interface GraphNode {
  id: string;
  title: string;
  description: string;
  node_type: string;
  color: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
  pos_x: number;
  pos_y: number;
  sort_order: number;
  // 다중 그룹(태그) 소속 — 노드가 여러 그룹에 동시 소속. 빈 배열=무소속
  group_ids: string[];
  has_children?: boolean;
  // 하위프로세스 참조 (node_type==="subprocess")
  linked_map_id: number | null;
  follow_latest: boolean;
  linked_version_id: number | null;
  // 대표 끝 (node_type==="end")
  is_primary_end: boolean;
}

// 전체 그래프(모든 계층) 조회용 — 계층/계보 정보 포함 (검색·버전 diff)
export interface FlatNode extends GraphNode {
  parent_node_id: string | null;
  source_node_id: string | null;
}

export interface GraphEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  label: string;
  source_side: string;
  target_side: string;
  source_handle: string | null;
  target_handle: string | null;
}

// 업무 묶음(보이는 그룹 박스) — 부서/담당자별, 노드와 같은 (version, parent) 스코프 (Phase 2)
export interface GraphGroup {
  id: string;
  // 상위 그룹 id — 중첩(하위 그룹핑). null=최상위
  parent_group_id: string | null;
  label: string;
  color: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: GraphGroup[];
}

export interface VersionGraph {
  nodes: FlatNode[];
  edges: GraphEdge[];
}

// 인증 토큰 — AuthGate가 로그인 후 주입. auth 비활성(로컬)이면 null로 유지.
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

let devUser: string | null = null;

export function setDevUser(loginId: string | null): void {
  devUser = loginId;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  } else if (devUser) {
    headers["X-Dev-User"] = devUser;
  }
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
  if (!response.ok) {
    // 서버 detail(검증 실패 사유 등)을 메시지에 포함 — 진단 용이
    const detail = await response.text().catch(() => "");
    throw new Error(
      `API ${init?.method ?? "GET"} ${path} failed: ${response.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function listMaps(): Promise<MapSummary[]> {
  return request<MapSummary[]>("/maps");
}

export function createMap(name: string): Promise<MapDetail> {
  return request<MapDetail>("/maps", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getMap(mapId: number): Promise<MapDetail> {
  return request<MapDetail>(`/maps/${mapId}`);
}

export interface LibraryProcess {
  map_id: number;
  name: string;
  latest_version_id: number | null;
  latest_published_version_id: number | null;
  refs: number[];
}

export function listLibraryProcesses(): Promise<LibraryProcess[]> {
  return request<LibraryProcess[]>("/library/processes");
}

export function getResolvedGraph(
  mapId: number,
  followLatest: boolean,
  pinned: number | null,
): Promise<Graph> {
  const params = new URLSearchParams({ follow_latest: String(followLatest) });
  if (pinned !== null) params.set("pinned", String(pinned));
  return request<Graph>(`/library/processes/${mapId}/resolved?${params.toString()}`);
}

export function createVersion(
  mapId: number,
  label: string,
  sourceVersionId: number | null = null,
): Promise<VersionSummary> {
  return request<VersionSummary>(`/maps/${mapId}/versions`, {
    method: "POST",
    body: JSON.stringify({ label, source_version_id: sourceVersionId }),
  });
}

export function renameVersion(
  versionId: number,
  label: string,
): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}`, {
    method: "PATCH",
    body: JSON.stringify({ label }),
  });
}

export function deleteVersion(versionId: number): Promise<void> {
  return request<void>(`/versions/${versionId}`, { method: "DELETE" });
}

export function deleteMap(mapId: number): Promise<void> {
  return request<void>(`/maps/${mapId}`, { method: "DELETE" });
}

export function getGraph(versionId: number): Promise<Graph> {
  return request<Graph>(`/versions/${versionId}/graph`);
}

export function getFullGraph(versionId: number): Promise<VersionGraph> {
  return request<VersionGraph>(`/versions/${versionId}/graph/all`);
}

// ── 체크아웃 / 코멘트 (spec §7 Phase C) ──────────────────

export interface CheckoutState {
  checked_out_by: string | null;
  checked_out_at: string | null;
  mine: boolean;
}

export function acquireCheckout(
  versionId: number,
  force = false,
): Promise<CheckoutState> {
  return request<CheckoutState>(`/versions/${versionId}/checkout`, {
    method: "POST",
    body: JSON.stringify({ force }),
  });
}

export function releaseCheckout(versionId: number): Promise<void> {
  return request<void>(`/versions/${versionId}/checkout`, { method: "DELETE" });
}

export interface CommentItem {
  id: number;
  node_id: string;
  author: string;
  body: string;
  resolved: boolean;
  created_at: string;
}

export function listComments(versionId: number): Promise<CommentItem[]> {
  return request<CommentItem[]>(`/versions/${versionId}/comments`);
}

export function createComment(
  versionId: number,
  nodeId: string,
  body: string,
): Promise<CommentItem> {
  return request<CommentItem>(`/versions/${versionId}/comments`, {
    method: "POST",
    body: JSON.stringify({ node_id: nodeId, body }),
  });
}

export function updateComment(
  commentId: number,
  resolved: boolean,
): Promise<CommentItem> {
  return request<CommentItem>(`/comments/${commentId}`, {
    method: "PATCH",
    body: JSON.stringify({ resolved }),
  });
}

export function deleteComment(commentId: number): Promise<void> {
  return request<void>(`/comments/${commentId}`, { method: "DELETE" });
}

export function saveGraph(versionId: number, graph: Graph): Promise<Graph> {
  return request<Graph>(`/versions/${versionId}/graph`, {
    method: "PUT",
    body: JSON.stringify(graph),
  });
}

// ── Version approval workflow (design 2026-06-14) ──────────

export interface WorkflowState {
  version_id: number;
  status: VersionStatus;
  submitted_by: string | null;
  reject_reason: string | null;
  approvers: string[];
  approvals: string[];
}

export interface Me {
  username: string;
  ai_enabled: boolean;
  name: string;
  role: "admin" | "user";
  department: string;
  // BPM 시스템 관리자 여부 — sysadmin-only UI 게이팅 단일 소스
  is_sysadmin: boolean;
}

export function getMe(): Promise<Me> {
  return request<Me>("/me");
}

export interface EmployeeRow {
  login_id: string;
  name: string;
  title: string;
  source: string;
  role: string;
  department: string;
}

export function listEmployees(): Promise<EmployeeRow[]> {
  return request<EmployeeRow[]>("/employees");
}

export interface SyncSummary {
  scanned: number;
  upserted: number;
  excluded: number;
}

export function syncEmployees(): Promise<SyncSummary> {
  return request<SyncSummary>("/employees/sync", { method: "POST" });
}

export function getWorkflowState(versionId: number): Promise<WorkflowState> {
  return request<WorkflowState>(`/versions/${versionId}/workflow`);
}

export function submitVersion(versionId: number): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/submit`, { method: "POST" });
}

export function approveVersion(versionId: number): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/approve`, { method: "POST" });
}

export function rejectVersion(
  versionId: number,
  reason: string,
): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function publishVersion(versionId: number): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/publish`, { method: "POST" });
}

export function withdrawVersion(versionId: number): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/withdraw`, { method: "POST" });
}

export function listApprovers(mapId: number): Promise<string[]> {
  return request<string[]>(`/maps/${mapId}/approvers`);
}

export function setApprovers(mapId: number, userIds: string[]): Promise<string[]> {
  return request<string[]>(`/maps/${mapId}/approvers`, {
    method: "PUT",
    body: JSON.stringify({ user_ids: userIds }),
  });
}

// ── 권한 관리 (collaborators / owner-transfer / visibility, Layer 2) ──────

export type PrincipalType = "user" | "department" | "group";
export type MapRole = "viewer" | "editor" | "owner";

export interface MapPermission {
  id: number;
  principal_type: string;
  principal_id: string;
  role: string;
  granted_by: string;
}

// PATCH/DELETE 응답 봉투 — 다운그레이드/에디터제거는 즉시 적용 대신 pending 요청.
// pending=true 면 approval_request 만 채워지고 grant 는 그대로 (서버 진실 = 변경 없음).
export interface PermissionMutationResult {
  pending: boolean;
  permission?: MapPermission;
  deleted?: boolean;
  approval_request?: ApprovalRequest;
}

export interface ApprovalRequest {
  id: number;
  map_id: number;
  kind: string;
  payload: Record<string, unknown>;
  requested_by: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export function listMapPermissions(mapId: number): Promise<MapPermission[]> {
  return request<MapPermission[]>(`/maps/${mapId}/permissions`);
}

export function addMapPermission(
  mapId: number,
  principalType: PrincipalType,
  principalId: string,
  role: "viewer" | "editor",
): Promise<MapPermission> {
  return request<MapPermission>(`/maps/${mapId}/permissions`, {
    method: "POST",
    body: JSON.stringify({
      principal_type: principalType,
      principal_id: principalId,
      role,
    }),
  });
}

export function changeMapPermission(
  mapId: number,
  permissionId: number,
  role: MapRole,
): Promise<PermissionMutationResult> {
  return request<PermissionMutationResult>(
    `/maps/${mapId}/permissions/${permissionId}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
}

export function removeMapPermission(
  mapId: number,
  permissionId: number,
): Promise<PermissionMutationResult> {
  return request<PermissionMutationResult>(
    `/maps/${mapId}/permissions/${permissionId}`,
    { method: "DELETE" },
  );
}

// 소유권 이전 — 즉시 적용. owner-1 불변식은 서버가 보장(클라 검증 폐기).
export function transferMapOwner(
  mapId: number,
  newOwner: string,
): Promise<{ owner_id: string; transferred: boolean }> {
  return request<{ owner_id: string; transferred: boolean }>(
    `/maps/${mapId}/transfer-owner`,
    { method: "POST", body: JSON.stringify({ new_owner: newOwner }) },
  );
}

// 가시성 변경 — 즉시 적용 안 됨. pending ApprovalRequest 반환(승인 시 적용).
export function requestVisibilityChange(
  mapId: number,
  toVisibility: "public" | "private",
): Promise<ApprovalRequest> {
  return request<ApprovalRequest>(`/maps/${mapId}/visibility-request`, {
    method: "POST",
    body: JSON.stringify({ to_visibility: toVisibility }),
  });
}

// 맵의 승인 요청 목록 — collaborators 패널의 pending 다운그레이드 표시에 사용.
export function listApprovalRequests(mapId: number): Promise<ApprovalRequest[]> {
  return request<ApprovalRequest[]>(`/maps/${mapId}/approval-requests`);
}

// 승인 요청 결정 — approve 면 서버가 payload(권한 하향/가시성)를 즉시 적용, reject 면 변경 없음.
// 서버 진실: 호출 후 요청 목록·영향받은 맵 데이터를 재조회한다(낙관적 갱신 금지).
export function decideApprovalRequest(
  requestId: number,
  decision: "approve" | "reject",
): Promise<ApprovalRequest> {
  return request<ApprovalRequest>(`/approval-requests/${requestId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

// ── 디렉터리 API (collaborator picker, Layer 4 Task 0) ──────────────────────

export interface DirectoryUser {
  id: string;        // login_id
  name: string;      // English display name
  department: string;
}

export interface DirectoryDept {
  id: string;        // org_path string (e.g. "Management Support Division/Procurement Office")
  name: string;      // leaf segment
}

export interface Directory {
  users: DirectoryUser[];
  departments: DirectoryDept[];
}

/** 인증 사용자 공개 디렉터리 — 협업자 피커 후보 (real employees + dept org-paths). */
export function getDirectory(): Promise<Directory> {
  return request<Directory>("/directory");
}

// ── 사용자 그룹 관리 API (Layer 4 Task 3b/4) ────────────────────────────────

export type GroupStatus = "pending" | "active" | "rejected";
export type GroupMemberType = "user" | "department";

export interface GroupMember {
  id: number;          // member PK — DELETE 경로에 사용 / member primary key for removal
  member_type: GroupMemberType;
  member_id: string;   // user→login_id, department→org_path string
}

export interface Group {
  id: number;
  name: string;
  description: string;
  status: GroupStatus;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  members: GroupMember[];
  managers: string[];  // manager login_ids
}

export interface GroupMemberInput {
  member_type: GroupMemberType;
  member_id: string;
}

/** 그룹 목록 — sysadmin은 전체, 그 외는 active + 본인 생성 pending(서버 가시성 규칙). */
export function listGroups(): Promise<Group[]> {
  return request<Group[]>("/groups");
}

/** 그룹 생성 요청 — status=pending. 멤버 ≥2 필수(서버 422). 생성자는 자동 관리자. */
export function createGroup(
  name: string,
  description: string,
  members: GroupMemberInput[],
  managers: string[],
): Promise<Group> {
  return request<Group>("/groups", {
    method: "POST",
    body: JSON.stringify({ name, description, members, managers }),
  });
}

export function getGroup(groupId: number): Promise<Group> {
  return request<Group>(`/groups/${groupId}`);
}

/** 멤버 추가 — 관리자/sysadmin, active 그룹만. 중복은 409. department member_id = org_path string. */
export function addGroupMember(
  groupId: number,
  member: GroupMemberInput,
): Promise<Group> {
  return request<Group>(`/groups/${groupId}/members`, {
    method: "POST",
    body: JSON.stringify(member),
  });
}

/** 멤버 제거 — member PK(GroupMember.id)로 삭제. 관리자/sysadmin, active 그룹만. */
export function removeGroupMember(
  groupId: number,
  memberPk: number,
): Promise<Group> {
  return request<Group>(`/groups/${groupId}/members/${memberPk}`, {
    method: "DELETE",
  });
}

/** 관리자 집합 교체 — login_id 배열. 최소 1명(빈 배열 422). */
export function setGroupManagers(
  groupId: number,
  managers: string[],
): Promise<Group> {
  return request<Group>(`/groups/${groupId}/managers`, {
    method: "PUT",
    body: JSON.stringify({ managers }),
  });
}

/** sysadmin 승인 대기열 — pending 그룹만. sysadmin 외 403. */
export function listPendingGroups(): Promise<Group[]> {
  return request<Group[]>("/groups/pending");
}

/** 그룹 생성 요청 결정 — sysadmin only. approve→active, reject→rejected. */
export function decideGroup(
  groupId: number,
  decision: "approve" | "reject",
): Promise<Group> {
  return request<Group>(`/groups/${groupId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

// ── 관리 콘솔 API (sysadmin-only, Layer 4 Task 0b) ──────────────────────────

export interface AdminUser {
  login_id: string;
  name: string;
  department: string;
  role: string;        // 'admin' | 'user'
  is_sysadmin: boolean;
  org_levels: string[];
  active: boolean;     // false = AD account disabled (userAccountControl bit 0x2)
}

export interface AdminDept {
  name: string;        // leaf segment
  org_levels: string[];
}

export interface AdminDirectory {
  users: AdminUser[];
  departments: AdminDept[];
}

/** sysadmin 전용 — 관리 콘솔 직원·부서 목록 (영문, 풍부한 필드). active = AD userAccountControl 기반 (Task 2). */
export function getAdminUsers(): Promise<AdminDirectory> {
  return request<AdminDirectory>("/admin/users");
}

export interface NotificationItem {
  id: number;
  type: string;
  map_id: number | null;
  version_id: number | null;
  message: string;
  read: boolean;
  created_at: string;
}

export function listNotifications(unreadOnly = false): Promise<NotificationItem[]> {
  const query = unreadOnly ? "?unread_only=true" : "";
  return request<NotificationItem[]>(`/notifications${query}`);
}

export function markNotificationRead(id: number): Promise<NotificationItem> {
  return request<NotificationItem>(`/notifications/${id}/read`, { method: "POST" });
}

// ── 온프레미스 AI 채팅 (design 2026-06-15) ──────────────

export interface AiNodeAttributes {
  assignee: string;
  department: string;
  system: string;
  duration: string;
  color: string;
}

export interface AiNode {
  key: string;
  title: string;
  node_type: string;
  description: string;
  // 선택 메타 — 미제공이면 null (apply가 빈값/기존값으로 처리, D1)
  attributes: AiNodeAttributes | null;
  // 소속 그룹 — AiProposal.groups[].key 참조. null=무소속
  group_key: string | null;
}

export interface AiEdge {
  source: string;
  target: string;
  label: string;
}

// 그룹(레인/박스) 제안 — key는 노드 group_key가 참조하는 임시키
export interface AiGroup {
  key: string;
  label: string;
  color: string;
  parent_key: string | null;
}

export type AiOpAction = "add" | "remove" | "connect" | "relabel" | "set_attr";

// 증분 편집 연산 (D1 하이브리드) — 실제 적용은 Phase 3
export interface AiOp {
  action: AiOpAction;
  node_id: string | null;
  node: AiNode | null;
  source: string | null;
  target: string | null;
  label: string | null;
  title: string | null;
  attributes: AiNodeAttributes | null;
}

// 워크스루 단계 (Phase 5)
export interface AiStep {
  order: number;
  node_id: string;
  narration: string;
}

export type AiSeverity = "high" | "medium" | "low";

// 분석 결과 항목 (Phase 4)
export interface AiFinding {
  severity: AiSeverity;
  category: string;
  node_ids: string[];
  message: string;
  suggestion: string;
}

export type AiProposalKind = "graph" | "answer" | "walkthrough" | "analysis" | "ops";

export interface AiProposal {
  // 판별 5종 — graph/answer 활성, ops/walkthrough/analysis는 타입만(Phase 3~5 활성)
  kind: AiProposalKind;
  message: string;
  nodes: AiNode[];
  edges: AiEdge[];
  groups: AiGroup[];
  ops: AiOp[];
  steps: AiStep[];
  findings: AiFinding[];
}

export interface AiChatTurn {
  role: string;
  content: string;
}

export function aiChat(
  versionId: number,
  instruction: string,
  history: AiChatTurn[],
  model: string | null,
): Promise<AiProposal> {
  return request<AiProposal>(`/versions/${versionId}/ai/chat`, {
    method: "POST",
    body: JSON.stringify({ instruction, history, model }),
  });
}

export function getAiModels(): Promise<{ models: string[] }> {
  return request<{ models: string[] }>("/ai/models");
}
