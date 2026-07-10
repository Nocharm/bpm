# 맵 필수 필드 '오우닝 부서'(Owning Department) — 설계

날짜: 2026-07-10 · base: `0a9d19d` (main)

## 목적

모든 맵에 **책임 부서**를 명시한다. 맵 생성 시 오우닝 부서 지정을 필수로 하고, 그 부서는 **항상 에디터 권한**을 가진다(해제 불가). 생성 모달의 승인자 피커에는 그 부서의 리더(부서장)를 검색 없이 우선 노출하고 승인자로 미리 넣어준다(제거 가능). 기존 운영 맵은 전부 "누락" 상태로 두고, 설정에서 오너/관리자가 수동 지정하며, 홈에서 누락 맵을 필터·배지로 구분한다.

## 확정된 결정 (사용자 답변)

| 질문 | 결정 |
|------|------|
| 지정 가능한 조직 레벨 | **모든 레벨** — 상위 부서 지정 시 prefix 매칭으로 하위 전원이 에디터 |
| 지정 후 변경 | **오너·관리자(sysadmin)는 변경 가능** — 에디터 고정 권한은 현재 오우닝 부서를 따라감 |
| 누락 맵 노출 | **필터 옵션 + 카드 배지** |
| 잠금 에디터 권한 구현 | **파생 권한(Approach A)** — 권한 행 없이 `effective_role`에서 바닥값 계산 |

## 핵심 설계 — 파생 권한(권한 행을 만들지 않는다)

`process_maps.owning_department` 컬럼(org_path 문자열, 예: `"본부/실/팀"`) 하나가 진실의 원천이다. `effective_role` 계산 시 **사용자가 오우닝 부서 소속이면 최소 editor**를 바닥값으로 적용한다.

- 지울 권한 행 자체가 없으므로 "변경 불가" 강제 코드가 불필요하다.
- 부서를 변경하면 파생 권한이 자동으로 새 부서로 이동한다 — 드리프트 불가능.
- 같은 부서가 이미 수동 viewer/editor 행을 가진 경우와도 충돌하지 않는다(`max()`로 합산).
- 대가: 협업자 목록의 "잠금 행"은 프론트에서 합성 표시한다(맵 상세 + 디렉터리로 충분).

기각한 대안 — 실제 `MapPermission` 행 삽입 + PATCH/DELETE 잠금 가드: 컬럼↔행 불변식 유지, 기존 부서 행과의 중복 principal 409, 가드 3개 엔드포인트 산재. 이점(기존 권한 조회 로직 재사용)보다 비용이 크다.

## 백엔드

### 1. 스키마·모델

- `ProcessMap`(`backend/app/models.py:68`)에 `owning_department: VARCHAR(200) NULL` 추가. NULL = 누락(기존 운영 데이터가 자동으로 이 상태).
- `backend/app/db.py` `_ADDED_COLUMNS`에 `("process_maps", "owning_department", "VARCHAR(200)")` 등록(기존 `sp_department` 패턴).
- `MapCreate`(`backend/app/schemas.py:16`)에 `owning_department: str` **필수** 추가. `MapUpdate`는 건드리지 않는다(변경은 전용 엔드포인트).
- `MapOut`/`MapDetailOut`/목록 응답에 `owning_department` 노출.

### 2. 검증

`POST /maps`(`backend/app/routers/maps.py:218`)에서 `owning_department`가 **known org path**인지 검증, 아니면 422. known 집합은 디렉터리가 부서를 만들 때 쓰는 것과 같은 로직(직원 org_l1..l5 경로의 전 레벨 prefix, `backend/app/routers/directory.py:53-72`)을 재사용한다.

### 3. 파생 권한

`effective_role`(`backend/app/permissions/logic.py:57-93`)·`get_effective_role`(`backend/app/permissions/access.py:52-95`) 경로에 오우닝 부서 바닥값을 추가한다:

```
if map.owning_department and belongs_to_department(user_org_path, map.owning_department):
    role = max(role, "editor")
```

`belongs_to_department`(logic.py:28-37)는 exact 또는 `prefix + "/"` 매칭이라 하위 부서가 자동 포함된다. editor 바닥값이므로 private 맵 열람도 함께 해결된다.

### 4. 변경 엔드포인트

`PUT /maps/{map_id}/owning-department` 신설 — `require_map_role("owner")` (sysadmin은 서버에서 owner로 승격되므로 "관리자" 커버). 본문 `{"owning_department": "..."}`, 같은 known-path 검증. subprocess-designation PUT(`maps.py:481-520`) 패턴을 따른다. 누락 맵의 최초 지정과 이후 변경 모두 이 엔드포인트 하나로 처리한다.

### 5. 중복 방지 가드

`POST /maps/{id}/permissions`(`backend/app/routers/permissions.py:66`)에서 department principal이 현재 오우닝 부서와 동일하면 400 — 파생 editor가 이미 있으므로 중복 행은 혼란만 준다. (하위/상위 부서 행은 허용 — 의미가 다르다.)

## 프론트엔드 — 생성 모달 (`frontend/src/components/permissions/create-map-dialog.tsx`)

1. **필수 필드 "Owning Department"** — 이름/설명 아래, 가시성 위에 배치. 기존 `PrincipalPicker`(`frontend/src/components/permissions/principal-picker.tsx`)를 부서 전용(departments만 전달)으로 재사용 — 부서 옵션 `principalId`가 이미 org_path고 전 레벨 한글검색이 열려 있다. 미선택 시 Create 비활성(기존 게이트: 이름·승인자 ≥1에 추가).
2. **리더 자동 승인자** — 부서 선택 시 `getDirectory()`의 `DirectoryDept.manager`(= `dept_info.manager` login_id)를 조회해:
   - 승인자 목록에 **자동 추가**(일반 승인자와 동일하게 제거 가능),
   - 승인자 피커에서 **검색어 없을 때 상단 고정 노출**(기존 `managersFirst` 배지 패턴 활용).
   - 부서에 리더가 없으면(dept_info 미등록) 둘 다 생략. 부서를 바꾸면 이전 리더 자동 추가분은 제거하고 새 리더로 교체하되, 사용자가 수동으로 만진 항목은 보존한다.
3. **잠금 행 표시** — 협업자 목록에 "〈부서 한글명〉 — Editor (Owning dept, 잠금)" 합성 행을 표시, 제거/역할변경 UI 없음.
4. **승인자 후보군** — private 맵의 후보 제한 로직(`approverPickerUsers`, create-map-dialog.tsx:297-329)에 오우닝 부서 소속원(org_path prefix 매칭)을 포함한다.
5. `createMap`(`frontend/src/lib/api.ts:205`) 본문에 `owning_department` 추가. CSV 생성 플로우도 같은 다이얼로그라 자동 적용된다.

## 프론트엔드 — 설정 (`frontend/src/app/maps/[mapId]/settings/page.tsx`)

- **details 섹션**(`map-details-panel.tsx`)에 Owning Department 블록:
  - 지정됨 → 부서 한글명 + 경로 표시. `isOwner`(sysadmin 포함, page.tsx:132-145)에게만 **Change** 버튼.
  - 누락 → 경고 스타일(amber 계열 토큰) + **Assign** 버튼(같은 owner 게이트). 비오너에겐 "Missing" 표시만.
  - Assign/Change 모두 부서 전용 `PrincipalPicker` → `PUT /maps/{id}/owning-department`.
- **collaborators 섹션** — 생성 모달과 동일한 잠금 행 합성 표시.

## 프론트엔드 — 홈 목록 (`frontend/src/app/page.tsx`)

- **카드 배지** — `owning_department`가 null인 맵 카드에 경고 배지("No owning dept", amber 토큰·Lucide 16px). 지정된 맵엔 배지 없음(요청 범위가 누락 구분).
- **필터 칩** — 기존 필터(가시성·상태·역할) 옆에 누락-only 토글 칩 추가. `filteredMaps`(page.tsx:251-263) AND 조합에 편입, sessionStorage 영속(기존 패턴 :149-163).

## 데이터 작업

- **마이그레이션 불필요** — 컬럼 자동 추가(`_ADDED_COLUMNS`), 기존 행은 NULL = 누락. 운영 배포 시 추가 스크립트 없음.
- **시드**(`scripts/reset_db` 계열) — 데모 맵 일부에만 오우닝 부서를 지정하고 일부는 의도적으로 누락으로 남겨 배지·필터·Assign 플로우를 시연 가능하게 한다.

## 스코프 밖 (명시적 제외)

- 설정에서 오우닝 부서 변경 시 새 리더 자동 승인자 제안 — 요청은 생성 모달 한정.
- 설정 승인자 패널의 리더 우선 노출.
- 지정된 맵 카드에 부서명 표시(누락 배지만 요청됨).
- 오우닝 부서 기준 정렬/그룹핑(누락 필터만 요청됨).

## 테스트

- **pytest**: 생성 시 `owning_department` 누락 → 422 / unknown path → 422 · 오우닝 부서 소속원 effective_role=editor(하위 부서 prefix 포함, private 맵 열람 포함) · PUT owning-department owner 게이트(editor 403)·값 반영 · permissions POST 중복 가드 400 · 기존 맵 NULL 허용(목록·상세 정상).
- **vitest**: 리더 해석·자동 승인자 교체 등 순수 로직 분리분.
- **Playwright 검증 스크립트**: 생성 플로우(부서 필수 게이트→리더 자동 승인자→생성 후 잠금 행 확인) · 설정 Assign(누락 맵) · 홈 배지+필터. 실행엔 dev 서버 필요 — 미실행 시 정직하게 기록.
