# Permission Management (UI-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 권한 관리(공개/비공개 + 개인·부서·그룹 권한 + 승인 흐름 + sysadmin 콘솔)를 프론트엔드 화면·상태·mock 데이터로 완성한다(백엔드 무변경).

**Architecture:** `frontend/src/lib/mock/` 아래 순수 mock 레이어(타입·시드·판정함수·in-memory store)를 두고, 신규 화면이 그 store를 구독한다. 권한은 실제 맵 리스트에 `mapId`-keyed mock 오버레이로 얹는다. 기존 버전게시 워크플로(미사용)는 건드리지 않고, mock 버전게시를 새 settings 화면에 별도로 구현한다. 에디터(`maps/[mapId]/page.tsx`)·백엔드는 변경하지 않는다.

**Tech Stack:** Next.js(App Router) + TypeScript(strict) + React 함수형 컴포넌트 + 기존 자산(`ModalBackdrop`+createPortal, `StatusBadge`, `ToastStack`, lucide-react, i18n `useI18n`, `genId`). 새 라이브러리 추가 없음. 새 테스트 러너 추가 없음.

## Global Constraints

- 브랜치 `feat/permission-management-ui`. main 직접 커밋 금지.
- **커밋 게이트(매 Task 끝)**: `npm run lint` + `npx tsc --noEmit` + `npm run build` 전부 통과 후 커밋. 커밋 전 `PROGRESS.md` 한 줄 갱신.
- 주석은 **EN/KO 병기**만(별도 산문 금지). UI 텍스트는 **i18n 키(en+ko)**, 기본 노출 한국어.
- id 생성은 `frontend/src/lib/id.ts`의 `genId()` (crypto.randomUUID 금지 — 평문 HTTP secure context 아님).
- 줄바꿈 LF 고정.
- **스코프 밖 금지**: `backend/` 변경, 실제 API 호출, 스키마 마이그레이션, 새 npm 의존성/테스트 러너. 필요가 보이면 멈추고 보고.
- **에디터 보호**: `frontend/src/app/maps/[mapId]/page.tsx`는 체크아웃 배너 1줄 외 변경 금지.
- **same fix twice → stop**: 같은 수정을 두 번 시도하면 중단·보고.
- `Department.orgLevels`는 `string[]` 가변 — org 레벨 수 하드코딩 금지.
- **Phase 1 종료 시 멈추고 사용자 확인**(설계 §11). Phase 2/3는 그 후 진행.
- Phase 1 순수함수 검증: 새 테스트 러너 없이 `npx --yes tsx`로 새너티 스크립트를 실행·관찰(스크립트는 커밋하지 않음) + `tsc`. UI 검증: `tsc/lint/build` + Playwright(시스템 Chrome) 실측(`docs/lessons/browser-verification.md` — 좀비 next dev/uvicorn `pkill -9 -f 'next dev|uvicorn app.main'` 후 클린 재기동, dev.db 오염 주의).

설계 문서: `docs/superpowers/specs/2026-06-20-permission-management-design.md`.

---

## File Structure

신규(모두 `frontend/src/` 하위):

| 파일 | 책임 |
|---|---|
| `lib/mock/permissions-types.ts` | 타입만(PrincipalType, MapRole, Department, User, UserGroup, MapPermission, MapApprover, ApprovalRequest, MapMeta). 백엔드 스키마 미러. |
| `lib/mock/permissions-seed.ts` | 시드 데이터(부서/유저/그룹/맵메타/맵권한/승인자/승인요청). `buildSeed()` 순수 팩토리(매 호출 새 객체 — 리셋용). |
| `lib/mock/permissions-logic.ts` | 순수 판정 함수(getEffectiveRole, isVisibleToUser, canComment, isDowngrade, requiresDowngradeApproval, getGroupMembership, getActiveApprovers, getMapMeta). state를 인자로 받음(side-effect 없음). |
| `lib/mock/permissions-store.ts` | in-memory store(state + pub-sub + `resetPermissions()`) + 액션(setRole, removePrincipal, addCollaborator, requestVisibilityChange, requestDowngrade, decideRequest, transferOwner, createMapPermission, group 액션, approver 액션). `usePermissions()` 훅(`useSyncExternalStore`). |
| `lib/mock/permissions.ts` | 배럴 — 위 4개 re-export(설계 §7의 단일 진입점). |
| `lib/mock/current-mock-user.ts` | `getCurrentMockUser()` — 기존 `current-user.ts`의 loginId → mock `User` 매핑(없으면 null). |
| `components/permissions/principal-picker.tsx` | 개인/부서/그룹 검색·선택 콤보(hangul 검색 재사용). Phase 2. |
| `components/permissions/role-badge.tsx` | 역할/승인대기 배지(StatusBadge 패턴). Phase 2. |
| `components/permissions/collaborators-panel.tsx` | §7.2 Collaborators 표. Phase 2. |
| `components/permissions/approvers-panel.tsx` | §7.2 Approvers + 활성0 경고. Phase 2. |
| `components/permissions/visibility-control.tsx` | §7.2 Visibility(owner만). Phase 2. |
| `components/permissions/danger-zone.tsx` | §7.2 오너 이양 확인모달 + 맵 삭제. Phase 2. |
| `components/permissions/versions-publish-panel.tsx` | §7.5 mock 버전게시 상태기계. Phase 2. |
| `components/permissions/reassign-approver-modal.tsx` | §7.6 재지정 모달. Phase 2. |
| `components/permissions/create-map-dialog.tsx` | §7.1 생성 다이얼로그. Phase 2. |
| `components/permissions/tabs.tsx` | 단순 탭(라이브러리 없음, 직접 구현). Phase 2. |
| `app/maps/[mapId]/settings/page.tsx` | §7.2/7.5 설정 페이지(탭 호스트). Phase 2. |
| `app/groups/page.tsx` | §7.3 유저그룹 목록+생성요청. Phase 3. |
| `app/groups/[groupId]/page.tsx` | §7.3 그룹 상세. Phase 3. |
| `components/admin/approval-queue.tsx` | §7.4 승인 큐(그룹생성·권한하향·visibility). Phase 3. |
| `components/admin/department-table.tsx` | §7.4 부서 테이블 + org 디버그 토글. Phase 3. |
| `components/admin/user-table.tsx` | §7.4 사용자 목록(read-only). Phase 3. |

수정:

| 파일 | 변경 |
|---|---|
| `app/page.tsx` | 인라인 생성 폼 → `CreateMapDialog` 트리거. 맵 리스트를 `isVisibleToUser`로 필터(Phase 2). |
| `lib/dev-auth.ts` | `LOCAL_USERS` 5인을 seed mock User와 정합(loginId·department 정렬, sysadmin 1인). (Phase 1) |
| `lib/i18n-messages.ts` | `perm.*` 키 en+ko 추가(각 Phase에서 사용분만). |
| `app/admin/page.tsx` | sysadmin 콘솔 탭(승인 큐·부서·유저·그룹) 추가(Phase 3). |
| `components/top-nav.tsx`(존재 시) | Groups/Settings 진입 링크(Phase 2/3, 위치 확인 후). |

---

# PHASE 1 — Mock 기반 (화면 없음, 단위 검증)

> 끝나면 **멈추고 보고**. Phase 2 진행은 사용자 확인.

### Task 1: 타입 정의 (`permissions-types.ts`)

**Files:**
- Create: `frontend/src/lib/mock/permissions-types.ts`

**Interfaces:**
- Produces: `PrincipalType`, `MapRole`, `Department`, `User`, `UserGroup`, `MapPermission`, `MapApprover`, `ApprovalRequest`, `MapMeta`, `ApprovalKind`, `RequestStatus`.

- [ ] **Step 1: 타입 파일 작성**

```ts
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
```

- [ ] **Step 2: 타입 컴파일 확인**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (오류 0). 타입만이라 미사용 경고 없음.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/mock/permissions-types.ts
git commit -m "feat(perm): mock permission types mirroring future backend schema — 권한 mock 타입"
```

---

### Task 2: 시드 데이터 (`permissions-seed.ts`)

**Files:**
- Create: `frontend/src/lib/mock/permissions-seed.ts`

**Interfaces:**
- Consumes: Task 1 타입.
- Produces: `SeedState` 인터페이스, `buildSeed(): SeedState` (매 호출 **새 객체** — store 리셋용).

`SeedState`:
```ts
export interface SeedState {
  departments: Department[];
  users: User[];
  groups: UserGroup[];
  mapMeta: MapMeta[];          // 알려진 맵(실제 seed map 1·2)에 대한 오버레이
  permissions: MapPermission[];
  approvers: MapApprover[];
  requests: ApprovalRequest[];
}
```

- [ ] **Step 1: 시드 작성**

핵심 시드 규칙(설계 §2 역할·§3 visibility 검증 가능하도록):
- 부서 4개(가변 org 레벨 — 일부는 3단계, 일부 4단계로 깊이 가변 확인): `proc`(프로세스혁신팀), `purch`(구매팀), `hr`(인사팀), `qa`(품질팀).
- 유저 5인 = 기존 `LOCAL_USERS` loginId와 동일: `admin.kim`(proc, **isSysadmin**), `user.lee`(purch), `user.park`(hr), `user.choi`(생산관리 → `proc`로 둠), `user.jung`(qa). 전원 active. 1인은 inactive 검증용으로 추가하지 말고 기존 5인 유지하되 store 액션에서 inactive 토글 가능.
- 그룹 2개: `g-core`(active, manager=admin.kim, members=[dept proc, user.lee]), `g-pending`(pending, manager=user.park).
- 맵 메타(실제 seed map id "1","2"): `1` = public·owner `user.lee`; `2` = private·owner `admin.kim`.
- 권한: 맵 `2`(private)에 `user.park` viewer, `g-core` editor(그룹). 맵 `1`(public)에 추가 grant `user.jung` editor.
- 승인자: 맵 `1` approver=[admin.kim], 맵 `2` approver=[user.lee].
- 요청: 빈 배열(런타임 생성).

전체 타임스탬프는 고정 문자열 상수(`'2026-06-20T00:00:00Z'`)로(테스트 결정성). `buildSeed()`는 배열·객체를 매번 새로 생성(스프레드/맵)하여 반환.

```ts
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
```

- [ ] **Step 2: tsc 확인** — Run: `cd frontend && npx tsc --noEmit` → PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/mock/permissions-seed.ts
git commit -m "feat(perm): mock seed (depts/users/groups/map perms) — 권한 mock 시드"
```

---

### Task 3: 순수 판정 함수 (`permissions-logic.ts`)

**Files:**
- Create: `frontend/src/lib/mock/permissions-logic.ts`

**Interfaces:**
- Consumes: Task 1 타입, Task 2 `SeedState`.
- Produces 함수(전부 첫 인자로 `state: SeedState`를 받는 순수 함수):
  - `getMapMeta(state, mapId, allMapIds?): MapMeta` — 메타 없으면 기본값(`visibility:'private'`, owner는 후술 규칙). 오버레이 lazy 기본값 생성.
  - `getGroupMembership(state, userId): string[]` — 전이적(유저 직접 + 유저 부서가 멤버인 그룹). active 그룹만.
  - `getEffectiveRole(state, userId, mapId): MapRole | null` — sysadmin=owner급, 명시 grant(user>그룹>부서 중 **최고 권한**), public이면 최소 viewer. 없으면 null.
  - `isVisibleToUser(state, userId, mapId): boolean` — `getEffectiveRole !== null`.
  - `canComment(state, userId, mapId): boolean` — viewer 이상.
  - `roleRank(role): number` — viewer<editor<owner.
  - `isDowngrade(from, to): boolean` — to=null(제거)이거나 rank 하락.
  - `requiresDowngradeApproval(from, to): boolean` — **editor → (viewer|제거)** 만 true. viewer 하향/제거는 false.
  - `getActiveApprovers(state, mapId): MapApprover[]` — approver userId가 active 유저인 것만.
  - `hasActiveApprover(state, mapId): boolean`.

**판정 규칙 상세(설계 §2·§3):**
- sysadmin: 모든 맵 owner급 → `getEffectiveRole`는 `'owner'` 반환(단 ownerId 교체는 아님, 권한 레벨만).
- 명시 grant 해석: 해당 유저에 적용되는 모든 권한(개인 grant + 전이적 그룹 grant + 부서 grant) 중 `roleRank` 최고.
- public 베이스라인: grant 없고 sysadmin 아니어도 `'viewer'`.
- private + grant 없음 + sysadmin 아님 → `null`.

```ts
import type { SeedState } from './permissions-seed';
import type { MapRole, MapMeta, MapApprover } from './permissions-types';

export function roleRank(role: MapRole): number {
  return role === 'owner' ? 3 : role === 'editor' ? 2 : 1;
}

export function getMapMeta(state: SeedState, mapId: string, fallbackOwnerId = ''): MapMeta {
  const found = state.mapMeta.find((m) => m.mapId === mapId);
  if (found) return found;
  // 오버레이 기본 규칙: 알려지지 않은 실제 맵은 private + created_by(=fallbackOwnerId)
  return { mapId, visibility: 'private', ownerId: fallbackOwnerId };
}

export function getGroupMembership(state: SeedState, userId: string): string[] {
  const user = state.users.find((u) => u.id === userId);
  const deptId = user?.departmentId;
  return state.groups
    .filter((g) => g.status === 'active')
    .filter((g) => g.members.some((m) =>
      (m.type === 'user' && m.id === userId) ||
      (m.type === 'department' && m.id === deptId)))
    .map((g) => g.id);
}

export function getEffectiveRole(state: SeedState, userId: string, mapId: string): MapRole | null {
  const user = state.users.find((u) => u.id === userId);
  if (user?.isSysadmin) return 'owner';
  const meta = getMapMeta(state, mapId);
  const groupIds = getGroupMembership(state, userId);
  const deptId = user?.departmentId;
  const applicable = state.permissions.filter((p) =>
    p.mapId === mapId && (
      (p.principalType === 'user' && p.principalId === userId) ||
      (p.principalType === 'group' && groupIds.includes(p.principalId)) ||
      (p.principalType === 'department' && p.principalId === deptId)));
  let best: MapRole | null = applicable.length
    ? applicable.reduce((acc, p) => (roleRank(p.role) > roleRank(acc) ? p.role : acc), applicable[0].role)
    : null;
  if (!best && meta.visibility === 'public') best = 'viewer';
  return best;
}

export function isVisibleToUser(state: SeedState, userId: string, mapId: string): boolean {
  return getEffectiveRole(state, userId, mapId) !== null;
}

export function canComment(state: SeedState, userId: string, mapId: string): boolean {
  return getEffectiveRole(state, userId, mapId) !== null; // viewer 이상 / viewer+
}

export function isDowngrade(from: MapRole, to: MapRole | null): boolean {
  if (to === null) return true;
  return roleRank(to) < roleRank(from);
}

export function requiresDowngradeApproval(from: MapRole, to: MapRole | null): boolean {
  // editor → viewer/제거만 승인 게이트 / only editor downgrade/removal gated (설계 §4③)
  return from === 'editor' && (to === 'viewer' || to === null);
}

export function getActiveApprovers(state: SeedState, mapId: string): MapApprover[] {
  const activeIds = new Set(state.users.filter((u) => u.status === 'active').map((u) => u.id));
  return state.approvers.filter((a) => a.mapId === mapId && activeIds.has(a.userId));
}

export function hasActiveApprover(state: SeedState, mapId: string): boolean {
  return getActiveApprovers(state, mapId).length > 0;
}
```

- [ ] **Step 1: 위 파일 작성.**

- [ ] **Step 2: tsc 확인** — Run: `cd frontend && npx tsc --noEmit` → PASS.

- [ ] **Step 3: 새너티 스크립트로 동작 검증(커밋 안 함)**

Create temp `frontend/_perm_sanity.ts`:
```ts
import { buildSeed } from './src/lib/mock/permissions-seed';
import { getEffectiveRole, isVisibleToUser, requiresDowngradeApproval, getGroupMembership } from './src/lib/mock/permissions-logic';

const s = buildSeed();
const assert = (name: string, cond: boolean) => { if (!cond) { console.error('FAIL', name); process.exit(1); } console.log('ok', name); };

// public 맵(1): grant 없는 user.park도 viewer
assert('public baseline viewer', getEffectiveRole(s, 'user.park', '1') === 'viewer');
// private 맵(2): grant 없는 user.jung은 숨김
assert('private hidden', isVisibleToUser(s, 'user.jung', '2') === false);
// private 맵(2): viewer grant
assert('private viewer grant', getEffectiveRole(s, 'user.park', '2') === 'viewer');
// 그룹 전이성: user.lee는 g-core(맵2 editor) 멤버 → editor
assert('group editor', getEffectiveRole(s, 'user.lee', '2') === 'editor');
// 부서 전이성: admin.kim 부서 proc가 g-core 멤버 → 그룹 상속 (단 sysadmin이라 owner)
assert('sysadmin owner', getEffectiveRole(s, 'admin.kim', '2') === 'owner');
// 부서→그룹 상속: user.choi(proc) → g-core editor(맵2)
assert('dept->group editor', getEffectiveRole(s, 'user.choi', '2') === 'editor');
assert('membership transitive', getGroupMembership(s, 'user.choi').includes('g-core'));
// 승인 게이트
assert('editor downgrade gated', requiresDowngradeApproval('editor', 'viewer') === true);
assert('viewer downgrade free', requiresDowngradeApproval('viewer', null) === false);
console.log('ALL PASS');
```
Run: `cd frontend && npx --yes tsx _perm_sanity.ts`
Expected: 모든 `ok ...` + `ALL PASS`. (FAIL 시 로직 수정 — same fix twice면 중단·보고.)
그다음: `rm frontend/_perm_sanity.ts` (커밋하지 않음).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/mock/permissions-logic.ts
git commit -m "feat(perm): pure permission judgment functions — 권한 순수 판정 함수"
```

---

### Task 4: in-memory store + 액션 (`permissions-store.ts` + 배럴)

**Files:**
- Create: `frontend/src/lib/mock/permissions-store.ts`
- Create: `frontend/src/lib/mock/permissions.ts` (배럴)

**Interfaces:**
- Consumes: Task 1~3.
- Produces:
  - `getPermissionState(): SeedState` / `subscribePermissions(cb): () => void` / `resetPermissions(): void`.
  - `usePermissions(): SeedState` (`useSyncExternalStore`).
  - 액션(모두 state를 새 객체로 교체 후 emit):
    - `addCollaborator(mapId, principalType, principalId, role, by)` — 상향·추가 즉시.
    - `changeRole(mapId, principalType, principalId, toRole, by): { gated: boolean }` — editor 하향/제거면 `requiresDowngradeApproval` → 즉시 적용 대신 `permission_downgrade` 요청 생성(gated:true). 아니면 즉시.
    - `removeCollaborator(mapId, principalType, principalId, by): { gated: boolean }` — 동일 게이트(editor 제거는 요청).
    - `requestVisibilityChange(mapId, to, by)` — `visibility_change` 요청 생성.
    - `decideRequest(requestId, decision: 'approved'|'rejected', by)` — 승인 시 payload에 따라 실제 적용(visibility 변경/권한 하향) 후 status='applied', 반려 시 'rejected'.
    - `transferOwner(mapId, toUserId, by)` — 원 owner editor 강등 + toUser owner(권한 + MapMeta.ownerId 교체). 승인 아님.
    - `createMapPermission(mapId, ownerId, visibility, collaborators, approverIds)` — 생성 다이얼로그용 오버레이 엔트리.
    - `requestVersionPublish(mapId, versionId, label, by)` / 버전게시 상태는 별도 경량 맵(`versionFlow: Record<versionId, {status, requestedBy}>`)으로 store에 둠.
    - group 액션: `requestGroup(...)`, `decideGroup(groupId, 'active'|'rejected')`, `addGroupMember/removeGroupMember`, `setGroupManagers`.
    - approver 액션: `setApprovers(mapId, userIds, by)`, `toggleUserActive(userId)`(데모용 비활성 검증).

설계 결정: store는 모듈 레벨 `let state = buildSeed()` + listener Set(기존 `current-user.ts` 패턴). `resetPermissions()`는 `state = buildSeed()` 후 emit. 영속화 없음(새로고침 시 모듈 재평가 → 시드 리셋).

- [ ] **Step 1: store 작성**(액션은 위 시그니처대로, 각 액션은 불변 갱신 + emit).
- [ ] **Step 2: 배럴 작성** — `permissions.ts`에서 types/seed/logic/store re-export.
- [ ] **Step 3: tsc/lint 확인** — Run: `cd frontend && npx tsc --noEmit && npm run lint` → PASS.
- [ ] **Step 4: 새너티(커밋 안 함)** — temp 스크립트로: addCollaborator(맵2, user.jung editor) 후 getEffectiveRole=editor; changeRole(맵2, g-core, editor→viewer) → gated:true & 요청 1건; decideRequest(approved) 후 그룹 권한 viewer 적용; transferOwner(맵2, user.lee) 후 메타 ownerId='user.lee' & admin.kim... (sysadmin이라 effrole owner 유지되므로 비-sysadmin owner로 검증: 맵1 user.lee→user.jung 이양 후 user.lee editor). Run `npx --yes tsx`, 관찰, `rm`.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/mock/permissions-store.ts frontend/src/lib/mock/permissions.ts
git commit -m "feat(perm): in-memory mock store + actions (reset on reload) — 권한 mock store"
```

---

### Task 5: mock user 매핑 + 5인 정합

**Files:**
- Create: `frontend/src/lib/mock/current-mock-user.ts`
- Modify: `frontend/src/lib/dev-auth.ts` (LOCAL_USERS 5인을 seed User와 정합: loginId·department 일치, admin.kim은 admin role 유지)

**Interfaces:**
- Produces: `getCurrentMockUser(state, currentUser): User | null` — `currentUser.loginId`로 seed user 조회.
- Consumes: Task 1 User, 기존 `lib/current-user.ts`.

- [ ] **Step 1:** `current-mock-user.ts` — `getCurrentMockUser(state, loginId): User | null = state.users.find(u => u.id === loginId) ?? null`. 훅 `useCurrentMockUser()`(usePermissions + current-user 구독 결합).
- [ ] **Step 2:** `dev-auth.ts` LOCAL_USERS의 loginId/부서를 seed(admin.kim/user.lee/user.park/user.choi/user.jung)와 일치 확인·정렬(이미 일치하면 무변경). department 라벨도 seed와 정합.
- [ ] **Step 3: tsc/lint** → PASS.
- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/mock/current-mock-user.ts frontend/src/lib/dev-auth.ts
git commit -m "feat(perm): map current login user to mock User; align 5 dev users — mock 유저 매핑"
```

---

### Phase 1 종료 검증 + STOP

- [ ] Run: `cd frontend && npm run lint && npx tsc --noEmit && npm run build` → 전부 PASS.
- [ ] `PROGRESS.md` 한 줄 갱신(Phase 1 완료).
- [ ] **STOP — 사용자에게 보고**: mock 레이어·판정함수·store·유저매핑 완료, 새너티 통과. Phase 2 진행 확인 요청.

---

# PHASE 2 — 맵 권한 UI

> Phase 1 사용자 확인 후 진행. 각 Task 끝 `lint+tsc+build` + 커밋. UI는 design 토큰(`rules/frontend/design.md`)·i18n(en+ko) 준수. 컴포넌트 마크업은 토큰/패턴대로 작성(인라인 hex 금지, lucide 16px/1.5, `text-caption`/`text-fine` 컴팩트 밀도). 검증은 tsc/lint/build + Playwright(시스템 Chrome) 실측 — `pkill -9 -f 'next dev|uvicorn app.main'` 후 클린 1쌍 재기동, dev.db 오염 주의.

### Task 6: 공통 프리미티브 — `tabs.tsx`, `role-badge.tsx`, `principal-picker.tsx`

**Files:** Create `components/permissions/tabs.tsx`, `role-badge.tsx`, `principal-picker.tsx`. Modify `lib/i18n-messages.ts`(perm.role.*, perm.pendingApproval 등).

**Interfaces:**
- `Tabs({ tabs: {key,label}[], active, onChange })` — 직접 구현(상태 기반, 라이브러리 없음).
- `RoleBadge({ role, pending? })` — `StatusBadge` 스타일 재사용(역할 색 토큰 + pending이면 「승인 대기」).
- `PrincipalPicker({ onPick })` — 개인/부서/그룹 통합 검색(기존 `lib/hangul.ts` 초성검색 재사용), lucide 아이콘으로 종류 구분(User/Building2/Users).

- [ ] Step 1: i18n 키 추가(en+ko). Step 2: 세 컴포넌트 작성(토큰 준수). Step 3: `tsc+lint+build`. Step 4: Commit.

### Task 7: 설정 페이지 셸 — `app/maps/[mapId]/settings/page.tsx`

**Files:** Create `app/maps/[mapId]/settings/page.tsx`. (에디터 `page.tsx` 미수정.)

**Interfaces:**
- Consumes: `usePermissions`, `useCurrentMockUser`, `getEffectiveRole`, `getMapMeta`. 맵 이름은 기존 `lib/api.ts` `getMap`로 표시(읽기 전용 표시용 — 권한 데이터는 mock).
- 탭: Collaborators / Approvers / Visibility / Versions / Danger. owner/sysadmin이 아니면 편집 컨트롤 비활성(읽기 표시).

- [ ] Step 1: 라우트 + Tabs 셸 + 권한 게이팅(현재 mock 유저 effectiveRole로 owner 여부). Step 2: 빈 탭 패널 자리. Step 3: `tsc+lint+build`. Step 4: Playwright — `/maps/2/settings` 진입, admin.kim(owner)일 때 탭 5개 표시. Step 5: Commit.

### Task 8: Collaborators 패널 — `collaborators-panel.tsx`

**Files:** Create `components/permissions/collaborators-panel.tsx`. Wire into settings Task 7.

**동작(설계 §7.2):** principal 행(아이콘+이름+역할 드롭다운). 상향·추가=즉시(`addCollaborator`/`changeRole` non-gated). **editor 하향·제거 → `changeRole`/`removeCollaborator`가 gated:true 반환 시 행에 「승인 대기」 배지 + 요청 생성(toast)**. 부서·그룹도 editor 부여 가능(PrincipalPicker). principal 종류 무관 동일.

- [ ] Step 1: 패널 작성(usePermissions 구독, 액션 호출). Step 2: 「승인 대기」 배지 = 해당 principal에 pending `permission_downgrade` 요청 있으면 표시. Step 3: `tsc+lint+build`. Step 4: Playwright(맵2, admin.kim): g-core editor→viewer 시 「승인 대기」 배지 + 요청 생성 확인; user.jung viewer 추가 즉시 반영. Step 5: Commit.

### Task 9: Approvers 패널 + 재지정 모달 — `approvers-panel.tsx`, `reassign-approver-modal.tsx`

**Files:** Create both. Wire into settings.

**동작(설계 §5·§7.6):** 승인자 추가/제거(PrincipalPicker, user만), 비활성 표시(`status==='inactive'`), `getActiveApprovers` 0이면 경고 + **재지정 모달 강제**. `toggleUserActive`로 데모 비활성화 가능.

- [ ] Step 1: approvers-panel(목록·추가·제거·비활성 뱃지·활성0 경고). Step 2: reassign-approver-modal(ModalBackdrop, 활성 승인자 0 감지 시 강제 노출, 닫기 불가까지). Step 3: `tsc+lint+build`. Step 4: Playwright: 맵2 승인자 user.lee 비활성 토글 → 활성0 경고 + 재지정 모달 강제. Step 5: Commit.

### Task 10: Visibility + Danger zone — `visibility-control.tsx`, `danger-zone.tsx`

**Files:** Create both. Wire into settings.

**동작:** Visibility(owner만; public↔private 변경 시 `requestVisibilityChange` → 「승인 대기」). Danger: 오너 이양(editor+ 1인 선택 → 확인 모달 1회 → `transferOwner`: 원 owner editor 강등 + 지정자 owner). 맵 삭제(mock 확인 모달; 실제 삭제는 기존 `deleteMap` 호출하되 — **확인**: 실제 삭제는 백엔드 호출이므로 데모에서는 mock 제거만 하거나 기존 deleteMap 사용? 설계 §1 "실제 맵 유지" → 맵 삭제는 기존 `deleteMap` API 사용 OK(권한과 무관한 기존 기능). owner/sysadmin만 노출).

- [ ] Step 1: visibility-control(owner 게이트, 변경 시 요청+배지, public이면 조회 grant 입력 비활성 연동 플래그 export). Step 2: danger-zone(이양 확인모달 + 삭제). Step 3: `tsc+lint+build`. Step 4: Playwright: 맵1 owner(user.lee)로 전환 → 이양 user.jung → 확인 → user.lee effrole editor, 메타 owner user.jung. visibility public→private 요청 시 배지. Step 5: Commit.

### Task 11: 버전 게시(mock) 패널 — `versions-publish-panel.tsx`

**Files:** Create `components/permissions/versions-publish-panel.tsx`. Wire into settings Versions 탭. (에디터 미수정 — 이 패널이 mock 버전게시 UI.)

**동작(설계 §4①):** 버전 목록(기존 `getMap` 버전 라벨 표시) + mock 상태기계(store `versionFlow`): draft→[승인 요청]→pending→(승인자 화면)승인→approved→요청자[게시]→published. 반려=rejected. 현재 mock 유저가 요청자/승인자에 따라 버튼 분기. `StatusBadge` 재사용.

- [ ] Step 1: 패널 + store versionFlow 액션 연동. Step 2: 역할 분기(요청자=현재유저, 승인자=맵 approver). Step 3: `tsc+lint+build`. Step 4: Playwright: 맵2 user.lee(approver)·admin.kim(요청자) 전환하며 요청→승인→게시 흐름. Step 5: Commit.

### Task 12: 생성 다이얼로그 — `create-map-dialog.tsx` + 홈 연동

**Files:** Create `components/permissions/create-map-dialog.tsx`. Modify `app/page.tsx`(인라인 폼 → 다이얼로그 트리거; 맵 리스트 `isVisibleToUser` 필터).

**동작(설계 §7.1):** 이름/설명 + visibility 토글(public 시 조회 grant 입력 비활성) + 초기 collaborators(PrincipalPicker × viewer|editor) + 필수 승인자(≥1, 미지정 시 생성 불가). 생성 = 기존 `createMap(name)` 호출 → 반환 mapId로 `createMapPermission` 오버레이 기록(owner=현재유저, visibility, collaborators, approverIds).

- [ ] Step 1: 다이얼로그(ModalBackdrop). Step 2: 홈 연동 + 리스트 필터(현재 mock 유저 `isVisibleToUser`). Step 3: `tsc+lint+build`. Step 4: Playwright: 승인자 미지정 시 생성 버튼 비활성; 생성 후 홈 리스트에 표시; 다른 유저로 전환 시 private 맵 숨김. Step 5: Commit.

### Phase 2 종료
- [ ] `lint+tsc+build` 전부 PASS. `PROGRESS.md` 갱신. 보고(중간 STOP은 설계상 Phase 1만 필수 — Phase 2 완료 보고 후 Phase 3 진행).

---

# PHASE 3 — 그룹 & sysadmin

### Task 13: 유저그룹 목록 + 생성요청 — `app/groups/page.tsx`

**동작(설계 §7.3):** 목록(status pending/active/rejected 배지), 생성 요청 폼(이름/설명/멤버(부서·개인 PrincipalPicker)/그룹 관리자). 제출 = `requestGroup` (status pending).

- [ ] Step 1: 라우트+목록+폼. Step 2: i18n. Step 3: `tsc+lint+build`. Step 4: Playwright: 생성요청 → 목록에 pending 추가. Step 5: Commit.

### Task 14: 그룹 상세 — `app/groups/[groupId]/page.tsx`

**동작:** 멤버 add/remove, 관리자 지정 — **그룹 관리자/sysadmin만**(현재 mock 유저 게이트). active 그룹만 편집.

- [ ] Step 1~4 (작성→i18n→빌드게이트→Playwright: 관리자=user.park가 g-pending 멤버 추가, 비관리자는 비활성). Step 5: Commit.

### Task 15: sysadmin 콘솔 — admin 페이지 확장 + `approval-queue.tsx` / `department-table.tsx` / `user-table.tsx`

**Files:** Modify `app/admin/page.tsx`(탭 추가). Create 3 컴포넌트.

**동작(설계 §7.4):**
- 승인 큐: pending `ApprovalRequest`(그룹생성[UserGroup.status==='pending']·권한하향·visibility) 승인/반려 = `decideRequest`/`decideGroup`. **오너 이양은 큐에 없음**(설계 §4④').
- 부서 테이블: 기본 department 컬럼만 → **디버그 토글**로 `orgLevels` 전체 컬럼 동적 노출(레벨 수 가변 — 최대 길이로 헤더 생성, 하드코딩 금지).
- 사용자 목록: status 표시, sysadmin은 env 관리이므로 **read-only** 라벨.
- 콘솔 전체 sysadmin 게이트(현재 mock 유저 `isSysadmin`).

- [ ] Step 1: admin 탭 셸 + sysadmin 게이트. Step 2: approval-queue. Step 3: department-table(디버그 토글, orgLevels 가변 컬럼). Step 4: user-table(read-only). Step 5: i18n. Step 6: `tsc+lint+build`. Step 7: Playwright(admin.kim): 권한하향 요청 승인→적용, 그룹생성 승인→active, 부서 디버그 토글로 org 컬럼 노출. Step 8: Commit.

### Task 16: 알림(토스트/배지) 연결 — `ToastStack` 재사용

**동작(설계 §7.7):** 권한 변경·승인 결과를 기존 `ToastStack`로. 「승인 대기」 배지는 Task 8/10/11에서 이미 연결 — 누락분 점검.

- [ ] Step 1: 액션 성공/요청 생성 시 toast 발생(공통 헬퍼). Step 2: `tsc+lint+build`. Step 3: Playwright: 권한 변경 시 toast 노출. Step 4: Commit.

### Phase 3 종료 + 수용기준 검증
- [ ] 설계 §12 수용 기준 13개 전부 Playwright/수동 실측으로 확인(체크리스트).
- [ ] `lint+tsc+build` PASS. `PROGRESS.md` 갱신. 최종 보고.

---

## Self-Review (작성자 점검 결과)

**1. Spec coverage:** 설계 §2~§9 매핑 — 역할/visibility(Task 3 logic), 승인흐름 ①(Task 11)②(Task 13/15)③(Task 8/15)④(Task 10/15)④'(Task 10, 큐 제외 명시), 승인자/재지정(Task 9), 데이터모델(Task 1), mock레이어/스위처(Task 2~5), 화면 7.1(Task 12)7.2(Task 8~10)7.3(Task 13~14)7.4(Task 15)7.5(Task 11)7.6(Task 9)7.7(Task 16). 수용기준 13개 → Phase 종료 검증. **갭 없음.**

**2. Placeholder scan:** Phase 1은 전체 코드 제공. Phase 2/3 UI Task는 "파일·인터페이스·동작·검증"을 구체화하되 JSX 전문은 design 토큰 규칙에 위임(코드 컨벤션상 마크업은 토큰대로 작성) — 로직/상태/액션 시그니처는 Task 1~5에서 확정. "TODO/나중에" 없음. 단 Task 10 맵 삭제는 기존 `deleteMap` 사용 여부를 인라인 결정(실 삭제는 권한 무관 기존 기능 → 사용 OK)로 명시.

**3. Type consistency:** 액션·함수명 통일 — `getEffectiveRole`/`isVisibleToUser`/`requiresDowngradeApproval`/`changeRole`/`addCollaborator`/`decideRequest`/`transferOwner`/`createMapPermission`/`getCurrentMockUser`가 Task 3~5 정의와 Task 6~16 사용에서 일치. `buildSeed`/`SeedState`/`resetPermissions`/`usePermissions` 일관.

**열린 항목(실행 중 확정):** ① `top-nav` 존재·위치 확인 후 Groups/Settings 링크(Task 7/13). ② Playwright 검증은 dev 모드(AUTH_ENABLED=false)에서 mock 유저 스위처로 수행.
