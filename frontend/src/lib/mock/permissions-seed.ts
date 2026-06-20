import type {
  Department, User, UserGroup, MapPermission, MapApprover, ApprovalRequest, MapMeta,
} from './permissions-types';

const TS = '2026-06-20T00:00:00Z';

export interface SeedState {
  departments: Department[];
  users: User[];
  groups: UserGroup[];
  mapMeta: MapMeta[];
  permissions: MapPermission[];
  approvers: MapApprover[];
  requests: ApprovalRequest[];
}

export function buildSeed(): SeedState {
  const departments: Department[] = [
    { id: 'proc',  code: 'PROC',  name: '프로세스혁신팀', orgLevels: ['본사', '경영지원', '프로세스혁신팀'], parentId: null, rawDn: 'OU=proc' },
    { id: 'purch', code: 'PURCH', name: '구매팀',        orgLevels: ['본사', '구매본부', '구매1실', '구매팀'], parentId: null, rawDn: 'OU=purch' },
    { id: 'hr',    code: 'HR',    name: '인사팀',        orgLevels: ['본사', '경영지원', '인사팀'], parentId: null, rawDn: 'OU=hr' },
    { id: 'qa',    code: 'QA',    name: '품질팀',        orgLevels: ['본사', '생산본부', '품질팀'], parentId: null, rawDn: 'OU=qa' },
  ];
  const users: User[] = [
    { id: 'admin.kim', name: '김관리', email: 'admin.kim@corp', departmentId: 'proc',  status: 'active', isSysadmin: true },
    { id: 'user.lee',  name: '이업무', email: 'user.lee@corp',  departmentId: 'purch', status: 'active', isSysadmin: false },
    { id: 'user.park', name: '박담당', email: 'user.park@corp', departmentId: 'hr',    status: 'active', isSysadmin: false },
    { id: 'user.choi', name: '최실무', email: 'user.choi@corp', departmentId: 'proc',  status: 'active', isSysadmin: false },
    { id: 'user.jung', name: '정사용', email: 'user.jung@corp', departmentId: 'qa',    status: 'active', isSysadmin: false },
  ];
  const groups: UserGroup[] = [
    { id: 'g-core', name: '핵심 프로세스 그룹', description: '데모 그룹', status: 'active', managerIds: ['admin.kim'], members: [{ type: 'department', id: 'proc' }, { type: 'user', id: 'user.lee' }] },
    { id: 'g-pending', name: '신규 검토 그룹', description: '승인 대기 데모', status: 'pending', managerIds: ['user.park'], members: [{ type: 'user', id: 'user.park' }] },
  ];
  const mapMeta: MapMeta[] = [
    { mapId: '1', visibility: 'public',  ownerId: 'user.lee' },
    { mapId: '2', visibility: 'private', ownerId: 'admin.kim' },
  ];
  const permissions: MapPermission[] = [
    { mapId: '1', principalType: 'user', principalId: 'user.lee',  role: 'owner',  grantedBy: 'system', grantedAt: TS },
    { mapId: '1', principalType: 'user', principalId: 'user.jung', role: 'editor', grantedBy: 'user.lee', grantedAt: TS },
    { mapId: '2', principalType: 'user',  principalId: 'admin.kim', role: 'owner',  grantedBy: 'system', grantedAt: TS },
    { mapId: '2', principalType: 'user',  principalId: 'user.park', role: 'viewer', grantedBy: 'admin.kim', grantedAt: TS },
    { mapId: '2', principalType: 'group', principalId: 'g-core',    role: 'editor', grantedBy: 'admin.kim', grantedAt: TS },
  ];
  const approvers: MapApprover[] = [
    { mapId: '1', userId: 'admin.kim', assignedBy: 'system' },
    { mapId: '2', userId: 'user.lee',  assignedBy: 'system' },
  ];
  const requests: ApprovalRequest[] = [];
  return { departments, users, groups, mapMeta, permissions, approvers, requests };
}
