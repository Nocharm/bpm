# Consultant Framework Phase 2 (category tree UI + I/O + slot transfer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 Maps 탭에 컨설턴트 체계(카테고리 L1~L5) 트리 뷰(서버 주도 lazy)를 토글로 추가하고, 맵 상세 카드에 경로 뱃지·Input/Output·카테고리 연결/해제·슬롯 이양을, SP 지정 폼에 I/O 편집을 붙인다.

**Architecture:** 스펙 = `docs/design/2026-08-08-consultant-hierarchy-design.md` §6(2026-08-08 스코핑 개정 반영: Maps 탭 좌측 세그먼트 토글, 신규 표면만 서버 주도 lazy — 기존 홈 fetch-all은 안 건드림). 백엔드는 신설 categories 라우터(자식 lazy 조회 + 카테고리별 맵 페이지네이션) + MapOut에 category 노출 + 지정/이양 API. 프론트는 기존 홈의 검증된 패턴을 재사용한다: 토글은 가시성 필터 세그먼트 템플릿(`page.tsx:610-631`), 트리 행은 org-accordion 패턴, 상태 영속은 `bpm.home.tree` 블롭(핸들러 내 기록 — StrictMode 함정), 맵 카드는 `renderCard` prop 재사용.

**Tech Stack:** FastAPI + SQLAlchemy async / Next.js + TS + vitest. 브라우저 스모크는 Playwright+시스템 Chrome(리포 관례).

## Global Constraints

- **작업 위치**: 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/consultant-hierarchy` (브랜치 `feat/consultant-hierarchy`). 커밋 전 `pwd`·`git branch --show-current` 확인.
- **백엔드 게이트** (backend/): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`(전체) 또는 대상 파일만 · `.venv/bin/ruff check app/ tests/ scripts/`.
- **프론트 게이트** (frontend/): `npm run lint` · `npx tsc --noEmit` · `npx vitest run` · `npm run build`. **워크트리에 node_modules 없음** — Task 3 Step 0에서 셋업(메인 체크아웃에서 APFS 클론 후 npm install 보강: turbopack이 심링크 거부하므로 `cp -Rc` 필수).
- **커밋 형식**: `type(scope): English summary — 한국어 요약` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 푸터. **PROGRESS.md + 이 플랜 파일 체크박스를 코드와 같은 커밋에** 갱신.
- **UI 규칙**: raw hex 금지(토큰만) · UI 문구 영어(EN/KO i18n 키 쌍 필수, `frontend/src/lib/i18n-messages.ts` 양쪽 로케일) · Lucide 16px strokeWidth 1.5 · 이모지 금지 · 주요 구조 요소 `data-id` 부여 · 버튼 커서/눌림은 전역 base(중복 정의 금지).
- **트리 상태 영속 랜드마인**: localStorage 기록은 **토글 핸들러 안에서만**(`writeTree` 패턴, `page.tsx:107-120` 주석 참조) — effect에서 쓰면 StrictMode 리마운트가 기본값으로 덮는다.
- **스케일 계약(설계 §6/§8)**: 신규 카테고리 트리 표면은 fetch-all 금지 — 자식은 펼칠 때 조회, 맵은 카테고리별 페이지네이션. 기존 홈 fetch-all(list_maps)은 이번에 건드리지 않는다.
- `sp_input`/`sp_output`은 자유 텍스트 — 길이 캡 금지(Phase 1 회귀 가드 존재).
- 테스트 직원 시드는 `active=False`(공지 브로드캐스트 단언 오염 방지).

## File Structure

- Create: `backend/app/routers/categories.py` — 트리 자식·카테고리별 맵 조회
- Modify: `backend/app/schemas.py`(MapOut 4필드 + CategoryNodeOut/CategoryMapsOut + SubprocessDesignationIn I/O), `backend/app/routers/maps.py`(category_path 주입·designation I/O·category PUT·framework-transfer), `backend/app/main.py`(라우터 등록)
- Test: `backend/tests/test_categories_api.py` (신규)
- Create: `frontend/src/components/maps/framework-tree.tsx`
- Modify: `frontend/src/lib/api.ts`, `frontend/src/app/page.tsx`(토글+뷰 전환), `frontend/src/components/maps/map-detail-card.tsx`, `frontend/src/components/permissions/subprocess-designation-modal.tsx` + `subprocess-designation-panel.tsx`, `frontend/src/lib/i18n-messages.ts`
- Create: `frontend/src/components/maps/framework-assign-modal.tsx`(카테고리 연결/해제+슬롯 이양)
- Create: `docs/samples/consultant-delivery-sample/`(categories.json + maps.jsonl) + `frontend/scripts/pw-smoke-framework.mjs`

---

### Task 1: 백엔드 — categories 조회 API + MapOut category 노출

**Files:**
- Create: `backend/app/routers/categories.py`
- Modify: `backend/app/schemas.py` (MapOut 뒤에 신규 스키마 2종 + MapOut 필드 4개), `backend/app/routers/maps.py` (`list_maps`/`get_map`에 category_path 주입), `backend/app/main.py` (라우터 include — 기존 include_router 나열부에 1줄)
- Test: `backend/tests/test_categories_api.py`

**Interfaces (Produces — 이후 태스크가 그대로 사용):**
- `GET /api/categories/nodes` · `GET /api/categories/nodes?parent_id=<int>` → `list[CategoryNodeOut]` — parent 미지정=루트(L1). 필드: `id, code, name, level, sort_order, child_count`(직계 자식 카테고리 수), `map_count`(**서브트리 전체**의 연결 맵 수 — 소프트삭제 제외, 가시성 무관 총계). 정렬 sort_order, code.
- `GET /api/categories/{category_id}/maps?offset=0&limit=50` → `CategoryMapsOut {total: int, hidden: int, maps: list[MapOut]}` — **그 노드에 직접 연결된** 맵만(서브트리 아님). 가시성 필터: 호출자가 열람 불가한 맵은 `maps`에서 제외하고 `hidden`으로 집계(subprocess-usage의 hidden_count 마스킹 선례). `maps`엔 list_maps와 동일한 카드 메트릭(`_set_card_metrics` 재사용 — 페이지 소량이라 스코프 쿼리로) + `my_role` 주입.
- `MapOut` 추가 필드: `category_id: int | None = None` · `category_path: str | None = None`(트랜지언트 — "L1이름/L2이름/.../연결노드이름" 조인, 서버 계산) · `consultant_code: str | None = None` · `sp_input: str | None = None` · `sp_output: str | None = None`.
- `list_maps`·`get_map`: 카테고리 전체를 1회 로드(`id,parent_id,name` — 수천 행, 메모리 조인)해 path 문자열 dict 구성 후 `m.category_path` 트랜지언트 주입. `category_id` 없는 맵은 None.

**구현 지침:**
- 라우터 골격은 `backend/app/routers/library.py`나 `subprocess.py`처럼 얇게. 가시성 판정은 `app.permissions.logic.effective_role` + `is_sysadmin` — `list_maps`(maps.py:122~)의 in-memory 판정 패턴을 **카테고리 1개 분량으로 축소** 재사용(권한 행·승인자·부서는 해당 맵 id들로 스코프 쿼리).
- `child_count`/`map_count`: 요청당 카테고리 전량 1회 로드 + `SELECT category_id, count(*) FROM process_maps WHERE deleted_at IS NULL AND category_id IS NOT NULL GROUP BY category_id` 1회 → 부모 역방향 누적으로 서브트리 합산(메모리, ~수천 행).
- path 조인 유틸은 `categories.py`에 `build_category_paths(rows) -> dict[int, str]` 순수 함수로 두고 maps.py가 import(중복 구현 금지).

- [x] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_categories_api.py` 신규

```python
"""카테고리 트리 조회 API — lazy 자식·서브트리 카운트·카테고리별 맵 페이지네이션/가시성 마스킹."""

from fastapi.testclient import TestClient


def _seed_tree(client: TestClient) -> dict[str, int]:
    """A(L1) > A1(L2) 트리 + A1에 public 맵 1·private 맵 1 연결. 반환: code→category id."""
    import asyncio

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessCategory, ProcessMap

    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            a = ProcessCategory(code="CAT-A", name="구매", level=1, sort_order=0)
            session.add(a)
            await session.flush()
            a1 = ProcessCategory(code="CAT-A1", name="직접구매", level=2, parent_id=a.id, sort_order=0)
            session.add(a1)
            await session.flush()
            pub = ProcessMap(name="framework pub map", visibility="public",
                             owner_id="cat.owner", created_by="cat.owner",
                             category_id=a1.id, consultant_code="CAT-M1")
            prv = ProcessMap(name="framework private map", visibility="private",
                             owner_id="cat.owner", created_by="cat.owner",
                             category_id=a1.id, consultant_code="CAT-M2")
            session.add_all([pub, prv])
            await session.flush()
            session.add(MapVersion(map_id=pub.id, label="As-Is", status="published", version_number=1))
            await session.commit()
            return {"A": a.id, "A1": a1.id, "pub": pub.id}

    return asyncio.run(_seed())


def test_nodes_roots_and_children_with_counts(client: TestClient) -> None:
    ids = _seed_tree(client)
    roots = client.get("/api/categories/nodes").json()
    root = next(r for r in roots if r["code"] == "CAT-A")
    assert root["level"] == 1 and root["child_count"] == 1 and root["map_count"] == 2
    children = client.get(f"/api/categories/nodes?parent_id={ids['A']}").json()
    assert [c["code"] for c in children] == ["CAT-A1"]
    assert children[0]["child_count"] == 0 and children[0]["map_count"] == 2


def test_category_maps_visibility_masking(client: TestClient) -> None:
    ids = _seed_tree(client)
    # 기본 로컬 유저는 sysadmin 아님 + 권한 행 없음 → private 맵은 hidden으로 마스킹
    body = client.get(f"/api/categories/{ids['A1']}/maps").json()
    names = [m["name"] for m in body["maps"]]
    assert "framework pub map" in names
    assert body["total"] == 2 and body["hidden"] >= 1
    assert all(m["name"] != "framework private map" for m in body["maps"])


def test_map_out_exposes_category_fields(client: TestClient) -> None:
    ids = _seed_tree(client)
    detail = client.get(f"/api/maps/{ids['pub']}").json()
    assert detail["category_id"] is not None
    assert detail["category_path"] == "구매/직접구매"
    assert detail["consultant_code"] == "CAT-M1"
    assert "sp_input" in detail and "sp_output" in detail
```

주의: `_seed_tree`는 테스트마다 같은 code로 재시드하면 unique 충돌 — 함수 첫머리에서 기존 `CAT-A*` 행/맵을 조회해 있으면 재사용하도록 멱등 처리(간단히: code로 조회 후 존재 시 기존 id 반환). DEV_ENFORCE_PERMISSIONS=false 기본에서도 private 마스킹이 동작하는지 확인 — 만약 enforce OFF에서 전부 보인다면 conftest의 enforce 픽스처(권한 강제 ON 런타임 토글)를 사용해 마스킹 테스트만 enforce ON으로 감쌀 것(기존 권한 테스트들의 패턴을 따른다).

- [x] **Step 2: 실패 확인** — `pytest tests/test_categories_api.py -q` → 404/필드 누락으로 FAIL.

- [x] **Step 3: 구현** — 위 Interfaces·구현 지침 대로. main.py 라우터 등록 잊지 말 것(`app.include_router(categories.router)` — 기존 나열부와 동일 스타일, prefix는 라우터 내 `/categories`).

- [x] **Step 4: 통과 확인** — 대상 파일 + `tests/test_consultant_import.py`(회귀) green.

- [x] **Step 5: 린트+커밋** — ruff 후 `feat(categories): lazy tree read API + MapOut category exposure — 카테고리 트리 조회 API·MapOut 노출` (+PROGRESS/플랜 체크박스).

---

### Task 2: 백엔드 — 지정 I/O + 카테고리 연결/해제 + 슬롯 이양 API

**Files:**
- Modify: `backend/app/schemas.py` (`SubprocessDesignationIn`에 `input: str = ""`·`output: str = ""` — **길이 캡 금지**, 기존 validator 불변), `backend/app/routers/maps.py`
- Test: `backend/tests/test_categories_api.py` (append)

**Interfaces (Produces):**
- `designate_subprocess`(PUT `/maps/{id}/subprocess-designation` 기존 엔드포인트): `sp_input = payload.input or None`, `sp_output = payload.output or None` 저장(다른 필드 대입부와 같은 블록).
- `PUT /api/maps/{map_id}/category` body `{"category_id": <int|null>}` → 갱신된 MapDetailOut. 가드: **`set_owning_department`(maps.py:888)와 동일한 오너/sysadmin 가드 패턴을 그대로 미러**. category_id 존재 검증(404), null=해제.
- `POST /api/maps/{map_id}/framework-transfer` body `{"to_map_id": <int>}` → 200 + `{from_map_id, to_map_id}`. 시맨틱: source의 `category_id`+`consultant_code`를 target으로 이전하고 source는 둘 다 NULL. 가드: sysadmin이거나 **두 맵 모두의** 오너. 409: source에 category_id 없음 / target이 이미 category_id 또는 consultant_code 보유 / target 소프트삭제·source 소프트삭제는 404.

- [x] **Step 1: 실패하는 테스트 작성** — append

```python
def test_designation_saves_input_output(client: TestClient) -> None:
    ids = _seed_tree(client)
    resp = client.put(
        f"/api/maps/{ids['pub']}/subprocess-designation",
        json={"department": "Owning Anchor Division", "input": "PR 문서", "output": "PO 문서"},
    )
    assert resp.status_code == 200
    body = client.get(f"/api/maps/{ids['pub']}").json()
    assert body["sp_input"] == "PR 문서" and body["sp_output"] == "PO 문서"


def test_category_assign_and_unassign(client: TestClient) -> None:
    ids = _seed_tree(client)
    created = client.post("/api/maps", json={
        "name": "framework assign target", "description": "",
        "owning_department": "Owning Anchor Division", "visibility": "public",
    }).json()
    mid = created["id"]
    assert client.put(f"/api/maps/{mid}/category", json={"category_id": ids["A1"]}).status_code == 200
    assert client.get(f"/api/maps/{mid}").json()["category_path"] == "구매/직접구매"
    assert client.put(f"/api/maps/{mid}/category", json={"category_id": None}).status_code == 200
    assert client.get(f"/api/maps/{mid}").json()["category_id"] is None
    assert client.put(f"/api/maps/{mid}/category", json={"category_id": 999999}).status_code == 404


def test_framework_transfer_moves_slot(client: TestClient) -> None:
    ids = _seed_tree(client)
    created = client.post("/api/maps", json={
        "name": "framework transfer target", "description": "",
        "owning_department": "Owning Anchor Division", "visibility": "public",
    }).json()
    target = created["id"]
    resp = client.post(f"/api/maps/{ids['pub']}/framework-transfer", json={"to_map_id": target})
    assert resp.status_code == 200
    src = client.get(f"/api/maps/{ids['pub']}").json()
    dst = client.get(f"/api/maps/{target}").json()
    assert src["category_id"] is None and src["consultant_code"] is None
    assert dst["category_path"] == "구매/직접구매" and dst["consultant_code"] == "CAT-M1"
    # 재이양 시 source에 슬롯 없음 → 409
    assert client.post(f"/api/maps/{ids['pub']}/framework-transfer", json={"to_map_id": target}).status_code == 409
```

주의: `_seed_tree` 멱등 재사용 시 이전 테스트가 슬롯을 옮겨놨을 수 있음 — transfer 테스트는 자기 시드 맵(`pub`)의 현재 상태를 전제하므로 **테스트 순서 의존을 피하기 위해 transfer 테스트 전용 코드로 새 시드(code 접두 `CAT-T*`)를 쓰는 별도 헬퍼**로 작성해도 된다(구현자 판단 — 단언 강도 유지).

- [x] **Step 2: 실패 확인** → 신규 3건 FAIL.
- [x] **Step 3: 구현** — Interfaces 대로. 이양은 알림 없음(최소 스코프 — 후속).
- [x] **Step 4: 통과 확인** — `tests/test_categories_api.py` 전체 + `tests/test_consultant_import.py` green.
- [x] **Step 5: 린트+커밋** — `feat(maps): designation I/O + category assign + framework slot transfer — 지정 I/O·카테고리 연결·슬롯 이양`.

---

### Task 3: 프론트 — API 클라이언트 + Maps 탭 토글 + FrameworkTree(lazy)

**Files:**
- Modify: `frontend/src/lib/api.ts`, `frontend/src/app/page.tsx`, `frontend/src/lib/i18n-messages.ts`
- Create: `frontend/src/components/maps/framework-tree.tsx`
- Test: `frontend/src/components/maps/framework-tree.test.tsx`(또는 lib 헬퍼 분리 시 그 테스트)

**Step 0 — 워크트리 프론트 셋업(최초 1회):**
```bash
cp -Rc /Users/hyeonjin/Documents/bpm/frontend/node_modules \
  /Users/hyeonjin/Documents/bpm/.claude/worktrees/consultant-hierarchy/frontend/node_modules
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/consultant-hierarchy/frontend && npm install
```
(메인 체크아웃에 node_modules 없거나 클론 실패 시 npm install 단독 — 시간이 더 걸릴 뿐 동작.)

**Interfaces (Consumes Task 1 API / Produces Task 4가 재사용):**
- `api.ts` 추가 — 기존 컨벤션(스네이크 필드 그대로, `request<T>` 헬퍼):
```ts
export interface CategoryNode {
  id: number; code: string; name: string; level: number;
  sort_order: number; child_count: number; map_count: number;
}
export interface CategoryMaps { total: number; hidden: number; maps: MapSummary[]; }
export function listCategoryNodes(parentId?: number): Promise<CategoryNode[]> {
  const qs = parentId === undefined ? "" : `?parent_id=${parentId}`;
  return request<CategoryNode[]>(`/categories/nodes${qs}`);
}
export function listCategoryMaps(categoryId: number, offset = 0, limit = 50): Promise<CategoryMaps> {
  return request<CategoryMaps>(`/categories/${categoryId}/maps?offset=${offset}&limit=${limit}`);
}
```
- `MapSummary`에 `category_id?: number | null; category_path?: string | null; consultant_code?: string | null; sp_input?: string | null; sp_output?: string | null;` 추가.
- `page.tsx` 토글: `homeView: "departments" | "framework"` state — **`bpm.home.tree` 블롭에 `view` 필드로 영속**(writeTree 시그니처에 인자 추가, 모든 기존 호출부 갱신·복원 effect에서 하이드레이션). 토글 UI는 가시성 필터 세그먼트(`page.tsx:610-631`) 스타일 복제 — `data-id="home-view-toggle"`, 라벨 i18n `home.viewDepartments`("Departments"/"부서")·`home.viewFramework`("Framework"/"업무 체계"). framework 뷰일 때 좌측 컬럼: 검색박스·필터·MyDept·Word 섹션 대신 `<FrameworkTree/>`만 렌더(v1은 브라우즈 전용 — 검색은 Departments 뷰가 커버, 설계 §6 v1 단순화로 주석).
- `FrameworkTree` (신규 컴포넌트) props: `{ renderCard: (map: MapSummary) => ReactNode; selectedId: number | null }` — page.tsx의 기존 `renderCard`(519-520)를 그대로 물려받아 맵 행 렌더 일원화. 내부:
  - state: `childrenByParent: Map<number | "root", CategoryNode[]>`(fetch 1회 캐시), `mapsByCategory: Map<number, CategoryMaps>`, `openIds: Set<number>`, `loadingIds: Set<number>`.
  - 마운트 시 루트 fetch. 노드 펼침 핸들러: 캐시 없으면 `listCategoryNodes(id)` + `listCategoryMaps(id)` 병렬 fetch 후 open. 접힘/펼침은 세션 state만(영속 불요 — v1).
  - 행 UI: org-accordion(`org-accordion.tsx:54-93`) 패턴 미러 — depth 들여쓰기 inline paddingLeft, 접힌 행에만 `CountTag`(map_count), 펼친 행 톤다운, 빈 카테고리(map_count=0·child_count=0)도 행으로 표시. 맵 행은 renderCard. `hidden > 0`이면 `home.frameworkHidden`("{n} hidden"/"{n}개 비공개") fine 텍스트 행. `total > maps.length + hidden`이면 "Load more" 버튼(`listCategoryMaps(id, offset)` append).
  - `data-id`: `framework-tree`, 노드 행 `framework-node`, 로드모어 `framework-more`.
- i18n 키(EN/KO 양쪽): `home.viewDepartments`·`home.viewFramework`·`home.frameworkEmpty`("No categories yet — run the consultant import."/"카테고리가 아직 없습니다 — 컨설턴트 임포트를 실행하세요.")·`home.frameworkHidden`·`home.frameworkMore`("Load more"/"더 보기").

- [x] **Step 1: 실패하는 테스트 작성** — 트리 캐시·펼침 로직을 vitest로. fetch 목킹은 `listCategoryNodes`/`listCategoryMaps`를 vi.mock으로 대체(리포 관례: page.route가 아닌 모듈 목). 최소 3케이스: ①루트 로드 렌더 ②펼침 시 자식+맵 1회만 fetch(재펼침 시 캐시) ③hidden 행·빈 카테고리 행 표시. (컴포넌트 테스트가 기존 리포에 없다면 — `frontend/src/components` 아래 `.test.tsx` 부재 확인 후 — 캐시/펼침 로직을 `frontend/src/lib/framework-tree-state.ts` 순수 리듀서로 분리해 그걸 vitest하고 컴포넌트는 thin 렌더로 유지하는 쪽을 택한다. 리포 테스트 관례를 먼저 확인하고 맞출 것.) — `vitest.config.ts`가 `src/**/*.test.ts`만 include(`.test.tsx` 부재 확인) → lib 분리 경로 채택, 4케이스로 구현(load more append 1건 추가).
- [x] **Step 2: 실패 확인** — `npx vitest run <대상>` FAIL. — 모듈 미존재로 import resolve 실패 확인.
- [x] **Step 3: 구현** — Interfaces 대로. page.tsx 변경은 외과적으로: 토글 state·writeTree 확장·좌측 컬럼 조건 분기만.
- [x] **Step 4: 게이트** — `npx vitest run` 전체 · `npx tsc --noEmit` · `npm run lint` green. — 597/597 · 클린 · 0 errors(사전 warning 1건 무관). `npm run build`도 성공 확인(§Global Constraints 프론트 게이트).
- [x] **Step 5: 커밋** — `feat(home): framework view toggle + lazy category tree — 홈 업무 체계 토글·lazy 카테고리 트리`.

---

### Task 4: 프론트 — MapDetailCard 뱃지/I/O + 카테고리 연결/해제·슬롯 이양 모달

**Files:**
- Modify: `frontend/src/components/maps/map-detail-card.tsx`, `frontend/src/lib/api.ts`, `frontend/src/lib/i18n-messages.ts`
- Create: `frontend/src/components/maps/framework-assign-modal.tsx`

**Interfaces (Consumes Task 2 API):**
- `api.ts` 추가:
```ts
export function putMapCategory(mapId: number, categoryId: number | null): Promise<MapDetail> {
  return request<MapDetail>(`/maps/${mapId}/category`, {
    method: "PUT", body: JSON.stringify({ category_id: categoryId }),
  });
}
export function postFrameworkTransfer(mapId: number, toMapId: number): Promise<{ from_map_id: number; to_map_id: number }> {
  return request(`/maps/${mapId}/framework-transfer`, {
    method: "POST", body: JSON.stringify({ to_map_id: toMapId }),
  });
}
```
- **경로 뱃지**: `map-detail-card.tsx`의 기존 pill 행(304-368, visibility·role·owning-department pill 컨테이너)에 `category_path` pill 추가 — 같은 `rounded-full px-2 py-0.5` + tint 토큰 + Lucide `Network`(16px) 아이콘, `data-id="map-detail-category"`. 오너/sysadmin(`my_role === "owner"`)이면 pill 클릭 → FrameworkAssignModal. category 없으면 오너에게만 "Add to framework" 유령 pill(`home.frameworkAssign`).
- **I/O 표시**: full-body(`!only`) 설명 박스(389-398) 아래 `sp_input`/`sp_output` 존재 시 2행 블록(`data-id="map-detail-io"`, 라벨 i18n `home.ioInput`("Input"/"인풋")·`home.ioOutput`).
- **FrameworkAssignModal** (신규): props `{ mapId, currentCategoryId, currentPath, onClose, onChanged }`. 내용 — 모달 컨벤션(압축: 아이콘+요약박스, ConfirmDialog 계열 스타일) 준수:
  - 카테고리 선택: 레벨별 **캐스케이드 셀렉트**(루트부터 `listCategoryNodes(parent)` lazy — Task 3의 API 재사용, 트리 임베드보다 가벼움). 아무 레벨에서나 "여기에 연결" 가능(비-리프 허용 — 설계 §2.2).
  - 액션 3개: Assign(putMapCategory) · Unassign(putMapCategory null — category 있을 때만) · Transfer slot(다른 맵 선택 → postFrameworkTransfer — `consultant_code` 있는 맵에만 노출). Transfer의 맵 선택은 홈이 이미 가진 클라이언트 맵 목록에서 SearchSelect(포털 모드) 재사용 — 서버 검색은 스케일 하드닝 트랙으로.
  - 성공 시 `onChanged()` → 카드 reloadKey 갱신(기존 detailReloadKey 패턴).
- i18n: `home.frameworkAssign`·`home.frameworkUnassign`·`home.frameworkTransfer`·`home.frameworkPickCategory` 등 EN/KO.

- [x] **Step 1: 실패하는 테스트 작성** — 모달의 캐스케이드 상태 로직을 순수 헬퍼로 분리 시 vitest(선택 체인 변경 시 하위 리셋), 최소 1~2케이스. UI 상호작용 자체는 Task 6 스모크가 커버.
- [x] **Step 2: 실패 확인.**
- [x] **Step 3: 구현.**
- [x] **Step 4: 게이트** — vitest 전체·tsc·lint green.
- [x] **Step 5: 커밋** — `feat(home): category badge + I/O display + framework assign/transfer modal — 경로 뱃지·I/O 표시·연결/이양 모달`.

---

### Task 5: 프론트 — SP 지정 폼 Input/Output 편집

**Files:**
- Modify: `frontend/src/components/permissions/subprocess-designation-modal.tsx`(DesignationForm 19-30 + 렌더), `frontend/src/components/permissions/subprocess-designation-panel.tsx`(modalInitial 34-45), `frontend/src/lib/api.ts`(`SubprocessDesignationBody` 385-397), `frontend/src/lib/i18n-messages.ts`

**요구:**
- `DesignationForm`·`SubprocessDesignationBody`에 `input: string`·`output: string` 추가(빈 문자열 기본). 모달 렌더는 description textarea(209-217) **앞**에 Input/Output 각 1줄 텍스트 입력(멀티라인 아님 — 간결, 필요 시 후속) 추가, 라벨 i18n `sp.input`("Input"/"인풋")·`sp.output`. panel의 `modalInitial`은 맵의 `sp_input ?? ""`/`sp_output ?? ""` 프리필.
- 저장 경로는 기존 `putSubprocessDesignation` 그대로(Task 2가 백엔드 수용). **길이 제한·정규화 없음**(자유 텍스트).

- [x] **Step 1~4:** 이 태스크는 폼 배선 4파일 — 신규 로직이 없어 vitest 신규 케이스는 불요(기존 스위트 회귀만). tsc·lint·vitest 전체 green으로 검증.
- [x] **Step 5: 커밋** — `feat(sp): input/output fields on designation form — SP 지정 폼 I/O 편집`.

---

### Task 6: 샘플 전달물 + Playwright 스모크 + 전체 게이트

**Files:**
- Create: `docs/samples/consultant-delivery-sample/categories.json`(L1~L5 각 1개 체인 + 형제 1개), `docs/samples/consultant-delivery-sample/maps.jsonl`(맵 3개 — 연계 1쌍 포함, owner `admin.sys`, department는 데모 시드 org 경로)
- Create: `frontend/scripts/pw-smoke-framework.mjs`(리포 기존 pw-smoke-*.mjs 관례 미러 — 시스템 Chrome, `docs/lessons/browser-verification.md` 준수)
- Modify: `docs/README.md`(샘플 1줄), PROGRESS.md, 플랜 체크박스

**스모크 시나리오** (로컬: backend uvicorn(8000, sqlite dev 초기화 `python -m scripts.reset_db`) + `python -m scripts.import_consultant docs/samples/consultant-delivery-sample --apply` + frontend dev(3000, 좀비 next 전수 pkill 후):
1. 홈 진입(devUser admin.sys) → `home-view-toggle` 존재 → Framework 클릭
2. `framework-tree` 루트 노드 렌더 → 펼침 → 하위 → L5 펼침 → 맵 행(카드) 노출
3. 맵 카드 선택 → 상세 카드에 `map-detail-category` 경로 뱃지 + `map-detail-io` 확인
4. Departments 토글 복귀 → 조직도 정상(회귀)
5. 새로고침 → 토글 상태 유지(localStorage)

- [x] **Step 1: 샘플 전달물 작성** — canonical 계약(§4) 준수, `python -m scripts.import_consultant docs/samples/consultant-delivery-sample`(dry-run)이 error 0으로 통과하는지 backend에서 확인. — dry-run `created=3` (errors=0, warnings=0).
- [x] **Step 2: 스모크 작성·실행** — 5시나리오 green. dev.db 오염/포트 좀비 함정은 lessons 문서 절차대로. — `pw-smoke-framework.mjs` 8/8 checks passed (재실행 2회 안정).
- [x] **Step 3: 전체 게이트** — backend pytest 전체 + ruff / frontend vitest·tsc·lint·build 전부 green. — pytest 922 passed·ruff clean / vitest 603 passed·tsc clean·lint 0 errors(사전 warning 1건 무관)·build 성공.
- [x] **Step 4: 커밋** — `feat(consultant): sample delivery + framework smoke — 샘플 전달물·업무 체계 스모크` (+PROGRESS에 Phase 2 완료 요약).

미검증 잔여(정직 보고 대상): 서버(원격 IP·평문 HTTP) 실배포 확인, 대량(수천 카테고리) 렌더 성능 실측, SP 피커/기존 홈 스케일 하드닝(별도 트랙).
