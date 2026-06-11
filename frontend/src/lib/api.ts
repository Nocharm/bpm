// 백엔드 REST 클라이언트. /api는 nginx(운영) 또는 next.config rewrites(로컬)가 backend로 프록시.

export interface MapSummary {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface VersionSummary {
  id: number;
  label: string;
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
  pos_x: number;
  pos_y: number;
  sort_order: number;
  has_children?: boolean;
}

export interface GraphEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  label: string;
}

export interface Graph {
  nodes: GraphNode[];
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
    throw new Error(`API ${init?.method ?? "GET"} ${path} failed: ${response.status}`);
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
