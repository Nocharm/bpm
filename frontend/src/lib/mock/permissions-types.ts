// 후속 백엔드 스키마 미러 — 이번 PR은 mock 전용 / Mirror of future backend schema (mock only this PR)

export type PrincipalType = 'user' | 'department' | 'group';
export type MapRole = 'viewer' | 'editor' | 'owner';
export type MapVisibility = 'public' | 'private';
export type ApprovalKind = 'version_publish' | 'permission_downgrade' | 'visibility_change';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'applied';

export interface Department {       // AD 동기화 / synced from AD
  id: string;
  code: string;
  name: string;
  orgLevels: string[];             // org1..N 가변 — 레벨 수 하드코딩 금지 / variable depth
  parentId: string | null;
  rawDn: string;
}

export interface User {
  id: string;                      // sAMAccountName
  name: string;
  email: string;
  departmentId: string;
  status: 'active' | 'inactive';
  isSysadmin: boolean;
}

export interface UserGroup {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'active' | 'rejected';
  managerIds: string[];            // 그룹 권한 관리자 / group managers
  members: { type: 'department' | 'user'; id: string }[];
}

export interface MapPermission {
  mapId: string;
  principalType: PrincipalType;
  principalId: string;
  role: MapRole;
  grantedBy: string;
  grantedAt: string;
}

export interface MapApprover {
  mapId: string;
  userId: string;
  assignedBy: string;
}

// process_maps 확장(후속 백엔드) — 이번 PR은 mock 오버레이 / future ProcessMap columns, mock overlay this PR
export interface MapMeta {
  mapId: string;
  visibility: MapVisibility;       // 기본 private / default private
  ownerId: string;                 // 맵당 1인 / single owner per map
}

export interface ApprovalRequest {  // ①③④ 공용 / shared by flows ①③④
  id: string;
  mapId: string;
  kind: ApprovalKind;
  payload: unknown;                // kind별 상세 / per-kind detail
  requestedBy: string;
  status: RequestStatus;
  decidedBy?: string;
  decidedAt?: string;
}

// kind별 payload 형태 / per-kind payload shapes (payload는 unknown → 아래로 narrow)
export interface DowngradePayload {
  principalType: PrincipalType;
  principalId: string;
  fromRole: MapRole;
  toRole: MapRole | null;          // null = 제거 / removal
}
export interface VisibilityChangePayload {
  from: MapVisibility;
  to: MapVisibility;
}
export interface VersionPublishPayload {
  versionId: string;
  label: string;
}
