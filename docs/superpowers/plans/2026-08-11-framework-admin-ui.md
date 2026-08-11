# Framework Admin UI (카테고리 관리 + 웹 임포트) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 컨설턴트 체계(카테고리 트리)를 sysadmin이 프론트에서 직접 관리(CRUD)하고, 전달물(JSON) 대량 임포트를 웹에서 dry-run→apply로 실행할 수 있는 관리자 탭을 만든다.

**Architecture:** 백엔드는 기존 `routers/categories.py`에 sysadmin 전용 CRUD 3종 + `/import` 1종을 추가하고, 임포트는 기존 엔진 `scripts/import_consultant.import_delivery`를 그대로 재사용(파서에서 파일 IO만 분리). 프론트는 설정(admin 콘솔)에 "Framework" 탭 신설 — 좌측 카테고리 트리 관리 + 하단 임포트 섹션. CLI(`scripts/import_consultant.py`)는 대량 전달 대안으로 병행 유지.

**Tech Stack:** FastAPI + SQLAlchemy async + Pydantic / Next.js + TS (React Compiler) + Tailwind 토큰.

## Global Constraints

- 모든 신규 엔드포인트는 **sysadmin 전용** — `Depends(require_sysadmin)` (`app/auth.py`). 입력 검증은 API 경계(Pydantic).
- **재임포트 정책 불변**: 임포트 upsert가 UI 카테고리 수정을 덮는다(전달물=소스 오브 트루스). 보호 플래그 추가 금지 — UI에 안내 문구 1줄만.
- UI 카테고리 code는 `ui-` 네임스페이스 자동 생성(컨설턴트 code와 충돌 방지). 카테고리 레벨 최대 **5** (`CanonicalCategory` le=5와 동일).
- FE: raw hex 금지(토큰만), UI 영어 기본, i18n 키는 **en+ko 양쪽**(`i18n-messages.ts`), Lucide 16px/strokeWidth 1.5, 이모지 금지, 신규 인터랙티브 요소에 `data-id`(`rules/frontend/identifiers.md` — `surface-role` kebab-case), 라이트 전용.
- React Compiler 함정: setState만 하는 트리비얼 핸들러는 plain function(수동 useCallback 금지), effect 내 동기 setState 금지 (`frontend/AGENTS.md`).
- `crypto.randomUUID` 금지 — id 필요 시 `genId()`(`@/lib/id`).
- 커밋 직전 `PROGRESS.md` 갱신(커밋당 1–3줄, 같은 커밋에 포함 — `rules/common/git.md`).
- 게이트: BE `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `ruff check app/ tests/ scripts/` / FE `npx tsc --noEmit`·`npm run lint`·`npx vitest run`·`npm run build`.

---

### Task 1: 백엔드 카테고리 CRUD API

**Files:**
- Modify: `backend/app/routers/categories.py` (라우터 뒤쪽에 CRUD 3종 추가)
- Modify: `backend/app/schemas.py` (`CategoryCreateIn`, `CategoryUpdateIn` 추가 — 기존 `CategoryNodeOut` 근처)
- Test: `backend/tests/test_categories_admin.py` (신규)

**Interfaces:**
- Produces: `POST /api/categories` · `PATCH /api/categories/{id}` · `DELETE /api/categories/{id}` — 응답은 기존 `CategoryNodeOut`(DELETE는 204). Task 3의 FE가 이 계약을 호출한다.
- Consumes: `app.auth.require_sysadmin`, `ProcessCategory` 모델, `CategoryNodeOut`.

**Spec:**

1. **POST `/api/categories`** — body `CategoryCreateIn { name: str(strip, 1..300), parent_id: int | None = None, code: str | None = None (strip, 1..100) }`
   - `parent_id` 지정 시 존재 검증(404). `level = parent.level + 1`(무부모=1), `level > 5` → 422 `"max depth is 5"`.
   - `code` 지정 시 중복이면 409. 미지정이면 `f"ui-{uuid4().hex[:8]}"` 생성(충돌 시 재생성 루프).
   - `sort_order` = 같은 부모 형제의 `max(sort_order) + 1`(형제 없으면 0).
   - 응답 `CategoryNodeOut`(child_count=0, map_count=0).
2. **PATCH `/api/categories/{id}`** — body `CategoryUpdateIn { name: str | None = None, parent_id: int | None = None, sort_order: int | None = None }` + **`model_fields_set`으로 "미전송 vs null" 구분** — `parent_id`가 body에 있으면 이동(null=루트로 이동), 없으면 무변경.
   - 404(대상 없음). name: strip 1..300.
   - 이동 검증: 새 부모가 자기 자신 또는 자기 자손이면 422 `"cannot move under own subtree"`(자손 판정은 전체 카테고리 1회 로드 후 메모리 순회). 새 부모 404. 이동 후 서브트리 최심 레벨이 5를 넘으면 422 `"max depth is 5"` (서브트리 높이 = 메모리 순회로 산정).
   - 이동 시 **서브트리 전체 level 재계산**(BFS로 부모 level+1 전파). sort_order는 새 형제 max+1로 재배정(명시 sort_order 동시 전송 시 그 값 우선).
   - 응답 `CategoryNodeOut`(child_count·map_count는 재조회 값).
3. **DELETE `/api/categories/{id}`** — 404 / 자식 존재 시 409 `f"has {n} child categories"` / 연결 맵 존재 시(`ProcessMap.category_id == id`, 소프트삭제 포함 전체) 409 `f"{n} maps are linked"` / 아니면 행 삭제, 204.
4. 세 엔드포인트 모두 `login_id: str = Depends(require_sysadmin)`.

**Steps:**
- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_categories_admin.py`. 기존 `tests/test_categories_api.py`의 client 픽스처·enforce 패턴을 참고(같은 conftest 사용, 403 테스트는 enforce 픽스처). 케이스:
  - `test_create_root_and_child` — 루트 생성(level 1·code `ui-` 접두 자동), 자식 생성(level 파생·sort_order 증가)
  - `test_create_depth_and_dup_code` — level 5 부모 아래 생성 422, 중복 code 409
  - `test_rename_and_reorder` — name·sort_order 갱신
  - `test_move_recomputes_levels` — 서브트리(2단) 이동 후 전 노드 level 재계산 확인
  - `test_move_guards` — 자기 자손 아래 이동 422, 이동 후 깊이 초과 422, 새 부모 404
  - `test_delete_guards_and_ok` — 자식 보유 409, 맵 연결 409(맵 생성 후 PUT category 연결), 빈 카테고리 삭제 204 후 목록에서 소멸
  - `test_crud_requires_sysadmin` — enforce 픽스처 + 일반 유저 → 403 (3종 모두)
- [ ] **Step 2: 테스트 실행 — 실패 확인** (`.venv/bin/python -m pytest tests/test_categories_admin.py -q` → 404/405류 실패)
- [ ] **Step 3: 스키마·엔드포인트 구현** (위 Spec대로)
- [ ] **Step 4: 테스트 그린 + 기존 카테고리 테스트 무회귀** (`pytest tests/test_categories_admin.py tests/test_categories_api.py -q`) + `ruff check app/ tests/`
- [ ] **Step 5: PROGRESS 갱신 + 커밋** — `feat(categories): sysadmin CRUD API for framework tree — 카테고리 생성·이동·삭제 관리 API`

### Task 2: 백엔드 JSON 임포트 API

**Files:**
- Modify: `backend/scripts/consultant_canonical.py` (파일 IO와 검증 분리)
- Modify: `backend/app/routers/categories.py` (`POST /api/categories/import`)
- Modify: `backend/app/schemas.py` (`FrameworkImportIn`, `FrameworkImportOut`, `FrameworkImportRow`)
- Test: `backend/tests/test_categories_import_api.py` (신규)

**Interfaces:**
- Produces: `POST /api/categories/import` — body `{ categories: list[dict], maps: list[dict], apply: bool = False, label: str | None }` → `{ applied, summary: {created, updated, unchanged, errors, warnings}, rows: [{code, action, detail}], truncated }`. Task 4의 FE가 호출.
- Consumes: `scripts.import_consultant.import_delivery(session, *, categories, maps, actor, label, commit_every)` — 시그니처 무변경.

**Spec:**

1. `consultant_canonical.py` 리팩터(동작 불변):
   - `parse_categories(raw: object) -> list[CanonicalCategory]` — 기존 `load_categories`의 JSON 이후 로직(구조 검증·중복 code·트리 검증) 전부 이동. `load_categories(path)`는 파일 읽고 위임.
   - `parse_map_objs(items: Sequence[object]) -> tuple[list[CanonicalMap], list[str]]` — 항목별 `CanonicalMap.model_validate`, 오류는 `"item {i}: {msg}"`로 수집(기존 `load_maps`의 줄 단위 수집과 대칭). `load_maps(path)`는 줄 파싱 후 위임하거나 기존 로직 유지 — 중복 없게 한쪽으로 정리.
2. **POST `/api/categories/import`** — `Depends(require_sysadmin)`.
   - `parse_categories` 실패(CanonicalError) → 422(메시지 그대로).
   - `parse_map_objs`의 항목 오류는 CLI와 동일하게 report의 `error` 행으로 합류(전체 중단 아님).
   - `import_delivery(..., actor=login_id, label=label or f"Web import {now_kst():%Y-%m-%d}", commit_every=None)` 호출 → `apply=True`면 `session.commit()`, 아니면 `session.rollback()`.
   - label은 strip 후 ≤100 검증(422).
   - 응답: summary는 report.rows의 action별 카운트, rows는 **최대 500행**(초과 시 `truncated=True` — 단 error·warning 행 우선 포함 후 나머지 순서대로), applied=apply.
3. 요청 크기: 별도 제한 두지 않음(대량은 CLI 안내 — FE 문구). 스트리밍 없음.

**Steps:**
- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_categories_import_api.py`. 샘플 페이로드는 `tests/test_consultant_import.py`의 canonical dict 픽스처 스타일 재사용(간단 카테고리 2 + 맵 1~2, owner는 기존 시드 직원). 케이스:
  - `test_dry_run_reports_without_persisting` — apply=False → created 카운트 리포트 + DB에 맵 없음
  - `test_apply_persists_and_publishes` — apply=True → 맵 존재·게시본 v1·재호출 시 unchanged
  - `test_invalid_map_item_reports_error_row` — 깨진 항목 1 + 정상 1 → error 행 + 정상 진행
  - `test_invalid_categories_422` — 부모 누락 트리 → 422
  - `test_import_requires_sysadmin` — enforce + 일반 유저 403
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 파서 분리 + 엔드포인트 구현** — CLI(`run_import`)가 기존 그린 유지하는지 함께 확인
- [ ] **Step 4: 신규 + `tests/test_consultant_canonical.py` + `tests/test_consultant_import.py` 그린** + ruff
- [ ] **Step 5: PROGRESS 갱신 + 커밋** — `feat(categories): web JSON bulk import endpoint reusing import engine — 웹 대량 임포트(dry-run/apply)`

### Task 3: FE 설정 Framework 탭 + 카테고리 관리 트리

**Files:**
- Modify: `frontend/src/lib/api.ts` (`createCategory`, `updateCategory`, `deleteCategory`, `importFramework` + `FrameworkImportResult` 타입)
- Modify: `frontend/src/app/settings/page.tsx` (TabId `"framework"` + 신규 sysadmin 카테고리 그룹)
- Create: `frontend/src/components/admin/framework-panel.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (en+ko)

**Interfaces:**
- Consumes: Task 1·2 API + 기존 `listCategoryNodes(parentId)`(`CategoryNode`).
- Produces: `FrameworkPanel` 컴포넌트(설정 페이지가 렌더), 임포트 섹션 슬롯은 Task 4가 같은 파일에 채움.

**Spec:**

1. `api.ts`:
   ```ts
   export async function createCategory(body: { name: string; parent_id?: number | null; code?: string }): Promise<CategoryNode>
   export async function updateCategory(id: number, body: { name?: string; parent_id?: number | null; sort_order?: number }): Promise<CategoryNode>
   export async function deleteCategory(id: number): Promise<void>
   export interface FrameworkImportRow { code: string; action: string; detail: string }
   export interface FrameworkImportResult { applied: boolean; summary: { created: number; updated: number; unchanged: number; errors: number; warnings: number }; rows: FrameworkImportRow[]; truncated: boolean }
   export async function importFramework(body: { categories: unknown[]; maps: unknown[]; apply: boolean; label?: string }): Promise<FrameworkImportResult>
   ```
   기존 fetch 헬퍼(`apiFetch`류) 컨벤션 그대로. PATCH의 "parent_id 미전송 vs null" 구분 — body에 키 자체를 조건부 포함.
2. `settings/page.tsx`: TabId에 `"framework"`, CATEGORIES에 신규 그룹 `{ labelKey: "admin.catFramework", access: "sysadmin", tabs: [{ id: "framework", labelKey: "framework.adminTab" }] }` — Database 그룹 앞에 배치. 렌더 분기에 `<FrameworkPanel />`.
3. `framework-panel.tsx` — 카테고리 관리 트리:
   - 데이터: `listCategoryNodes(parentId)` lazy — 루트는 마운트 시, 자식은 펼침 시. 전역 `reloadKey` state로 뮤테이션 후 전체 리프레시(트리 상태 단순 유지 — `Map<number|null, CategoryNode[]>` + open set, `framework-tree-state.ts` 재사용 가능하면 사용하되 admin 전용 확장 금지).
   - 행: 펼침 caret + name + code(`text-fine text-ink-muted`) + `map_count` 카운트 태그. hover/선택 시 액션 아이콘(Lucide 16): **Add child**(level<5만), **Rename**, **Move**, **Delete**.
   - Rename/Add: 행 인라인 input(Enter 저장/Esc 취소) 또는 기존 `prompt-dialog.tsx` 재사용 — 구현 단순한 쪽. 저장 → API → reloadKey++.
   - Move: 기존 `category-cascade.ts`(`pickCascadeLevel`) 기반 캐스케이드 셀렉트 모달(`framework-assign-modal.tsx`의 캐스케이드 패턴 참고, 대상=새 부모, "(root)" 옵션 포함). 자기 자손 제외는 서버 422 신뢰 + 에러 토스트.
   - Delete: `confirm-dialog.tsx` — 서버 409 메시지(자식/맵 카운트)를 에러로 표시.
   - 에러는 기존 ApiError 토스트/인라인 컨벤션.
   - 상단 안내 문구 1줄: "Re-imports overwrite category names/structure by code — the last delivery is the source of truth."
   - `data-id`: `framework-admin-tree`, `framework-admin-add-root`, 행 `framework-admin-node-${id}`, 액션 `framework-admin-<action>-${id}`.
4. i18n 키(en+ko): `admin.catFramework`("Framework"/"프레임워크"), `framework.adminTab`("Categories & import"/"카테고리·임포트") 등 필요 최소.

**Steps:**
- [ ] **Step 1: api.ts + 탭 배선 + 패널 뼈대(트리 조회·펼침만)** — `npx tsc --noEmit` 통과
- [ ] **Step 2: CRUD 액션 4종 + 모달/인라인 입력** — 각 액션 후 reloadKey 리프레시
- [ ] **Step 3: 게이트** — `npx tsc --noEmit`·`npm run lint`·`npx vitest run`·`npm run build`
- [ ] **Step 4: PROGRESS 갱신 + 커밋** — `feat(admin): Framework tab with category tree management — 설정 프레임워크 탭(카테고리 관리)`

### Task 4: FE 웹 임포트 섹션

**Files:**
- Modify: `frontend/src/components/admin/framework-panel.tsx` (임포트 섹션)
- Modify: `frontend/src/lib/i18n-messages.ts`
- Create: `frontend/src/lib/framework-import-parse.ts` + `frontend/src/lib/framework-import-parse.test.ts`

**Spec:**

1. `framework-import-parse.ts` — 순수 함수(vitest 대상):
   ```ts
   export interface ParsedDelivery { categories: unknown[]; maps: unknown[]; clientErrors: string[] }
   export function parseCategoriesFile(text: string): { categories: unknown[]; error?: string }   // {categories:[...]} 형태 필수
   export function parseMapsFile(text: string): { maps: unknown[]; lineErrors: string[] }          // JSONL(줄단위) 또는 JSON 배열 텍스트 허용
   ```
2. 패널 임포트 섹션(트리 아래, `border-hairline` 구분):
   - 파일 입력 2개(`categories.json`, `maps.jsonl`) — 선택 시 클라이언트 파싱, 파일명·항목 수·클라이언트 파싱 오류 표시. `data-id="framework-import-categories-file"` / `framework-import-maps-file`.
   - **Dry-run** 버튼(`framework-import-dryrun`) — `importFramework({apply:false})` → 요약 칩 5종(created/updated/unchanged/errors/warnings — errors>0은 `text-error`) + 행 테이블(code·action·detail, error/warning 행 틴트, `max-h` 스크롤, truncated 시 안내). busy 중 버튼 disabled.
   - **Apply** 버튼(`framework-import-apply`) — dry-run 결과가 있어야 활성. `confirm-dialog`(요약 카운트 포함) → `importFramework({apply:true})` → 성공 요약 + 트리 reloadKey++.
   - 안내 문구: "Large deliveries (thousands of maps) should use the server CLI instead." + 재임포트 덮어쓰기 문구는 Task 3의 상단 문구와 중복이면 생략.
3. label 입력은 두지 않는다(서버 기본 `Web import YYYY-MM-DD` 사용) — YAGNI.

**Steps:**
- [ ] **Step 1: 파서 유틸 + vitest** (JSONL·배열·깨진 줄·빈 파일 케이스) — 실패 후 구현 그린
- [ ] **Step 2: 임포트 섹션 UI + 배선**
- [ ] **Step 3: 게이트** — tsc·lint·vitest·build
- [ ] **Step 4: PROGRESS 갱신 + 커밋** — `feat(admin): web bulk import UI with dry-run report — 웹 임포트 섹션(드라이런 리포트·적용)`

### Task 5: 문서 — 쉬운 dev↔main 체크리스트 재작성 + 가이드 정합

**Files:**
- Rewrite: `docs/qa/dev-vs-main-checklist.md`
- Modify: `docs/deploy/db-migration-9910.md` (§8 컨설턴트 항목 — 웹 임포트 우선, CLI는 대량 대안)
- Modify: `docs/design/2026-08-08-consultant-hierarchy-design.md` (§6에 관리자 탭·웹 임포트 개정 각주 1~2줄)
- Modify: `docs/README.md` 인덱스 문구(변경 시)

**Spec (체크리스트 재작성 원칙):**
- **n8n 연동(HR 웹훅·EDW positions)은 완료 가정** — 이행 절차 단계 삭제, "완료됨" 전제만 한 줄.
- 기준: **main(`4980277`) 대비 dev 신규분을 9910/dev 스택에서 화면으로 확인하는 쉬운 체크리스트** — 각 항목 "어디 가서 → 뭘 하고 → 뭘 보면 통과" 한 줄 형식, 전문용어 최소화.
- 묶음: ① 유저·부서(완료 표시 유지, 접기) ② 컨설턴트 체계 — 설정→Framework 탭에서 샘플 업로드→Dry-run→Apply→홈 Framework 토글 확인 경로로 갱신 ③ 신규 카테고리 관리(생성·이름변경·이동·삭제 각 1회) ④ 기존 화면 회귀 스팟(홈·에디터·승인). 백로그 섹션은 유지(내용 이동 금지, 임포트 UI 신설로 해소된 항목 있으면 소거 표시).

**Steps:**
- [ ] **Step 1: 체크리스트 재작성 + 9910 가이드·설계 문서 정합**
- [ ] **Step 2: PROGRESS 갱신 + 커밋** — `docs(qa): rewrite dev-vs-main checklist assuming n8n done — 쉬운 확인 체크리스트(웹 임포트 반영)`
