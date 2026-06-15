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
  // 업무 묶음(그룹 박스) 소속 그룹 id — null=무소속 (Phase 2)
  group_id: string | null;
  has_children?: boolean;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
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

function scopeQuery(parentId: string | null): string {
  return parentId ? `?parent=${encodeURIComponent(parentId)}` : "";
}

export function getGraph(
  versionId: number,
  parentId: string | null = null,
): Promise<Graph> {
  return request<Graph>(`/versions/${versionId}/graph${scopeQuery(parentId)}`);
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

export function saveGraph(
  versionId: number,
  graph: Graph,
  parentId: string | null = null,
): Promise<Graph> {
  return request<Graph>(`/versions/${versionId}/graph${scopeQuery(parentId)}`, {
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

export function getMe(): Promise<{ username: string; ai_enabled: boolean }> {
  return request<{ username: string; ai_enabled: boolean }>("/me");
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

export interface AiNode {
  key: string;
  title: string;
  node_type: string;
  description: string;
}

export interface AiEdge {
  source: string;
  target: string;
  label: string;
}

export interface AiProposal {
  kind: "graph" | "answer";
  message: string;
  nodes: AiNode[];
  edges: AiEdge[];
}

export interface AiChatTurn {
  role: string;
  content: string;
}

export function aiChat(
  versionId: number,
  parent: string | null,
  instruction: string,
  history: AiChatTurn[],
  model: string | null,
): Promise<AiProposal> {
  return request<AiProposal>(`/versions/${versionId}/ai/chat`, {
    method: "POST",
    body: JSON.stringify({ parent, instruction, history, model }),
  });
}

export function getAiModels(): Promise<{ models: string[] }> {
  return request<{ models: string[] }>("/ai/models");
}
