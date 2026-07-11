// 백엔드 REST 클라이언트. /api는 nginx(운영) 또는 next.config rewrites(로컬)가 backend로 프록시.

export type VersionStatus =
  | "draft"
  | "pending"
  | "approved"
  | "published"
  | "rejected"
  | "expired";

export interface VersionSummary {
  id: number;
  label: string;
  status: VersionStatus;
  submitted_by: string | null;
  reject_reason: string | null;
  created_at: string;
  // 게시 시 부여되는 맵별 순차 번호(v1, v2…). 미게시는 null/미설정. 백엔드 추가 예정.
  version_number?: number | null;
}

// 버전 생애주기 이벤트 — git-log 타임라인 행 / version lifecycle event.
export interface VersionEvent {
  id: number;
  event_type: string;
  actor: string;
  note: string | null;
  created_at: string;
}

export interface VersionDetail extends VersionSummary {
  events: VersionEvent[];
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
  // 최신 버전(최대 id) 상태 — 홈 카드 표시용 (목록 응답에서만 채움)
  latest_version_status: VersionStatus | null;
  // H5b — 홈 카드 집계 (목록 응답에서만 채워짐): 전체 버전 수·라이브(published) 노드 수·허용 인원 수·소유자 직원명
  version_count?: number;
  node_count?: number;
  member_count?: number;
  owner_name?: string | null;
  // 소프트삭제 시각 — 휴지통(삭제 예정) 목록에서만 채워짐 (DL)
  deleted_at?: string | null;
  // 서브프로세스 지정 — NULL=미지정. 어트리뷰트·최근 변경 기록 (spec 2026-07-06)
  sp_designated_at?: string | null;
  sp_department?: string | null;
  sp_assignee?: string | null;
  sp_system?: string | null;
  sp_duration?: string | null;
  sp_url?: string | null;
  sp_url_label?: string | null;
  sp_changed_by?: string | null;
  sp_changed_at?: string | null;
  // 오우닝 부서 org_path — null=누락(레거시). 홈 배지·필터, 설정 표시 (spec 2026-07-10)
  owning_department?: string | null;
}

export interface MapDetail extends MapSummary {
  versions: VersionDetail[];
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
  // 참조 링크 — 노드당 1개, 빈 값 허용 (CSV import design 2026-07-06)
  url?: string;
  url_label?: string;
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

// 링크 대상 맵의 서브프로세스 지정 정보 — 노드에 복사하지 않는 라이브 참조 (spec 2026-07-06)
export interface SubprocessRef {
  designated: boolean;
  department: string | null;
  assignee: string | null;
  system: string | null;
  duration: string | null;
  url: string | null;
  url_label: string | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: GraphGroup[];
  // 권한 마스킹 — getResolvedGraph가 viewer 미만 호출자에게 200 + 빈 그래프 + locked:true 반환.
  // Permission masking — getResolvedGraph returns 200 + empty graph + locked:true for below-viewer callers.
  locked?: boolean;
  // linked_map_id별 지정 정보 — 경고·잠금·어트리뷰트 표시 소스 (JSON 키라 문자열 인덱스)
  subprocess_refs?: Record<number, SubprocessRef>;
}

export interface VersionGraph {
  nodes: FlatNode[];
  edges: GraphEdge[];
  subprocess_refs?: Record<number, SubprocessRef>;
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

// HTTP 상태로 분기해야 하는 호출자(403 접근 게이트 등)용 — 메시지 형식은 기존 Error와 동일.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
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
    throw new ApiError(
      `API ${init?.method ?? "GET"} ${path} failed: ${response.status}${detail ? ` — ${detail}` : ""}`,
      response.status,
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

export function createMap(
  name: string,
  description: string,
  visibility: MapSummary["visibility"],
  owningDepartment: string,
): Promise<MapDetail> {
  return request<MapDetail>("/maps", {
    method: "POST",
    body: JSON.stringify({
      name,
      description,
      visibility,
      owning_department: owningDepartment,
    }),
  });
}

// 승인본(approved/published) 기준 맵 복사 — 새 private 맵의 초기 draft에 그래프 복제 (F12)
export function copyMap(mapId: number, name?: string): Promise<MapDetail> {
  return request<MapDetail>(`/maps/${mapId}/copy`, {
    method: "POST",
    body: JSON.stringify(name ? { name } : {}),
  });
}

// 노드 담당자/부서 후보 — 맵 조회권한(viewer+) 보유 직원 + 그 부서 (F5, 자유입력 폐기)
export interface EligibleAssignees {
  users: {
    id: string;
    name: string;
    department: string;
    korean_name?: string;
    korean_dept?: string;
  }[];
  departments: string[];
  // 부서명 → 한글 부서명·부서장 (dept_info 보유 부서만) — 부서 셀렉트 검색·한/영 표시
  dept_infos?: Record<string, { korean_name?: string; manager?: string }>;
}
export function getEligibleAssignees(versionId: number): Promise<EligibleAssignees> {
  return request<EligibleAssignees>(`/versions/${versionId}/eligible-assignees`);
}

export function updateMap(
  mapId: number,
  patch: { name?: string; description?: string },
): Promise<MapSummary> {
  return request<MapSummary>(`/maps/${mapId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// 오우닝 부서 지정/변경 — owner/sysadmin 전용. 파생 editor가 새 부서를 따라간다 (spec 2026-07-10)
export function setOwningDepartment(
  mapId: number,
  owningDepartment: string,
): Promise<MapSummary> {
  return request<MapSummary>(`/maps/${mapId}/owning-department`, {
    method: "PUT",
    body: JSON.stringify({ owning_department: owningDepartment }),
  });
}

export function getMap(mapId: number): Promise<MapDetail> {
  return request<MapDetail>(`/maps/${mapId}`);
}

// 서브프로세스 지정/수정(upsert) — 오너 전용, 게시 버전 필수(409). 어트리뷰트는 사용처에 라이브 적용 (spec 2026-07-06)
export interface SubprocessDesignationBody {
  department: string;
  assignee?: string;
  system?: string;
  duration?: string;
  url?: string;
  url_label?: string;
}

// 임베드 체크 — 미리보기 iframe이 열 수 있는 URL인지 서버가 대상 헤더로 판정 (embed-check design 2026-07-08)
export interface EmbedCheck {
  embeddable: boolean | null; // null = 판정 불가(도달 실패) — 프론트는 기존 onLoad+타임아웃 동작 유지
}

export function checkEmbeddable(url: string): Promise<EmbedCheck> {
  return request<EmbedCheck>(`/embed-check?url=${encodeURIComponent(url)}`);
}

export function putSubprocessDesignation(
  mapId: number,
  body: SubprocessDesignationBody,
): Promise<MapSummary> {
  return request<MapSummary>(`/maps/${mapId}/subprocess-designation`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// 지정 해제 — 어트리뷰트는 서버에 유지(재지정 프리필), 멱등
export function deleteSubprocessDesignation(mapId: number): Promise<MapSummary> {
  return request<MapSummary>(`/maps/${mapId}/subprocess-designation`, {
    method: "DELETE",
  });
}

export interface LibraryProcess {
  map_id: number;
  name: string;
  latest_version_id: number | null;
  latest_published_version_id: number | null;
  refs: number[];
  // 지정 어트리뷰트 — 목록은 지정된 맵만 반환하므로 항상 동봉(부서 칩 표시용) (spec 2026-07-06)
  department: string | null;
  assignee: string | null;
  system: string | null;
  duration: string | null;
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

// 휴지통(삭제 예정) — 소프트삭제 맵 목록(오너 본인/sysadmin 전체) + 복구 (DL)
export function listDeletedMaps(): Promise<MapSummary[]> {
  return request<MapSummary[]>("/maps/deleted/list");
}
export function restoreMap(mapId: number): Promise<MapSummary> {
  return request<MapSummary>(`/maps/${mapId}/restore`, { method: "POST" });
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

// 점유권 이전 — 현 보유자가 다른 편집자에게 점유권 넘김 / Transfer checkout to another editor
export function transferCheckout(versionId: number, to: string): Promise<void> {
  return request<void>(`/versions/${versionId}/checkout/transfer`, {
    method: "POST",
    body: JSON.stringify({ to }),
  });
}

// 점유권 요청 — 미보유 편집자가 보유자에게 요청 발송 / Request checkout from holder
export function requestCheckout(
  versionId: number,
): Promise<{ id: number; requested_by: string }> {
  return request<{ id: number; requested_by: string }>(
    `/versions/${versionId}/checkout/request`,
    { method: "POST" },
  );
}

// 점유 요청 대기 목록 항목 / Checkout request queue item (backend CheckoutRequestQueueOut).
export interface CheckoutRequestQueue {
  id: number;
  version_id: number;
  requested_by: string;   // login_id
  status: string;
  created_at: string;
  map_id: number;
  map_name: string;
  version_label: string;
}

// 대기 중인 점유 요청 목록 — sysadmin은 전체, 그 외는 처리 권한(보유자/소유자)이 있는 것만 /
// Pending checkout requests: sysadmin sees all; others see only those they can act on.
export function getPendingCheckoutRequests(mapId?: number): Promise<CheckoutRequestQueue[]> {
  const qs = mapId != null ? `?map_id=${mapId}` : "";
  return request<CheckoutRequestQueue[]>(`/checkout-requests/pending${qs}`);
}

// 점유권 요청 결정 — 보유자/소유자/sysadmin이 승인 또는 거절 / Approve or reject a checkout request
export function decideCheckoutRequest(requestId: number, approve: boolean): Promise<void> {
  return request<void>(`/checkout-requests/${requestId}/decide`, {
    method: "POST",
    body: JSON.stringify({ approve }),
  });
}

// 점유권 요청 철회 — 요청자 본인이 자신의 미결 요청을 거둠 / Requester withdraws own pending request.
export function withdrawCheckoutRequest(requestId: number): Promise<void> {
  return request<void>(`/checkout-requests/${requestId}/withdraw`, { method: "POST" });
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

export interface PendingCheckoutRequest {
  id: number;
  requested_by: string;
  created_at?: string | null;
}

export interface WorkflowState {
  version_id: number;
  status: VersionStatus;
  submitted_by: string | null;
  reject_reason: string | null;
  // 현재 반려 상태를 만든 승인자(rejected일 때만) — 승인자 목록 'Rejected' 표시용
  rejected_by?: string | null;
  approvers: string[];
  approvals: string[];
  version_number?: number | null;
  checkout_holder?: string | null;
  // 점유 획득 시각(언제) · 출처(누구에게서) — 점유권 탭 provenance
  checkout_holder_since?: string | null;
  checkout_from?: string | null;
  // (deprecated) 단건 — 하위호환. 신규 UI는 pending_checkout_requests
  pending_checkout_request?: PendingCheckoutRequest | null;
  // 미결 점유 요청 전체(요청자 복수)
  pending_checkout_requests?: PendingCheckoutRequest[];
}

export interface Me {
  username: string;
  ai_enabled: boolean;
  // 편집용 매뉴얼 사이트 주소 — 비어 있으면 에디터 버튼 숨김 (F9)
  manual_url: string;
  // CSV 임포트 안내 문서 주소 — 비면 매뉴얼 버튼 숨김
  csv_manual_url: string;
  name: string;
  role: "admin" | "user";
  department: string;
  // 부서 소속 판정용 org_path(루트→리프) — 상세 멤버 하이라이트(HM-2)
  org_path: string;
  // BPM 시스템 관리자 여부 — sysadmin-only UI 게이팅 단일 소스
  is_sysadmin: boolean;
  // 내 상위 부서장 체인(리프→루트, 본인 제외) — 피커 Manager 라벨·승인자 우선 정렬
  manager_ids?: string[];
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
  korean_name: string;
  korean_dept: string;
  active: boolean;
  // env(BPM_SYSADMINS) 계산값 — 구 사용자 탭 흡수로 직원 목록에 노출
  is_sysadmin: boolean;
}

export function listEmployees(): Promise<EmployeeRow[]> {
  return request<EmployeeRow[]>("/employees");
}

export interface SyncSummary {
  scanned: number;
  upserted: number;
  excluded: number;
  // 전체 동기화에서 삭제된 스테일 ad 행 수(비활성·퇴사·제외 대상)
  purged: number;
}

export function syncEmployees(): Promise<SyncSummary> {
  return request<SyncSummary>("/employees/sync", { method: "POST" });
}

export interface KoreanNamesImportSummary {
  updated: number;
  skipped: number;
  unknown: string[];
}

export function importKoreanNames(
  mode: "skip" | "overwrite",
  entries: Record<string, { name: string; dept: string }>,
): Promise<KoreanNamesImportSummary> {
  return request<KoreanNamesImportSummary>("/employees/korean-names", {
    method: "PUT",
    body: JSON.stringify({ mode, entries }),
  });
}

// ── 어드민 테이블 뷰어 (sysadmin 전용, 읽기전용) / Admin table viewer ──

export interface TableData {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  size: number;
}

export interface TableQuery {
  page?: number;
  size?: number;
  sort?: string;
  order?: "asc" | "desc";
  q?: string;
}

// 테이블 선택 pill — 이름 + 행수 / table selector pills: name + row count.
export interface TableInfo {
  name: string;
  count: number;
}

export function listDbTables(): Promise<TableInfo[]> {
  return request<TableInfo[]>("/admin/tables");
}

export function getDbTable(name: string, query: TableQuery = {}): Promise<TableData> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.size) params.set("size", String(query.size));
  if (query.sort) params.set("sort", query.sort);
  if (query.order) params.set("order", query.order);
  if (query.q) params.set("q", query.q);
  const qs = params.toString();
  return request<TableData>(
    `/admin/tables/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`,
  );
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

// 만료 버전 재게시 — 새 draft 반환 / Republish expired version (creates a new draft)
export function republishVersion(versionId: number): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/republish`, { method: "POST" });
}

export function listApprovers(mapId: number): Promise<string[]> {
  return request<string[]>(`/maps/${mapId}/approvers`);
}

// 승인자 지정 후보 — 맵 조회권한(viewer+) 보유 직원만 (AP)
export function listEligibleApprovers(mapId: number): Promise<DirectoryUser[]> {
  return request<DirectoryUser[]>(`/maps/${mapId}/eligible-approvers`);
}

// 편집자 목록 — 점유권 이전 대상 후보(editor+ 역할 보유) / Editors for checkout transfer
export function getMapEditors(mapId: number): Promise<DirectoryUser[]> {
  return request<DirectoryUser[]>(`/maps/${mapId}/editors`);
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

// 교차맵 대기 승인 요청 — sysadmin 전역 큐(관리자 콘솔 Approval Queue). 결정 후 재조회.
export function listPendingApprovalRequests(): Promise<ApprovalRequest[]> {
  return request<ApprovalRequest[]>(`/approval-requests`);
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

// ── 알림·승인 인박스 (S7) ──────────────────────────────────────
export type InboxApprovalKind = "version_approval" | "checkout_transfer" | "approval_request";

export interface InboxApproval {
  kind: InboxApprovalKind;
  id: number; // act 엔드포인트가 받는 id (version_approval=version_id, 그 외=request id)
  title: string;
  map_id: number;
  map_name: string;
  requester: string;
  status: string;
  created_at: string;
  version_id: number | null;
  detail: Record<string, unknown> | null;
  // 상세 표시용 부가 정보
  version_label: string | null;
  version_number: number | null;
  updated_at: string | null; // 버전/맵 최종 수정 시각
  holder: string | null; // checkout_transfer 현재 점유자
  before: string | null; // approval_request 변경 전 값
  after: string | null; // approval_request 변경 후 값
  principal: string | null; // permission_downgrade 대상 사용자
}

// 내가 결정할 승인 대기 통합 큐 — 버전 승인·점유권 이전·권한/가시성. act는 각 출처 기존 함수 재사용.
export function listInboxApprovals(): Promise<InboxApproval[]> {
  return request<InboxApproval[]>("/inbox/approvals");
}

// ── 사용 매뉴얼 (S8) ──────────────────────────────────────────
export interface ManualDoc {
  format: "markdown" | "html";
  content: string;
  updated_at: string | null; // 파일 fallback이면 null
  updated_by: string | null;
}

// 게시본 조회 — DB 우선, 없으면 manual.md 파일 fallback(updated_at=null).
// bundled=true면 DB 게시본을 무시하고 배포 포함 manual.md 원문(편집기 '배포본 불러오기').
export function getManual(bundled = false): Promise<ManualDoc> {
  return request<ManualDoc>(`/manual${bundled ? "?bundled=true" : ""}`);
}

// 게시본 저장 (sysadmin) — 단일 행 upsert. (레거시 — 다중 문서 도입 후 관리 UI는 docs CRUD 사용)
export function putManual(format: ManualDoc["format"], content: string): Promise<ManualDoc> {
  return request<ManualDoc>("/manual", {
    method: "PUT",
    body: JSON.stringify({ format, content }),
  });
}

// ── 앱 런타임 설정 (sysadmin) ────────────────────────────────
export interface AppSettings {
  ai_chat_tips: string[]; // 이전 기록 로딩 중 노출되는 기능 팁(미설정 시 기본 20종)
  ai_chat_max_sessions_per_map: number; // 보존 상한 — 사용자×맵당 대화 수
  ai_chat_max_messages_per_session: number; // 보존 상한 — 대화당 메시지 수
  ai_chat_retention_days: number; // 마지막 활동 후 보관 일수
  updated_by: string | null;
  updated_at: string | null;
}

export function getAppSettings(): Promise<AppSettings> {
  return request<AppSettings>("/admin/app-settings");
}

// 부분 갱신 — 넘긴 필드만 변경. tips에 빈 배열을 보내면 기본 팁으로 복원.
export function putAppSettings(patch: {
  ai_chat_tips?: string[];
  ai_chat_max_sessions_per_map?: number;
  ai_chat_max_messages_per_session?: number;
  ai_chat_retention_days?: number;
}): Promise<AppSettings> {
  return request<AppSettings>("/admin/app-settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function getAiTips(): Promise<{ tips: string[] }> {
  return request<{ tips: string[] }>("/ai/tips");
}

// ── 매뉴얼 다중 문서 (F10) ────────────────────────────────────
export type ManualLang = "ko" | "en";

export interface ManualDocSummary {
  id: number;
  title: string; // 본문에서 자동 추출
  language: ManualLang;
  format: ManualDoc["format"];
  sort_order: number;
  updated_at: string | null;
  updated_by: string | null;
}

export interface ManualDocDetail extends ManualDocSummary {
  content: string;
}

export function listManualDocs(language?: ManualLang): Promise<ManualDocSummary[]> {
  return request<ManualDocSummary[]>(
    `/manual/docs${language ? `?language=${language}` : ""}`,
  );
}

export function getManualDoc(docId: number): Promise<ManualDocDetail> {
  return request<ManualDocDetail>(`/manual/docs/${docId}`);
}

export function createManualDoc(body: {
  language: ManualLang;
  format: ManualDoc["format"];
  content: string;
}): Promise<ManualDocDetail> {
  return request<ManualDocDetail>("/manual/docs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateManualDoc(
  docId: number,
  body: Partial<{ language: ManualLang; format: ManualDoc["format"]; content: string }>,
): Promise<ManualDocDetail> {
  return request<ManualDocDetail>(`/manual/docs/${docId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteManualDoc(docId: number): Promise<void> {
  return request<void>(`/manual/docs/${docId}`, { method: "DELETE" });
}

// ── 운영 대시보드 (S10) ──────────────────────────────────────
export interface DashboardMetrics {
  visitors_unique: number; // 고유 접속자 수
  logins_total: number; // 전체 로그인 수
  logins_7d: number; // 최근 7일 로그인 수
}

// 접속자 현황 지표 (sysadmin) — login_records 집계.
export function getDashboard(): Promise<DashboardMetrics> {
  return request<DashboardMetrics>("/dashboard");
}

export interface AiUsagePeriod {
  calls: number;
  failed: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface AiUsageTopUser {
  login_id: string;
  name: string;
  calls: number;
  total_tokens: number;
}

export interface AiUsageTopMap {
  map_id: number;
  name: string;
  calls: number;
  total_tokens: number;
}

export interface AiUsageMetrics {
  last7: AiUsagePeriod;
  last30: AiUsagePeriod;
  top_users: AiUsageTopUser[];
  top_maps: AiUsageTopMap[];
}

// AI 챗 사용량 지표 (sysadmin) — ai_usage_events 집계.
export function getAiUsage(): Promise<AiUsageMetrics> {
  return request<AiUsageMetrics>("/dashboard/ai-usage");
}

// ── 디렉터리 API (collaborator picker, Layer 4 Task 0) ──────────────────────

export interface DirectoryUser {
  id: string;        // login_id
  name: string;      // English display name
  department: string;
  title?: string;    // 직급 — 멤버 2번째 줄(H2). 미채움 시 ""
  org_path?: string; // 루트→리프 조직 경로. 멤버 2번째 줄 말단 org·부서 카운트(H2). 미채움 시 ""
  role?: string;     // admin | user — 로컬 로그인 피커 관리자 식별
  korean_name?: string; // 한글 이름 — 서버 기본 "" (member-card design 2026-07-09)
  korean_dept?: string; // 한글 부서명 — 피커 검색 키워드 파생 (picker-korean-search design 2026-07-09)
}

export interface DirectoryDept {
  id: string;        // org_path string (e.g. "Management Support Division/Procurement Office")
  name: string;      // leaf segment
  korean_name: string; // dept_info 조인(리프명 키) — 없으면 ""
  manager: string;
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

export type GroupStatus = "pending" | "active" | "rejected" | "inactive";
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
  deleted_at: string | null;  // 소프트삭제/거절 시각 — 7일 후 자동 영구삭제
  name_changed_at: string | null;  // 마지막 이름변경 시각 — active 주 1회 rename 제한
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

// 그룹 삭제/비활성 — rejected는 즉시, 그 외는 소프트삭제(7일 보존). 매니저/생성자/sysadmin.
export function deleteGroup(groupId: number): Promise<Group> {
  return request<Group>(`/groups/${groupId}`, { method: "DELETE" });
}

// 거절된 그룹 재신청 → pending. 매니저/생성자/sysadmin.
export function resubmitGroup(groupId: number): Promise<Group> {
  return request<Group>(`/groups/${groupId}/resubmit`, { method: "POST" });
}

// 그룹 이름 사용 가능 여부 — 전역 중복 금지(모든 그룹이 안 보여도 서버가 판정). 생성 모달 실시간 검사.
export function checkGroupName(name: string): Promise<{ available: boolean }> {
  return request<{ available: boolean }>(`/groups/name-available?name=${encodeURIComponent(name)}`);
}

// 스케줄드 딜리션(휴지통) — 소프트삭제된 그룹 목록. 관리 가능분만(sysadmin 전체).
export function listDeletedGroups(): Promise<Group[]> {
  return request<Group[]>("/groups/deleted");
}

// 휴지통에서 복구 — deleted_at 해제(inactive로 복귀).
export function restoreGroup(groupId: number): Promise<Group> {
  return request<Group>(`/groups/${groupId}/restore`, { method: "POST" });
}

// 라이프사이클 — 신청 철회(pending 취소, 즉시 제거).
export function withdrawGroup(groupId: number): Promise<{ withdrawn: boolean }> {
  return request<{ withdrawn: boolean }>(`/groups/${groupId}/withdraw`, { method: "POST" });
}

// 라이프사이클 — 비활성(active→inactive, 삭제 전 단계).
export function deactivateGroup(groupId: number): Promise<Group> {
  return request<Group>(`/groups/${groupId}/deactivate`, { method: "POST" });
}

// 라이프사이클 — 재활성(inactive→active).
export function reactivateGroup(groupId: number): Promise<Group> {
  return request<Group>(`/groups/${groupId}/reactivate`, { method: "POST" });
}

// 라이프사이클 — 이름 변경(active만, 주 1회, 전역 중복 금지).
export function renameGroup(groupId: number, name: string): Promise<Group> {
  return request<Group>(`/groups/${groupId}/name`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
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
  korean_name: string;
  korean_dept: string;
}

export interface AdminDept {
  name: string;        // leaf segment
  org_levels: string[];
  korean_name: string; // dept_info 임포트값 — 없으면 ""
  manager: string;
}

export interface DeptInfoImportSummary {
  updated: number;
  unknown: string[];
}

export interface DeptRemapItem {
  path: string;         // 현 조직에 없는 org_path (조직개편 잔재)
  map_grants: number;   // 이 경로를 참조하는 맵 부서 권한 수
  group_members: number; // 이 경로를 참조하는 그룹 부서 멤버 수
}

/** sysadmin 전용 — 소멸 부서 경로를 참조 중인 권한·그룹 멤버 집계. */
export function getDeptRemap(): Promise<DeptRemapItem[]> {
  return request<DeptRemapItem[]>("/admin/dept-remap");
}

/** sysadmin 전용 — from_path 참조 전부를 현존 to_path로 일괄 이동(중복은 병합). */
export function postDeptRemap(
  fromPath: string,
  toPath: string,
): Promise<{ map_grants: number; group_members: number }> {
  return request("/admin/dept-remap", {
    method: "POST",
    body: JSON.stringify({ from_path: fromPath, to_path: toPath }),
  });
}

/** sysadmin 전용 — 부서 한글명·부서장 일괄 등록 (키: 영문 리프 부서명, 빈 필드는 기존 보존). */
export function importDeptInfo(
  entries: Record<string, { korean_name: string; manager: string }>,
): Promise<DeptInfoImportSummary> {
  return request<DeptInfoImportSummary>("/admin/dept-info", {
    method: "PUT",
    body: JSON.stringify({ entries }),
  });
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

export function markAllNotificationsRead(): Promise<void> {
  return request<void>("/notifications/read-all", { method: "POST" });
}

// ── 피드백 (design 2026-07-05) ──────────────

export type FeedbackKind = "bug" | "suggestion" | "question" | "etc";
export type FeedbackStatus = "draft" | "in_progress" | "done";

export interface FeedbackContext {
  route?: string;
  map_id?: number | null;
  version_id?: number | null;
}

export interface FeedbackItem {
  id: number;
  kind: FeedbackKind;
  body: string;
  author: string;
  context: FeedbackContext;
  status: FeedbackStatus;
  reply: string;
  created_at: string;
  body_edited_at: string | null;
  reply_at: string | null;
  done_at: string | null;
}

export interface FeedbackCounts {
  total: number;
  mine: number;
  in_progress: number;
  done: number;
}

export interface FeedbackList {
  items: FeedbackItem[];
  counts: FeedbackCounts;
}

export function submitFeedback(input: {
  kind: FeedbackKind;
  body: string;
  context?: FeedbackContext;
}): Promise<FeedbackItem> {
  return request<FeedbackItem>("/feedback", {
    method: "POST",
    body: JSON.stringify({
      kind: input.kind,
      body: input.body,
      context: input.context ?? {},
    }),
  });
}

export function listFeedback(): Promise<FeedbackList> {
  return request<FeedbackList>("/feedback");
}

export interface FeedbackPatch {
  status?: FeedbackStatus;
  reply?: string;
  body?: string;
}

// 부분 갱신 — 서버가 필드별 권한 검증(status=관리자·reply=관리자·body=작성자)
export function patchFeedback(id: number, patch: FeedbackPatch): Promise<FeedbackItem> {
  return request<FeedbackItem>(`/feedback/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteFeedback(id: number): Promise<void> {
  return request<void>(`/feedback/${id}`, { method: "DELETE" });
}

// ── 공지사항 (design 2026-07-05) ──────────────

export type NoticeImportance = "important" | "normal";

export interface NoticeItem {
  id: number;
  title: string;
  body_md: string;
  importance: NoticeImportance;
  starts_at: string;
  ends_at: string | null;
  created_by: string;
  created_at: string;
}

export interface NoticeInput {
  title: string;
  body_md: string;
  importance: NoticeImportance;
  starts_at: string;
  ends_at: string | null;
  notify_all?: boolean;
}

// 게시기간 유효분(열람용)
export function listNotices(): Promise<NoticeItem[]> {
  return request<NoticeItem[]>("/notices");
}

// 관리용 — 게시기간 무관 전체(sysadmin)
export function listNoticesManage(): Promise<NoticeItem[]> {
  return request<NoticeItem[]>("/notices/manage");
}

export function getNotice(id: number): Promise<NoticeItem> {
  return request<NoticeItem>(`/notices/${id}`);
}

export function createNotice(input: NoticeInput): Promise<NoticeItem> {
  return request<NoticeItem>("/notices", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateNotice(id: number, patch: Partial<NoticeInput>): Promise<NoticeItem> {
  return request<NoticeItem>(`/notices/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteNotice(id: number): Promise<void> {
  return request<void>(`/notices/${id}`, { method: "DELETE" });
}

// ── 온프레미스 AI 채팅 (design 2026-06-15) ──────────────

// 부분 갱신 시맨틱(증분 편집) — null/생략=유지, ""=지움, 값=설정 (백엔드 AiNodeAttributes 미러)
export interface AiNodeAttributes {
  assignee?: string | null;
  department?: string | null;
  system?: string | null;
  duration?: string | null;
  color?: string | null;
  url?: string | null;
  url_label?: string | null;
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

export type AiOpAction =
  | "add"
  | "remove"
  | "connect"
  | "relabel"
  | "set_attr"
  | "disconnect"
  | "set_edge_label"
  | "set_desc";

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
  description: string | null;
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
  // 적재된 대화 세션 id — 서버가 저장 후 세팅(새 대화 첫 전송 시 신규 id)
  session_id?: number | null;
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
  sessionId: number | null,
): Promise<AiProposal> {
  return request<AiProposal>(`/versions/${versionId}/ai/chat`, {
    method: "POST",
    body: JSON.stringify({ instruction, history, model, session_id: sessionId }),
  });
}

// ── AI 챗 서버 저장 히스토리 (design 2026-07-08) ──────────────

export interface AiChatSessionSummary {
  id: number;
  map_id: number;
  map_name: string;
  title: string;
  message_count: number;
  updated_at: string;
}

// 카드 재현용 제안 원자료 — kind별 서브셋(백엔드 serialize_proposal_payload 미러)
export interface AiMessagePayload {
  findings?: AiFinding[];
  steps?: AiStep[];
  nodes?: AiNode[];
  edges?: AiEdge[];
  groups?: AiGroup[];
  ops?: AiOp[];
}

export interface AiChatMessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  kind: string | null;
  payload: AiMessagePayload | null;
  version_id: number | null;
  created_at: string;
}

// 내 세션 목록(최근 활동순) — mapId 생략 시 전체 맵(맵 이름 포함, "다른 맵 대화" 목록용)
export function getAiChatSessions(
  mapId?: number,
): Promise<{ sessions: AiChatSessionSummary[] }> {
  const query = mapId !== undefined ? `?map_id=${mapId}` : "";
  return request<{ sessions: AiChatSessionSummary[] }>(`/ai/chat-sessions${query}`);
}

// 커서 페이징 — before(메시지 id)보다 오래된 limit개를 시간 오름차순으로
export function getAiChatMessages(
  sessionId: number,
  before?: number,
  limit = 30,
): Promise<{ messages: AiChatMessageRow[]; has_more: boolean }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) params.set("before", String(before));
  return request<{ messages: AiChatMessageRow[]; has_more: boolean }>(
    `/ai/chat-sessions/${sessionId}/messages?${params.toString()}`,
  );
}

export function deleteAiChatSession(sessionId: number): Promise<void> {
  return request<void>(`/ai/chat-sessions/${sessionId}`, { method: "DELETE" });
}

export function getAiModels(): Promise<{ models: string[] }> {
  return request<{ models: string[] }>("/ai/models");
}
