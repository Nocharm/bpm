# 서브프로세스 지정(Designation) 설계 — 2026-07-06

하위프로세스 참조 모델(Call Activity, `2026-06-20-subprocess-reference-model-design.md`) 위에 얹는 **큐레이션 계층**. 맵 오너가 자기 맵을 "공식 서브프로세스"로 지정해야만 에디터 피커에 노출되고, 지정 시 입력한 어트리뷰트가 모든 사용처에 라이브로 적용된다.

## 1. 배경 / 목표

- 현재 라이브러리 피커(`GET /api/library/processes`)는 **모든 맵**을 노출(순환참조만 차단) — 가시성·soft-delete 필터조차 없음.
- 목표: **지정된 맵(사내 대표 업무)만** 서브프로세스로 사용 가능하게 하고, 부서 등 메타를 지정 단계에서 강제해 사용처에 일관 표시.

## 2. 확정 결정사항 (사용자 확인 완료)

| 결정 | 내용 |
|---|---|
| 지정 조건 | **게시(published) 버전이 있는 맵만** 지정 가능 |
| 지정 권한 | 맵 **오너 또는 sysadmin** (설정 페이지 `isOwner` 게이팅 재사용) |
| 어트리뷰트 | **고정 4종** — 부서(필수)·담당자·시스템·소요시간(선택). 노드 BPM 필드와 1:1 — 추후 노드 어트리뷰트가 늘면 함께 확장 |
| 동기화 | **라이브 참조** — 노드에 값 복사 안 함, 오너 수정 시 전 사용처 즉시 반영 |
| 미지정/해제 맵을 가리키는 노드 | **구분 없이 경고 + 잠금** (배포 전 생성된 기존 노드 포함, 권한 있어도 잠금). 시드 맵에 지정을 심어 데모 유지 |
| 변경 기록 | **최근 1건만** — `sp_changed_by/at` 컬럼 (이력 테이블 없음, 맵과 1:1) |
| 색상 | 서브프로세스 노드는 **단일 색 고정** (현행 `DEFAULT_COLORS.subprocess` 바이올렛 톤 유지, 추후 액센트 커스텀 시 함께 변경) |
| 저장 방식 | **접근 A — `ProcessMap` 컬럼 추가** (별도 테이블 없음, `_ADDED_COLUMNS` 멱등 백필) |

## 3. 데이터 모델 (backend)

`ProcessMap`(`backend/app/models.py`)에 nullable 컬럼 7개:

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `sp_designated_at` | DateTime NULL | **NULL = 미지정** (플래그 겸 지정 시각, `clock.py` KST) |
| `sp_department` | String NULL | 지정 시 필수 |
| `sp_assignee` | String NULL | 선택 |
| `sp_system` | String NULL | 선택 |
| `sp_duration` | String NULL | 선택 (노드 `duration`과 동일 타입) |
| `sp_changed_by` | String NULL | 최근 지정/해제/속성수정 수행자 login_id |
| `sp_changed_at` | DateTime NULL | 최근 변경 시각 |

- `db.py` `_ADDED_COLUMNS`에 7줄 추가 → 기존 DB 무중단 백필.
- **해제 시 `sp_designated_at`만 NULL** — 어트리뷰트는 남겨 재지정 모달 프리필.

## 4. API (backend)

### `PUT /api/maps/{map_id}/subprocess-designation`
- body: `{department: str(필수·비어있으면 422), assignee?, system?, duration?}` — 지정과 속성 수정 겸용(upsert).
- 가드: 오너/sysadmin 아니면 403 · **게시 버전 없으면 409** · soft-deleted 404.
- 효과: 미지정→지정 전환 시 `sp_designated_at` 새로 찍음, **지정 상태에서 속성만 수정 시 유지**. 어트리뷰트 반영, `sp_changed_by/at` 갱신.

### `DELETE /api/maps/{map_id}/subprocess-designation`
- 가드: 오너/sysadmin 403 (게시 버전 조건 불필요).
- 효과: `sp_designated_at = NULL`, 어트리뷰트 유지, `sp_changed_by/at` 갱신. 멱등(이미 미지정이어도 200).

### `MapOut` 확장
- designation 필드 7종 노출 → 설정 페이지 표시용.

## 5. 라이브러리 피커 필터 (`backend/app/routers/library.py`)

- `GET /api/library/processes` → `WHERE sp_designated_at IS NOT NULL AND deleted_at IS NULL`.
- 응답 행에 어트리뷰트 4종 추가 → 프론트 `LibraryProcess` 타입(`api.ts`) 확장, 피커 행에 부서 칩 표시.
- 가시성/권한 필터는 **추가하지 않음** — 지정 = 전사 공개 의도. 펼침 권한은 resolve 단계에서 기존 규칙(viewer+)로 제어.

## 6. 라이브 참조 — `subprocess_refs`

- `GraphOut`(`schemas.py`)에 `subprocess_refs: dict[int, SubprocessRefOut]` 추가:
  ```
  SubprocessRefOut = {designated: bool, department, assignee, system, duration}
  ```
  그래프 내 subprocess 노드들의 `linked_map_id`별로 서버가 조인 계산. soft-deleted 링크 대상은 `designated: false` 취급.
- 포함 위치: **에디터 그래프 GET**(버전 그래프)과 **임베드 resolved**(`GET /api/library/processes/{id}/resolved`) 양쪽 — 중첩 임베드 안 subprocess 노드도 커버.
- **resolve 잠금 확장**: 기존 `role < viewer → locked:true`(200 + 빈 그래프)에 **`미지정 → locked:true`** 추가. 서버에서 펼침 원천 차단(이중 방어).

## 7. 설정 페이지 UI (`frontend/src/app/maps/[mapId]/settings/page.tsx`)

- `ALL_TABS`에 **`subprocess` 앵커 섹션** 추가(Details 아래), **오너에게만 노출**.
- 신규 패널 `frontend/src/components/permissions/subprocess-designation-panel.tsx`:
  - 미지정: 안내 + "Designate as subprocess" 버튼. **게시 버전 없으면 비활성 + 사유 문구**.
  - 지정됨: 어트리뷰트 요약 카드 + "Last changed by {name} · {time}" + Edit / Un-designate.
- **지정/수정 모달**: 부서(필수)·담당자 = `bpm-attribute-picker` 재사용, 시스템·소요시간 = 자유 입력. 재지정 시 프리필.
- **해제 확인 ConfirmDialog**: 모달 컨벤션(아이콘+요약박스) — "사용 중인 맵의 노드들이 경고·잠금 처리됩니다" 경고.
- UI 텍스트 영어, i18n 사전 키 추가. 주요 구조 요소에 `data-id` 부여.

## 8. 캔버스 렌더 (frontend)

- `subprocess_refs`가 렌더 단일 소스 (노드 `data`의 BPM 필드는 subprocess에서 무시):
  - **`designated: false`** → 경고 배지(`AlertTriangle`, `AssigneeWarningBadge` 스타일, 툴팁 "Not a designated subprocess" — UI 영어 룰) + `lockedKeys` 병합 → 기존 `canExpand` 게이트로 펼침 차단.
  - **지정됨** → 현행 유지: viewer+ 펼침 토글, 미만 `LockedBadge`.
- **노드 카드 어트리뷰트 표시**: subprocess 노드에 부서/담당자/시스템/소요시간 행(`NodeFields` 재사용, 소스는 refs). `hasBpmAttributes` 게이트를 subprocess에 대해 완화.
- **인스펙터**: subprocess 선택 시 4종 **읽기전용** 표시(기존 `readOnly`/`disabled` 패턴). 편집 UI 없음 — 값 변경은 지정 모달에서만.
- 드롭/링크 생성 시 노드에 어트리뷰트를 **저장하지 않음**(라이브 참조 원칙).

## 9. 색상 고정 (frontend)

- `colorsForType('subprocess')` → 단일 색 `[DEFAULT_COLORS.subprocess]`.
- 속성폼에서 subprocess는 색 프리셋/헥스 입력 숨김.
- **렌더에서 `data.color` 무시하고 기본색 강제** → 기존 다른 색 저장 노드도 데이터 수정 없이 즉시 통일 (저장값 마이그레이션 없음).

## 10. 시드 / 테스트

- `backend/scripts/seed_reference_demo.py`: 맵 1(주문처리)·2(배송)·3(결제)에 지정 + 어트리뷰트 심기 → 맵 4(주문이행)의 참조 데모 유지.
- backend pytest:
  - PUT/DELETE 가드 — 비오너 403 · 게시버전 없음 409 · 부서 누락/공백 422 · 해제 멱등.
  - 라이브러리 필터 — 미지정·soft-delete 제외, 어트리뷰트 포함.
  - `subprocess_refs` — 그래프/resolved 양쪽 계산, soft-deleted 대상 `designated:false`.
  - resolve locked — 미지정 시 true(권한 있어도), viewer 미만 true.
- frontend: `npm run lint`·`build` + Playwright 스모크(지정 → 피커 노출 → 드래그 → 어트리뷰트 표시 → 해제 → 경고+잠금).

## 11. 엣지 케이스

| 케이스 | 동작 |
|---|---|
| 해제 후 재지정 | 라이브 참조라 경고·잠금 자동 해소 (별도 처리 없음) |
| 지정 맵 soft-delete | 피커 제외 + refs `designated:false` → 경고+잠금. 복원 시 자동 복귀 |
| 지정 맵의 게시 버전이 전부 만료 | **범위 외** — 지정 유지, resolve는 기존 규칙대로(follow_latest는 빈 결과 가능). 후속 과제로 명시 |
| 지정 어트리뷰트 수정 중 다른 사용자가 조회 | 라이브 참조 — 다음 그래프 로드 시 반영 (실시간 push 없음, 기존 임베드 갱신 정책과 동일) |
| subprocess 노드 `data`에 남아있는 옛 color/BPM 필드 | 렌더에서 무시 (데이터 정리 안 함) |

## 12. 범위 외 (이번 브랜치에서 안 함)

- 지정 변경 **이력 테이블**(최근 1건만 컬럼으로).
- 어트리뷰트 키 확장(고정 4종 유지 — 노드 필드 확장 시 함께).
- 게시 버전 만료 시 지정 자동 해제/알림.
- 액센트 커스텀 테마 연동(단일색 상수만 준비).
