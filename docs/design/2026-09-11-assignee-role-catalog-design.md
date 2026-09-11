# 노드 역할(assignee_role) + 관리 목록 엔진(역할·시스템 카탈로그) 설계 — 2026-09-11

담당자(`assignee`)는 "이 맵을 볼 수 있는 재직자 이름"만 붙는 칸이라 "실험자/검토자" 같은 범용 역할을 표현할 수 없다. 담당자 옆에 **단일값 역할 칸**을 추가하고, 그 입력에 쓰는 자동완성을 **재사용 엔진**으로 만들어 **시스템 필드 정규화**에도 같이 적용한다. 목록은 관리자가 설정 탭에서 관리한다(CSV 임포트 포함).

사용자 결정(2026-09-11): ① 역할은 담당자와 같이 보임 ② 역할은 부서와 페어가 아님(담당자↔부서 페어는 유지) ③ 하위프로세스도 같은 로직 ④ 자유입력 + 관리자 목록 자동완성 ⑤ 역할에 승인 게이트 없음 ⑥ CSV·AI 계약 노출은 다음 세션 ⑦ 역할은 노드당 1개 ⑧ 설정 왼쪽 레일에 탭 추가, 두 목록 모두 CSV 임포트 ⑨ 시스템 자유값은 "Other"로 분류하고 입력 원문은 폴백(`system_fallback`)으로.

## 1. 현황(조사 요약)

- `nodes.assignee` String(100): 영문 name 콤마 구분 복수. 유효성은 FE 피커(`eligible-assignees`, 맵 viewer+ 직원)에서만 강제, 저장 후 경고(`lib/node-ref-warnings.ts`)·관리자 감사(`app/ref_audit.py node_assignee`)가 "재직자 명단에 있는 이름인가"를 본다. 담당자 추가 시 부서 자동 설정·교차 부서 금지·부서 변경 시 담당자 초기화(`lib/assignee.ts addAssignee`).
- 담당자를 가지는 노드: `hasBpmAttributes`(`lib/canvas.ts:181`) = process·decision. subprocess는 링크 맵 `process_maps.sp_assignee` 읽기전용 상속(`spAssignee`). start·end·section은 칸 없음.
- `system`: 인스펙터 `<input>` 자유 텍스트 + 노드 모달·SP 지정 모달 타일(값 + `system_fallback` 원문 메모). 정규화 목록 없음. `system_fallback`은 인터뷰 임포트 원문 메모(`FallbackHint` 팝오버로 보기·수정·적용).
- 관리자 목록 선례: `app_settings` 키-값(JSON) + `exposed_positions`(`app/app_settings.py get_exposed_positions`, `PUT /admin/app-settings`, Employees 탭 `ExposedPositionsCard`가 `available_positions` 후보를 체크로 승격).
- 자동완성 선례: `components/data-form-picker.tsx`(정적 `DATA_FORM_OPTIONS` 전용, body 포털 드롭다운, 무일치 자유값은 "추가" 행), 검색 랭킹 `lib/search.ts filterByQuery`(초성·로마자).
- 인터뷰 에이전트는 담당자를 수집하지 않는다(`app/interview/agents.py:107`). AI 제안은 명시 지시 때만 채움(`app/ai_prompt.py:61`).

## 2. 데이터 모델

| 위치 | 필드 | 형식 | 비고 |
|---|---|---|---|
| `nodes` | `assignee_role` | VARCHAR(100) DEFAULT '' | 단일값, trim. 콤마 파싱 없음 |
| `process_maps` | `sp_assignee_role` | VARCHAR(100) NULL | SP 지정 대칭. subprocess 노드가 읽기전용 상속 |
| `app_settings` | `assignee_roles` | JSON `string[]` | 역할 자동완성 목록. 기본 `[]` |
| `app_settings` | `systems` | JSON `string[]` | 시스템 정규화 목록. 기본 `["Other"]` — `Other`는 예약 항목(삭제 불가, 항상 포함) |

- `db.py _ADDED_COLUMNS`에 두 컬럼 수동 등록(서버는 배포 시 자동 ALTER).
- 백엔드 열거 지점: `models.Node`·`models.ProcessMap` · `schemas.NodeIn`(max_length 100) · `SubprocessDesignationIn.assignee_role` · `MapOut.sp_assignee_role` · `SubprocessRefOut.assignee_role` · `graph.py` upsert · `versions.py` clone · `maps.py` SP 지정 저장 · `subprocess.py` ref 빌드(spAssignee와 같은 소스). 라이브러리 행(`library.py`)은 후속.
- **경고·감사 무영향**: `ref_audit`·`node-ref-warnings`는 `assignee`만 읽는다. 새 컬럼은 대상이 아니며 테스트로 고정한다.
- 백엔드 검증: trim + 길이만. 목록 일치 강제 없음(역할은 자유입력, 시스템 정규화는 FE 커밋 시점 규칙 — §4).

## 3. 관리 목록 엔진

### 3.1 백엔드
- `app/app_settings.py`: `MANAGED_LIST_KEYS = ("exposed_positions", "assignee_roles", "systems")`, `get_managed_list(session, key, default)` / `set_managed_list(...)`. `get_exposed_positions`는 이 헬퍼로 재구현(동작 불변: 빈 목록 저장 존중).
- `systems` 읽기는 `Other`가 없으면 맨 앞에 보강해 반환(예약 항목 불변식).
- `GET /catalogs` (로그인 유저 전원) → `CatalogsOut{assignee_roles: list[str], systems: list[str]}`. 에디터 피커가 읽는 경로. sysadmin 전용 `/admin/app-settings`와 분리하는 이유: 편집자는 sysadmin이 아니다.
- `PUT /admin/app-settings`에 `assignee_roles`·`systems` 필드 추가(trim·빈값 제거·중복 제거·각 100자 컷·최대 500개). `AppSettingsOut`에 두 목록 + `available_systems`(`nodes.system` ∪ `process_maps.sp_system` distinct, 빈값 제외, 정렬) 추가 — 관리자가 사용 중 값을 체크로 승격하는 후보.

### 3.2 프론트
- `lib/catalogs.ts`: 모듈 캐시 + `useCatalogs()`(`lib/directory.ts` 패턴: 세션당 1회 fetch, 실패 시 inflight 리셋) + `invalidateCatalogs()`(관리자 저장 후). 순수 함수 `normalizeToCatalog(value, list): string | null` — trim 후 대소문자 무시 일치면 목록 표기, 아니면 null.
- `components/suggest-input.tsx` **`SuggestInput`**: 단일값 자유입력 + 제안 드롭다운. props: `value`, `options: string[]`, `onCommit(next: string)`, `dataId`, `placeholder`, `mode: "row" | "field"`(인스펙터 우측정렬 행 / 팝오버 안 일반 필드), `allowFree`(기본 true). 동작: `filterByQuery` 랭킹, ↑↓ 이동·Enter 확정·Esc 취소, 일치 없으면 입력값 그대로 확정(`allowFree`), blur 시 확정. 드롭다운은 body 포털 + fixed, z 1400(타일 팝오버 1350 위에 떠야 한다 — `DataFormPicker`와 같은 층). `DataFormPicker`는 손대지 않는다(후속 통합 후보).
- i18n: `field.assigneeRole`("Role"/"역할"), `catalog.*` 탭·카드·CSV 문구, `system.other`("Other"/"기타") 표시 라벨.

## 4. 적용 규칙

### 4.1 역할(`assignee_role`)
- 편집: 인스펙터(`bpm-attribute-picker` 담당자 행 아래 "Role" 행, `SuggestInput mode="row"`) · 노드 모달·SP 지정 모달·Usage 탭(부서·담당자 타일 옆 **별도 역할 타일**, `SpFieldTile` + 팝오버 안 `SuggestInput mode="field"`). `DeptAssigneeTiles`에 섞지 않는다 — 부서 페어 로직(`addAssignee`)과 격리.
- 부서 변경 확인 모달은 담당자만 지우고 역할은 유지. 역할 변경은 `department`·`assignee`를 건드리지 않는다.
- 표시: 캔버스 담당자 줄(`process-node.tsx NodeFields` assignee 필드)에 역할 칩을 이름 앞에 — `[역할] 박지영, 김민수`. 별도 표시 토글 없이 기존 `assignee` 토글에 묶음. 이름 없이 역할만 있어도 줄이 뜬다. subprocess는 `spAssigneeRole`. 칩 스타일: 액센트 틴트 사각 라운드 + Lucide `BriefcaseBusiness` 16px/1.5(이름 필의 `User` 아이콘과 구분).
- 같은 칩을 인스펙터 읽기 행(`attribute-read-rows.tsx`) · 노드 요약 모달 · SP 인스펙터 카드 · SP 피크 · 홈 맵 상세 SP 섹션에 표시.
- 비교: `lib/diff.ts FIELD_KEYS`에 `assignee_role` 추가(`FIELD_MSG` 라벨 `field.assigneeRole`). Excel(`excel-export.ts`·`excel-wbs.ts`)에 "Role" 열을 Assignee 옆에 추가.
- 그룹 벌크 모달(`group-bulk-modal.tsx`)은 범위 밖(후속).

### 4.2 시스템(`system`) 정규화
- 편집 4곳(인스펙터 `<input>` · 노드 모달 시스템 타일 · SP 지정 모달 시스템 타일 · Usage 탭)을 `SuggestInput`으로 교체. 옵션 = `catalogs.systems`.
- 커밋 규칙(FE `lib/catalogs.ts commitSystem(raw, list, currentFallback)` 순수 함수 — 4곳 공용):
  - `raw` 빈값 → `{system: "", system_fallback: currentFallback}` (원문 메모 유지).
  - `normalizeToCatalog(raw, list)` 일치 → `{system: 표기, system_fallback: currentFallback}`.
  - 불일치 → `system: "Other"`. `system_fallback`은 비어 있으면 `raw`로 채우고, 이미 값이 있으면 **유지**한다(`replacedNote: false`). 인스펙터 행은 이때 `ConfirmDialog`("원문 메모를 입력값으로 교체할까요?")를 띄워 확인하면 교체; 타일 팝오버(노드 모달·SP 지정)는 메모 칸이 같은 팝오버에 보이므로 다이얼로그 없이 안내문 한 줄(`catalog.systemKeptNote`)만 띄운다.
- `FallbackHint` "적용"(원문 → 대표값)도 같은 규칙을 통과한다(원문이 목록에 없으면 `Other` + 원문 유지).
- 레거시 자유값은 그대로 표시·유지(정규화는 편집 커밋 시점에만). 관리자가 `available_systems`에서 체크로 목록에 올리면 그때부터 자동완성·정규화 대상.
- `Other` 표시: 값이 정확히 `Other`이면 `t("system.other")`로 렌더(캔버스·인스펙터·타일·SP 표면). 저장값은 `Other` 고정(UI 영어 기본 규칙).

### 4.3 패스스루 보존(이번 범위) vs 노출(후속)
- `csv-import.ts`: `NODE_DEFAULTS`에 `assignee_role: ""`, `mergeNode`에서 `assignee_role: existing.assignee_role`(CSV 열 없음 → 항상 기존값 유지), 행 변환은 `""`. 안 하면 재임포트 시 `NodeIn` 기본 `""`로 백엔드가 소거한다.
- AI 변환 2곳(`buildGraphFromAiProposal`, page.tsx `aiNodeToGraphNode`): 기존 노드의 `assignee_role`을 그대로 이월. `AiNode.attributes`·프롬프트·인터뷰 에이전트 계약은 다음 세션.
- CSV 열(`Role`)·Excel 왕복·AI 계약·인터뷰 수집은 후속 트랙으로 `docs/design/2026-08-24-data-surface-parity-design.md`에 항목 추가.

## 5. 관리자 탭 "Catalogs"

- `src/app/settings/page.tsx` `CATEGORIES`의 조직(`admin.catDirectory`, access `admin`) 카테고리에 탭 `{ id: "catalogs", labelKey: "catalog.tab" }` 추가. 패널 `components/settings/catalogs-panel.tsx`. 저장 API는 sysadmin 전용이라 패널은 `admin`이 아닌 **sysadmin에게만 편집 버튼 활성**(비sysadmin은 읽기 전용 목록).
- 카드 2개(역할·시스템), 같은 컴포넌트 `ManagedListCard`: 현재 목록(칩, × 삭제 — `Other`는 잠금) · 직접 추가 입력(Enter) · "사용 중 값" 후보 체크 승격(시스템 카드만, `available_systems`) · **CSV 임포트** 버튼(파일 선택 → `lib/csv.ts` 파서로 1열 읽기, 헤더 `value` 또는 헤더 없음 허용, trim·중복 제거 후 병합 미리보기 "추가 n건·중복 m건") · 저장(`putAppSettings({assignee_roles})` / `({systems})`) 후 `invalidateCatalogs()`.
- 기존 `ExposedPositionsCard`는 Employees 탭에 그대로 둔다(이동 없음).

## 6. 검증

- BE pytest: `test_graph.py` 역할 PUT/GET 왕복 + 빈 페이로드 소거 · `test_versions.py` clone 이월 · `test_subprocess_designation.py` `sp_assignee_role` 저장→`SubprocessRefOut.assignee_role` · `test_app_settings.py` 두 목록 PUT/GET·`Other` 보강·정규화(trim·중복)·`available_systems` · `GET /catalogs` 비sysadmin 200 · `test_ref_audit.py` 역할이 고아로 안 잡힘.
- FE vitest: `catalogs.test.ts`(`normalizeToCatalog`·`commitSystem` 분기 4종) · `csv-import.test.ts` mergeNode 보존 · `diff.test.ts` 필드 · `excel-export.test.ts` 열 · `node-ref-warnings.test.ts` 무영향. `SuggestInput` 키 내비는 컴포넌트 테스트 인프라가 없어 Playwright로 검증.
- Playwright(`scripts/pw-smoke-assignee-role.mjs`): 인스펙터 역할 입력→자동완성 선택→저장→새로고침→캔버스 칩 · 시스템에 목록 외 값 입력→`Other`+폴백 메모 · SP 지정 역할→subprocess 노드 상속 · Catalogs 탭 CSV 임포트→피커 옵션 반영. 스크린샷 공유.
- 게이트: `ruff` · `pytest`(AI_ENABLED=false …) · `tsc --noEmit` · `vitest run` · `lint` · `build-component-catalog.mjs`. FE/BE 동시 배포, 신규 컬럼은 서버 자동 ALTER.

## 7. 범위 밖(후속)
- CSV `Role`/`System` 열 노출·AI `attributes.assignee_role`·인터뷰 에이전트 역할 수집(2026-08-24 패리티 트랙에 이관).
- 그룹 벌크 모달 역할 일괄 지정.
- `DataFormPicker`를 `SuggestInput` 위로 통합.
- 시스템 별칭 매핑(`lims`→`LIMS` 외의 동의어).
- 라이브러리 패널 행(`library.py`)·SP 피크의 역할 표시.
