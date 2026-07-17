# Word 맵 섹션 링크(문서 내부 하이퍼링크) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Word 맵 전용 모드를 추가해, 순서도 도형이 SOP 문서 내부 섹션으로 점프하는 살아있는 하이퍼링크(`w:anchor`)를 갖도록 한다 — 산출물을 원본 문서에 붙여넣으면 링크가 즉시 활성.

**Architecture:** "섹션 = 서브프로세스 대체" 한 축. read-only `.docx` 파서가 기존 북마크만 뽑아 맵 레벨 카탈로그로 저장하고, 서브프로세스 피커/드롭/접근포인트를 미러한 "섹션" UI가 `section_anchor`를 가진 노드를 만든다. 기존 Word 내보내기(`word-export.ts`)에 내부 앵커 하이퍼링크 + 두 링크 규칙을 분기로 추가한다. 백엔드는 노드 1컬럼(`section_anchor`) + 맵 3컬럼(`mode`·`doc_name`·`doc_sections`) 추가.

**Tech Stack:** Next.js(React, TypeScript) + @xyflow/react · FastAPI + SQLAlchemy + Pydantic · vitest/pytest/Playwright · fflate(동적 import).

## Global Constraints

- **줄바꿈 LF 고정** — `.gitattributes` 강제. 새 파일도 LF.
- **id는 `genId()`(`@/lib/id`)** — `crypto.randomUUID` 금지(평문 HTTP 인시큐어 컨텍스트).
- **heavy export 라이브러리(`fflate`)는 동적 import만** — 정적 import는 에디터 번들 오염(AGENTS.md). `word-import.ts`도 `word-export.ts`처럼 `await import("fflate")`.
- **신규 노드 컬럼(`section_anchor`)은 열거 지점 전부 갱신** — `models.py`·`schemas.NodeIn`·`graph.py` upsert(update+insert)·`versions.py` `clone_graph`·`csv-import.ts`(NODE_DEFAULTS·mergeNode·행변환·AI경로)·`db.py` `_ADDED_COLUMNS`.
- **신규 맵 컬럼은 `_ADDED_COLUMNS`에 `DEFAULT` 포함 DDL로 등록** — 운영 DB 자동 ALTER 보강, 기존 행 백필(응답 스키마 `from_attributes`라 NULL이 non-nullable 필드 깨뜨림).
- **파서는 문서 0 수정**(read-only). 내부 링크는 실재 북마크만 대상.
- **내보내기 두 링크 규칙(확정):** 앵커 라벨은 **첫 공백 토큰만** `w:anchor` 내부 링크, 나머지 plain. url 라벨은 전체 외부 링크(현행 계승). 둘 다 동시 생존.
- **도형 크기 1.5cm×3cm(가로 3·세로 1.5)는 튜닝 가능 상수** — 엣지 라우팅·배치 정밀값은 이 플랜 밖(구현 후 시각 검토).
- **테스트 그린 기준(백엔드):** `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`. **프론트:** `npm run test`(vitest)·`npx tsc --noEmit`·`npm run lint`·`npm run build`.

## Prerequisite (Phase 0 — 실물 문서 확인, 코드 아님)

Task B1(파서) 착수 전, **대표 `.docx` 하나를 실측**한다: unzip → `word/document.xml`에서 (1) 하위 섹션(1.2.2)에 `w:bookmarkStart`가 있는지, (2) 번호가 제목 텍스트에 타이핑돼 있는지 vs 자동 넘버링인지 확인. 결과로 B1의 픽스처·기대값을 실제 구조에 맞춘다. 하위에 북마크가 전무하면 최상위만 링크 가능(스펙 §5·§11) — 사용자에게 보고 후 진행.

## File Structure

**신규 파일:**
- `frontend/src/lib/word-import.ts` — read-only `.docx` → `SectionEntry[]` 파서(순수 함수).
- `frontend/src/lib/word-import.test.ts` — 파서 vitest.
- `frontend/src/components/section-panel.tsx` — 섹션 피커 패널(`process-library-panel` 미러).
- `frontend/src/components/word-create-modal.tsx` — 홈 Word 생성 드롭존(`csv-create-modal` 미러).

**수정 파일(주요):**
- 백엔드: `models.py`·`schemas.py`·`routers/graph.py`·`routers/versions.py`·`routers/maps.py`·`db.py`.
- 프론트 lib: `canvas.ts`·`api.ts`·`csv-import.ts`·`word-export.ts`.
- 에디터: `app/maps/[mapId]/page.tsx`(드롭·접근포인트·export 게이팅)·`components/add-node-menu.tsx`·`components/inspector-panel.tsx`.
- 홈: `app/page.tsx`·`components/permissions/create-map-dialog.tsx`.

---

## Phase A — 백엔드 스키마 & API

### Task A1: 노드 `section_anchor` 컬럼 (풀 체크리스트)

**Files:**
- Modify: `backend/app/models.py` (Node model, ~line 189-234)
- Modify: `backend/app/schemas.py` (`NodeIn`, ~line 584-652)
- Modify: `backend/app/routers/graph.py` (`replace_graph` upsert, ~line 283-312)
- Modify: `backend/app/routers/versions.py` (`clone_graph`, ~line 50-93)
- Modify: `backend/app/db.py` (`_ADDED_COLUMNS`, ~line 16-68)
- Test: `backend/tests/test_graph.py` (신규 테스트 추가)

**Interfaces:**
- Produces: `Node.section_anchor: str` (default `""`), `NodeIn.section_anchor: str = Field(default="", max_length=200)`, GraphNode JSON key `section_anchor`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_graph.py`에 추가(기존 그래프 저장 테스트 픽스처/헬퍼 재사용 — 파일 상단의 기존 map/version 생성 헬퍼를 따를 것):

```python
async def test_section_anchor_roundtrips(client, seeded_map_version):
    version_id = seeded_map_version
    graph = {
        "nodes": [{
            "id": "n1", "title": "1.2.2 재고 실사", "node_type": "section",
            "section_anchor": "_Toc123456",
        }],
        "edges": [], "groups": [],
    }
    r = await client.put(f"/api/versions/{version_id}/graph", json=graph)
    assert r.status_code == 200
    got = await client.get(f"/api/versions/{version_id}/graph")
    node = next(n for n in got.json()["nodes"] if n["id"] == "n1")
    assert node["section_anchor"] == "_Toc123456"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_graph.py::test_section_anchor_roundtrips -q`
Expected: FAIL (`section_anchor` 미인식 — KeyError 또는 응답에 필드 없음).

- [ ] **Step 3: Add the column across all enumerated points**

`models.py` — `Node`에 `url_label` 다음 줄 추가:
```python
    # 문서 내부 섹션 앵커 — Word 맵 섹션 노드(node_type="section")의 주 링크 (design 2026-07-18)
    section_anchor: Mapped[str] = mapped_column(String(200), default="")
```

`schemas.py` — `NodeIn`에서 `url_label` 필드 다음에 추가:
```python
    # 문서 내부 섹션 앵커 — Word 맵 섹션 노드 (design 2026-07-18)
    section_anchor: str = Field(default="", max_length=200)
```

`routers/graph.py` — update 분기에 `existing.url_label = node.url_label` 다음 줄 추가(insert 분기는 `**node.model_dump()`라 자동):
```python
            existing.section_anchor = node.section_anchor
```

`routers/versions.py` — `clone_graph`의 `Node(...)` 생성에서 `url_label=node.url_label,` 다음 추가:
```python
            section_anchor=node.section_anchor,
```

`db.py` — `_ADDED_COLUMNS`에 추가:
```python
    ("nodes", "section_anchor", "VARCHAR(200) DEFAULT ''"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_graph.py::test_section_anchor_roundtrips -q`
Expected: PASS.

- [ ] **Step 5: Run full backend suite + lint**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py backend/app/routers/graph.py backend/app/routers/versions.py backend/app/db.py backend/tests/test_graph.py
git commit -m "feat(word-map): add section_anchor node column — 섹션 노드 앵커 컬럼"
```

---

### Task A2: 맵 `mode`·`doc_name`·`doc_sections` 컬럼 + 생성/조회 배선

**Files:**
- Modify: `backend/app/models.py` (`ProcessMap`, ~line 70-122)
- Modify: `backend/app/schemas.py` (`MapCreate` ~24-30, `MapOut` ~531-577; 신규 `SectionEntryIn`)
- Modify: `backend/app/routers/maps.py` (`create_map` ~246-293, `copy_map` ~296-349)
- Modify: `backend/app/db.py` (`_ADDED_COLUMNS`)
- Test: `backend/tests/test_maps.py`

**Interfaces:**
- Produces: `ProcessMap.mode: str`(default `"normal"`), `ProcessMap.doc_name: str`(default `""`), `ProcessMap.doc_sections: list`(JSON, default `[]`). `SectionEntryIn { anchor: str, title: str, number: str, level: int }`. `MapCreate` gains `mode`, `doc_name`, `doc_sections`. `MapOut` returns the same three.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_maps.py`에 추가(기존 create-map 테스트의 owning_department 필수 관례 따를 것 — 앵커 부서 필요):

```python
async def test_create_word_map_stores_catalog(client):
    payload = {
        "name": "SOP Flow", "owning_department": "Owning Anchor Division",
        "mode": "word", "doc_name": "sop.docx",
        "doc_sections": [{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
    }
    r = await client.post("/api/maps", json=payload)
    assert r.status_code == 201
    body = r.json()
    assert body["mode"] == "word"
    assert body["doc_name"] == "sop.docx"
    assert body["doc_sections"][0]["anchor"] == "_Toc1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_maps.py::test_create_word_map_stores_catalog -q`
Expected: FAIL (mode/doc_* 미인식).

- [ ] **Step 3: Implement**

`models.py` — `ProcessMap`에 `owning_department` 다음 추가:
```python
    # Word 맵 모드 & 임포트 카탈로그 (design 2026-07-18)
    mode: Mapped[str] = mapped_column(String(20), default="normal")
    doc_name: Mapped[str] = mapped_column(String(300), default="")
    doc_sections: Mapped[list] = mapped_column(JSON, default=list)
```

`schemas.py` — `MapCreate` 위에 신규 모델, 그리고 `MapCreate`/`MapOut` 확장:
```python
class SectionEntryIn(BaseModel):
    anchor: str = Field(max_length=200)
    title: str = Field(default="", max_length=500)
    number: str = Field(default="", max_length=50)
    level: int = 0
```
`MapCreate`에 추가:
```python
    mode: Literal["normal", "word"] = "normal"
    doc_name: str = Field(default="", max_length=300)
    doc_sections: list[SectionEntryIn] = Field(default_factory=list)
```
`MapOut`에 추가(필드 나열부 끝, `owning_department` 근처):
```python
    mode: str = "normal"
    doc_name: str = ""
    doc_sections: list[SectionEntryIn] = Field(default_factory=list)
```

`routers/maps.py` — `create_map`의 `ProcessMap(...)` 생성에 추가:
```python
        mode=payload.mode,
        doc_name=payload.doc_name,
        doc_sections=[s.model_dump() for s in payload.doc_sections],
```
그리고 `copy_map`에서 새 맵 생성 시 원본의 `mode`/`doc_name`/`doc_sections`를 복사(맵 복사는 `clone_graph` 밖 — 맵 레벨 필드는 copy_map 핸들러에서). 원본 맵 객체를 `src`라 할 때 새 맵 생성부에 `mode=src.mode, doc_name=src.doc_name, doc_sections=list(src.doc_sections),` 추가.

`db.py` — `_ADDED_COLUMNS`에 추가:
```python
    ("process_maps", "mode", "VARCHAR(20) DEFAULT 'normal'"),
    ("process_maps", "doc_name", "VARCHAR(300) DEFAULT ''"),
    ("process_maps", "doc_sections", "JSON"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_maps.py::test_create_word_map_stores_catalog -q`
Expected: PASS.

- [ ] **Step 5: Full suite + lint**, then **Commit**

```bash
git add backend/app/models.py backend/app/schemas.py backend/app/routers/maps.py backend/app/db.py backend/tests/test_maps.py
git commit -m "feat(word-map): map mode + imported section catalog columns — 맵 모드·카탈로그"
```

---

### Task A3: 재임포트 엔드포인트 `PUT /maps/{id}/word-doc`

**Files:**
- Modify: `backend/app/routers/maps.py` (신규 엔드포인트 + `WordDocIn` import)
- Modify: `backend/app/schemas.py` (`WordDocIn`)
- Test: `backend/tests/test_maps.py`

**Interfaces:**
- Consumes: `SectionEntryIn` (Task A2).
- Produces: `WordDocIn { doc_name: str, sections: list[SectionEntryIn] }`; `PUT /api/maps/{map_id}/word-doc` (editor 권한) → 200, 맵의 `doc_name`·`doc_sections` 교체.

- [ ] **Step 1: Failing test**
```python
async def test_reimport_replaces_catalog(client):
    r0 = await client.post("/api/maps", json={
        "name": "M", "owning_department": "Owning Anchor Division", "mode": "word"})
    map_id = r0.json()["id"]
    r = await client.put(f"/api/maps/{map_id}/word-doc", json={
        "doc_name": "v2.docx",
        "sections": [{"anchor": "_Toc9", "title": "New", "number": "3", "level": 1}]})
    assert r.status_code == 200
    detail = await client.get(f"/api/maps/{map_id}")
    assert detail.json()["doc_name"] == "v2.docx"
    assert detail.json()["doc_sections"][0]["anchor"] == "_Toc9"
```

- [ ] **Step 2: Run — expect FAIL** (404, 엔드포인트 없음)
Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_maps.py::test_reimport_replaces_catalog -q`

- [ ] **Step 3: Implement**

`schemas.py`:
```python
class WordDocIn(BaseModel):
    doc_name: str = Field(default="", max_length=300)
    sections: list[SectionEntryIn] = Field(default_factory=list)
```
`routers/maps.py` — `update_map`(PATCH) 근처에 추가(권한 데코레이터는 기존 editor 요구 패턴 재사용, 예: `require_map_role("editor")`):
```python
@router.put("/{map_id}/word-doc", response_model=MapDetailOut,
            dependencies=[Depends(require_map_role("editor"))])
async def set_word_doc(map_id: int, payload: WordDocIn,
                       session=Depends(get_session), user=Depends(get_current_user)) -> ProcessMap:
    found = await session.get(ProcessMap, map_id, options=[
        selectinload(ProcessMap.versions).selectinload(MapVersion.events)])
    if found is None or found.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    found.doc_name = payload.doc_name
    found.doc_sections = [s.model_dump() for s in payload.sections]
    await session.commit()
    await session.refresh(found)
    found.my_role = await get_effective_role(session, user, map_id)
    return found
```
(정확한 import·의존성 헬퍼 이름은 파일 상단 기존 라우트에서 확인해 맞출 것.)

- [ ] **Step 4: Run — expect PASS**, full suite, lint.
- [ ] **Step 5: Commit**
```bash
git add backend/app/routers/maps.py backend/app/schemas.py backend/tests/test_maps.py
git commit -m "feat(word-map): PUT word-doc endpoint for re-import — 재임포트 엔드포인트"
```

---

## Phase B — Word 파서 (프론트 lib)

### Task B1: `word-import.ts` — read-only `.docx` → SectionEntry[]

> **Prerequisite:** Phase 0(실물 확인) 완료. 아래 파서는 표준 OOXML 구조(TOC 필드의 `w:hyperlink w:anchor` + 본문 `w:bookmarkStart` + 제목 `w:pStyle`) 기준. 실물이 다르면 Step 1 픽스처와 파싱 규칙을 실물에 맞춰 조정.

**Files:**
- Create: `frontend/src/lib/word-import.ts`
- Test: `frontend/src/lib/word-import.test.ts`

**Interfaces:**
- Produces:
```ts
export interface SectionEntry { anchor: string; title: string; number: string; level: number; }
export async function parseWordSections(docxBytes: Uint8Array): Promise<SectionEntry[]>;
```
- Consumes: `fflate`(동적 import, `unzipSync`).

- [ ] **Step 1: Write the failing test**

`word-import.test.ts` (픽스처는 최소 docx zip을 fflate로 즉석 생성 — `word-export.test.ts`의 unzip 관례 반대 방향):

```ts
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseWordSections } from "./word-import";

function makeDocx(documentXml: string): Uint8Array {
  return zipSync({ "word/document.xml": strToU8(documentXml) });
}

describe("parseWordSections", () => {
  it("extracts a body heading bookmark with typed number", async () => {
    const xml =
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr>` +
      `<w:bookmarkStart w:id="1" w:name="_Toc9001"/>` +
      `<w:r><w:t>1.2.2 재고 실사</w:t></w:r>` +
      `<w:bookmarkEnd w:id="1"/></w:p></w:body></w:document>`;
    const out = await parseWordSections(makeDocx(xml));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ anchor: "_Toc9001", number: "1.2.2", title: "재고 실사", level: 3 });
  });

  it("ignores bookmarks without a heading paragraph", async () => {
    const xml =
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:bookmarkStart w:id="2" w:name="_GoBack"/>` +
      `<w:r><w:t>본문 문단</w:t></w:r></w:p></w:body></w:document>`;
    const out = await parseWordSections(makeDocx(xml));
    expect(out).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`parseWordSections` 미정의)
Run: `npm run test -- word-import`

- [ ] **Step 3: Implement `word-import.ts`**

```ts
// read-only .docx 파서 — 문서 내부 링크 가능한 "섹션" 목록만 뽑는다(문서 0 수정).
// 대상: 제목 스타일(Heading N) 문단에 붙은 w:bookmarkStart. 번호는 제목 텍스트에 타이핑된
// 선두 번호 → 없으면 "". 하위 섹션이 목차에 없어도 본문 북마크가 있으면 잡힌다(spec §5).
export interface SectionEntry {
  anchor: string; // w:bookmarkStart w:name — 내부 하이퍼링크 앵커
  title: string; // 번호 제거한 제목 텍스트
  number: string; // "1.2.2" 등, 판별 불가 시 ""
  level: number; // Heading N의 N, 미상 시 0
}

// "1.2.2 재고 실사" → { number: "1.2.2", rest: "재고 실사" }. 선두가 점/숫자 토큰이 아니면 number "".
function splitLeadingNumber(text: string): { number: string; rest: string } {
  const m = text.match(/^\s*(\d+(?:\.\d+)*)\.?\s+(.*)$/);
  return m ? { number: m[1], rest: m[2].trim() } : { number: "", rest: text.trim() };
}

function levelOfStyle(styleVal: string): number {
  const m = styleVal.match(/^Heading(\d)$/i) ?? styleVal.match(/^제목\s*(\d)$/);
  return m ? Number(m[1]) : 0;
}

export async function parseWordSections(docxBytes: Uint8Array): Promise<SectionEntry[]> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(docxBytes);
  const docPart = files["word/document.xml"];
  if (!docPart) return [];
  const xml = strFromU8(docPart);
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paras = Array.from(doc.getElementsByTagNameNS(W, "p"));
  const seen = new Set<string>();
  const out: SectionEntry[] = [];

  for (const p of paras) {
    const bookmarks = Array.from(p.getElementsByTagNameNS(W, "bookmarkStart"));
    if (bookmarks.length === 0) continue;
    const styleEl = p.getElementsByTagNameNS(W, "pStyle")[0];
    const level = styleEl ? levelOfStyle(styleEl.getAttributeNS(W, "val") ?? "") : 0;
    if (level === 0) continue; // 제목 스타일 문단만 — 본문/GoBack 북마크 제외
    const text = Array.from(p.getElementsByTagNameNS(W, "t"))
      .map((t) => t.textContent ?? "")
      .join("")
      .trim();
    if (!text) continue;
    const { number, rest } = splitLeadingNumber(text);
    for (const bm of bookmarks) {
      const anchor = bm.getAttributeNS(W, "name") ?? "";
      if (!anchor || anchor === "_GoBack" || seen.has(anchor)) continue;
      seen.add(anchor);
      out.push({ anchor, title: rest || text, number, level });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**
Run: `npm run test -- word-import`

- [ ] **Step 5: Type + lint**
Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**
```bash
git add frontend/src/lib/word-import.ts frontend/src/lib/word-import.test.ts
git commit -m "feat(word-map): read-only .docx section parser — 문서 섹션 파서"
```

> **Backlog(이 태스크 밖):** TOC 필드 캐시 번호·아웃라인 자동 넘버링 계산은 실물이 타이핑 번호를 안 쓸 때만 필요 — Phase 0 결과에 따라 별도 태스크로.

---

## Phase C — 섹션 노드 타입 + 패널 + 접근포인트 + 드롭

### Task C1: 프론트 `section` 노드 타입 + `section_anchor` 스레딩

**Files:**
- Modify: `frontend/src/lib/canvas.ts` (`ProcessNodeType`)
- Modify: `frontend/src/lib/api.ts` (`GraphNode`)
- Modify: `frontend/src/lib/csv-import.ts` (`NODE_DEFAULTS`, `mergeNode`, 행변환, 컬럼목록, AI경로)
- Test: `frontend/src/lib/csv-import.test.ts`

**Interfaces:**
- Produces: `ProcessNodeType` includes `"section"`; `GraphNode.section_anchor?: string`.
- Consumes: 백엔드 `section_anchor`(A1).

- [ ] **Step 1: Failing test** — `csv-import.test.ts`에 `section_anchor` 왕복/기본값 테스트 추가(기존 url 왕복 테스트 패턴 복제):
```ts
it("preserves section_anchor through merge", () => {
  // 기존 mergeNode/round-trip 테스트 헬퍼 재사용 — url 대신 section_anchor 검증
  // (해당 파일의 기존 url 테스트를 찾아 그 구조로 section_anchor 케이스 추가)
});
```
(실제 assert는 그 파일의 기존 url 테스트 형태에 맞춰 작성.)

- [ ] **Step 2: Run — expect FAIL**
Run: `npm run test -- csv-import`

- [ ] **Step 3: Implement**

`canvas.ts` — `ProcessNodeType` 확장(섹션은 도형 그리기 타입이 아니므로 `NODE_TYPE_OPTIONS`엔 넣지 않음 — subprocess와 동일 관례):
```ts
export type ProcessNodeType = "process" | "decision" | "start" | "end" | "subprocess" | "section";
```

`api.ts` — `GraphNode`의 `url_label?` 다음 추가:
```ts
  // Word 맵 섹션 노드(node_type==="section")의 문서 내부 앵커 (design 2026-07-18)
  section_anchor?: string;
```

`csv-import.ts` — `NODE_DEFAULTS`에 `url_label: ""` 다음 `section_anchor: "",` 추가; `mergeNode` 반환에 `section_anchor: pick(next.section_anchor ?? "", existing.section_anchor ?? ""),` 추가; 행변환/노드빌드에 `section_anchor` 통과(url 라인 곁에); 허용 컬럼 목록(line ~72)과 AI 경로 노드빌드(line ~763)에도 url과 동일하게 미러.

- [ ] **Step 4: Run — expect PASS**, tsc, lint.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/canvas.ts frontend/src/lib/api.ts frontend/src/lib/csv-import.ts frontend/src/lib/csv-import.test.ts
git commit -m "feat(word-map): section node type + section_anchor field — 섹션 노드 타입·필드"
```

> **주의:** 에디터 내부에서 노드의 `url`/`url_label`이 React Flow `data`↔`GraphNode`로 스레딩되는 경로를 `git grep -n "url_label" -- 'frontend/src/app/maps/[mapId]/page.tsx'`로 찾아 `section_anchor`도 **동일 지점 전부**에 미러(직렬화·역직렬화·AI변환 `aiNodeToGraphNode`). 누락 시 저장 시 소거된다.

---

### Task C2: 섹션 패널 컴포넌트 (`process-library-panel` 미러)

**Files:**
- Create: `frontend/src/components/section-panel.tsx`
- Test: (컴포넌트 단위 테스트는 C4 드롭 e2e로 커버 — 여기선 tsc/lint/build만)

**Interfaces:**
- Produces:
```ts
export interface SectionPanelProps {
  sections: SectionEntry[];
  docName: string;
  onReimport: () => void; // 빈 상태/재임포트 버튼
  onClose: () => void;
}
export function SectionPanel(props: SectionPanelProps): JSX.Element;
```
드래그 payload: `application/bpm-section` = `anchor`; `application/bpm-section-number` = 표시번호; `application/bpm-section-title` = 제목.
- Consumes: `SectionEntry`(B1).

- [ ] **Step 1: Implement** (테스트 선행 대신 tsc/lint 게이트 — 순수 프레젠테이션 미러)

`process-library-panel.tsx`(158줄) 구조를 그대로 복제하되: `listLibraryProcesses()` fetch 제거 → props의 `sections` 사용; 행은 `SectionEntry` 렌더(번호 뱃지 + 제목, `Network` 아이콘 유지 또는 `Hash`); `handleDragStart`가 위 3개 payload 세팅; `linkedMapIds`/`closesCycle`/blocked 로직 제거(섹션은 사이클 없음). **카탈로그 비면**(`sections.length===0`) "Import a Word document" 드롭존 상태 + 상단 재임포트 버튼(`onReimport`). `data-id="section-panel"`.

```tsx
"use client";
import { Hash, X, FileUp } from "lucide-react";
import type { SectionEntry } from "@/lib/word-import";
import { useI18n } from "@/lib/i18n";
// ... filterByQuery/useInfiniteSlice는 process-library-panel과 동일하게 재사용

export interface SectionPanelProps {
  sections: SectionEntry[];
  docName: string;
  onReimport: () => void;
  onClose: () => void;
}

function handleDragStart(e: React.DragEvent<HTMLDivElement>, s: SectionEntry) {
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData("application/bpm-section", s.anchor);
  e.dataTransfer.setData("application/bpm-section-number", s.number || s.title);
  e.dataTransfer.setData("application/bpm-section-title", s.title);
}

export function SectionPanel({ sections, docName, onReimport, onClose }: SectionPanelProps) {
  const { t } = useI18n();
  // 검색 상태·행 렌더는 process-library-panel의 filtered/visible 패턴 복제.
  // sections.length === 0 → 드롭존/Import 안내 + onReimport 버튼.
  // 각 행: draggable, onDragStart=(e)=>handleDragStart(e, s), 표시= [number] title.
  // 헤더: 파일명(docName) + 재임포트(FileUp, onReimport) + 닫기(X, onClose).
  // ... (process-library-panel.tsx 72-153 레이아웃 그대로, 데이터만 sections로 교체)
  return <div data-id="section-panel">{/* 구현 */}</div>;
}
```
(구현 시 `process-library-panel.tsx`를 열어 컨테이너/헤더/검색/행 마크업을 1:1 복제하고 데이터 소스만 교체할 것.)

- [ ] **Step 2: tsc + lint + build**
Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 0 errors, build OK.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/section-panel.tsx
git commit -m "feat(word-map): section picker panel mirroring library panel — 섹션 피커 패널"
```

---

### Task C3: `sectionsOpen` state + 접근포인트 모드 게이팅

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (state, render, 3 access points, `S` shortcut)
- Modify: `frontend/src/components/add-node-menu.tsx` (Word 모드 라벨/분기 — 필요 시 prop)
- Modify: `frontend/src/components/inspector-panel.tsx` (빈 상태 버튼 분기 — 필요 시 prop)

**Interfaces:**
- Consumes: `SectionPanel`(C2), 맵의 `mode`(A2 — 에디터가 `getMap`/맵 상태로 이미 로드하는 값에서 `isWordMap` 파생).
- Produces: `sectionsOpen` state; `isWordMap` boolean; 접근포인트가 word 맵에선 `setSectionsOpen(true)`.

- [ ] **Step 1: Implement**

page.tsx:
- 맵 상세에서 `mode`를 읽어 `const isWordMap = mapMode === "word";`(맵 상태 로드 지점에서 파생 — `getMap` 응답 or 기존 맵 state에 `mode` 추가).
- `const [sectionsOpen, setSectionsOpen] = useState(false);`
- 라이브러리 렌더 지점(현 `{libraryOpen && <ProcessLibraryPanel .../>}`, ~6717) 옆에:
```tsx
{sectionsOpen && (
  <SectionPanel
    sections={docSections}
    docName={docName}
    onReimport={() => setWordImportOpen(true)}
    onClose={() => setSectionsOpen(false)}
  />
)}
```
(`docSections`/`docName`은 맵 상태에서; `setWordImportOpen`은 재임포트 모달 — D 단계와 연결. 재임포트 모달이 아직 없으면 이 태스크에선 `onReimport={() => {}}` 자리표시 후 D3에서 연결.)
- 3개 접근포인트를 word 맵 분기: 
  - AddNodeMenu 콜백(`onOpenLibrary`) — `onOpenLibrary={() => (isWordMap ? setSectionsOpen(true) : setLibraryOpen(true))}` (page.tsx ~6659).
  - inspector 빈상태 `onOpenLibrary` (page.tsx ~8255) — 동일 분기.
  - pane 컨텍스트 메뉴 항목(page.tsx ~4537의 `{ label: library.open, ..., onSelect: () => setLibraryOpen(true) }`) — `onSelect: () => (isWordMap ? setSectionsOpen(true) : setLibraryOpen(true))`, 라벨도 word 맵이면 `section.open`.
  - `S` 단축키(page.tsx `event.code === "KeyS"` → `setLibraryOpen(true)`) — 동일 분기.
- add-node-menu/inspector-panel의 "Add from library" 라벨은 word 맵일 때 "Add section"으로(prop 또는 i18n 분기).

- [ ] **Step 2: tsc + lint + build** — 0 errors.
- [ ] **Step 3: Commit**
```bash
git add frontend/src/app/maps/[mapId]/page.tsx frontend/src/components/add-node-menu.tsx frontend/src/components/inspector-panel.tsx
git commit -m "feat(word-map): gate access points to section panel in word maps — 접근포인트 모드 분기"
```

---

### Task C4: `handleSectionDrop` — 섹션 노드 생성

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (`onDrop` 분기 + `handleSectionDrop`)
- Test: `frontend/scripts/pw-verify-section-drop.mjs` (Playwright)

**Interfaces:**
- Consumes: `handleAddNode`(~3017) 팩토리; 드래그 payload(C2).
- Produces: `data.nodeType:"section"` 노드 with `label`=번호, `section_anchor`=앵커.

- [ ] **Step 1: Implement**

`handleLibraryDrop`(~3661) 곁에 `handleSectionDrop` 추가:
```tsx
const handleSectionDrop = (e: React.DragEvent) => {
  const anchor = e.dataTransfer.getData("application/bpm-section");
  if (!anchor) return;
  const number = e.dataTransfer.getData("application/bpm-section-number");
  const position = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  const id = genId();
  setNodes((current) => [
    ...current,
    {
      id, type: "process", position, className: "bpm-node-flash",
      data: { label: number, nodeType: "section", section_anchor: anchor,
              color: "", groupIds: [], hasChildren: false },
    },
  ]);
  setSelectedId(id);
  scheduleAutoSave();
  flashNode(id);
};
```
(정확한 노드 data 형태·좌표 보정·`findFreeSpot`은 `handleLibraryDrop`/`handleAddNode` 실제 코드에 맞춰 미러. `section_anchor`는 C1에서 확인한 노드 data 스레딩 필드명 사용.)

canvas `onDrop`(~6727)에 분기 추가 — 기존 `application/bpm-process`(→`handleLibraryDrop`) 곁에 `application/bpm-section`이면 `handleSectionDrop(e)`. `onDragOver`도 `application/bpm-section` 허용.

- [ ] **Step 2: Playwright 검증 스크립트** `pw-verify-section-drop.mjs` (기존 `pw-verify-library-open.mjs` 패턴 복제): word 맵 열기 → 섹션 패널 열기(S) → 첫 섹션 행을 캔버스로 드래그드롭 → 노드 1개 생성, label=번호, 콘솔 에러 0.

- [ ] **Step 3: Run Playwright** (로컬 백엔드+프론트 기동 후)
Run: `node frontend/scripts/pw-verify-section-drop.mjs`
Expected: PASS, 콘솔 에러 0.

- [ ] **Step 4: tsc + lint + build**, **Commit**
```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/scripts/pw-verify-section-drop.mjs
git commit -m "feat(word-map): drop a section to create a section-linked node — 섹션 드롭 노드 생성"
```

---

## Phase D — 생성 진입 (홈) + 임포트/재임포트

### Task D1: `word-create-modal.tsx` (`csv-create-modal` 미러)

**Files:**
- Create: `frontend/src/components/word-create-modal.tsx`

**Interfaces:**
- Produces:
```ts
export interface WordCreateOutcome { docName: string; sections: SectionEntry[]; }
export interface WordCreateModalProps {
  onClose: () => void;
  onContinue: (outcome: WordCreateOutcome) => void;
}
```
- Consumes: `parseWordSections`(B1).

- [ ] **Step 1: Implement** — `csv-create-modal.tsx`(드롭존 UI) 복제, 파일 accept `.docx`, 드롭 시 `await parseWordSections(new Uint8Array(await file.arrayBuffer()))` → `onContinue({ docName: file.name, sections })`. 파싱 0건이면 경고 표시(계속은 허용 — 나중 임포트/빈 맵).

- [ ] **Step 2: tsc + lint + build**, **Commit**
```bash
git add frontend/src/components/word-create-modal.tsx
git commit -m "feat(word-map): word doc dropzone create modal — Word 생성 드롭존 모달"
```

---

### Task D2: 홈 "Word 문서로 만들기" 진입 + CreateMapDialog 전달

**Files:**
- Modify: `frontend/src/app/page.tsx` (New map 영역 ~426-477, 모달 렌더 ~681-692)
- Modify: `frontend/src/components/permissions/create-map-dialog.tsx` (신규 `word` prop)

**Interfaces:**
- Consumes: `WordCreateOutcome`(D1).
- Produces: `CreateMapDialog`가 `word?: WordCreateOutcome` prop을 받아 `mode:"word"` + 카탈로그로 맵 생성.

- [ ] **Step 1: Implement**

`create-map-dialog.tsx` — 기존 `csv?` prop과 동형의 `word?: WordCreateOutcome` prop 추가. 생성 요청(`createMap` payload)에 word가 있으면 `mode: "word", doc_name: word.docName, doc_sections: word.sections` 포함. 이름 기본값=파일명(확장자 제거), CSV처럼.

`app/page.tsx` — New map 영역에 세 번째 버튼("Word 문서로 만들기", `FileText` 아이콘) 추가 → `setWordOpen(true)`. `WordCreateModal` 렌더(`CsvCreateModal` 곁, ~681):
```tsx
{wordOpen && (
  <WordCreateModal
    onClose={() => setWordOpen(false)}
    onContinue={(outcome) => { setWordOutcome(outcome); setWordOpen(false); setCreateOpen(true); }}
  />
)}
```
그리고 `CreateMapDialog`에 `word={wordOutcome}` 전달(csv와 동형).

- [ ] **Step 2: tsc + lint + build**, **Commit**
```bash
git add frontend/src/app/page.tsx frontend/src/components/permissions/create-map-dialog.tsx
git commit -m "feat(word-map): home 'create from Word doc' entry — 홈 Word 생성 진입"
```

---

### Task D3: 섹션 패널 재임포트 연결

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (재임포트 모달 + `setWordDoc` API 호출, 맵 상태 갱신)
- Modify: `frontend/src/lib/api.ts` (신규 `setWordDoc` client)

**Interfaces:**
- Consumes: `WordCreateModal`(D1), `PUT /maps/{id}/word-doc`(A3).
- Produces: `setWordDoc(mapId, { doc_name, sections }): Promise<MapDetail>` in api.ts.

- [ ] **Step 1: Implement**
`api.ts` — `setWordDoc` 클라이언트 추가(기존 `updateMap` 패턴):
```ts
export async function setWordDoc(mapId: number, body: { doc_name: string; sections: SectionEntry[] }) {
  return apiPut(`/maps/${mapId}/word-doc`, body); // 프로젝트의 실제 fetch 래퍼명에 맞출 것
}
```
page.tsx — C3의 `onReimport`가 `WordCreateModal`을 띄우고, `onContinue`에서 `await setWordDoc(mapId, { doc_name: o.docName, sections: o.sections })` → 응답으로 `docSections`/`docName` 맵 상태 갱신. 섹션 패널이 즉시 새 카탈로그 반영.

- [ ] **Step 2: tsc + lint + build**, **Commit**
```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/api.ts
git commit -m "feat(word-map): section-panel re-import wiring — 섹션 패널 재임포트 연결"
```

---

## Phase E — Word 내보내기 변형

### Task E1: `word-export.ts` — 내부 앵커 + 첫토큰 분할 + 두 링크

**Files:**
- Modify: `frontend/src/lib/word-export.ts`
- Test: `frontend/src/lib/word-export.test.ts`

**Interfaces:**
- Produces: `WordExportNode`에 `sectionAnchor?: string` 추가; section 노드는 label 첫 토큰 → `w:anchor` 내부 링크(+나머지 plain), `urlLabel` → 외부 링크(현행). 두 링크 동시.
- Consumes: 없음(순수).

- [ ] **Step 1: Failing test** — `word-export.test.ts`에 추가:
```ts
it("section node: first token of label is an internal anchor link, rest plain", async () => {
  const nodes = [{
    id: "n1", title: "1.22스탭 참고", nodeType: "section" as const,
    x: 0, y: 0, w: 113, h: 57, sectionAnchor: "_Toc9001",
  }];
  const blob = buildDocx(nodes as any, []);
  const xml = await readDocumentXml(blob); // 기존 테스트의 unzip 헬퍼
  // 첫 토큰만 앵커 하이퍼링크
  expect(xml).toContain('<w:hyperlink w:anchor="_Toc9001">');
  expect(xml).toContain("1.22스탭"); // 링크 텍스트
  expect(xml).toContain("참고"); // plain 잔여
  // 잔여는 하이퍼링크 밖(anchor run 뒤 별도 run)
});

it("section node with url: both anchor and external url hyperlinks present", async () => {
  const nodes = [{
    id: "n1", title: "1.2 절차", nodeType: "section" as const,
    x: 0, y: 0, w: 113, h: 57, sectionAnchor: "_Toc1", url: "https://x.test", urlLabel: "SOP",
  }];
  const blob = buildDocx(nodes as any, []);
  const xml = await readDocumentXml(blob);
  const rels = await readRelsXml(blob);
  expect(xml).toContain('<w:hyperlink w:anchor="_Toc1">'); // 내부
  expect(rels).toContain('TargetMode="External"'); // 외부
});
```

- [ ] **Step 2: Run — expect FAIL**
Run: `npm run test -- word-export`

- [ ] **Step 3: Implement**

`word-export.ts`:
- `WordExportNode`에 `sectionAnchor?: string;` 추가(line 10-19 인터페이스).
- 내부 앵커 문단 빌더 추가(`buildHyperlinkParagraph` 곁, ~line 112):
```ts
// 앵커 라벨 — 첫 공백 토큰만 내부 하이퍼링크(w:anchor), 나머지는 plain run. (design 2026-07-18)
function buildAnchorLabelParagraph(label: string, anchor: string): string {
  const sp = label.search(/\s/);
  const linked = sp === -1 ? label : label.slice(0, sp);
  const rest = sp === -1 ? "" : label.slice(sp); // 선행 공백 포함
  const linkedRun =
    `<w:hyperlink w:anchor="${escapeXml(anchor)}">` +
    `<w:r>${buildRunProps({ bold: true, hyperlink: true })}` +
    `<w:t xml:space="preserve">${escapeXml(linked)}</w:t></w:r></w:hyperlink>`;
  const restRun = rest
    ? `<w:r>${buildRunProps({ bold: true })}<w:t xml:space="preserve">${escapeXml(rest)}</w:t></w:r>`
    : "";
  return `<w:p>${CENTERED_P_PROPS}${linkedRun}${restRun}</w:p>`;
}
```
- `buildNodeShape`(line 124) 변경: section 노드면 1행을 `buildAnchorLabelParagraph(node.title, node.sectionAnchor)`로, 아니면 기존 `buildCenteredParagraph(node.title, { bold: true })`. 2행(url) 로직은 그대로(두 링크 공존):
```ts
  const titleLine =
    node.nodeType === "section" && node.sectionAnchor
      ? buildAnchorLabelParagraph(node.title, node.sectionAnchor)
      : buildCenteredParagraph(node.title, { bold: true });
  const paragraphs = titleLine + urlLine;
```
- Word 맵 export 시 도형 크기 고정: 호출부(E2)에서 각 `WordExportNode`의 `w`/`h`를 1.5cm×3cm EMU 상당 px로 넘기거나, `buildDocx`에 `fixedSize` 옵션 추가. **상수:** `3cm=1080000 EMU`, `1.5cm=540000 EMU`; layout이 px→EMU(×9525)이므로 px로는 `w≈113.4`, `h≈56.7`. (정확값은 시각 검토로 튜닝 — 상수에 주석.)

- [ ] **Step 4: Run — expect PASS**, tsc, lint.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/word-export.ts frontend/src/lib/word-export.test.ts
git commit -m "feat(word-map): internal anchor links + first-token split in word export — 내부 앵커·첫토큰"
```

---

### Task E2: export 게이팅 + 섹션 노드 앵커 전달

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (`handleExportWord` ~4723, 맵 탭 Word 버튼 게이팅)

**Interfaces:**
- Consumes: `buildDocx`/`exportCanvasWord`(E1), `isWordMap`(C3).
- Produces: Word 내보내기 버튼은 word 맵에서만 노출; export 모델에 `sectionAnchor` + 고정 크기 포함.

- [ ] **Step 1: Implement**
- `handleExportWord`가 노드를 `WordExportNode`로 변환할 때 `sectionAnchor: node.section_anchor` 포함, 그리고 word 맵이면 `w`/`h`를 고정(1.5×3cm px 상수).
- 맵 탭의 Word 내보내기 버튼(현 PNG 버튼 아래)을 `isWordMap`일 때만 렌더. 일반 맵에선 숨김. (버튼 위치·비주얼의 맵 탭 재배치는 다음 세션 보류 — 이번엔 **게이팅만**: `{isWordMap && <WordExportButton/>}`.)

- [ ] **Step 2: Playwright** — `pw-verify-word-map-export.mjs`: word 맵에서 섹션 노드 만들고 Word 버튼 노출 확인 + 다운로드 unzip에 `w:anchor` 존재; 일반 맵에선 Word 버튼 부재.
- [ ] **Step 3: Run Playwright**, tsc, lint, build.
- [ ] **Step 4: Commit**
```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/scripts/pw-verify-word-map-export.mjs
git commit -m "feat(word-map): gate word export to word maps + pass section anchors — 내보내기 게이팅"
```

---

## Phase F — 마무리 검증

### Task F1: 전체 게이트 + PROGRESS + 수동 Word 확인 항목

- [ ] **Step 1: 전체 게이트**
```bash
# 백엔드
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
# 프론트
cd ../frontend && npm run test && npx tsc --noEmit && npm run lint && npm run build
```
Expected: 전부 green.

- [ ] **Step 2: PROGRESS.md 갱신** — 구현 완료 항목·게이트 결과·수동 미검증(Windows Word 붙여넣기·클릭 점프) 기록.

- [ ] **Step 3: Commit**
```bash
git add PROGRESS.md
git commit -m "docs(progress): word-map section linking implemented + gates — 구현 완료·게이트"
```

- [ ] **Step 4: 수동 확인 항목(보고용, 자동화 불가)** — Windows Word에서: 산출물 `.docx` 열기 → 그룹 복사 → **원본 SOP 문서에 붙여넣기** → 섹션 도형 클릭 시 해당 섹션 점프, url 라벨 클릭 시 외부 링크. 실물 문서로 최종 확인.

---

## Self-Review (작성자 체크)

- **Spec 커버리지:** §3 모드=A2 · §4 생성진입=D1/D2 · §5 파서=B1 · §6 데이터모델=A1/A2/C1 · §7 패널·접근포인트·드롭=C2/C3/C4 · §8 내보내기 두 링크=E1/E2 · §9 재임포트/없어진 앵커=A3/D3(없어진 앵커 플래그는 백로그로 §11 근처 — 아래 참고) · §10 테스트=각 태스크. **맵 탭 표현(§11)·1.5×3cm 정밀값·북마크 주입은 의도적 제외.**
- **미커버 1건 발견 → 백로그 명시:** §9의 "재임포트 후 없어진 앵커 노드 플래그"는 별도 소기능. 이번 플랜엔 카탈로그 교체(A3/D3)까지만 포함, **앵커 유효성 뱃지는 후속 태스크**(구현 시 `undesignated` 유사 파생 플래그로 추가). 사용자에 고지.
- **타입 일관성:** `SectionEntry`(anchor/title/number/level)는 B1 정의를 C2/D1/E가 그대로 소비. `section_anchor`(백엔드 snake·GraphNode·노드 data)는 A1/C1/C4/E 일관. `mode:"word"`는 A2/C3/D2 일관.
- **Placeholder 스캔:** 순수 함수(파서·앵커 문단 빌더·백엔드 컬럼)는 완전 코드. 대형 파일 배선(page.tsx/패널 마크업)은 참조 파일+정확 델타+grep 지시로 명시(자리표시 아님).
