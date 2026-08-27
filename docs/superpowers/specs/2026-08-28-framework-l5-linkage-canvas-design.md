# Framework L5 연계 캔버스 — 설계 스펙

2026-08-28 브레인스토밍 확정본. 원설계 `docs/design/2026-08-08-consultant-hierarchy-design.md` §3 "전사 오버뷰"(후속 옵션)의 구체화.

## 1. 컨셉

L5 카테고리 하나를 "상세보기"처럼 열면 소속 L6(=맵)들이 subprocess 노드로 전부 배치된 캔버스가 나온다. 권한자는 다른 L5의 L6도 끌어와 업무 연계를 엣지로 표현한다. Start/End 없음 — L6 노드로만 구성.

## 2. 확정 결정 (브레인스토밍 Q&A)

| 항목 | 결정 |
|---|---|
| 연계 엣지 소스 | **수동 작성 기준**. L6 맵 내부의 연계 subprocess 링크와 독립적인 표현 계층. 향후 L5 단위 컨설턴트 임포트가 L6 관계를 실어오면 diff-upsert로 합류(§10) |
| 편집 주체 | **카테고리 레벨별 권한자(L1~L5) 신설, 하향 상속** — 상위 레벨 권한자는 서브트리 내 모든 L5 캔버스를 편집 가능. 권한자 지정은 sysadmin |
| 권한 범위 | **연계 캔버스 생성·편집만**. 카테고리 CRUD·임포트는 sysadmin 유지, L6 맵 권한 불변 |
| 수명주기 | **라이브 편집(영구 draft) + 본인 확정 스냅샷**. 확정 시 minor+1(1.0→1.1), "Major" 체크 시 major+1·minor 0(1.1→2.0). 상위 승인 없음 — 해당 권한자 본인이 확정 |
| L6 동기화 | **열 때 자동 보강** — 권한자 편집 진입 시 소속 L6 부족분 append. 소속 이탈 노드는 자동 삭제하지 않고 출신 배지로 라이브 표현 |
| 아키텍처 | **실맵(`mode="framework"`) + `ProcessCategory.linkage_map_id` 1:1 결착**. `category_id`는 NULL 유지 → L6 목록/집계 표면 오염 원천 차단 |
| 캔버스 존재 레벨 | **L5 전용**. L1~L4엔 캔버스 없음(권한자만 존재) |
| 열람 | `visibility="public"` — 로그인 사용자 전체. 항상 라이브 draft를 봄 |

## 3. 데이터 모델

신규 테이블 1, 신규 컬럼 4 (운영 DB 리셋 불가 — 컬럼은 전부 `db.py _ADDED_COLUMNS` 등록, 테이블은 `create_all`):

| 대상 | 변경 | 비고 |
|---|---|---|
| `ProcessMap.mode` | 값 `"framework"` 추가 (컬럼 변경 없음) | 캔버스 맵 = `mode="framework"`, `category_id=NULL`, `owning_department=NULL`(nullable — 부서 바닥권한 미발동), `visibility="public"`, `consultant_code=NULL` |
| `ProcessCategory.linkage_map_id` | int nullable, FK→process_maps | L5↔캔버스 1:1. `_ADDED_COLUMNS` 등록 |
| `category_permissions` (신설) | `id, category_id(FK cascade), principal_type('user'\|'group'), principal_id, granted_by, granted_at` | `MapPermission` 미러이되 **role 컬럼 없음**(행 존재=권한자), **department 타입 제외**(카테고리는 조직도와 별개 축) |
| `MapVersion.fw_major / fw_minor` | int nullable ×2 | 확정 스냅샷에만 값. `_ADDED_COLUMNS` 등록 |

캔버스 맵에는 `MapPermission` 행을 만들지 않는다(생성자 owner 행 포함 전부 없음) — 역할은 전부 파생(§4).

## 4. 권한 판정

파생 유틸 `resolve_framework_role(session, user, map)` 신설, **3곳이 공유**:

1. `assert_map_role`(`backend/app/permissions/deps.py`) — `map.mode=="framework"`이면 `map_permissions` 무시하고: sysadmin→`owner`, 카테고리 권한자→`editor`, 그 외→`viewer`(public).
2. 맵 상세 응답의 `my_role` 산출 지점 — 동일 분기(에디터 `readOnly` 판정이 이 값을 소비).
3. `GET /categories/nodes`의 `can_edit_linkage` 배치 계산.

권한자 판정 = 해당 카테고리 **자신+조상 체인**에 `category_permissions` 행이 존재하고, `principal_type='user'`가 login_id와 일치하거나 `'group'`이 사용자의 그룹 멤버십에 포함. 캔버스→카테고리 역참조는 `linkage_map_id` 역조회 1쿼리. 체인 산출은 기존 chain 로직(`categories.py:371~`)을 util로 추출해 재사용.

## 5. API

| 메서드/경로 | 권한 | 역할 |
|---|---|---|
| `POST /api/categories/{id}/linkage-map` | 로그인 전체 | **멱등 열기**. ① `level!=5` → 422. ② 캔버스 없음: 호출자가 권한자/sysadmin일 때만 생성(맵+draft 버전 1개+소속 L6 전원 subprocess 노드 그리드 시드+`linkage_map_id` 결착), 아니면 404. ③ 캔버스 있음: 권한자이고 체크아웃이 비었거나 본인이면 소속 L6 부족분을 미배치 그리드에 append(자동 보강), 그 외는 보강 없이 통과. 응답 `{map_id, added_count, missing_count}` |
| `GET /api/categories/{id}/permissions` | sysadmin | 권한자 목록 |
| `PUT /api/categories/{id}/permissions` | sysadmin | 멱등 replace(setApprovers 선례) |
| `POST /api/maps/{map_id}/framework-confirm` `{major: bool}` | 권한자/sysadmin | 확정 스냅샷(§6) |
| 기존 `PUT /api/versions/{id}/graph` 등 | 기존 그대로 | 저장·체크아웃·버전 API 전부 재사용 |

스키마 확장(전부 응답 트랜지언트 또는 옵션 필드 — 기존 소비자 무영향):

- `CategoryNodeOut` += `linkage_map_id: int|None`, `can_edit_linkage: bool`
- `MapOut` += `linkage_category_id: int|None`, `linkage_category_path: str|None` (캔버스의 FrameworkChip 소스)
- `SubprocessRefOut` += `category_path: str|None` (외부 L6 출신 배지 소스 — 라이브 파생)

## 6. 수명주기·버전

- **라이브**: 생성 시 만든 draft 버전 1개가 영구히 draft. 저장은 기존 PUT graph(상태 게이트 draft 통과, 체크아웃 규약 그대로 → 동시편집 보호).
- **확정**: `framework-confirm`이 `clone_graph`로 draft를 새 버전에 깊은 복사 → `status="published"`, `fw_major/fw_minor` 채번(최초 1.0; minor+1; major 체크 시 major+1·0), `label="v{maj}.{min}"`, `version_number`도 기존 규약대로 채번(게시 순번 소비자 호환), `VersionEvent("published")` 기록. draft는 계속 편집.
- 스냅샷은 버전 드롭다운에서 읽기전용 열람·비교 화면에서 비교 가능. `status="published"` 재사용 덕에 L6 상세의 subprocess-usage(Linked from)에 캔버스가 부모로 집계됨(의도된 유용성).
- **시드/보강 배치**: 그리드 row-major, X_STEP=240·Y_STEP=120 (`import_consultant.py` 배치 리듬과 동일). 자동 보강 노드는 기존 노드 바운딩 박스 **아래**에 새 그리드로 append(기존 배치와 충돌 없음).

## 7. 검증 (graph 저장 시)

- `map.mode=="framework"`이면 `validate_process`(start 1개 강제) 대신 **`validate_framework_canvas`**: 모든 노드 `node_type=="subprocess"` + `linked_map_id` 보유(위반 시 422). `validate_process` 시그니처 불변(인터뷰 오케스트레이터 호출부 무영향).
- 링크 유일성(같은 L6 중복 배치 금지)·순환 차단·엣지/그룹 무결성·체크아웃 규약은 기존 그대로 적용.

## 8. 프론트엔드

### 진입점 3곳
- **홈 Framework 트리**: `framework-tree.tsx` `renderNode`에 첫 레벨 분기 — `level===5` 행 우측 "Linkage" 버튼(Lucide 16px). 캔버스 존재 시 전원 노출(열람), 미존재 시 `can_edit_linkage`일 때만. 클릭 → POST linkage-map → 에디터 이동.
- **L6 에디터 FrameworkChip**: 체인의 L5 행에 "Open linkage canvas" 항목(존재 시).
- **캔버스 자신의 FrameworkChip**: `MapOut.linkage_category_id/path` 기반으로 렌더(기존 조건은 `category_id` 기반이라 미충족).

### 에디터 크롬 — `mode==="framework"` 분기 (isWordMap 선례)
- 팔레트: process/decision/start/end 도구 숨김. 허용 = subprocess 링크 추가·그룹·엣지(라벨/선모양 그대로).
- **버전 선택 분기**(`page.tsx:2330~`): framework 맵은 뷰어 포함 항상 **라이브 draft 우선**(기존 우선순위는 최신 published라 스냅샷이 열려버림).
- **"Confirm changes" 버튼**(권한자만, 제출/게시 버튼 대체): 모달 + "Major version" 체크박스 → confirm API → 토스트. 워크플로 배너 대신 "Linkage canvas · latest v1.1" 캡션.
- 인스펙터: subprocess 카드 그대로(17필드 라이브 주입, `annual_count`·`fte`만 직접 편집).

### L6 가져오기 — 트리 피커
좌측 라이브러리 패널을 framework 트리 탐색 피커로 교체(fetch-all은 L6≈20,000 스케일 불가): `framework-tree-state` 리듀서 재사용, `listCategoryMaps` 카드를 기존 `application/bpm-process` dataTransfer로 드래그 → `createLinkNodeAt` 그대로. SP 미지정 L6는 기존 미등록 확인 체인(지정 요청 발송) 재사용. 외부 L6 노드엔 `SubprocessRefOut.category_path` 기반 출신 L5 배지(현 캔버스의 L5와 다를 때만) — 소속 이동은 배지가 자동 갱신, 휴지통행은 기존 `designated=False` 스타일.

### 자동 보강 UX
편집 진입 `added_count>0` → 토스트 "N new L6 added (unplaced)". 뷰어는 `missing_count>0`일 때 상단 캡션 칩만.

### 설정 — 권한자 관리 (sysadmin)
`framework-panel.tsx` 카테고리 행에 권한자 관리 버튼 → 모달: 권한자 필 목록 + PrincipalPicker(user/group) 추가·제거, PUT replace.

### UI 언어
영어 기본(동적 데이터만 한글) — `rules/frontend/design.md` §5.

## 9. 가드·노출 제외

- `PUT subprocess-designation`: framework 모드 422 — 캔버스를 다른 맵의 링크노드로 삼는 것 차단(라이브러리는 지정 맵만 노출이라 자동 제외).
- `copy_map`·Word 승격: framework 모드 소스/대상 거부 가드.
- 카테고리 개명(PATCH) 시 캔버스 맵 이름 동기 rename(`"{카테고리명} 연계"`, 충돌 시 코드 서픽스) — 생성 시 자동 명명과 동일 규칙.
- 카테고리 삭제(DELETE subtree): 서브트리에 `linkage_map_id` 보유 카테고리가 있으면 기존 "연결 맵 존재 409"와 동일하게 409(캔버스 먼저 정리).
- 홈 일반 맵 목록: FE에서 `mode==="framework"` 제외(word 맵 분기 선례).

## 10. 향후 임포트 호환 (원칙만 — 구현은 임포트 확장 시점)

캔버스 안 노드의 자연키 = `linked_map_id`(링크 유일성으로 유일 보장). L5 단위 임포트가 L6 관계를 실어오면 이 키로 diff-upsert: **노드·관계 추가만 하고 사용자 배치·수동 엣지는 보존**한다.

## 11. 알려진 한계 (초기 허용)

- 대시보드 맵 수 집계에 캔버스 포함.
- 최근 맵 목록에 캔버스 노출 유지(유용 판단).
- 트리 피커 이름 검색 없음(트리 탐색만) — 후속.
- 캔버스 자체의 As-Is/To-Be 비교는 확정 스냅샷 간 비교로 갈음.

## 12. 테스트 계획

- **BE**: 권한 파생(자기/조상 체인·그룹 멤버십·비권한자 viewer), linkage-map 멱등(생성/재호출/보강/level≠5 422/비권한자 404), confirm 채번(1.0→1.1→major 2.0), `validate_framework_canvas` 422(start·process 유입), SP 지정·복사 거부, 카테고리 삭제 409, 개명 동기. 기존 스위트 그린(`AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS=""`).
- **FE**: framework-tree-state 확장·버전 선택 분기 vitest, `tsc --noEmit`·lint 그린.
- **실브라우저 스모크**: `pw-smoke-framework` 확장 — L5 버튼→생성·시드 확인→외부 L6 드래그→엣지→확정 v1.0→뷰어 라이브 열람·배지 확인.

## 13. 구현 앵커 (조사 실측)

| 지점 | 위치 |
|---|---|
| 카테고리 모델·레벨 상한 | `backend/app/models.py:94-113`, `categories.py:39` |
| 맵 mode·category_id | `models.py:163, 173-179` |
| MapVersion(label·status·version_number) | `models.py:236-260` |
| MapPermission(미러 원형) | `models.py:641-655` |
| 역할 관문 | `backend/app/permissions/deps.py:70-80` → `assert_map_role` |
| effective_role(비-framework 유지) | `backend/app/permissions/logic.py:102-` |
| 그래프 저장 게이트·검증 | `backend/app/routers/graph.py:126-215`, `subprocess.py:10-30` |
| clone_graph | `backend/app/routers/versions.py:57-` |
| SubprocessRefOut | `backend/app/schemas.py:1051-1083` |
| 트리 렌더(레벨 분기 도입점) | `frontend/src/components/maps/framework-tree.tsx:234-316` |
| 트리 상태 리듀서 | `frontend/src/lib/framework-tree-state.ts` |
| FrameworkChip | `frontend/src/components/framework-chip.tsx`, 렌더 조건 `page.tsx:8498-8503` |
| 버전 선택·readOnly | `frontend/src/app/maps/[mapId]/page.tsx:2330-2356, 1250-1260` |
| SP 노드 생성·드롭 규약 | `page.tsx:4440-4479, 4661-`, dataTransfer `application/bpm-process` |
| 배치 리듬 | `backend/scripts/import_consultant.py:38-39, 118-125` |
| 설정 Framework 탭 | `frontend/src/components/admin/framework-panel.tsx` |
