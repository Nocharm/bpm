# 권한 관리 (Permission Management) — UI-first 설계

- **날짜**: 2026-06-20
- **브랜치**: `feat/permission-management-ui` (워크트리 `feat+permission-management`)
- **범위**: 프론트엔드 화면 + 상태 흐름 + mock 데이터. **백엔드(스키마·API·실제 권한 판정)는 후속 PR.**
- **대상 파일 보호**: `frontend/src/app/maps/[mapId]/page.tsx`(약 5000줄 에디터)는 체크아웃 배너 1줄 외 변경 금지.

---

## 0. 배경 / 목표

현재 BPM은 인증(Keycloak)만 있고 인가(권한)가 없다 — 로그인하면 누구나 모든 맵을 열람·편집·삭제한다.
GitHub/GitLab 권한 모델을 차용해 **공개/비공개 베이스라인 + 명시적 권한 부여(개인·부서·그룹)** 를 도입한다.

이번 PR 목표: **권한 관리 화면과 상태 흐름을 mock 데이터로 완성.** 백엔드 연동 없음.
mock 타입은 후속 백엔드 스키마를 그대로 미러링해 교체 비용을 0에 가깝게.

---

## 1. 스코프 경계 (코드 대조로 확정 — 가장 중요)

코드베이스 탐색으로 스펙 가정 일부가 실제와 달라 아래로 확정한다.

| 구분 | 결정 |
|---|---|
| **순수 mock & 자체 완결** | 모든 권한 개념(collaborators/roles/visibility/owner/groups/departments + 권한하향·visibility변경 승인 + 그룹생성 승인 + sysadmin 콘솔 + **버전게시 §7.5**)은 mock 레이어로. 실제 API 호출 없음. 새로고침 시 시드 리셋 허용. |
| **버전게시 승인(흐름 ①)** | 기존에 실제 백엔드+프론트(`workflow.py`/`versions.py`/`workflow-dashboard.tsx`)로 구현돼 있으나 **현재 미사용** → 보존 불필요. 이번 PR은 §7.5를 **mock 상태기계로 신규 구현**. 단 백엔드 코드는 **삭제하지 않음**(백엔드 PR 소관), 에디터도 수정하지 않음 → mock 버전게시는 신규 settings 화면에 배치. |
| **맵 승인자(approvers)** | 실제 백엔드(`approvers.py`)가 있으나 비활성(inactive) 개념이 없음 → 이번 PR은 **mock으로 통일**. 실제 approvers·버전워크플로 코드는 그대로 둠(미사용). 두 목록 병존은 백엔드 PR에서 정리. |
| **맵 리스트** | 실제 `listMaps()` 유지 + `mapId`로 keyed된 mock 권한 오버레이. 기존 맵 기본값 `owner = created_by`, `visibility = private`. 생성 다이얼로그가 생성 시 mock 권한 엔트리 기록. 실제 에디터는 그대로 동작. |
| **i18n** | 코드베이스가 EN 권위 + KO 병행을 TS 타입으로 강제하는 i18n(`lib/i18n-messages.ts`)을 씀 → 신규 UI도 **i18n 따름(en+ko 키 추가)**. 기본 노출은 한국어(lang=ko). |
| **백엔드 무변경** | 이번 PR에서 `backend/` 변경 없음. visibility/owner/permission/group/department-permission 스키마는 후속 PR. |

---

## 2. 용어 / 역할

| 역할 | 권한 |
|---|---|
| **viewer** | 조회. 코멘트 가능. |
| **editor** | 조회 + 편집(체크아웃) + 권한 관리 + 승인 요청. **권한 상향·추가는 즉시**, 동급(editor) 하향·제거는 승인 게이트. |
| **owner** | editor 전부 + visibility 변경 요청 + 오너 이양. **맵당 1인.** 생성자 = 초기 owner. |
| **sysadmin** | 전역. `BPM_SYSADMINS` env 화이트리스트(sAMAccountName) — mock에서는 `User.isSysadmin`. 모든 맵 owner급 + 그룹 생성 승인 + 모든 승인 큐 조정 + 비활성 오너/승인자 대체. |

- **Principal(권한 주체) 3종**: `user | department | group`. 부서·그룹도 editor 부여 가능(맵 편집은 체크아웃으로 1인 직렬화되므로 안전).
- **코멘트**: viewer 이상 전원 가능.
- **그룹 멤버십은 전이적**: 유저가 그룹에 직접 속하거나, 유저의 부서가 그룹 멤버면 상속.

---

## 3. 가시성 (visibility)

| visibility | 조회 베이스라인 | 편집 |
|---|---|---|
| **private (기본)** | grant 없으면 목록·열람 불가 | grant 필요 |
| **public** | 전원 viewer | grant 필요 |

- `visibility == public`이면 조회 grant 입력 UI 비활성(이미 전원 열람).
- `private ↔ public` 전환은 owner 요청 → 맵 승인자 승인 → 적용(승인 흐름 ④).

---

## 4. 승인 흐름 (요청 → 승인 → 적용 상태 기계, 모두 mock)

### ① 버전 게시 승인 (mock 신규 — settings의 Versions 패널)
`작성 → [승인 요청] → 승인 대기 → 맵 승인자 승인/반려 → (승인 시) 요청자에게 [게시] 버튼 → 게시 완료`
- 승인자는 검토 역할, **게시는 요청자가 최종 수행**.
- 상태: `draft | pending | approved | published | rejected`.
- 에디터(`page.tsx`)는 수정하지 않으므로, 이 mock UI는 `/maps/[mapId]/settings`의 Versions 패널에 둔다.

### ② 그룹 생성 승인
`생성 요청(멤버·그룹관리자 지정) → 승인 대기 → sysadmin 승인/반려 → active`
- 상태: `pending | active | rejected` (`UserGroup.status`).
- **생성만** sysadmin 승인. 이후 멤버 추가/삭제는 그룹 관리자 권한(추가 승인 불필요).

### ③ 권한 하향/제거 승인
- **상향·추가: 즉시 적용.**
- `editor → viewer` / `editor 제거`: 맵 승인자 또는 sysadmin 승인 필요 → 「승인 대기」 배지 + `ApprovalRequest(kind='permission_downgrade')` 생성. **principal 종류(개인·부서·그룹) 무관 동일.**
- `viewer 하향/제거`: 즉시.

### ④ visibility 변경 승인
- owner 요청 → 맵 승인자 승인 → 적용. `ApprovalRequest(kind='visibility_change')`.

### ④' 오너 이양 (승인 게이트 아님 — 확인 모달)
- owner가 editor 이상 1인 지정 → 확인 모달 1회 → 즉시 적용: **원래 owner는 editor로 강등, 지정자를 owner로 설정**.
- 승인 흐름 불필요(맵당 owner 1인이므로 단순 교체).
- **스펙 모순 정리**: 오너 이양은 승인 대상이 아니므로 sysadmin **승인 큐에서 제외**한다.
- 원래 owner가 비활성/삭제로 작업 불가 시 sysadmin이 직접 조정.

> **sysadmin 승인 큐 = 그룹 생성(②) + 권한 하향(③) + visibility 변경(④).** (오너 이양 제외)

---

## 5. 맵 승인자 (approvers, mock)

- 맵 생성 시 **활성 승인자 ≥1 필수** 지정 — 미지정 시 생성 불가.
- 승인자는 편집권이 없어도 됨 → 암묵 viewer.
- 비활성/삭제 처리: 승인 단계 진입 시 활성 승인자 부족 감지 → **재지정 모달 강제**(§7.6).
- 동기화(sync) 시 비활성 승인자 보유 맵을 owner에게 알림 배지로 표시(mock).

---

## 6. 편집 중 권한 변경 (동시성, mock 시뮬레이션)

- 편집(체크아웃) 중인 유저의 권한이 변경되면 → 즉시 적용 + 알림(토스트).
- 체크아웃 해제 → 다른 editor 이어받기(또는 진행분 폐기).
- 체크아웃 잠금은 권한과 직교: 권한(자격) 통과 → 체크아웃(점유) 획득 → 편집.
- 에디터 파일 보호 때문에 이번 PR에서는 **체크아웃 배너 1줄(현재 권한 상태/알림)** 까지만 반영.

---

## 7. 데이터 형태 (mock 타입 — 후속 백엔드 스키마 미러)

`frontend/src/lib/mock/permissions.ts`에 타입 + 시드 데이터로 둔다. 후속 백엔드 테이블과 1:1 대응.

```ts
// 후속 백엔드 스키마 미러 — 이번 PR은 mock 전용 / Mirror of future backend schema (mock only this PR)
type PrincipalType = 'user' | 'department' | 'group';
type MapRole = 'viewer' | 'editor' | 'owner';

interface Department {       // AD 동기화 / synced from AD
  id: string; code: string; name: string;
  orgLevels: string[];       // org1..N 가변 — 레벨 수 하드코딩 금지 / variable depth
  parentId: string | null; rawDn: string;
}
interface User {
  id: string;                // sAMAccountName
  name: string; email: string; departmentId: string;
  status: 'active' | 'inactive'; isSysadmin: boolean;
}
interface UserGroup {
  id: string; name: string; description: string;
  status: 'pending' | 'active' | 'rejected';
  managerIds: string[];      // 그룹 권한 관리자 / group managers
  members: { type: 'department' | 'user'; id: string }[];
}
interface MapPermission {
  mapId: string;
  principalType: PrincipalType; principalId: string;
  role: MapRole; grantedBy: string; grantedAt: string;
}
interface MapApprover { mapId: string; userId: string; assignedBy: string; }
interface ApprovalRequest {  // ①③④ 공용 / shared by flows ①③④
  id: string; mapId: string;
  kind: 'version_publish' | 'permission_downgrade' | 'visibility_change';
  payload: unknown;          // kind별 상세 / per-kind detail
  requestedBy: string; status: 'pending' | 'approved' | 'rejected' | 'applied';
  decidedBy?: string; decidedAt?: string;
}
// 오너 이양은 승인 대상 아님 — 확인 모달 후 즉시 교체 / Ownership transfer is NOT an approval — confirm modal then swap
// process_maps 확장(후속 백엔드) / future extend: + visibility: 'public' | 'private' (기본 private), + ownerId (맵당 1인)
```

- **org 레벨**: `orgLevels: string[]`로 레벨 수를 하드코딩하지 않는다. 로컬은 더미데이터로 검증, 사내 AD는 정상 동작 가정하에 몇 단계 더 내려받음.
- **맵 식별자 매핑**: `MapPermission.mapId`는 실제 백엔드 맵 id(문자열화)와 매핑. 기존 맵은 시드가 특정 id를 알 수 없으므로 런타임 기본 규칙(`owner = created_by`, `visibility = private`)으로 lazy 초기화. 생성 다이얼로그는 생성 직후 실제 mapId로 엔트리 기록.
- **current user 매핑**: 기존 `lib/current-user.ts`의 `CurrentUser.loginId` → mock `User.id`(sAMAccountName)로 매핑.

---

## 8. mock 레이어 설계

- `frontend/src/lib/mock/permissions.ts` — 타입 + 시드(부서/유저/그룹/맵 권한/승인 요청).
- **mock user 스위처**: 기존 `lib/dev-auth.ts`의 `LOCAL_USERS`(5인) + `components/dev-login-modal.tsx`를 확장 — 역할별(viewer/editor/owner/sysadmin) 화면 검증용. 시드 권한과 일관되도록 5인 매핑.
- **순수 판정 함수**(side-effect 없음, 후속 백엔드 이전 가능):
  - `getEffectiveRole(user, mapId): MapRole | null` — 전이적 그룹/부서 멤버십 + visibility 베이스라인 반영.
  - `isVisibleToUser(user, mapId): boolean` — 목록/열람 필터.
  - `canComment(user, mapId): boolean` — viewer 이상.
  - `canDowngrade(actor, target): boolean` / 하향이 승인 게이트인지 판정.
  - `getGroupMembership(user): groupId[]` — 전이적.
  - `getActiveApprovers(mapId): MapApprover[]` / 활성 0 감지.
- **store**: in-memory(로컬 state, pub-sub 또는 작은 store). 영속화 없음 — 새로고침 시 시드로 리셋. 기존 `current-user.ts`의 pub-sub 패턴 참고.

---

## 9. 화면 (이번 PR 구현 대상) + 배치

신규 화면 위주. 재사용 프리미티브: `ModalBackdrop`+`createPortal`, `StatusBadge`, `ToastStack`, lucide(16px/1.5). 탭·드롭다운은 컴포넌트가 없으므로 직접 구현(디자인 토큰 준수).

| 스펙 | 배치(라우팅/파일) |
|---|---|
| **7.1 맵 생성 다이얼로그(확장)** | 홈 `app/page.tsx` 인라인 폼 → `ModalBackdrop` 기반 다이얼로그. 이름/설명 + visibility 토글 + 초기 collaborators(개인/부서/그룹 × viewer\|editor) + 필수 승인자(≥1) 피커. public 선택 시 조회 grant 입력 비활성. 미지정 승인자면 생성 불가. |
| **7.2 권한 탭(GitHub repo settings 스타일)** | **신규 `/maps/[mapId]/settings`** + 탭. Collaborators(principal 아이콘 + 역할 드롭다운; 부서·그룹 editor 가능; 상향·추가=즉시 / editor 하향·제거=「승인 대기」 배지 + 요청 생성). Approvers(추가/제거·비활성 표시·활성 0 경고). Visibility(owner만; 변경 시 「승인 대기」). Danger zone(오너 이양 확인모달 → 원 owner editor 강등, 맵 삭제). |
| **7.5 버전 게시(mock)** | settings 내 **Versions 패널** (에디터 미수정). 버전 상세에 [승인 요청] → 승인 대기 → (승인자 화면) 승인 → 요청자 [게시] (mock 상태기계). |
| **7.6 승인자 재지정 모달** | 활성 승인자 0 감지 시 강제 노출(생성·승인 진입 시). |
| **7.3 유저그룹 관리** | **신규 `/groups`**. 목록(status: pending/active/rejected), 생성 요청 폼(이름/설명/멤버(부서·개인)/그룹 관리자), 그룹 상세(멤버 add/remove, 관리자 지정 — 그룹 관리자/sysadmin만). |
| **7.4 sysadmin 콘솔** | 기존 **`/admin`(admin-gated) 확장** — 탭: 승인 큐(그룹생성·권한하향·visibility), 부서 테이블(기본 department만 → 디버그 토글로 org 전체 컬럼 노출), 사용자 목록(status; sysadmin은 env 관리이므로 read-only 표시). |
| **7.7 알림** | 기존 `ToastStack` + `StatusBadge` 재사용(권한 변경·승인 결과). |

---

## 10. 코드베이스 통합 지점 (탐색 결과)

| 영역 | 기존 자산 |
|---|---|
| 현재 유저 | `lib/current-user.ts`(pub-sub + `useSyncExternalStore`), shape `{name,email,loginId,role:'admin'\|'user',department}` |
| mock 유저 | `lib/dev-auth.ts`(LOCAL_USERS 5인), `components/dev-login-modal.tsx`, `components/providers.tsx`(AUTH gate) |
| 맵 리스트/생성 | `app/page.tsx`(인라인 생성 폼), `lib/api.ts`(`listMaps`/`createMap`) |
| 버전 워크플로(기존, 미사용) | `components/workflow-dashboard.tsx`, `workflow-actions.tsx`, `status-badge.tsx`; 백엔드 `workflow.py`/`routers/versions.py`/`routers/approvers.py` |
| 코멘트 | `components/comment-section.tsx` |
| UI 프리미티브 | `components/modal-backdrop.tsx`, `status-badge.tsx`, `toast-stack.tsx`, `context-menu.tsx`; lucide-react |
| i18n | `lib/i18n.tsx`(`useI18n`), `lib/i18n-messages.ts`(en 권위 + ko 병행, TS 강제) |
| id | `lib/id.ts` `genId()` (crypto.randomUUID 금지 — 평문 HTTP secure context 아님) |
| 라우팅 | `/`, `/login`, `/maps/[mapId]`, `/maps/[mapId]/compare`, `/admin` |

---

## 11. 단계 분할 + stop-and-confirm

각 Phase 종료 시 멈추고 결과 보고 후 다음 진행 확인. 커밋 게이트: `npm run lint` + `tsc`(`npx tsc --noEmit`) + `npm run build` 통과 후 커밋. 커밋 전 `PROGRESS.md` 갱신.

- **Phase 1 — mock 기반**: §7 타입 + §8 mock 레이어 + 순수 판정 함수 + mock user 스위처. (화면 없음, 단위 검증) → **끝나면 멈추고 보고.**
- **Phase 2 — 맵 권한 UI**: §9의 7.1 생성 다이얼로그, 7.2 권한 탭, 7.5 버전 게시(mock), 7.6 재지정 모달.
- **Phase 3 — 그룹 & sysadmin**: 7.3 유저그룹, 7.4 sysadmin 콘솔(디버그 토글), 7.7 알림.

---

## 12. 수용 기준

- [ ] mock user 전환으로 viewer/editor/owner/sysadmin 화면 차이 확인 가능
- [ ] private 맵은 grant 없는 user에게 목록·열람 숨김 (mock)
- [ ] public 맵은 전원 조회, 조회 grant UI 비활성
- [ ] editor 하향/제거 시 「승인 대기」 배지 + 승인 큐에 항목 생성 (개인·부서·그룹 동일)
- [ ] 부서·그룹에도 editor 부여 가능
- [ ] 오너 이양: 확인 모달 1회 → 원 owner editor 강등 + 지정자 owner 설정 (승인 큐에 안 뜸)
- [ ] 코멘트는 viewer 이상 전원 가능 (mock 판정 연결)
- [ ] 맵 생성 시 승인자 미지정이면 생성 불가
- [ ] 승인자 활성 0 → 재지정 모달 강제
- [ ] 버전 게시(mock): 승인 요청 → 승인 → 요청자 게시 흐름 동작
- [ ] 그룹 생성: 요청 → sysadmin 승인 → active (mock)
- [ ] sysadmin 부서 테이블 디버그 토글로 org 전체 컬럼 노출
- [ ] UI는 en+ko i18n 키로 노출 (기본 한국어)
- [ ] lint / tsc / build 통과

---

## 13. 작업 규칙 (CLAUDE.md 준수)

- 브랜치 `feat/permission-management-ui`. main 직접 커밋 금지.
- 주석: EN/KO 병기. UI 텍스트: i18n(en+ko), 기본 한국어.
- 스코프: 이 문서 범위 밖(백엔드·실제 API·스키마 마이그레이션)으로 확장 금지. 필요가 보이면 멈추고 보고.
- same fix twice → stop: 같은 수정을 두 번 시도하게 되면 중단하고 보고.
- 에디터 파일 보호: `maps/[mapId]/page.tsx`는 체크아웃 배너 외 변경 금지.
- 줄바꿈 LF 고정, id는 `genId()`, secure context 가정 금지(평문 HTTP 서버).
