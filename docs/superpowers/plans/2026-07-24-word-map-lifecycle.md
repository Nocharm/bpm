# Word Map Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Word 맵을 홈에서 문서 부속 산출물로 분리 표현하고(섹션·집계 제외), 생성/재임포트/완결문서/승격 복사까지 라이프사이클을 완성한다.

**Architecture:** 백엔드는 타임스탬프 컬럼 2종 + generated 스탬프 엔드포인트 + copy `convert_to_normal` 확장만. 프론트는 홈 목록을 `mode`로 분리(`splitMapsByMode`)해 신규 `WordDocsSection`에 word 맵을 몰고, 빠른 생성(자동값)·재임포트·승격은 기존 모달/다이얼로그를 재사용·확장한다. stale 앵커·재생성 힌트는 순수 클라 파생.

**Tech Stack:** FastAPI + SQLAlchemy(async) + pytest / Next.js + React + vitest + playwright-core.

**Spec:** `docs/design/2026-07-24-word-map-lifecycle-design.md` (섹션 번호 §N로 참조)

## Global Constraints

- **작업 위치**: `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`, 브랜치 `dev`. 매 태스크 시작 시 `pwd && git branch --show-current`로 확인(서브에이전트 main 이탈 사고 전례).
- 백엔드 테스트: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` (backend/.env 오염 가드).
- 프론트 게이트: `cd frontend && npx vitest run && npx tsc --noEmit && npm run lint`.
- 신규 DB 컬럼은 반드시 `backend/app/db.py` `_ADDED_COLUMNS`에 등록(운영 DB는 리셋 불가, 자동 ALTER만).
- 커밋: `type(scope): English summary — 한국어 요약`. **매 커밋에 `PROGRESS.md` 갱신 포함**(2026-07-24 섹션에 한 줄 추가/보강). 커밋 끝에:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 프론트 디자인: raw hex 금지(토큰만), Lucide 16px `strokeWidth={1.5}`, 이모지 금지, 신규 구조 요소에 `data-id`. word 표면 UI 텍스트는 영어 하드코딩(`word-create-modal.tsx` 관례 — i18n 키 미배선).
- `crypto.randomUUID` 금지(`genId()` 사용 — 이번 플랜에서는 id 생성 없음).
- TS: `any`·불필요한 `as` 금지, strict.

---

### Task 1: Backend — 타임스탬프 컬럼 2종 + 재임포트 스탬프

**Files:**
- Modify: `backend/app/models.py` (ProcessMap, `doc_sections` 컬럼 직후 ~line 120)
- Modify: `backend/app/db.py` (`_ADDED_COLUMNS` 리스트 끝)
- Modify: `backend/app/schemas.py` (MapOut, word 필드 블록 직후)
- Modify: `backend/app/routers/maps.py` (`set_word_doc`, ~line 816)
- Test: `backend/tests/test_maps.py` (파일 끝에 추가)

**Interfaces:**
- Consumes: 기존 `ProcessMap.doc_name/doc_sections`, `_now()` (maps.py에 이미 import됨)
- Produces: `ProcessMap.doc_imported_at`, `ProcessMap.doc_generated_at` (datetime|None) — MapOut/MapDetailOut 응답에 노출. Task 2·4가 사용.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_maps.py` 끝에 추가 (기존 import에 `uuid4` 이미 있음):

```python
def test_reimport_stamps_imported_at(client: TestClient) -> None:
    """재임포트 성공 시 doc_imported_at이 찍힌다 (design 2026-07-24 §5)."""
    created = client.post(
        "/api/maps",
        json={
            "name": f"stamp-{uuid4().hex[:8]}",
            "owning_department": "Owning Anchor Division",
            "mode": "word",
            "doc_name": "v1.docx",
            "doc_sections": [],
        },
    ).json()
    assert created["doc_imported_at"] is None
    r = client.put(
        f"/api/maps/{created['id']}/word-doc",
        json={"doc_name": "v2.docx", "sections": []},
    )
    assert r.status_code == 200
    assert r.json()["doc_imported_at"] is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_maps.py::test_reimport_stamps_imported_at -q`
Expected: FAIL — `KeyError: 'doc_imported_at'` (응답에 필드 없음)

- [ ] **Step 3: Implement**

`models.py` — ProcessMap의 `doc_sections` 줄 바로 아래:

```python
    # 개정 라이프사이클 타임스탬프 — 재임포트/완결 문서 생성 시각 (design 2026-07-24 §5)
    doc_imported_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    doc_generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
```

`db.py` — `_ADDED_COLUMNS` 리스트 마지막에:

```python
    # Word 맵 개정 타임스탬프 — 재임포트·완결 문서 생성 시각 (design 2026-07-24 §5)
    ("process_maps", "doc_imported_at", "TIMESTAMP"),
    ("process_maps", "doc_generated_at", "TIMESTAMP"),
```

`schemas.py` — MapOut의 `doc_sections: list[SectionEntryIn]...` 줄 바로 아래:

```python
    # 개정 라이프사이클 타임스탬프 — 홈 word 행·상세 카드 표시용 (design 2026-07-24 §5)
    doc_imported_at: datetime | None = None
    doc_generated_at: datetime | None = None
```

(`MapDetailOut`이 `MapOut`을 상속하는지 확인 — 상속하면 추가 작업 없음. 별도 클래스면 같은 두 줄을 추가.)

`maps.py` `set_word_doc` — `found_map.doc_sections = ...` 줄 바로 아래:

```python
    found_map.doc_imported_at = _now()
```

- [ ] **Step 4: Run test to verify it passes**

Run: 같은 명령. Expected: PASS. 이어서 파일 전체 회귀: `... -m pytest tests/test_maps.py -q` Expected: all pass.

- [ ] **Step 5: Commit** (PROGRESS.md에 한 줄 추가 후 함께)

```bash
git add backend/app/models.py backend/app/db.py backend/app/schemas.py backend/app/routers/maps.py backend/tests/test_maps.py PROGRESS.md
git commit -m "feat(word-map): revision timestamps — stamp doc_imported_at on reimport — 개정 타임스탬프 컬럼·재임포트 스탬프"
```

---

### Task 2: Backend — `POST /maps/{id}/word-doc/generated`

**Files:**
- Modify: `backend/app/routers/maps.py` (`set_word_doc` 함수 바로 아래)
- Test: `backend/tests/test_maps.py`

**Interfaces:**
- Consumes: Task 1의 `doc_generated_at` 컬럼
- Produces: `POST /api/maps/{map_id}/word-doc/generated` → MapOut. Task 4의 `markWordDocGenerated()`가 호출.

- [ ] **Step 1: Write the failing test**

```python
def test_mark_generated_stamps_timestamp(client: TestClient) -> None:
    """완결 문서 생성 기록 — 서버는 doc_generated_at만 스탬프 (design 2026-07-24 §5)."""
    created = client.post(
        "/api/maps",
        json={
            "name": f"gen-{uuid4().hex[:8]}",
            "owning_department": "Owning Anchor Division",
            "mode": "word",
        },
    ).json()
    r = client.post(f"/api/maps/{created['id']}/word-doc/generated")
    assert r.status_code == 200
    assert r.json()["doc_generated_at"] is not None

    missing = client.post("/api/maps/999999/word-doc/generated")
    assert missing.status_code in (403, 404)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... -m pytest tests/test_maps.py::test_mark_generated_stamps_timestamp -q`
Expected: FAIL — 405 or 404 (라우트 없음)

- [ ] **Step 3: Implement** — `set_word_doc` 아래에 추가:

```python
@router.post(
    "/{map_id}/word-doc/generated",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("editor"))],
)
async def mark_word_doc_generated(
    map_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    """완결 문서 생성 성공 기록 — 생성은 클라이언트 전용이라 서버는 시각만 스탬프 (design 2026-07-24 §5)."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    found_map.doc_generated_at = _now()
    await session.commit()
    found_map.my_role = await get_effective_role(session, user, map_id)
    return found_map
```

(`MapOut`·`require_map_role`·`get_effective_role`는 maps.py에 이미 import되어 있는지 확인 — set_word_doc·copy_map이 이미 사용 중.)

- [ ] **Step 4: Run tests** — 해당 테스트 PASS 확인 후 `pytest tests/ -q` 전체 그린 + `.venv/bin/ruff check app/ tests/`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/maps.py backend/tests/test_maps.py PROGRESS.md
git commit -m "feat(word-map): endpoint to record complete-doc generation time — 완결문서 생성시각 기록 엔드포인트"
```

---

### Task 3: Backend — copy `convert_to_normal` (승격 복사)

**Files:**
- Modify: `backend/app/schemas.py` (`MapCopy`, ~line 52)
- Modify: `backend/app/routers/maps.py` (`copy_map`, ~line 311-380)
- Test: `backend/tests/test_maps.py`

**Interfaces:**
- Consumes: 기존 copy 계약(승인본 필수 409), `clone_graph`, `Node` 모델(maps.py에 이미 import)
- Produces: `MapCopy.convert_to_normal: bool`, `MapCopy.owning_department: str | None`. Task 4의 `copyMap(mapId, name, opts)`가 사용.

- [ ] **Step 1: Write the failing test**

테스트 파일 상단 import에 `Node`가 없으면 `from app.models import ...` 라인에 추가. 파일 끝에:

```python
def test_copy_convert_to_normal_promotes_sections(client: TestClient) -> None:
    """승격 복사 — mode/doc 소거, 섹션 노드는 process 변환(앵커 소거·url 유지) (design 2026-07-24 §6)."""
    name = f"word-promote-{uuid4().hex[:8]}"

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(
                name=name,
                visibility="public",
                mode="word",
                doc_name="sop.docx",
                doc_sections=[{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
            )
            v = MapVersion(label="As-Is", status="approved")
            m.versions.append(v)
            session.add(m)
            await session.flush()
            session.add(
                Node(
                    id="sec-1",
                    version_id=v.id,
                    title="1 재고",
                    node_type="section",
                    section_anchor="_Toc1",
                    url="http://docs.example/sop",
                    url_label="SOP",
                )
            )
            await session.commit()
            return m.id

    map_id = asyncio.run(_seed())
    res = client.post(
        f"/api/maps/{map_id}/copy",
        json={"convert_to_normal": True, "owning_department": "Owning Anchor Division"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["mode"] == "normal"
    assert body["doc_name"] == ""
    assert body["doc_sections"] == []
    assert body["owning_department"] == "Owning Anchor Division"
    graph = client.get(f"/api/versions/{body['versions'][0]['id']}/graph").json()
    node = next(n for n in graph["nodes"] if n["id"] == "sec-1")
    assert node["node_type"] == "process"
    assert node["section_anchor"] == ""
    assert node["url"] == "http://docs.example/sop"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... -m pytest tests/test_maps.py::test_copy_convert_to_normal_promotes_sections -q`
Expected: FAIL — `body["mode"] == "word"` (상속됨)

- [ ] **Step 3: Implement**

`schemas.py` `MapCopy`:

```python
class MapCopy(BaseModel):
    # 새 맵 이름 — 비우면 "<원본명> (Copy)" (F12 승인본 복사)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    # Word 맵 → 일반 맵 승격 복사 — mode/doc 소거 + 섹션 노드 일괄 process 변환 (design 2026-07-24 §6)
    convert_to_normal: bool = False
    # 승격 관문에서 지정한 오우닝 부서 — 없으면 원본 상속
    owning_department: str | None = None
```

`maps.py` `copy_map` — `new_map = ProcessMap(...)` 블록을 다음으로 교체:

```python
    convert = payload.convert_to_normal
    new_map = ProcessMap(
        name=copy_name,
        description=source_map.description,
        created_by=user,
        owner_id=user,
        visibility="private",
        owning_department=payload.owning_department or source_map.owning_department,
        # Word 맵 복사는 mode·문서 카탈로그도 함께 상속 — 승격(convert)은 일반 맵으로 소거 (design 2026-07-24 §6)
        mode="normal" if convert else source_map.mode,
        doc_name="" if convert else source_map.doc_name,
        doc_sections=[] if convert else list(source_map.doc_sections),
    )
```

`await clone_graph(session, source_version, new_version.id)` 바로 아래:

```python
    if convert:
        # 승격: 섹션 노드 → 일반 process 노드 일괄 변환(앵커 소거·url은 유지) (design 2026-07-24 §6)
        for node in await session.scalars(
            select(Node).where(Node.version_id == new_version.id, Node.node_type == "section")
        ):
            node.node_type = "process"
            node.section_anchor = ""
```

- [ ] **Step 4: Run tests** — 신규 PASS + 기존 `test_copy_inherits_word_mode_and_catalog` 여전히 PASS(플래그 기본 False → 상속 불변). 전체 `pytest tests/ -q` + ruff 그린.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/maps.py backend/tests/test_maps.py PROGRESS.md
git commit -m "feat(word-map): promote-copy — convert_to_normal flag turns section nodes into process — 승격 복사(섹션→일반 노드 일괄 변환)"
```

---

### Task 4: FE — api 확장 + `word-map-home.ts` 파생 헬퍼

**Files:**
- Modify: `frontend/src/lib/api.ts` (MapSummary ~line 79 인접, `copyMap` ~line 272, `setWordDoc` 아래)
- Create: `frontend/src/lib/word-map-home.ts`
- Test: `frontend/src/lib/word-map-home.test.ts`

**Interfaces:**
- Produces (이후 태스크 전부가 사용):
  - `MapSummary.doc_imported_at?: string | null`, `MapSummary.doc_generated_at?: string | null`
  - `copyMap(mapId: number, name?: string, opts?: { convertToNormal?: boolean; owningDepartment?: string }): Promise<MapDetail>`
  - `markWordDocGenerated(mapId: number): Promise<MapSummary>`
  - `splitMapsByMode<T extends { mode?: string }>(maps: T[]): { processMaps: T[]; wordMaps: T[] }`
  - `needsRegenerate(map: { doc_imported_at?: string | null; doc_generated_at?: string | null }): boolean`
  - `getStaleSectionNodeIds(nodes: { id: string; nodeType?: string; sectionAnchor?: string }[], sections: { anchor: string }[]): Set<string>`
  - `formatDocStamp(value: string | null | undefined): string | null` — `YYYY-MM-DD` 또는 null

- [ ] **Step 1: Write the failing test** — `frontend/src/lib/word-map-home.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  formatDocStamp,
  getStaleSectionNodeIds,
  needsRegenerate,
  splitMapsByMode,
} from "@/lib/word-map-home";

describe("splitMapsByMode", () => {
  it("separates word maps from process maps (missing mode = process)", () => {
    const { processMaps, wordMaps } = splitMapsByMode([
      { id: 1, mode: "normal" },
      { id: 2, mode: "word" },
      { id: 3 },
    ]);
    expect(processMaps.map((m) => m.id)).toEqual([1, 3]);
    expect(wordMaps.map((m) => m.id)).toEqual([2]);
  });
});

describe("needsRegenerate", () => {
  it("true only when import is newer than last generation", () => {
    expect(
      needsRegenerate({
        doc_imported_at: "2026-07-24T10:00:00+09:00",
        doc_generated_at: "2026-07-24T09:00:00+09:00",
      }),
    ).toBe(true);
    expect(
      needsRegenerate({
        doc_imported_at: "2026-07-24T08:00:00+09:00",
        doc_generated_at: "2026-07-24T09:00:00+09:00",
      }),
    ).toBe(false);
    expect(needsRegenerate({ doc_imported_at: "2026-07-24T08:00:00+09:00", doc_generated_at: null })).toBe(false);
    expect(needsRegenerate({ doc_imported_at: null, doc_generated_at: null })).toBe(false);
  });
});

describe("getStaleSectionNodeIds", () => {
  it("flags section nodes whose anchor left the catalog", () => {
    const ids = getStaleSectionNodeIds(
      [
        { id: "s1", nodeType: "section", sectionAnchor: "_Toc1" },
        { id: "s2", nodeType: "section", sectionAnchor: "_TocGone" },
        { id: "s3", nodeType: "section", sectionAnchor: "" },
        { id: "p1", nodeType: "process", sectionAnchor: "_TocGone" },
      ],
      [{ anchor: "_Toc1" }],
    );
    expect([...ids]).toEqual(["s2"]);
  });
});

describe("formatDocStamp", () => {
  it("formats to YYYY-MM-DD and passes through empties", () => {
    expect(formatDocStamp("2026-07-24T10:00:00+09:00")).toBe("2026-07-24");
    expect(formatDocStamp(null)).toBeNull();
    expect(formatDocStamp(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/word-map-home.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement** — `frontend/src/lib/word-map-home.ts`:

```ts
// Word 맵 홈 표현 파생 헬퍼 — 목록 분리·재생성 힌트·stale 앵커 판정.
// 설계: docs/design/2026-07-24-word-map-lifecycle-design.md §2·§5

// 홈 목록 분리 — 조직도/집계는 processMaps만, Word documents 섹션은 wordMaps만 사용한다.
export function splitMapsByMode<T extends { mode?: string }>(
  maps: T[],
): { processMaps: T[]; wordMaps: T[] } {
  const processMaps: T[] = [];
  const wordMaps: T[] = [];
  for (const m of maps) (m.mode === "word" ? wordMaps : processMaps).push(m);
  return { processMaps, wordMaps };
}

// 재임포트가 마지막 완결 문서 생성보다 새로우면 재생성 필요. 생성 이력이 없으면 힌트 없음.
export function needsRegenerate(map: {
  doc_imported_at?: string | null;
  doc_generated_at?: string | null;
}): boolean {
  if (!map.doc_imported_at || !map.doc_generated_at) return false;
  return new Date(map.doc_imported_at).getTime() > new Date(map.doc_generated_at).getTime();
}

// 카탈로그에 더 이상 없는 앵커를 참조하는 섹션 노드 id — 캔버스 배지·섹션 패널 경고용(재임포트 후 자동삭제 없음).
export function getStaleSectionNodeIds(
  nodes: { id: string; nodeType?: string; sectionAnchor?: string }[],
  sections: { anchor: string }[],
): Set<string> {
  const anchors = new Set(sections.map((s) => s.anchor));
  const stale = new Set<string>();
  for (const n of nodes) {
    if (n.nodeType === "section" && n.sectionAnchor && !anchors.has(n.sectionAnchor)) {
      stale.add(n.id);
    }
  }
  return stale;
}

// 타임스탬프 표시 — 홈 행/상세 카드는 날짜(YYYY-MM-DD)면 충분하다.
export function formatDocStamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
```

`api.ts` 3곳:

1. `MapSummary`의 `doc_sections?: SectionEntry[];` 줄 아래:

```ts
  // 개정 라이프사이클 타임스탬프 — 재임포트/완결 문서 생성 (design 2026-07-24 §5)
  doc_imported_at?: string | null;
  doc_generated_at?: string | null;
```

2. `copyMap` 교체:

```ts
// 승인본(approved/published) 기준 맵 복사 — 새 private 맵의 초기 draft에 그래프 복제 (F12)
// convertToNormal: word 맵 승격 — mode/doc 소거 + 섹션 노드 일괄 process 변환 (design 2026-07-24 §6)
export function copyMap(
  mapId: number,
  name?: string,
  opts?: { convertToNormal?: boolean; owningDepartment?: string },
): Promise<MapDetail> {
  return request<MapDetail>(`/maps/${mapId}/copy`, {
    method: "POST",
    body: JSON.stringify({
      ...(name ? { name } : {}),
      ...(opts?.convertToNormal ? { convert_to_normal: true } : {}),
      ...(opts?.owningDepartment ? { owning_department: opts.owningDepartment } : {}),
    }),
  });
}
```

3. `setWordDoc` 아래:

```ts
// 완결 문서 생성 성공 기록 — 서버는 doc_generated_at만 스탬프 (design 2026-07-24 §5)
export function markWordDocGenerated(mapId: number): Promise<MapSummary> {
  return request<MapSummary>(`/maps/${mapId}/word-doc/generated`, { method: "POST" });
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/word-map-home.test.ts` PASS, `npx tsc --noEmit` 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/word-map-home.ts frontend/src/lib/word-map-home.test.ts PROGRESS.md
git commit -m "feat(word-map): api fields + home derivation helpers — 목록분리·재생성힌트·stale 파생 헬퍼"
```

---

### Task 5: Home — 목록 분리 + `WordDocsSection` + 생성 진입 이동

**Files:**
- Create: `frontend/src/components/maps/word-docs-section.tsx`
- Modify: `frontend/src/app/page.tsx` (visibleMaps ~line 302, create 메뉴 ~line 513-524, browse 컬럼 ~line 672-699, HomeDashboard ~line 718)

**Interfaces:**
- Consumes: Task 4의 `splitMapsByMode`, `needsRegenerate`, `formatDocStamp`
- Produces: `WordDocsSection` props — `{ maps: MapSummary[]; open: boolean; onToggle: () => void; selectedId: number | null; onSelect: (id: number) => void; onCreate: () => void; onReimport: (map: MapSummary) => void; onPromote: (map: MapSummary) => void }`. Task 6·7·9가 onCreate/onReimport/onPromote를 배선.

- [ ] **Step 1: Create `word-docs-section.tsx`**

```tsx
"use client";

// 홈 Word documents 섹션 — word 맵(문서 부속 산출물)을 조직도 밖 문서 중심 평면 목록으로 분리 표시.
// 설계: docs/design/2026-07-24-word-map-lifecycle-design.md §2. word 표면은 영어 하드코딩(word-create-modal 관례).
import { ArrowUpRight, ChevronDown, ChevronRight, FileText, Plus, RefreshCw } from "lucide-react";

import type { MapSummary } from "@/lib/api";
import { formatDocStamp, needsRegenerate } from "@/lib/word-map-home";

interface WordDocsSectionProps {
  maps: MapSummary[];
  open: boolean;
  onToggle: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onReimport: (map: MapSummary) => void;
  onPromote: (map: MapSummary) => void;
}

export function WordDocsSection({
  maps,
  open,
  onToggle,
  selectedId,
  onSelect,
  onCreate,
  onReimport,
  onPromote,
}: WordDocsSectionProps) {
  return (
    <section data-id="word-docs-section" className="shrink-0 rounded-sm border border-hairline bg-surface">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          data-id="word-docs-toggle"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={onToggle}
        >
          {open ? (
            <ChevronDown size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
          ) : (
            <ChevronRight size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
          )}
          <FileText size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
          <span className="truncate text-caption-strong text-ink">Word documents</span>
          <span className="text-fine text-ink-muted">{maps.length}</span>
        </button>
        <button
          data-id="word-docs-create"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink hover:bg-surface-alt"
          onClick={onCreate}
        >
          <Plus size={16} strokeWidth={1.5} />
          New
        </button>
      </div>
      {open && (
        <ul className="flex flex-col gap-0.5 border-t border-hairline p-1">
          {maps.length === 0 && (
            <li className="px-2 py-1.5 text-fine text-ink-muted">
              No Word documents yet — create one from a .docx.
            </li>
          )}
          {maps.map((m) => {
            const imported = formatDocStamp(m.doc_imported_at);
            const generated = formatDocStamp(m.doc_generated_at);
            return (
              <li key={m.id}>
                <div
                  data-id={`word-doc-row-${m.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSelect(m.id);
                  }}
                  className={`group flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-alt ${selectedId === m.id ? "bg-accent-tint" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-caption text-ink">{m.name}</p>
                    <p className="truncate text-fine text-ink-muted">
                      {m.doc_name || "(no document)"} · {m.doc_sections?.length ?? 0} sections
                      {imported ? ` · imported ${imported}` : ""}
                      {generated ? ` · generated ${generated}` : ""}
                    </p>
                    {needsRegenerate(m) && (
                      <p data-id={`word-doc-regen-hint-${m.id}`} className="truncate text-fine text-changed">
                        Re-imported after last generation — regenerate the document.
                      </p>
                    )}
                  </div>
                  <button
                    data-id={`word-doc-reimport-${m.id}`}
                    title="Re-import document"
                    className="hidden shrink-0 rounded-sm p-1 text-ink-muted hover:bg-surface group-hover:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReimport(m);
                    }}
                  >
                    <RefreshCw size={16} strokeWidth={1.5} />
                  </button>
                  <button
                    data-id={`word-doc-promote-${m.id}`}
                    title="Convert to process map"
                    className="hidden shrink-0 rounded-sm p-1 text-ink-muted hover:bg-surface group-hover:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPromote(m);
                    }}
                  >
                    <ArrowUpRight size={16} strokeWidth={1.5} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

`text-changed` 토큰이 없으면(`git grep "text-changed" frontend/src`로 확인) `VERSION_STATUS_STYLE`이 쓰는 changed 계열 클래스명으로 맞춘다 — raw hex 금지.

- [ ] **Step 2: Wire `page.tsx`**

1. import 추가: `import { WordDocsSection } from "@/components/maps/word-docs-section";`, `import { splitMapsByMode } from "@/lib/word-map-home";`
2. `visibleMaps` useMemo 바로 아래:

```tsx
  // word 맵은 문서 부속 산출물 — 조직도/집계는 processMaps만, Word documents 섹션은 wordMaps (design 2026-07-24 §2)
  const { processMaps, wordMaps } = useMemo(() => splitMapsByMode(visibleMaps), [visibleMaps]);
```

3. `visibleMaps` 사용처 중 **조직도·집계 3곳**을 `processMaps`로 교체: `myDeptMaps` 계산(`filterMyDeptMaps(...)` 호출부), `orgTree` 계산(`buildOrgTree(...)` 호출부), `<HomeDashboard maps={processMaps} ...>`. **검색(`shownSearchHits`) 소스는 `visibleMaps` 유지** — word 맵도 이름 검색으로는 찾을 수 있다. `selectedDept` 파생 등 나머지 사용처는 각자 확인해 목록 의미(조직도용인지 전체용인지)에 맞게 선택.
4. 상태 추가: `const [wordOpen, setWordOpen] = useState(true);`
5. browse 컬럼에서 `<OrgAccordion ... />` 바로 아래에:

```tsx
                  <WordDocsSection
                    maps={wordMaps}
                    open={wordOpen}
                    onToggle={() => setWordOpen((v) => !v)}
                    selectedId={effectiveSelected}
                    onSelect={setSelectedId}
                    onCreate={() => setWordModalOpen(true)}
                    onReimport={() => {}}
                    onPromote={() => {}}
                  />
```

(onReimport/onPromote는 Task 7·9에서 실배선 — 이번 단계는 빈 함수로 컴파일만.)
6. create 드롭다운 메뉴에서 `data-id="home-create-from-word"` 버튼 블록 **삭제** (CSV 버튼은 유지).

- [ ] **Step 3: Gates**

Run: `cd frontend && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all green (기존 테스트 회귀 없음)

- [ ] **Step 4: 브라우저 확인** — 백엔드/프론트 dev 서버 기동 후(word 맵이 시드에 있으면) 홈에서: Word documents 섹션 표시, 조직도에 word 맵 부재, 상단 create 메뉴에 Word 항목 부재. (서버 기동이 어려우면 Task 11 pw 스모크로 대체하고 여기선 게이트만.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/maps/word-docs-section.tsx frontend/src/app/page.tsx PROGRESS.md
git commit -m "feat(word-map): home split — Word documents section, org/aggregates exclude word maps — 홈 분리(Word 섹션·조직도/집계 제외·생성 진입 이동)"
```

---

### Task 6: 빠른 생성 — `WordQuickCreateDialog` (자동값 축소)

**Files:**
- Create: `frontend/src/components/word-quick-create-dialog.tsx`
- Modify: `frontend/src/app/page.tsx` (WordCreateModal onContinue ~line 736-745)

**Interfaces:**
- Consumes: `createMap(name, description, visibility, owningDepartment, word?)`, `setApprovers(mapId, userIds)`, `me.org_path`·`me.username` (홈에 이미 로드된 `Me`)
- Produces: `WordQuickCreateDialog` props — `{ outcome: WordCreateOutcome; owningDepartment: string; approverId: string; onClose: () => void; onCreated: (detail: MapDetail) => void }`

- [ ] **Step 1: Create `word-quick-create-dialog.tsx`**

`ModalBackdrop` 사용법은 `word-create-modal.tsx`의 것을 그대로 미러링한다(백드롭 prop 시그니처가 다르면 그쪽에 맞춤).

```tsx
"use client";

// Word 맵 빠른 생성 — 파싱 결과에서 이름만 확인, 오우닝 부서=내 말단 부서·승인자=본인 자동.
// 설계: docs/design/2026-07-24-word-map-lifecycle-design.md §3. 영어 하드코딩(word-create-modal 관례).
import { useRef, useState } from "react";

import { FileText, X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import type { WordCreateOutcome } from "@/components/word-create-modal";
import { createMap, setApprovers, type MapDetail } from "@/lib/api";

interface WordQuickCreateDialogProps {
  outcome: WordCreateOutcome;
  /** 자동 오우닝 부서 — 내 org_path 말단(design §3). org_path 없는 유저는 이 다이얼로그 대신 CreateMapDialog 폴백. */
  owningDepartment: string;
  approverId: string;
  onClose: () => void;
  onCreated: (detail: MapDetail) => void;
}

export function WordQuickCreateDialog({
  outcome,
  owningDepartment,
  approverId,
  onClose,
  onCreated,
}: WordQuickCreateDialogProps) {
  const [name, setName] = useState(outcome.docName.replace(/\.docx$/i, ""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 부분 실패 재시도 시 맵 재생성(이름 409) 방지 — create-map-dialog의 createdRef 관례
  const createdRef = useRef<MapDetail | null>(null);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (createdRef.current === null) {
        createdRef.current = await createMap(trimmed, "", "private", owningDepartment, {
          docName: outcome.docName,
          sections: outcome.sections,
        });
      }
      await setApprovers(createdRef.current.id, [approverId]); // 멱등 PUT — 재시도 안전
      onCreated(createdRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create map.");
      setSubmitting(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        data-id="word-quick-create"
        className="w-[26rem] rounded-sm border border-hairline bg-surface p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <FileText size={16} strokeWidth={1.5} className="text-ink-muted" />
          <h2 className="flex-1 text-body-strong text-ink">New Word document map</h2>
          <button
            data-id="word-quick-create-close"
            onClick={onClose}
            className="rounded-sm p-1 text-ink-muted hover:bg-surface-alt"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <p className="mb-2 truncate text-fine text-ink-muted">
          {outcome.docName} · {outcome.sections.length} sections
        </p>
        <input
          data-id="word-quick-create-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink"
          placeholder="Map name"
        />
        {error && <p className="mb-2 text-fine text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
          >
            Cancel
          </button>
          <button
            data-id="word-quick-create-submit"
            disabled={!name.trim() || submitting}
            onClick={() => void handleCreate()}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
```

- [ ] **Step 2: Wire `page.tsx`**

1. import: `import { WordQuickCreateDialog } from "@/components/word-quick-create-dialog";`
2. WordCreateModal `onContinue`를 분기: `me?.org_path`가 있으면 quick 경로, 없으면 기존 CreateMapDialog 핸드오프(폴백 — 부서 피커 요구를 기존 다이얼로그가 담당).

```tsx
      {wordModalOpen && (
        <WordCreateModal
          onClose={() => setWordModalOpen(false)}
          onContinue={(outcome) => {
            setWordModalOpen(false);
            if (me?.org_path) {
              setWordQuick(outcome); // 빠른 생성 — 부서/승인자 자동 (design 2026-07-24 §3)
            } else {
              setWordHandoff(outcome); // 폴백: 부서 없는 유저는 기존 전체 다이얼로그
              setDialogOpen(true);
            }
          }}
        />
      )}
      {wordQuick && me?.org_path && (
        <WordQuickCreateDialog
          outcome={wordQuick}
          owningDepartment={me.org_path}
          approverId={me.username}
          onClose={() => setWordQuick(null)}
          onCreated={(detail) => {
            setWordQuick(null);
            void refresh();
            showToast(t("perm.createDialog.toastSuccess"));
            router.push(`/maps/${detail.id}`);
          }}
        />
      )}
```

3. 상태 추가: `const [wordQuick, setWordQuick] = useState<WordCreateOutcome | null>(null);` (`router`는 홈에 이미 있음 — 없으면 `useRouter()` 추가.)

- [ ] **Step 3: Gates** — `npx vitest run && npx tsc --noEmit && npm run lint` 그린.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/word-quick-create-dialog.tsx frontend/src/app/page.tsx PROGRESS.md
git commit -m "feat(word-map): quick create — auto owning dept + self approver, name-only confirm — 빠른 생성(자동값 축소)"
```

---

### Task 7: 홈 재임포트 액션

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: `setWordDoc(mapId, { doc_name, sections })` (api.ts 기존), `WordCreateModal`(재사용 — 파서 모달), Task 5의 `onReimport` 슬롯

- [ ] **Step 1: Wire**

1. import에 `setWordDoc` 추가 (api import 라인).
2. 상태: `const [reimportTarget, setReimportTarget] = useState<MapSummary | null>(null);`
3. Task 5에서 빈 함수로 둔 `onReimport`를 교체: `onReimport={(m) => setReimportTarget(m)}`
4. 모달 렌더 (wordModalOpen 블록 근처):

```tsx
      {reimportTarget && (
        <WordCreateModal
          onClose={() => setReimportTarget(null)}
          onContinue={(outcome) => {
            const target = reimportTarget;
            setReimportTarget(null);
            void setWordDoc(target.id, { doc_name: outcome.docName, sections: outcome.sections })
              .then(() => {
                void refresh();
                showToast("Document re-imported.");
              })
              .catch((err) => {
                showToast(err instanceof Error ? err.message : "Re-import failed.");
              });
          }}
        />
      )}
```

- [ ] **Step 2: Gates** — `npx tsc --noEmit && npm run lint` 그린.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/page.tsx PROGRESS.md
git commit -m "feat(word-map): re-import entry on home word rows — 홈 word 행 재임포트 액션"
```

---

### Task 8: 상세 카드 — 문서 메타 + 상태 배지 숨김 + 승격 진입

**Files:**
- Modify: `frontend/src/components/maps/map-detail-card.tsx`
- Modify: `frontend/src/app/page.tsx` (MapDetailCard 사용부 2곳 ~line 424, 714)

**Interfaces:**
- Consumes: `MapDetail.mode/doc_name/doc_sections/doc_imported_at/doc_generated_at`(Task 4 — `MapDetail`이 이 필드들을 상속/포함하는지 api.ts에서 확인, 없으면 MapDetail에도 동일 optional 필드 추가), `formatDocStamp`, `needsRegenerate`
- Produces: `MapDetailCardProps.onPromote?: (mapId: number, name: string) => void`

- [ ] **Step 1: `map-detail-card.tsx` 수정**

1. props에 `onPromote?: (mapId: number, name: string) => void;` 추가.
2. import: `import { formatDocStamp, needsRegenerate } from "@/lib/word-map-home";`
3. **문서 메타 블록** — 오우닝 부서 행 블록(`detail.owning_department ?` 조건부, ~line 344) 바로 아래에:

```tsx
        {detail.mode === "word" && (
          <div data-id="word-doc-meta" className="flex flex-col gap-0.5">
            <p className="truncate text-fine text-ink-muted">
              {detail.doc_name || "(no document)"} · {detail.doc_sections?.length ?? 0} sections
            </p>
            {formatDocStamp(detail.doc_imported_at) && (
              <p className="text-fine text-ink-muted">Imported {formatDocStamp(detail.doc_imported_at)}</p>
            )}
            {formatDocStamp(detail.doc_generated_at) && (
              <p className="text-fine text-ink-muted">Generated {formatDocStamp(detail.doc_generated_at)}</p>
            )}
            {needsRegenerate(detail) && (
              <p className="text-fine text-changed">Re-imported after last generation — regenerate the document.</p>
            )}
          </div>
        )}
```

4. **버전 상태 배지 숨김** — `git grep -n "latest_version_status" frontend/src/components/maps/map-detail-card.tsx`로 배지 렌더를 찾아 `detail.mode !== "word" &&` 가드 추가. 없으면(상세 카드에 배지 부재) 생략.
5. **승격 버튼** — 기존 Copy 버튼(onCopy 사용부) 옆에:

```tsx
          {detail.mode === "word" && onPromote && (
            <button
              data-id="map-detail-promote"
              className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt"
              onClick={() => onPromote(detail.id, detail.name)}
            >
              Convert to process map
            </button>
          )}
```

(주변 버튼과 클래스 스타일이 다르면 이웃 버튼 클래스를 그대로 복사해 통일.)

- [ ] **Step 2: `page.tsx`** — MapDetailCard 사용부 2곳에 `onPromote={(id, name) => setPromoteTarget({ id, name })}` 추가. 상태는 Task 9에서 선언하므로 이 시점엔 함께 작업하거나, 임시로 이 prop 배선을 Task 9로 미뤄도 된다(그 경우 이번 커밋은 카드만).

- [ ] **Step 3: Gates** — `npx tsc --noEmit && npm run lint` 그린.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/maps/map-detail-card.tsx frontend/src/app/page.tsx PROGRESS.md
git commit -m "feat(word-map): detail card doc meta + hide status badge + promote entry — 상세 카드 문서 메타·배지 숨김·승격 진입"
```

---

### Task 9: 승격 관문 — `CreateMapDialog` promote 모드

**Files:**
- Modify: `frontend/src/components/permissions/create-map-dialog.tsx` (props ~line 77-84, name 초기값 ~line 146, handleCreate ~line 294-302, visibility 섹션 JSX)
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: Task 4 `copyMap(mapId, name, opts)`, Task 8 `onPromote` 배선, Task 5 `WordDocsSection.onPromote`
- Produces: `CreateMapDialog` 신규 prop `promote?: { mapId: number; defaultName: string }`

- [ ] **Step 1: `create-map-dialog.tsx` 확장**

1. Props 인터페이스에 추가:

```tsx
  /** Word 맵 승격 복사 — 지정 시 createMap 대신 copyMap(convertToNormal)으로 생성 (design 2026-07-24 §6). */
  promote?: { mapId: number; defaultName: string };
```

함수 시그니처에 `promote` 구조분해 추가.
2. `copyMap`을 api import에 추가.
3. name 초기값: `const [name, setName] = useState(initialName ?? promote?.defaultName ?? (csvBaseName || wordBaseName));`
4. `handleCreate`의 생성 호출 교체:

```tsx
      if (createdRef.current === null) {
        const detail = promote
          ? await copyMap(promote.mapId, trimmed, {
              convertToNormal: true,
              owningDepartment: owningDept.id,
            })
          : await createMap(
              trimmed,
              description.trim(),
              visibility,
              owningDept.id,
              word ? { docName: word.docName, sections: word.sections } : undefined,
            );
        createdRef.current = { mapId: detail.id, versionId: detail.versions[0].id };
      }
```

`useCallback` deps에 `promote` 추가.
5. **visibility 섹션 숨김** — copy는 항상 private로 생성되므로 promote 모드에선 무의미: visibility 라디오/셀렉트 JSX 블록을 `{!promote && ( ... )}`로 감싼다 (`git grep -n "setPendingVisibility\|visibility" 해당 파일`로 렌더 블록 위치 확인).
6. **다이얼로그 제목** — 헤더의 `t("perm.createDialog.title")` 사용부를 `{promote ? "Convert to process map" : t("perm.createDialog.title")}`로.
7. csv/word 아코디언 섹션은 promote에서 자연히 undefined — 변경 불필요.

- [ ] **Step 2: `page.tsx` 배선**

1. 상태: `const [promoteTarget, setPromoteTarget] = useState<{ id: number; name: string } | null>(null);`
2. Task 5의 `onPromote` 빈 함수 교체: `onPromote={(m) => setPromoteTarget({ id: m.id, name: m.name })}` (+ Task 8의 MapDetailCard 배선 확인).
3. 렌더:

```tsx
      {promoteTarget && (
        <CreateMapDialog
          promote={{ mapId: promoteTarget.id, defaultName: `${promoteTarget.name} (Copy)` }}
          onClose={() => setPromoteTarget(null)}
          onCreated={(silent) => {
            void refresh();
            if (!silent) showToast("Converted to process map.");
          }}
        />
      )}
```

(성공 시 다이얼로그 내부 `router.push`가 새 일반 맵 에디터로 이동 — 기존 생성 흐름과 동일.)

**Note (설계 §6 보충):** 게시본 없음 사전 비활성은 클라 데이터로 판정 불가(`latest_version_status`는 최신 버전만) — 409 에러 메시지가 다이얼로그 error 영역에 표시되는 것으로 갈음한다. 승격 전 셀프 게시(원클릭)를 안내하는 문구는 에러 메시지로 충분.

- [ ] **Step 3: Gates** — `npx vitest run && npx tsc --noEmit && npm run lint` 그린.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/permissions/create-map-dialog.tsx frontend/src/app/page.tsx PROGRESS.md
git commit -m "feat(word-map): promote gate dialog — reuse create dialog with copy(convertToNormal) — 승격 관문(생성 다이얼로그 재사용)"
```

---

### Task 10: 에디터 — generated 스탬프 + stale 앵커 배지 + 섹션 패널 경고

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (완결문서 생성 ~line 4912-4913, SectionPanel ~line 7394-7400, 노드 표시 주입부)
- Modify: `frontend/src/lib/canvas.ts` (NodeData, `section_anchor` 필드 근처 ~line 33)
- Modify: `frontend/src/components/process-node.tsx`
- Modify: `frontend/src/components/section-panel.tsx`

**Interfaces:**
- Consumes: Task 4 `markWordDocGenerated`, `getStaleSectionNodeIds`; 에디터 기존 state `mapMode`/`docSections`/`isWordMap`(~line 764-770)
- Produces: `NodeData.staleAnchor?: boolean`, `SectionPanelProps.staleCount?: number`

- [ ] **Step 1: generated 스탬프**

에디터 page.tsx의 완결 문서 생성 성공 지점(`generateCompleteWordDoc` await 후 다운로드 트리거 다음 줄)에:

```tsx
      // 생성 성공 기록 — 실패해도 다운로드는 이미 완료라 흐름을 막지 않는다 (design 2026-07-24 §5)
      void markWordDocGenerated(Number(mapId)).catch((err) =>
        console.warn("word-doc generated stamp failed", err),
      );
```

(`mapId`가 string이면 Number 변환, 이미 number면 그대로. `markWordDocGenerated` import 추가.)

- [ ] **Step 2: NodeData + 배지**

`canvas.ts` NodeData의 `section_anchor` 필드 아래:

```ts
  staleAnchor?: boolean; // 카탈로그에서 사라진 앵커 참조 — 표시 전용, 저장 안 함 (design 2026-07-24 §5)
```

`process-node.tsx` — 노드 본체 래퍼 안, 기존 오버레이 배지(commentCount 렌더 위치를 `git grep -n "commentCount" frontend/src/components/process-node.tsx`로 확인) 근처에:

```tsx
      {data.staleAnchor && (
        <span
          title="Section no longer exists in the imported document"
          className="absolute -right-1.5 -top-1.5 rounded-full bg-surface text-changed"
          data-id="node-stale-anchor-badge"
        >
          <AlertTriangle size={16} strokeWidth={1.5} />
        </span>
      )}
```

(`AlertTriangle`를 lucide import에 추가. 겹침 시 기존 배지들과 위치 조정 — 우상단 클러스터 규칙 준수.)

- [ ] **Step 3: 에디터 파생 + 주입**

에디터 page.tsx — `docSections` state 아래쯤에:

```tsx
  // stale 앵커 — 재임포트 후 카탈로그에서 사라진 앵커를 참조하는 섹션 노드 (design 2026-07-24 §5)
  const staleAnchorIds = useMemo(() => {
    if (!isWordMap) return new Set<string>();
    return getStaleSectionNodeIds(
      nodes.map((n) => ({
        id: n.id,
        nodeType: n.data.nodeType,
        sectionAnchor: n.data.section_anchor,
      })),
      docSections,
    );
  }, [isWordMap, nodes, docSections]);
```

(`getStaleSectionNodeIds` import. `nodes`가 이 위치보다 뒤에 선언돼 TDZ면 선언 아래로 이동.)

주입 — ReactFlow에 넘기는 표시용 노드 배열을 만드는 지점(`injectSubEnds` 결과를 쓰는 memo — `git grep -n "injectSubEnds" 에디터 page.tsx`)에서 반환 직전:

```tsx
    if (staleAnchorIds.size > 0) {
      result = result.map((n) =>
        staleAnchorIds.has(n.id) ? { ...n, data: { ...n.data, staleAnchor: true } } : n,
      );
    }
```

(해당 memo의 deps에 `staleAnchorIds` 추가. 변수명 `result`는 실제 지역 변수명에 맞춤.)

- [ ] **Step 4: 섹션 패널 경고**

`section-panel.tsx` props에 `staleCount?: number;` 추가, 패널 헤더(문서명 표시부) 아래:

```tsx
      {typeof staleCount === "number" && staleCount > 0 && (
        <p data-id="section-panel-stale" className="px-3 py-1.5 text-fine text-changed">
          {staleCount} node link{staleCount === 1 ? "" : "s"} no longer match the document.
        </p>
      )}
```

에디터의 `<SectionPanel ...>`에 `staleCount={staleAnchorIds.size}` 전달.

- [ ] **Step 5: Gates** — `npx vitest run && npx tsc --noEmit && npm run lint` 그린. (getStaleSectionNodeIds 로직 자체는 Task 4 vitest가 커버 — 에디터 주입은 Task 11 수동/pw로.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/maps/\[mapId\]/page.tsx frontend/src/lib/canvas.ts frontend/src/components/process-node.tsx frontend/src/components/section-panel.tsx PROGRESS.md
git commit -m "feat(word-map): generated stamp call + stale-anchor badges (canvas + section panel) — 생성 스탬프·stale 앵커 배지"
```

---

### Task 11: Playwright 스모크 + 전체 게이트

**Files:**
- Create: `frontend/scripts/pw-smoke-word-home.mjs`

**Interfaces:**
- Consumes: Task 5의 data-id들(`word-docs-section`, `word-docs-toggle`, `word-docs-create`, `word-doc-row-{id}`)

- [ ] **Step 1: 서버 기동** — 좀비 정리 후(`pkill -f "next dev"` 등, browser-test-zombie-frontend 교훈) backend 8000·frontend 3000 기동. dev.db 상태 확인(오염 시 재시드: `docs/deploy/db-seed.md`).

- [ ] **Step 2: 스모크 작성** — `frontend/scripts/pw-smoke-word-home.mjs`:

```js
// Word 홈 스모크 — Word documents 섹션 분리 표시·행 노출·생성 진입 버튼.
// 실행: node scripts/pw-smoke-word-home.mjs  (backend 8000 / frontend 3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API = "http://localhost:8000/api";

// 시드: word 맵 1개 생성(테스트마다 유니크 이름 → 이름 유일성 충돌 방지)
const name = `pw-word-${Date.now()}`;
const created = await (
  await fetch(`${API}/maps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      owning_department: "Owning Anchor Division",
      mode: "word",
      doc_name: "sop.docx",
      doc_sections: [{ anchor: "_Toc1", title: "Intro", number: "1", level: 1 }],
    }),
  })
).json();
if (!created.id) {
  console.log("SEED FAILED", created);
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin.sys"));
const page = await ctx.newPage();
try {
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-id="word-docs-section"]', { timeout: 30000 });

  const row = page.locator(`[data-id="word-doc-row-${created.id}"]`);
  if ((await row.count()) === 0 || !(await row.first().isVisible())) {
    await page.click('[data-id="word-docs-toggle"]'); // 접혀 있으면 펼침
  }
  await row.first().waitFor({ timeout: 10000 });

  const createBtn = await page.locator('[data-id="word-docs-create"]').count();
  // 상단 create 메뉴에서 Word 항목이 제거됐는지
  const legacyWordEntry = await page.locator('[data-id="home-create-from-word"]').count();
  // 조직도/즐겨찾기 영역에 word 맵 이름이 새지 않는지 — 섹션 밖 텍스트 검색
  const nameHits = await page.getByText(name, { exact: true }).count();
  const inSectionHits = await page
    .locator(`[data-id="word-docs-section"]`)
    .getByText(name, { exact: true })
    .count();

  const pass =
    (await row.first().isVisible()) &&
    createBtn === 1 &&
    legacyWordEntry === 0 &&
    nameHits === inSectionHits; // 이름 노출은 전부 Word 섹션 안
  console.log(
    JSON.stringify({ rowVisible: await row.first().isVisible(), createBtn, legacyWordEntry, nameHits, inSectionHits, pass }),
  );
  process.exitCode = pass ? 0 : 1;
} finally {
  await fetch(`${API}/maps/${created.id}`, { method: "DELETE" }); // 소프트삭제 정리
  await browser.close();
}
```

Run: `cd frontend && node scripts/pw-smoke-word-home.mjs`
Expected: `{"rowVisible":true,"createBtn":1,"legacyWordEntry":0,...,"pass":true}` exit 0

- [ ] **Step 3: 수동 확인(가능하면)** — 브라우저에서: ① Word 섹션 New → 빠른 생성 다이얼로그(이름만) → 생성 → 에디터 진입 ② word 맵 게시 후 승격 → 관문 다이얼로그(부서·승인자) → 일반 맵 생성, 섹션 노드가 process로 보임 ③ 재임포트로 섹션 하나 제거된 문서 올려 stale 배지 확인. 실물 Word 검증(붙여넣기 점프 등)은 기존 미완 항목과 함께 Windows에서.

- [ ] **Step 4: 전체 게이트**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd ../frontend && npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```

Expected: 전부 그린(0 fail).

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/pw-smoke-word-home.mjs PROGRESS.md
git commit -m "test(word-map): home split smoke — Word section rows, entry button, no org leak — 홈 분리 pw 스모크"
```
