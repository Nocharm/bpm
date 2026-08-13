# 협업자 스테이징 UX 7종 + 오우닝 피커 트리 + 홈 필터 반응형 — 설계 스펙

- **날짜**: 2026-08-14
- **상태**: 사용자 승인 완료 (구현 전)
- **브랜치**: dev에서 분기한 워크트리 `fix/frontend-minor`
- **관련**: 거버넌스 UX(dev 머지 10a79b6)의 권한 스테이징 스택(`lib/permission-staging.ts`) 확장

## 0. 목표 (한 줄)

에디터 권한 사용자의 협업자 편집 흐름에서 "이 변경이 즉시 적용될지/승인 대기될지"를 스테이지
시점부터 예고하고, pending 필 중복 렌더 버그를 고치고, 취소·회수·되돌리기를 호버 필 전환이라는
단일 문법으로 통일한다. 추가로 오우닝 부서 피커를 조직도 브라우즈로, 홈 필터 필을 3단계 반응형으로.

## 1. 확정된 결정 (사용자 Q&A)

| 결정 | 선택 |
|---|---|
| 적용 표면 | **3곳 전부** — 홈 미리보기+에디터 맵 탭(둘 다 `map-detail-card.tsx`) + 설정 협업자 패널(`collaborators-panel.tsx`) |
| 백엔드 변경 | **허용** — `PendingChangeOut`에 `request_id` 추가(직렬화 1줄 수준, DB 무변경) |
| 되돌리기 의미론 | **전부 실행 + 예고 표시** — 역방향이 승인 필요한 항목도 실행하되 모달에 즉시/승인 뱃지 표시 |
| 즉시/펜딩 예고 표시 | **A안** — 스테이지 필 안 12px 아이콘(`Zap`=즉시 / `Hourglass`=승인 예정) + 툴팁 |
| 내 부서 상단 고정 개수 | **3개 캡** — 깊은 단위(말단) 우선 |

## 2. 현재 상태 (탐색 실측, dev 06890c2 기준)

- **스테이징 스택**: `frontend/src/lib/permission-staging.ts` — `StagedOp`(add/change/remove),
  `applyStagedOps`는 집계 카운트(`{applied, pending, failed}`)만 반환. 호출처 2곳(카드·패널).
- **즉시/펜딩 규칙(BE)**: `backend/app/permissions/logic.py:23` `requires_downgrade_approval` —
  editor→viewer/제거만 승인 게이트. 오너 actor는 전부 즉시(`permissions.py:217,272`). add는 항상 즉시.
- **pending 필 중복 버그(항목 2)**: `map-detail-card.tsx:572-576`에서 `RoleBadge pending`이
  "Pending approval" 필로 바뀌고 `:603-612` 상세 태그("editor → viewer · Approval pending")가 또 렌더
  — 같은 내용 2중. pending 배지만 고정폭(`ROLE_PILL_WIDTH_CLASS` 60px) 예외(`:70-71,575`)라 좁은
  카드에서 레이아웃 깨짐. `collaborators-panel.tsx:152-153` + `:173-180` 동일 중복.
- **철회 API**: `DELETE /approval-requests/{id}`(`permissions.py:590`) — 요청자 본인만, pending만,
  버전 동봉 제외. FE 클라이언트 `withdrawApprovalRequest`(`api.ts:989`) 기존재.
- **격차**: `pending_change` 마커는 `{to_role, requested_by}`뿐(`api.ts:893`) — request_id 없음.
  맵 승인요청 목록(`GET /maps/{id}/approval-requests`)은 `_assert_owner_or_approver` 게이트라
  에디터는 자기 요청 id를 얻을 수 없다.
- **호버 스왑 선례**: `map-detail-card.tsx:561-600` 역할 필→Remove 필 (absolute inset-0 오버레이 +
  opacity 150ms, named group `group/member`, 고정폭 공유로 크기 불변).
- **내 역할**: 카드는 `detail.my_role`(`:377-382`, sysadmin→owner 서버 해석). 패널은 `canEdit`만
  받음 — owner 여부 prop 추가 필요.
- **오우닝 피커**: `principal-picker.tsx` 브라우즈 경로 `:161-191`(myDeptsFirst 체인 `:168-178`).
  호출처: `create-map-dialog.tsx:502`(myDeptsFirst 있음) · `map-details-panel.tsx:292`(없음). 둘 다
  부서 전용(`users=[]`). 레벨 아이콘 사다리·`deptLevelRank`는 `map-detail-card.tsx:94-104`에 존재.
- **홈 필터**: `filter-dropdown.tsx`(아이콘+라벨+선택수+셰브론) × 4개(상태/권한/오우닝/SP,
  `app/page.tsx:698-792`) — 행이 `flex shrink-0`이라 ~1130px에서 EN은 안 들어가고 KO는 세로 줄바꿈.

## 3. 항목별 설계

### ① 즉시/펜딩 예고 (스테이지 시점)

`lib/permission-staging.ts`에 순수 함수 추가:

```ts
export function forecastStagedOp(
  op: StagedOp,
  grantRole: string | undefined,   // change/remove 대상 grant의 현재 역할
  actorIsOwner: boolean,
): "instant" | "approval";
```

- add → instant. change/remove → BE `requires_downgrade_approval` 미러(editor→viewer/제거만 approval),
  actorIsOwner면 전부 instant. **FE/BE 이중 구현 — 수정 시 양쪽 동기화 주석 필수**(duration.ts 선례).
- 표시: 스테이지 필 내부 선두에 12px Lucide 아이콘 — `Zap`(즉시)/`Hourglass`(승인 예정) + `title` 툴팁
  (i18n: `perm.staged.forecastInstant` "Applies immediately" / `perm.staged.forecastApproval` "Needs approval").
- 카드의 `actorIsOwner = detail.my_role === "owner"`. 패널은 새 prop `isOwner`(설정 페이지의 맵
  상세에서 전달).

### ② pending 필 중복·깨짐 픽스

- 두 표면 모두: pending 행에서 `RoleBadge`는 **실제 역할 그대로**(pending prop 호출부 제거 → 고정폭
  60px 복원). pending 정보는 상세 태그필 하나만 유지("editor → viewer · Approval pending").
- 상세 태그에 `min-w-0 max-w-full truncate` — 극단 폭에서도 줄바꿈/삐져나감 방지.
- `RoleBadge`의 `pending` prop 자체는 유지(다른 호출처 무영향), 이 두 호출부만 정리.

### ③ 스테이지 필 호버 캔슬 (X버튼 제거)

- 스테이지 필 3종(추가 예정/변경 예정/제거 예정)을 버튼화. **필 호버/focus-visible 시 같은 자리·같은
  크기의 회색 "Cancel" 필로 크로스페이드**(선례 `:561-600`과 동일: relative 래퍼 + absolute inset-0
  오버레이 + opacity 150ms). 클릭 = `removeStagedOp`. 기존 X버튼 3곳 삭제.
- 회색 = `border-hairline text-ink-secondary bg-surface` + hover `bg-surface-alt`. 카드에서는
  `ROLE_PILL_WIDTH_CLASS` 공유로 크기 불변, 패널은 콘텐츠 폭(오버레이가 래퍼 폭 상속).
- i18n: `perm.staged.cancelPill` "Cancel"/"취소".

### ④ pending 회수

- **BE**: `PendingChangeOut`(schemas)에 `request_id: int` 추가, `list_permissions` 직렬화에서 `req.id`
  주입. 기존 pytest 직렬화 단언 보강.
- **FE**: `api.ts` `pending_change` 타입에 `request_id: number` 추가. 두 표면에서
  `pending_change.requested_by === 내 loginId`인 행만 pending 태그필에 ③과 동일한 호버 전환 —
  회색 **"Withdraw"** 필(i18n `perm.pending.withdraw` "Withdraw"/"회수") → 클릭 시
  `withdrawApprovalRequest(request_id)` → 재조회 + 토스트. 모달 없음(재스테이징으로 가역).
- 타인 요청 행은 현행 유지(정보 툴팁만). 실패(이미 결재됨 등)는 humanizeApiError 토스트.

### ⑤ 변경적용 → 되돌리기 (직전 1회, 메모리 한정)

- `applyStagedOps` 반환 확장(두 호출처+테스트 동기 수정):

```ts
interface AppliedOpRecord {
  op: StagedOp;
  outcome: "applied" | "pending" | "failed";
  createdPermission?: MapPermission;   // add 성공 시 (역방향: 그 id 제거)
  approvalRequest?: ApprovalRequest;   // pending 생성 시 (역방향: withdraw)
  prev?: { principalType: PrincipalType; principalId: string; role: string };
                                       // change/remove 대상의 저장 직전 스냅샷 (역방향 재료)
  message?: string;                    // failed 시 서버 detail
}
interface StagedResult {
  applied: number; pending: number;
  failed: { op: StagedOp; message: string }[];   // 기존 필드 유지(호출처 토스트 집계 무변경)
  records: AppliedOpRecord[];
}
```

  `prev`는 `applyStagedOps`의 새 3번째 파라미터 `permsById: Map<number, MapPermission>`로 전달 —
  호출측이 저장 직전 `perms` 배열에서 조립한다.
- 저장 성공 시 컴포넌트 state `lastApply: AppliedOpRecord[]`(failed 제외) 기록 — **메모리만**
  (페이지 이탈/언마운트 시 자연 소멸 = "유저별·직전 1회·페이지 벗어나면 초기화" 충족). 재저장 시 대체.
- `stagedOps.length === 0 && lastApply` 존재 시 Save 바 자리에 보더형 **Undo** 버튼
  (i18n `perm.undo.button` "Undo last change"/"직전 변경 되돌리기", `RotateCcw` 아이콘).
- 클릭 → 확인 모달(기존 모달 컨벤션: 아이콘 + 요약 박스 + 필 압축): 항목별 행 =
  PrincipalIcon+이름 + 역방향 설명 필("editor 재추가" / "viewer → editor 원복" / "요청 회수") +
  ①의 즉시/승인 예고 아이콘. 확인 시 역방향 실행:
  - applied add → `removeMapPermission(createdPermission.id)` (editor grant면 pending 생성될 수 있음 — 예고대로)
  - applied change → `changeMapPermission(permissionId, prev.role)`
  - applied remove → `addMapPermission(prev.principalType, prev.principalId, prev.role)`
  - pending 생성분 → `withdrawApprovalRequest(approvalRequest.id)`
- 실행 정책은 Save와 동일(개별 실패 비차단, 토스트 집계). 완료 후 `lastApply` 소거(1회성)·재조회.
  이미 결재된 pending의 withdraw 409 등은 failed로 집계.

### ⑥ 오우닝 부서 피커 — 조직도 브라우즈

- `PrincipalPicker`에 `deptTreeBrowse?: boolean` 추가. **빈 검색(브라우즈)일 때만**:
  1. 내 소속 부서 체인 최대 **3개** 상단 고정(깊은 단위 먼저, "My Dept" 필 유지 — 기존 myDeptsFirst
     로직 재사용 + `slice(0, 3)`),
  2. 구분선,
  3. 전체 부서를 `buildOrgTree` DFS 순서로 들여쓰기 렌더(depth × pl 들여쓰기 + 레벨 아이콘 사다리 —
     `map-detail-card.tsx`의 `deptLevelRank`/아이콘을 공용 모듈로 추출해 재사용). 접힘 없음.
- 검색 중에는 현행 랭킹 플랫 리스트 그대로. `excludeIds`는 트리 렌더에서도 존중(행 제외).
- 적용: 오우닝 피커 2곳(`create-map-dialog`, `map-details-panel` — 후자엔 `myDeptsFirst`도 함께).
  협업자/승인자 피커는 무변경.

### ⑦ 홈 필터 필 3단계 반응형

- `FilterDropdown`에 `display?: "full" | "label" | "icon"` prop:
  - full = 아이콘+라벨(현행) · label = 라벨만(아이콘 생략) · icon = 아이콘만(+선택수 "· N"), `title` 툴팁 필수.
- 판정은 실측: 필터 행 래퍼에 ResizeObserver, 각 단계 소요 폭은 **invisible 측정 노드**(3단계 복제를
  `absolute invisible`로 렌더)에서 측정. 순수 함수
  `pickFilterDisplayMode(available: number, widths: {full; label; icon}): mode`가 "들어가는 가장 풍부한
  단계"를 선택, 여유 마진(~8px)으로 진동 방지. EN/KO 전환·부서 뷰 필 개수 차(4 vs 2)는 측정 노드가
  같은 i18n/조건을 공유하므로 자동 반영.
- vis 세그먼트(전체/공개/비공개)·Clear 버튼은 무변경(필 4종만 모드 전환).

## 4. 테스트·검증

- **vitest**: `permission-staging.test.ts` 확장 — forecast 표(오너/에디터 × add/승격/다운그레이드/제거),
  records 구조(성공/펜딩/실패 혼합), 역방향 op 생성 헬퍼. `pickFilterDisplayMode` 경계값.
- **pytest**: `list_permissions` 응답의 `pending_change.request_id` 단언 보강.
- **tsc --noEmit + next build + ruff** 그린.
- **Playwright+시스템 Chrome**(로컬 실구동, `docs/lessons/browser-verification.md` 하네스):
  3표면에서 pending 필 단일화·호버 캔슬/회수 전환·되돌리기 왕복(추가→적용→Undo→모달→원복),
  홈 1130px/1000px 스크린샷(EN·KO 각각) — 필터 필 3단계 전환 확인.

## 5. 리스크·한계

- forecast는 FE 미러라 BE 규칙 변경 시 어긋날 수 있음(§3① 동기화 주석으로 완화 — 어긋나도 표시만
  틀리고 실동작은 서버 판정이 진실).
- Undo는 스냅샷 기반 — 적용 후 타인이 같은 grant를 먼저 변경했으면 역방향이 409/404로 실패할 수
  있고, 이는 failed 집계로 표면화(정합 복원 시도는 하지 않음).
- 측정 노드 방식은 DOM 복제 비용이 있으나 필 4개 수준이라 무시 가능.
