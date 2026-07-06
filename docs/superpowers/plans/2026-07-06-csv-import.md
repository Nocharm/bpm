# CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CSV 한 장으로 프로세스맵을 생성(새 맵 다이얼로그)·전체 교체(에디터 툴바, 체크아웃 보유자만)하고, 노드에 `url` 어트리뷰트를 신설한다.

**Architecture:** 클라이언트에서 CSV를 파싱해 기존 `PUT /api/versions/{id}/graph`로 저장 — 백엔드 신규 엔드포인트 없음(역할·체크아웃·상태 게이트 재사용). 백엔드 변경은 `nodes.url` 필드뿐. 스펙: `docs/superpowers/specs/2026-07-06-csv-import-design.md`.

**Tech Stack:** FastAPI + SQLAlchemy(비동기) / Next.js + React + @xyflow/react + @dagrejs/dagre / vitest(프론트 단위테스트, 기설정) / pytest(백엔드).

## Global Constraints

- 줄바꿈 LF 고정 (`.gitattributes`).
- id 생성은 `genId()`(`frontend/src/lib/id.ts`) — `crypto.randomUUID` 직접 호출 금지(서버 평문 HTTP).
- UI 문구 영어 기본, i18n은 `frontend/src/lib/i18n-messages.ts`의 `en`/`ko` **양쪽에 동일 키** 추가(플랫 dotted key, tsc가 키 일치 강제).
- raw hex 금지 — 토큰 클래스만(`bg-surface`, `text-error`, `border-hairline` 등). 아이콘 Lucide 16px(툴바)/14px(버튼 내) `strokeWidth={1.5}`. 이모지 금지.
- 커밋: `type(scope): English summary — 한국어 요약`. **각 커밋에 `PROGRESS.md` 한 줄 + 이 계획 파일 체크박스 갱신을 같은 커밋에 포함.**
- 백엔드 명령은 `backend/`에서: `.venv/bin/python -m pytest tests/ -q`, `.venv/bin/ruff check app/ tests/`. 프론트는 `frontend/`에서: `npm run test`, `npm run lint`, `npm run build`. (Windows 병기는 CLAUDE.md 참조 — 이 계획은 macOS 세션 실행 기준.)
- **스펙 편차(승인 필요 없음, §5 한정):** `NodeIn.url`은 `max_length=500`만 검증하고 `^https?://` 패턴은 **적용하지 않는다**. 인스펙터가 자유 타이핑을 자동저장하므로 부분 입력("htt")이 422로 자동저장을 깨뜨리기 때문. 스킴 검증은 CSV 파서(클라이언트)에서 수행하고, 추후 링크 렌더 UI 추가 시 렌더 단계에서 재검증한다. Task 1에서 스펙 문서를 이에 맞게 1줄 수정한다.

## File Structure

| 파일 | 작업 | 책임 |
|------|------|------|
| `backend/app/models.py` | 수정 | `Node.url` 컬럼 |
| `backend/app/schemas.py` | 수정 | `NodeIn.url` (Out은 상속으로 자동) |
| `backend/app/routers/graph.py` | 수정 | upsert existing 분기에 `url` 복사 |
| `backend/app/routers/versions.py` | 수정 | `clone_graph`에 `url` 전파 |
| `backend/app/db.py` | 수정 | `_ADDED_COLUMNS` 보강 |
| `backend/tests/test_graph.py`, `backend/tests/test_versions.py` | 수정 | url 라운드트립·422·복제 보존 |
| `frontend/src/lib/api.ts`, `frontend/src/lib/canvas.ts` | 수정 | `GraphNode.url` / `NodeData.url` 타입 |
| `frontend/src/app/maps/[mapId]/page.tsx` | 수정 | url 왕복(toAppNodes/buildGraph)·인스펙터 URL 행·임포트 모달·교체 로직 |
| `frontend/src/lib/csv-import.ts` | 신규 | 파서·그래프 변환·템플릿 (순수 함수) |
| `frontend/src/lib/csv-import.test.ts` | 신규 | vitest 단위 테스트 |
| `frontend/src/components/csv-import-section.tsx` | 신규 | 템플릿 다운로드+파일 선택+요약/에러 (양쪽 플로우 공용) |
| `frontend/src/components/editor-toolbar.tsx` | 수정 | Import CSV 버튼(우측 클러스터) |
| `frontend/src/components/permissions/create-map-dialog.tsx` | 수정 | CSV 섹션 + 생성→체크아웃→PUT→이동 |
| `frontend/src/lib/i18n-messages.ts` | 수정 | `field.url`, `csvImport.*` en/ko |

---

### Task 1: Backend — 노드 `url` 필드

**Files:**
- Modify: `backend/app/models.py:143` (duration 다음)
- Modify: `backend/app/schemas.py:392` (NodeIn, duration 다음)
- Modify: `backend/app/routers/graph.py:252` (upsert existing 분기)
- Modify: `backend/app/routers/versions.py:71` (clone_graph)
- Modify: `backend/app/db.py:43` (`_ADDED_COLUMNS` 끝)
- Test: `backend/tests/test_graph.py`, `backend/tests/test_versions.py`
- Modify: `docs/superpowers/specs/2026-07-06-csv-import-design.md` §5 (패턴 검증 제거 반영)

**Interfaces:**
- Produces: 그래프 API의 모든 노드에 `url: str`(default `""`, max 500) — PUT 수용, GET(`/graph`, `/graph/all`) 반환, 버전 복제 시 보존. 이후 모든 프론트 태스크가 이 필드에 의존.

- [x] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_graph.py` 끝에 추가 (`_create_version` 헬퍼는 파일 상단에 이미 존재 — 맵 생성 + 체크아웃 획득):

```python
def test_node_url_roundtrip(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n0", "title": "시작", "node_type": "start"},
            {"id": "n1", "title": "계약", "url": "https://contract.example.com/doc/1"},
        ],
        "edges": [],
    }

    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    node = next(n for n in saved["nodes"] if n["id"] == "n1")
    assert node["url"] == "https://contract.example.com/doc/1"
    # 미지정 노드는 빈 문자열 기본값
    start = next(n for n in saved["nodes"] if n["id"] == "n0")
    assert start["url"] == ""

    # 두 번째 PUT은 기존 노드 갱신(upsert existing 분기) 경로를 지난다
    graph["nodes"][1]["url"] = "https://updated.example.com"
    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()
    node = next(n for n in saved["nodes"] if n["id"] == "n1")
    assert node["url"] == "https://updated.example.com"


def test_node_url_too_long_rejected(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n0", "title": "시작", "node_type": "start"},
            {"id": "n1", "title": "긴 URL", "url": "https://e.com/" + "a" * 500},
        ],
        "edges": [],
    }

    response = client.put(f"/api/versions/{version_id}/graph", json=graph)
    assert response.status_code == 422
```

`backend/tests/test_versions.py` 끝에 추가 (`_set_version_status` 헬퍼는 이 파일에 이미 존재):

```python
def test_new_version_clone_preserves_url(client: TestClient) -> None:
    created = client.post("/api/maps", json={"name": "url clone map"}).json()
    v1 = created["versions"][0]["id"]
    client.post(f"/api/versions/{v1}/checkout", json={})
    client.put(
        f"/api/versions/{v1}/graph",
        json={
            "nodes": [
                {"id": "n0", "title": "시작", "node_type": "start"},
                {"id": "n1", "title": "계약", "url": "https://contract.example.com"},
            ],
            "edges": [],
        },
    )
    # 새 버전 생성은 직전 버전이 published여야 허용된다
    _set_version_status(v1, "published")
    v2 = client.post(f"/api/maps/{created['id']}/versions", json={"label": "To-Be"}).json()["id"]

    cloned = client.get(f"/api/versions/{v2}/graph").json()
    # 복제 노드는 id가 재발급되므로 제목으로 매칭
    node = next(n for n in cloned["nodes"] if n["title"] == "계약")
    assert node["url"] == "https://contract.example.com"
```

- [x] **Step 2: 실패 확인**

Run (backend/ 에서): `.venv/bin/python -m pytest tests/test_graph.py::test_node_url_roundtrip tests/test_graph.py::test_node_url_too_long_rejected tests/test_versions.py::test_new_version_clone_preserves_url -q`
Expected: 3 FAIL — `KeyError: 'url'`(roundtrip·clone), 422 대신 200(too_long).

- [x] **Step 3: 구현**

`backend/app/models.py` — `duration` 줄(143) 바로 아래에 추가:

```python
    # 참조 링크 — 노드당 1개, 빈 값 허용 (CSV import design 2026-07-06)
    url: Mapped[str] = mapped_column(String(500), default="")
```

`backend/app/schemas.py` — `NodeIn`의 `duration` 필드(392) 바로 아래에 추가:

```python
    # 참조 링크 — 스킴 검증은 클라이언트(CSV 파서·링크 렌더)에서. 자유 타이핑 자동저장이 깨지지 않게 길이만 제한
    url: str = Field(default="", max_length=500)
```

(`NodeOut`/`FlatNodeOut`은 `NodeIn` 상속이라 자동 포함. GET 경로는 `model_validate` from_attributes라 변경 불필요.)

`backend/app/routers/graph.py` — `replace_graph` upsert existing 분기, `existing.duration = node.duration`(252) 바로 아래에 추가:

```python
            existing.url = node.url
```

(새 노드 분기는 `**node.model_dump()`라 자동.)

`backend/app/routers/versions.py` — `clone_graph`의 `Node(...)` 생성에서 `duration=node.duration,`(71) 바로 아래에 추가:

```python
            url=node.url,
```

`backend/app/db.py` — `_ADDED_COLUMNS` 리스트 끝(`("process_maps", "sp_changed_at", "TIMESTAMP"),` 다음)에 추가:

```python
    # 노드 참조 링크 — CSV import design 2026-07-06
    ("nodes", "url", "VARCHAR(500) DEFAULT ''"),
```

- [x] **Step 4: 통과 확인 + 전체 회귀 + 린트**

Run (backend/ 에서): `.venv/bin/python -m pytest tests/ -q` → Expected: 전체 PASS (기존 420+ 유지, 신규 3 포함).
Run: `.venv/bin/ruff check app/ tests/` → Expected: no issues.

- [x] **Step 5: 스펙 편차 반영 + 커밋**

`docs/superpowers/specs/2026-07-06-csv-import-design.md` §5의 `NodeIn.url` 줄을 다음으로 교체:

```
  - `NodeIn.url` — 검증: `max_length=500`만(스킴 패턴 없음 — 인스펙터 자유 타이핑의 자동저장이 422로 깨지지 않도록. `^https?://` 검증은 CSV 파서와 추후 링크 렌더 시 수행). `NodeOut`·`FlatNodeOut`에 포함. AI 그래프 스키마는 불변.
```

PROGRESS.md 상단에 한 줄 추가 후:

```bash
git add backend/app/models.py backend/app/schemas.py backend/app/routers/graph.py backend/app/routers/versions.py backend/app/db.py backend/tests/test_graph.py backend/tests/test_versions.py docs/superpowers/specs/2026-07-06-csv-import-design.md docs/superpowers/plans/2026-07-06-csv-import.md PROGRESS.md
git commit -m "feat(backend): node url attribute — 노드 URL 필드(모델·스키마·업서트·복제·DB 보강)"
```

---

### Task 2: Frontend — `url` 왕복 배선 + 인스펙터 입력

**Files:**
- Modify: `frontend/src/lib/api.ts:78` (GraphNode, duration 다음)
- Modify: `frontend/src/lib/canvas.ts:22` (NodeData, duration 다음)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` — `toAppNodes`(~482), `buildGraph`(~576), 인스펙터 System/Duration map(~7192)
- Modify: `frontend/src/lib/i18n-messages.ts` — `field.url` en/ko

**Interfaces:**
- Consumes: Task 1의 API `url` 필드.
- Produces: `GraphNode.url?: string`(api.ts) · `NodeData.url?: string`(canvas.ts) — Task 3의 그래프 생성이 `url` 키를 사용.

- [x] **Step 1: 타입 추가**

`frontend/src/lib/api.ts` — `GraphNode`의 `duration: string;` 다음에:

```ts
  // 참조 링크 — 노드당 1개, 빈 값 허용 (CSV import design 2026-07-06)
  url?: string;
```

`frontend/src/lib/canvas.ts` — `NodeData`의 `duration: string;` 다음에:

```ts
  // 참조 링크(URL) — 노드당 1개, 빈 값 허용
  url?: string;
```

(옵셔널로 추가 — 기존 NodeData/GraphNode 리터럴 생성처를 건드리지 않는다. 서브프로세스 필드들과 같은 전례.)

- [x] **Step 2: 왕복 배선**

`frontend/src/app/maps/[mapId]/page.tsx` — `toAppNodes`(모듈 레벨, ~469)의 `duration: node.duration,` 다음에:

```ts
      url: node.url ?? "",
```

같은 파일 `buildGraph`(모듈 레벨, ~554)의 `duration: node.data.duration,` 다음에:

```ts
      url: node.data.url ?? "",
```

- [x] **Step 3: 인스펙터 URL 행**

`frontend/src/app/maps/[mapId]/page.tsx` ~7192의 System/Duration map 배열에 `url` 추가. 기존:

```tsx
                          {([
                            ["system", "field.system"],
                            ["duration", "field.duration"],
                          ] as const).map(([key, labelKey]) => (
```

을 다음으로 교체하고, `value`/`title`을 옵셔널 안전하게 바꾼다:

```tsx
                          {([
                            ["system", "field.system"],
                            ["duration", "field.duration"],
                            ["url", "field.url"],
                          ] as const).map(([key, labelKey]) => (
```

map 내부에서 `value={selectedNode.data[key]}` → `value={selectedNode.data[key] ?? ""}`, `title={selectedNode.data[key] || undefined}`는 그대로(undefined 허용). `onChange`의 `updateSelectedData({ [key]: event.target.value }, true)`는 변경 없음 — 제네릭이라 자동 동작.

`frontend/src/lib/i18n-messages.ts` — `en`과 `ko` 양쪽의 `field.duration` 키 근처에:

```ts
  "field.url": "URL",
```

(ko도 동일 값 `"URL"`.)

- [x] **Step 4: 검증**

Run (frontend/ 에서): `npm run lint` → Expected: 0 errors. `npm run build` → Expected: 성공.
수동 확인(선택): `npm run dev` 후 에디터에서 process 노드 선택 → 인스펙터 BPM 카드에 URL 행 표시, 입력 → 새로고침 후 유지.

- [x] **Step 5: 커밋**

PROGRESS.md 한 줄 + 계획 체크박스 갱신 후:

```bash
git add frontend/src/lib/api.ts frontend/src/lib/canvas.ts "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts docs/superpowers/plans/2026-07-06-csv-import.md PROGRESS.md
git commit -m "feat(editor): thread node url end-to-end + inspector input — 노드 URL 왕복 배선·인스펙터 입력"
```

---

### Task 3: `csv-import.ts` — 파서·그래프 변환 라이브러리 (TDD)

**Files:**
- Create: `frontend/src/lib/csv-import.ts`
- Test: `frontend/src/lib/csv-import.test.ts` (vitest — `vitest.config.ts` 기설정, node 환경, `@` alias)

**Interfaces:**
- Consumes: `Graph`/`GraphNode`/`GraphEdge`(`./api`), `layoutWithDagre`·`normalizeNodeType`·`AppNode`(`./canvas`), `genId`(`./id`).
- Produces (Task 4~6이 사용):
  - `interface CsvImportError { line: number; message: string }`
  - `interface CsvImportOutcome { graph: Graph | null; nodeCount: number; edgeCount: number; errors: CsvImportError[] }`
  - `decodeCsvBuffer(buffer: ArrayBuffer): string`
  - `parseCsvRecords(text: string): { cells: string[]; line: number }[]`
  - `buildGraphFromCsv(text: string): CsvImportOutcome`
  - `buildTemplateCsv(): string`

- [x] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/csv-import.test.ts` 전체:

```ts
// CSV 임포트 파서·그래프 변환 단위 테스트 (설계: docs/superpowers/specs/2026-07-06-csv-import-design.md)
import { describe, expect, it } from "vitest";

import type { Graph } from "./api";
import {
  buildGraphFromCsv,
  buildTemplateCsv,
  decodeCsvBuffer,
  parseCsvRecords,
} from "./csv-import";

const HEADER = "Name,System,Duration,URL,Next";

function graphOf(csv: string): Graph {
  const outcome = buildGraphFromCsv(csv);
  expect(outcome.errors).toEqual([]);
  if (outcome.graph === null) throw new Error("graph is null");
  return outcome.graph;
}

describe("parseCsvRecords", () => {
  it("따옴표 안 쉼표·이스케이프 따옴표·CRLF를 처리한다", () => {
    const records = parseCsvRecords('a,"b,c","d""e"\r\nf,g,h\r\n');
    expect(records).toEqual([
      { cells: ["a", "b,c", 'd"e'], line: 1 },
      { cells: ["f", "g", "h"], line: 2 },
    ]);
  });

  it("따옴표 안 줄바꿈 셀 이후 행 번호가 파일 실제 행을 가리킨다", () => {
    const records = parseCsvRecords('a,"line1\nline2"\nb,c\n');
    expect(records[0].cells[1]).toBe("line1\nline2");
    expect(records[1]).toEqual({ cells: ["b", "c"], line: 3 });
  });

  it("전부 빈 셀인 행은 건너뛴다", () => {
    const records = parseCsvRecords("a,b\n,\n \nc,d\n");
    expect(records.map((r) => r.cells[0])).toEqual(["a", "c"]);
  });
});

describe("decodeCsvBuffer", () => {
  it("UTF-8 BOM을 제거한다", () => {
    const bytes = new TextEncoder().encode("\uFEFFName\nA");
    expect(decodeCsvBuffer(bytes.buffer)).toBe("Name\nA");
  });

  it("UTF-8이 아니면 EUC-KR로 폴백한다", () => {
    // "한글" EUC-KR 바이트: C7 D1 B1 DB
    const ascii = Array.from(new TextEncoder().encode("Name\n"));
    const bytes = new Uint8Array([...ascii, 0xc7, 0xd1, 0xb1, 0xdb]);
    expect(decodeCsvBuffer(bytes.buffer)).toBe("Name\n한글");
  });
});

describe("buildGraphFromCsv — 그래프 변환", () => {
  it("행 노드 + 자동 Start/End + decision 추론으로 그래프를 만든다", () => {
    const graph = graphOf(
      [
        HEADER,
        "Review,SAP ERP,2 days,https://ex.com/doc,Decide",
        "Decide,,,,Sign:approved;Reject:rejected",
        "Sign,,3 days,,",
        "Reject,,1 day,,",
      ].join("\n"),
    );
    // 4행 + Start + End = 6 노드
    expect(graph.nodes).toHaveLength(6);
    const byTitle = new Map(graph.nodes.map((n) => [n.title, n]));
    expect(byTitle.get("Start")?.node_type).toBe("start");
    expect(byTitle.get("End")?.node_type).toBe("end");
    expect(byTitle.get("End")?.is_primary_end).toBe(true);
    expect(byTitle.get("Decide")?.node_type).toBe("decision"); // Next 2개 → decision
    expect(byTitle.get("Review")?.node_type).toBe("process");
    expect(byTitle.get("Review")?.system).toBe("SAP ERP");
    expect(byTitle.get("Review")?.duration).toBe("2 days");
    expect(byTitle.get("Review")?.url).toBe("https://ex.com/doc");
    // 엣지: Start→Review, Review→Decide, Decide→Sign(approved), Decide→Reject(rejected), Sign→End, Reject→End
    expect(graph.edges).toHaveLength(6);
    const label = (from: string, to: string) =>
      graph.edges.find(
        (e) =>
          e.source_node_id === byTitle.get(from)?.id &&
          e.target_node_id === byTitle.get(to)?.id,
      )?.label;
    expect(label("Start", "Review")).toBe("");
    expect(label("Decide", "Sign")).toBe("approved");
    expect(label("Decide", "Reject")).toBe("rejected");
    expect(label("Sign", "End")).toBe("");
    // dagre 배치 — 좌표가 전부 (0,0)이 아니다
    expect(graph.nodes.some((n) => n.pos_x !== 0 || n.pos_y !== 0)).toBe(true);
    expect(graph.groups).toEqual([]);
  });

  it("헤더는 대소문자·순서 무관, 옵션 컬럼 생략 가능", () => {
    const graph = graphOf("next,NAME\nB,A\n,B");
    const byTitle = new Map(graph.nodes.map((n) => [n.title, n]));
    expect(byTitle.get("A")).toBeDefined();
    expect(byTitle.get("B")).toBeDefined();
  });

  it("템플릿 CSV는 에러 없이 변환된다", () => {
    const outcome = buildGraphFromCsv(buildTemplateCsv());
    expect(outcome.errors).toEqual([]);
    expect(outcome.graph).not.toBeNull();
  });
});

describe("buildGraphFromCsv — 검증 에러", () => {
  it("빈 파일 / 데이터 0행", () => {
    expect(buildGraphFromCsv("").errors[0].message).toMatch(/empty/i);
    expect(buildGraphFromCsv(HEADER).errors[0].message).toMatch(/no data/i);
  });

  it("미지 컬럼·Name 컬럼 누락", () => {
    expect(buildGraphFromCsv("Name,Foo\nA,").errors[0].message).toContain('Unknown column "Foo"');
    expect(buildGraphFromCsv("System\nERP").errors.some((e) => e.message.includes('"Name"'))).toBe(true);
  });

  it("Name 누락·중복은 파일 실제 행 번호로 보고한다", () => {
    const errors = buildGraphFromCsv(`${HEADER}\n,,,,\nA,,,,\nA,,,,`).errors;
    expect(errors).toEqual([
      { line: 2, message: "Name is required" },
      { line: 4, message: 'Duplicate name "A"' },
    ]);
  });

  it("Next 대상 미존재·셀 내 중복", () => {
    const errors = buildGraphFromCsv(`${HEADER}\nA,,,,Missing\nB,,,,A;A`).errors;
    expect(errors.some((e) => e.line === 2 && e.message.includes('"Missing"'))).toBe(true);
    expect(errors.some((e) => e.line === 3 && e.message.includes("Duplicate Next"))).toBe(true);
  });

  it("URL 스킴·행 수 상한", () => {
    expect(
      buildGraphFromCsv(`${HEADER}\nA,,,ftp://x,`).errors[0].message,
    ).toMatch(/http/);
    const big = [HEADER, ...Array.from({ length: 501 }, (_, i) => `N${i},,,,`)].join("\n");
    expect(buildGraphFromCsv(big).errors[0].message).toMatch(/max 500/i);
  });

  it("자기 참조(재작업 루프)는 허용한다", () => {
    const graph = graphOf(`${HEADER}\nA,,,,A;B\nB,,,,`);
    const a = graph.nodes.find((n) => n.title === "A");
    expect(graph.edges.some((e) => e.source_node_id === a?.id && e.target_node_id === a?.id)).toBe(true);
  });
});
```

- [x] **Step 2: 실패 확인**

Run (frontend/ 에서): `npx vitest run src/lib/csv-import.test.ts`
Expected: FAIL — `Cannot find module './csv-import'` 류의 모듈 미존재 에러.

- [x] **Step 3: 구현**

`frontend/src/lib/csv-import.ts` 전체:

```ts
// CSV 임포트 — 템플릿·RFC4180 파싱·그래프 변환(자동 Start/End·decision 추론).
// 설계: docs/superpowers/specs/2026-07-06-csv-import-design.md
import type { Edge } from "@xyflow/react";

import type { Graph, GraphEdge, GraphNode } from "./api";
import { type AppNode, layoutWithDagre, normalizeNodeType } from "./canvas";
import { genId } from "./id";

export interface CsvRecord {
  cells: string[];
  // 레코드가 시작하는 파일 실제 행 번호(1-기준) — Excel 행 번호와 일치
  line: number;
}

export interface CsvImportError {
  line: number;
  message: string;
}

export interface CsvImportOutcome {
  graph: Graph | null;
  nodeCount: number;
  edgeCount: number;
  errors: CsvImportError[];
}

const HEADER_COLUMNS = ["name", "system", "duration", "url", "next"] as const;
type HeaderColumn = (typeof HEADER_COLUMNS)[number];

// 데이터 행 상한 — 초대형 파일 오업로드 방지
const MAX_DATA_ROWS = 500;
// 백엔드 NodeIn max_length 미러 — 서버 422 전에 행 단위로 안내
const MAX_LEN: Record<Exclude<HeaderColumn, "next">, number> = {
  name: 200,
  system: 100,
  duration: 50,
  url: 500,
};

export function decodeCsvBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    // 구형 Excel "CSV(쉼표로 분리)" — CP949 저장본 폴백
    return stripBom(new TextDecoder("euc-kr").decode(bytes));
  }
}

function stripBom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

/** RFC4180 파싱 — 따옴표 셀(쉼표·줄바꿈·"" 이스케이프)·CRLF. 전부 빈 행은 건너뛴다. */
export function parseCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c.trim() !== "")) {
      records.push({ cells, line: recordLine });
    }
    cells = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        if (ch === "\n") line += 1;
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\n") {
      endRecord();
      line += 1;
      recordLine = line;
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  endRecord();
  return records;
}

// CSV가 다루지 않는 GraphNode 속성 기본값
const NODE_DEFAULTS = {
  description: "",
  color: "",
  assignee: "",
  department: "",
  system: "",
  duration: "",
  url: "",
  pos_x: 0,
  pos_y: 0,
  group_ids: [] as string[],
  linked_map_id: null,
  follow_latest: false,
  linked_version_id: null,
  is_primary_end: false,
};

/** CSV 텍스트 → 검증 + 그래프(자동 Start/End, decision 추론, dagre LR 배치). 에러 있으면 graph=null. */
export function buildGraphFromCsv(text: string): CsvImportOutcome {
  const fail = (errors: CsvImportError[]): CsvImportOutcome => ({
    graph: null,
    nodeCount: 0,
    edgeCount: 0,
    errors,
  });

  const records = parseCsvRecords(text);
  if (records.length === 0) {
    return fail([{ line: 1, message: "Empty file — header row required" }]);
  }

  // 헤더 매핑 — 대소문자 무시·순서 무관, 미지 컬럼은 에러(오타 방지)
  const header = records[0];
  const colIndex = new Map<HeaderColumn, number>();
  const headerErrors: CsvImportError[] = [];
  header.cells.forEach((raw, i) => {
    const name = raw.trim().toLowerCase();
    if (name === "") return;
    if (!(HEADER_COLUMNS as readonly string[]).includes(name)) {
      headerErrors.push({ line: header.line, message: `Unknown column "${raw.trim()}"` });
      return;
    }
    if (colIndex.has(name as HeaderColumn)) {
      headerErrors.push({ line: header.line, message: `Duplicate column "${raw.trim()}"` });
      return;
    }
    colIndex.set(name as HeaderColumn, i);
  });
  if (!colIndex.has("name")) {
    headerErrors.push({ line: header.line, message: 'Missing required column "Name"' });
  }
  if (headerErrors.length > 0) return fail(headerErrors);

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) {
    return fail([{ line: header.line, message: "No data rows" }]);
  }
  if (dataRecords.length > MAX_DATA_ROWS) {
    return fail([
      { line: dataRecords[MAX_DATA_ROWS].line, message: `Too many rows — max ${MAX_DATA_ROWS}` },
    ]);
  }

  const cellOf = (record: CsvRecord, col: HeaderColumn): string => {
    const idx = colIndex.get(col);
    return idx === undefined ? "" : (record.cells[idx] ?? "").trim();
  };
  const rows = dataRecords.map((r) => ({
    name: cellOf(r, "name"),
    system: cellOf(r, "system"),
    duration: cellOf(r, "duration"),
    url: cellOf(r, "url"),
    nextRaw: cellOf(r, "next"),
    line: r.line,
  }));

  const errors: CsvImportError[] = [];
  const names = new Set<string>();
  for (const row of rows) {
    if (row.name === "") {
      errors.push({ line: row.line, message: "Name is required" });
      continue;
    }
    if (names.has(row.name)) {
      errors.push({ line: row.line, message: `Duplicate name "${row.name}"` });
      continue;
    }
    names.add(row.name);
    for (const col of ["name", "system", "duration", "url"] as const) {
      if (row[col].length > MAX_LEN[col]) {
        errors.push({ line: row.line, message: `${col} exceeds ${MAX_LEN[col]} characters` });
      }
    }
    if (row.url !== "" && !/^https?:\/\//i.test(row.url)) {
      errors.push({
        line: row.line,
        message: `URL must start with http:// or https:// — "${row.url}"`,
      });
    }
  }

  // Next 파싱 — "대상" 또는 "대상:라벨", 세미콜론 구분(빈 항목 무시)
  const nextsOf = new Map<string, { target: string; label: string }[]>();
  for (const row of rows) {
    if (!names.has(row.name)) continue; // 이름 에러 행은 스킵
    const refs: { target: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const entryRaw of row.nextRaw.split(";")) {
      const entry = entryRaw.trim();
      if (entry === "") continue;
      const colon = entry.indexOf(":");
      const target = (colon < 0 ? entry : entry.slice(0, colon)).trim();
      const label = colon < 0 ? "" : entry.slice(colon + 1).trim();
      if (!names.has(target)) {
        errors.push({ line: row.line, message: `Next target "${target}" not found` });
        continue;
      }
      if (seen.has(target)) {
        errors.push({ line: row.line, message: `Duplicate Next target "${target}"` });
        continue;
      }
      seen.add(target);
      refs.push({ target, label });
    }
    nextsOf.set(row.name, refs);
  }
  if (errors.length > 0) return fail(errors);

  // 노드 — Next 대상 2개 이상이면 decision. Start/End는 자동 생성
  const idOf = new Map<string, string>();
  rows.forEach((row) => idOf.set(row.name, genId()));
  const startId = genId();
  const endId = genId();
  const nodes: GraphNode[] = [
    { ...NODE_DEFAULTS, id: startId, title: "Start", node_type: "start", sort_order: 0 },
    ...rows.map((row, i) => ({
      ...NODE_DEFAULTS,
      id: idOf.get(row.name) as string,
      title: row.name,
      node_type: (nextsOf.get(row.name) ?? []).length >= 2 ? "decision" : "process",
      system: row.system,
      duration: row.duration,
      url: row.url,
      sort_order: i + 1,
    })),
    {
      ...NODE_DEFAULTS,
      id: endId,
      title: "End",
      node_type: "end",
      sort_order: rows.length + 1,
      is_primary_end: true,
    },
  ];

  const edges: GraphEdge[] = [];
  const addEdge = (source: string, target: string, label: string) => {
    edges.push({
      id: genId(),
      source_node_id: source,
      target_node_id: target,
      label,
      source_side: "right",
      target_side: "left",
      source_handle: null,
      target_handle: null,
    });
  };
  const hasIncoming = new Set<string>();
  for (const row of rows) {
    for (const ref of nextsOf.get(row.name) ?? []) {
      addEdge(idOf.get(row.name) as string, idOf.get(ref.target) as string, ref.label);
      if (ref.target !== row.name) hasIncoming.add(ref.target);
    }
  }
  // Start → 진입 엣지 없는 노드 전부. 전부 순환이면 첫 행(백엔드 "start 1개" 규칙 충족용 진입점)
  const roots = rows.filter((row) => !hasIncoming.has(row.name));
  for (const row of roots.length > 0 ? roots : [rows[0]]) {
    addEdge(startId, idOf.get(row.name) as string, "");
  }
  // 말단(Next 없음) → End. 말단이 없으면(전부 순환) End는 미연결로 남는다
  for (const row of rows) {
    if ((nextsOf.get(row.name) ?? []).length === 0) {
      addEdge(idOf.get(row.name) as string, endId, "");
    }
  }

  // dagre LR 자동 배치 — layoutWithDagre는 data.nodeType 크기만 사용하므로 최소 AppNode로 충분
  const appNodes: AppNode[] = nodes.map((node) => ({
    id: node.id,
    type: "process",
    position: { x: 0, y: 0 },
    data: {
      label: node.title,
      description: "",
      nodeType: normalizeNodeType(node.node_type),
      color: "",
      assignee: "",
      department: "",
      system: node.system,
      duration: node.duration,
      url: node.url,
      groupIds: [],
      hasChildren: false,
    },
  }));
  const flowEdges: Edge[] = edges.map((e) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
  }));
  const posOf = new Map(
    layoutWithDagre(appNodes, flowEdges, "LR").map((n) => [n.id, n.position]),
  );
  const positioned = nodes.map((node) => {
    const pos = posOf.get(node.id);
    return pos ? { ...node, pos_x: pos.x, pos_y: pos.y } : node;
  });

  return {
    graph: { nodes: positioned, edges, groups: [] },
    nodeCount: positioned.length,
    edgeCount: edges.length,
    errors: [],
  };
}

/** 다운로드용 템플릿 — 구매 프로세스 예시. Excel 호환 CRLF(BOM은 다운로드 시 접두). */
export function buildTemplateCsv(): string {
  return [
    "Name,System,Duration,URL,Next",
    "Review request,SAP ERP,2 days,,Approval decision",
    "Approval decision,,,,Sign contract:approved;Notify rejection:rejected",
    "Sign contract,,3 days,https://example.com/contract,",
    "Notify rejection,,1 day,,",
  ].join("\r\n");
}
```

주의: `NodeData`에 존재하지 않는 필수 필드가 있어 tsc가 `appNodes`의 `data`에서 에러를 내면, `toAppNodes`(page.tsx:469)가 만드는 15개 필드 전부(`scopeId: null, linkedMapId: null, followLatest: false, linkedVersionId: null, isPrimaryEnd: false` 포함)를 채워 맞춘다 — 근거 소스는 `toAppNodes`.

- [x] **Step 4: 통과 확인**

Run (frontend/ 에서): `npx vitest run src/lib/csv-import.test.ts` → Expected: 전체 PASS.
Run: `npm run test` → Expected: 기존 테스트 포함 전체 PASS. `npm run lint` → 0 errors.

- [x] **Step 5: 커밋**

```bash
git add frontend/src/lib/csv-import.ts frontend/src/lib/csv-import.test.ts docs/superpowers/plans/2026-07-06-csv-import.md PROGRESS.md
git commit -m "feat(frontend): CSV parser + graph builder — CSV 파서·그래프 변환 라이브러리(자동 Start/End·decision 추론·dagre 배치)"
```

---

### Task 4: `CsvImportSection` 공용 컴포넌트 + 템플릿 다운로드

**Files:**
- Create: `frontend/src/components/csv-import-section.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` — `csvImport.*` en/ko

**Interfaces:**
- Consumes: Task 3의 `buildGraphFromCsv`, `buildTemplateCsv`, `decodeCsvBuffer`, `CsvImportOutcome`.
- Produces: `CsvImportSection` 컴포넌트 — props `{ outcome: CsvImportOutcome | null; fileName: string | null; onChange: (outcome: CsvImportOutcome | null, fileName: string | null) => void; disabled?: boolean }`. Task 5(다이얼로그)·Task 6(에디터 모달)이 사용.

- [x] **Step 1: i18n 키 추가**

`frontend/src/lib/i18n-messages.ts` — `en` 객체에 (알파벳/그룹 순서에 맞는 위치, `manual.*` 근처):

```ts
  // CSV import (design 2026-07-06)
  "csvImport.applied": "CSV imported",
  "csvImport.chooseFile": "Choose CSV file",
  "csvImport.confirmCreate": "Create {x} nodes · {y} edges",
  "csvImport.confirmDelete": "Delete {n} nodes · {m} edges · {k} groups",
  "csvImport.confirmTitle": "Replace map with CSV?",
  "csvImport.continue": "Continue",
  "csvImport.mapCreatedImportFailed": "Map was created, but the CSV import failed — open the map and retry from the toolbar.",
  "csvImport.modalTitle": "Import CSV — replace all",
  "csvImport.moreErrors": "+{n} more errors",
  "csvImport.rowError": "Row {line}: {message}",
  "csvImport.sectionTitle": "Start from CSV (optional)",
  "csvImport.summary": "{nodes} nodes · {edges} edges will be created",
  "csvImport.template": "Download template",
  "csvImport.toolbar": "Import CSV",
```

`ko` 객체에 동일 키:

```ts
  // CSV 임포트 (design 2026-07-06)
  "csvImport.applied": "CSV 임포트 완료",
  "csvImport.chooseFile": "CSV 파일 선택",
  "csvImport.confirmCreate": "새 노드 {x}개 · 엣지 {y}개 생성",
  "csvImport.confirmDelete": "기존 노드 {n}개 · 엣지 {m}개 · 그룹 {k}개 삭제",
  "csvImport.confirmTitle": "CSV로 맵을 교체할까요?",
  "csvImport.continue": "계속",
  "csvImport.mapCreatedImportFailed": "맵은 생성되었지만 CSV 임포트에 실패했습니다 — 맵을 열어 툴바에서 다시 시도하세요.",
  "csvImport.modalTitle": "CSV 임포트 — 전체 교체",
  "csvImport.moreErrors": "+{n}건 더",
  "csvImport.rowError": "{line}행: {message}",
  "csvImport.sectionTitle": "CSV로 시작 (선택)",
  "csvImport.summary": "노드 {nodes}개 · 엣지 {edges}개가 생성됩니다",
  "csvImport.template": "양식 다운로드",
  "csvImport.toolbar": "CSV 임포트",
```

- [x] **Step 2: 컴포넌트 구현**

`frontend/src/components/csv-import-section.tsx` 전체:

```tsx
"use client";

// CSV 임포트 공용 섹션 — 템플릿 다운로드 + 파일 선택 + 파싱 요약/행 에러.
// 새 맵 다이얼로그와 에디터 임포트 모달이 함께 쓴다 (design 2026-07-06).
import { useRef } from "react";

import { Download, Upload, X } from "lucide-react";

import {
  buildGraphFromCsv,
  buildTemplateCsv,
  decodeCsvBuffer,
  type CsvImportOutcome,
} from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

const OUTLINE_BTN =
  "inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

interface CsvImportSectionProps {
  outcome: CsvImportOutcome | null;
  fileName: string | null;
  onChange: (outcome: CsvImportOutcome | null, fileName: string | null) => void;
  disabled?: boolean;
}

export function CsvImportSection({ outcome, fileName, onChange, disabled }: CsvImportSectionProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDownloadTemplate = () => {
    // UTF-8 BOM 접두 — Excel이 한글을 올바른 인코딩으로 열도록
    const blob = new Blob(["\uFEFF" + buildTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bpm-map-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // 같은 파일 재선택을 허용하기 위해 input value 리셋 (manual-manage-panel 패턴)
  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const text = decodeCsvBuffer(await file.arrayBuffer());
    onChange(buildGraphFromCsv(text), file.name);
  };

  return (
    <div data-id="csv-import-section" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-id="csv-template-download"
          className={OUTLINE_BTN}
          onClick={handleDownloadTemplate}
          disabled={disabled}
        >
          <Download size={14} strokeWidth={1.5} />
          {t("csvImport.template")}
        </button>
        <button
          type="button"
          data-id="csv-file-pick"
          className={OUTLINE_BTN}
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
        >
          <Upload size={14} strokeWidth={1.5} />
          {t("csvImport.chooseFile")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => void handleFile(event)}
        />
      </div>
      {fileName !== null && outcome !== null && (
        <div className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface-alt px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-caption text-ink" title={fileName}>
              {fileName}
            </span>
            <button
              type="button"
              data-id="csv-clear"
              className="shrink-0 rounded-sm p-0.5 text-ink-tertiary hover:bg-surface hover:text-ink"
              onClick={() => onChange(null, null)}
              disabled={disabled}
              aria-label={t("common.cancel")}
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
          {outcome.errors.length === 0 ? (
            <p className="text-caption text-ink-secondary">
              {t("csvImport.summary", { nodes: outcome.nodeCount, edges: outcome.edgeCount })}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {outcome.errors.slice(0, 10).map((err) => (
                <li key={`${err.line}-${err.message}`} className="text-caption text-error">
                  {t("csvImport.rowError", { line: err.line, message: err.message })}
                </li>
              ))}
              {outcome.errors.length > 10 && (
                <li className="text-caption text-ink-tertiary">
                  {t("csvImport.moreErrors", { n: outcome.errors.length - 10 })}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

주의: `t()` 인자 타입이 `Record<string, string>`이면 숫자 보간에서 tsc 에러 — 그 경우 `String(...)`으로 감싼다(`{ nodes: String(outcome.nodeCount), ... }`). 기존 사용례(`group.removedN`, page.tsx:3033의 `{ n: removed.length }`)를 먼저 확인해 같은 방식을 따른다.

- [x] **Step 3: 검증**

Run (frontend/ 에서): `npm run lint` → 0 errors. `npm run build` → 성공. (렌더 확인은 Task 5·6에서 브라우저로.)

- [x] **Step 4: 커밋**

```bash
git add frontend/src/components/csv-import-section.tsx frontend/src/lib/i18n-messages.ts docs/superpowers/plans/2026-07-06-csv-import.md PROGRESS.md
git commit -m "feat(frontend): CSV import section component — CSV 공용 섹션(양식 다운로드·파일 선택·요약/에러)"
```

---

### Task 5: 새 맵 다이얼로그 — CSV로 시작

**Files:**
- Modify: `frontend/src/components/permissions/create-map-dialog.tsx`

**Interfaces:**
- Consumes: `CsvImportSection`(Task 4), `CsvImportOutcome`(Task 3), `acquireCheckout`/`saveGraph`(`@/lib/api` 기존), `useRouter`(`next/navigation`).
- Produces: 사용자 플로우 — CSV 첨부 생성 시 에디터(`/maps/{id}`)로 즉시 이동.

- [x] **Step 1: 임포트·상태 추가**

`create-map-dialog.tsx` 상단 import에 추가:

```ts
import { useRouter } from "next/navigation";
import { CsvImportSection } from "@/components/csv-import-section";
import type { CsvImportOutcome } from "@/lib/csv-import";
```

기존 `@/lib/api` import 목록에 `acquireCheckout`, `saveGraph` 추가.

컴포넌트 본문(기존 state 근처, ~116):

```ts
  const router = useRouter();
  // CSV로 시작(선택) — 파싱 결과와 파일명. 에러 있으면 생성 차단
  const [csv, setCsv] = useState<CsvImportOutcome | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
```

- [x] **Step 2: `canCreate` 차단 조건**

기존(218–222):

```ts
  const canCreate =
    currentUser !== null &&
    name.trim().length > 0 &&
    approvers.length >= 1 &&
    !submitting;
```

를 다음으로 교체:

```ts
  const canCreate =
    currentUser !== null &&
    name.trim().length > 0 &&
    approvers.length >= 1 &&
    (csv === null || (csv.errors.length === 0 && csv.graph !== null)) &&
    !submitting;
```

- [x] **Step 3: `handleCreate`에 CSV 반영 시퀀스**

`handleCreate`(192–215)에서 `await setMapApprovers(...)` 다음, `onCreated();` 이전에 삽입:

```ts
      // 4. CSV 첨부 시 — 신규 As-Is 버전은 잠금 free: 체크아웃 획득 → 그래프 반영 → 에디터로 이동
      if (csv?.graph) {
        const versionId = detail.versions[0].id;
        try {
          await acquireCheckout(versionId);
          await saveGraph(versionId, csv.graph);
        } catch (err) {
          // 맵은 이미 생성됨 — 목록 갱신 + 다이얼로그에 안내(에디터 툴바에서 재시도 가능)
          onCreated();
          setError(
            err instanceof Error
              ? `${t("csvImport.mapCreatedImportFailed")} — ${err.message}`
              : t("csvImport.mapCreatedImportFailed"),
          );
          setSubmitting(false);
          return;
        }
        onCreated();
        onClose();
        router.push(`/maps/${detail.id}`);
        return;
      }
```

`useCallback` deps에 `csv`, `router` 추가.

- [x] **Step 4: 섹션 JSX**

visibility 섹션 다음(협업자 섹션 이전)에 추가:

```tsx
        {/* CSV로 시작 (선택) — 양식 다운로드 + 파일 첨부 시 생성 직후 그래프 반영 후 에디터 이동 */}
        <div className="flex flex-col gap-1">
          <label className="text-caption text-ink-secondary">{t("csvImport.sectionTitle")}</label>
          <CsvImportSection
            outcome={csv}
            fileName={csvFileName}
            onChange={(nextOutcome, nextFileName) => {
              setCsv(nextOutcome);
              setCsvFileName(nextFileName);
            }}
            disabled={submitting}
          />
        </div>
```

- [x] **Step 5: 검증 + 커밋**

Run (frontend/ 에서): `npm run lint` → 0 errors. `npm run build` → 성공.

브라우저 확인(백엔드 `.venv/bin/uvicorn app.main:app --reload --port 8000` + `npm run dev`):
1. 홈 → New Map → 섹션에 [Download template] 클릭 → `bpm-map-template.csv` 다운로드, Excel/에디터에서 5컬럼 확인.
2. 템플릿 그대로 첨부 → "6 nodes · 6 edges will be created" 요약 표시 → 이름·결재자 채우고 Create → `/maps/{id}` 에디터로 이동, Start→Review→Decide(마름모)→Sign/Reject→End 렌더 확인.
3. 중복 Name CSV 첨부 → 행 에러 표시 + Create 비활성 확인. X로 제거 → Create 활성.

검증 완료(포트 충돌 회피 위해 8010/3001 임시 기동, playwright-core --no-save + system Chrome): 위 1~3 전부 확인 + CSV-less 생성 회귀 없음(이동 없이 dialog 닫힘)까지 21개 체크 전부 PASS. 상세는 PROGRESS.md.

```bash
git add frontend/src/components/permissions/create-map-dialog.tsx docs/superpowers/plans/2026-07-06-csv-import.md PROGRESS.md
git commit -m "feat(maps): start new map from CSV — 새 맵 CSV 시작(생성→체크아웃→그래프 반영→에디터 이동)"
```

---

### Task 6: 에디터 툴바 — CSV 임포트(전체 교체)

**Files:**
- Modify: `frontend/src/components/editor-toolbar.tsx` (우측 클러스터 재구성)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (상태·모달·교체 로직·툴바 prop)

**Interfaces:**
- Consumes: `CsvImportSection`(Task 4), `CsvImportOutcome`(Task 3), 기존 `saveGraph`·`toAppNodes`·`toAppEdges`·`pushHistory`·`refreshFullGraph`·`showToast`·`ModalBackdrop`·`ConfirmDialog`.
- Produces: 툴바 `onImportCsv?: () => void` prop.

- [x] **Step 1: 툴바 버튼**

`frontend/src/components/editor-toolbar.tsx`:
- lucide import에 `FileUp` 추가 (기존 `BookOpen` 옆).
- `EditorToolbarProps`(37–45)에 `onImportCsv?: () => void;` 추가 (함수 시그니처의 구조분해에도 추가).
- 기존 매뉴얼 버튼 블록(99–111)을 우측 클러스터로 교체:

```tsx
      {/* 우측 클러스터 — CSV 임포트(체크아웃 보유 시) + 매뉴얼 사이트(F9) */}
      <div className="ml-auto flex items-center gap-1">
        {onImportCsv && (
          <button
            type="button"
            data-id="toolbar-import-csv"
            className={iconBtn}
            onClick={onImportCsv}
            title={t("csvImport.toolbar")}
            aria-label={t("csvImport.toolbar")}
          >
            <FileUp size={16} strokeWidth={1.5} />
          </button>
        )}
        {manualUrl && (
          <button
            type="button"
            data-id="toolbar-manual-site"
            className={iconBtn}
            onClick={() => window.open(manualUrl, "_blank", "noopener,noreferrer")}
            title={t("editor.manualSite")}
            aria-label={t("editor.manualSite")}
          >
            <BookOpen size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>
```

(기존 매뉴얼 버튼의 `ml-auto`는 클러스터 div로 이동 — 단독일 때도 위치 동일.)

- [x] **Step 2: page.tsx 상태 + 교체 로직**

`frontend/src/app/maps/[mapId]/page.tsx`:

import 추가 — `CsvImportSection`(`@/components/csv-import-section`), `type CsvImportOutcome`(`@/lib/csv-import`), lucide `FileUp`·`Trash2`·`FilePlus2`(이미 있는 항목은 생략), `ModalBackdrop`(`@/components/modal-backdrop`, 이미 import돼 있으면 생략).

상태 (기존 모달 상태들 근처, ~744 `checkout` 아래):

```ts
  // CSV 임포트(전체 교체) — 모달·파싱 결과·확인 단계 (design 2026-07-06)
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvOutcome, setCsvOutcome] = useState<CsvImportOutcome | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvConfirmOpen, setCsvConfirmOpen] = useState(false);
```

교체 콜백 (`saveCurrentScope` 부근에 배치):

```ts
  // CSV 전체 교체 — 서버 PUT 성공 후에만 캔버스 반영(423/409 시 캔버스 불변).
  // 직접 saveGraph를 쓰는 이유: setState 직후 ref 동기화 전에 saveCurrentScope를 부르면 이전 상태가 저장됨.
  const applyCsvImport = useCallback(async () => {
    if (versionId === null || !csvOutcome?.graph) return;
    try {
      const saved = await saveGraph(versionId, csvOutcome.graph);
      pushHistory(); // undo = 임포트 이전 캔버스로 복귀(다음 자동저장이 서버도 되돌림)
      setNodes(toAppNodes(saved, null));
      setEdges(toAppEdges(saved));
      setGroups(saved.groups);
      setSelectedId(null);
      setSelectedEdgeId(null);
      setMenu(null);
      dirtyRef.current = false;
      setSaveState("saved");
      refreshFullGraph();
      setCsvConfirmOpen(false);
      setCsvImportOpen(false);
      setCsvOutcome(null);
      setCsvFileName(null);
      showToast(t("csvImport.applied"));
    } catch (err) {
      setCsvConfirmOpen(false);
      showToast(err instanceof Error ? err.message : t("err.save"));
    }
  }, [versionId, csvOutcome, pushHistory, setNodes, setEdges, setGroups, refreshFullGraph, showToast, t]);
```

(참고 패턴: AI 프리뷰 적용 블록 page.tsx:1467–1475 — `layoutWithDagre`는 불필요, CSV 그래프는 이미 배치됨. `setSaveState`/`dirtyRef`/`setMenu`/`setSelectedId`/`setSelectedEdgeId`는 모두 기존 심벌. deps에 없는 setter는 안정 참조라 생략 가능 — 기존 콜백들의 deps 스타일을 따른다.)

- [x] **Step 3: 툴바 prop + 모달 JSX**

`EditorToolbar` 렌더(6210~6225)에 prop 추가 — 루트 스코프 + 본인 체크아웃일 때만 노출(스펙 §4 게이트; 딥뷰(비루트 스코프)에서는 숨김):

```tsx
          onImportCsv={
            checkout?.mine && currentParentId === null
              ? () => setCsvImportOpen(true)
              : undefined
          }
```

모달 JSX — 기존 모달들(deleteVersionOpen 블록, ~7702) 근처에 추가:

```tsx
      {/* CSV 임포트 모달 — 파일 선택·파싱 결과, Continue로 교체 확인 단계 진입 */}
      {csvImportOpen && (
        <ModalBackdrop
          onClose={() => {
            setCsvImportOpen(false);
            setCsvOutcome(null);
            setCsvFileName(null);
          }}
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 backdrop-blur-sm"
        >
          <div className="relative flex w-full max-w-lg flex-col gap-4 rounded-md bg-surface p-6 shadow-lg">
            <h2 className="text-body-strong text-ink">{t("csvImport.modalTitle")}</h2>
            <CsvImportSection
              outcome={csvOutcome}
              fileName={csvFileName}
              onChange={(nextOutcome, nextFileName) => {
                setCsvOutcome(nextOutcome);
                setCsvFileName(nextFileName);
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                onClick={() => {
                  setCsvImportOpen(false);
                  setCsvOutcome(null);
                  setCsvFileName(null);
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="csv-import-continue"
                className="rounded-sm bg-accent px-3 py-1.5 text-caption text-white hover:opacity-90 disabled:opacity-50"
                disabled={!csvOutcome?.graph || csvOutcome.errors.length > 0}
                onClick={() => setCsvConfirmOpen(true)}
              >
                {t("csvImport.continue")}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
      {/* CSV 교체 확인 — 기존 노드·엣지·그룹 전부 삭제 경고 (맵 삭제 모달 컨벤션) */}
      {csvConfirmOpen && csvOutcome?.graph && (
        <ConfirmDialog
          title={t("csvImport.confirmTitle")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          danger
          icon={<FileUp size={28} strokeWidth={1.5} className="text-error" />}
          sections={[
            [
              {
                icon: <Trash2 size={14} strokeWidth={1.5} />,
                text: t("csvImport.confirmDelete", {
                  n: nodes.length,
                  m: edges.length,
                  k: groups.length,
                }),
                tone: "error",
              },
            ],
            [
              {
                icon: <FilePlus2 size={14} strokeWidth={1.5} />,
                text: t("csvImport.confirmCreate", {
                  x: csvOutcome.nodeCount,
                  y: csvOutcome.edgeCount,
                }),
                tone: "accent",
              },
            ],
          ]}
          onConfirm={() => void applyCsvImport()}
          onClose={() => setCsvConfirmOpen(false)}
        />
      )}
```

주의 2건: ① `ModalBackdrop` props는 `create-map-dialog.tsx:266` 사용례와 대조해 맞춘다(onClose 미지원이면 backdrop 클릭 처리 방식을 그 파일과 동일하게). ② 버튼 클래스는 페이지 내 기존 모달 푸터 버튼(예: 라이브러리 피커/노드 요약 모달)의 클래스를 우선 재사용 — 없을 때만 위 클래스 사용. `t()` 숫자 보간은 Task 4의 주의와 동일.

- [x] **Step 4: 검증 + 커밋**

Run (frontend/ 에서): `npm run lint` → 0 errors. `npm run build` → 성공.

브라우저 확인:
1. 기존 맵(draft, 본인 체크아웃) → 툴바 우측에 FileUp 아이콘 표시 → 클릭 → 모달에서 템플릿 첨부 → Continue → 확인 모달에 "Delete N nodes · …" / "Create 6 nodes · 6 edges" 표시 → Confirm → 캔버스가 새 그래프로 교체 + "CSV imported" 토스트, 새로고침 후에도 유지.
2. 다른 계정으로 열람(체크아웃 미보유) → Import 버튼 미노출. published 버전 → 툴바 자체 미노출(기존 동작).

```bash
git add frontend/src/components/editor-toolbar.tsx "frontend/src/app/maps/[mapId]/page.tsx" docs/superpowers/plans/2026-07-06-csv-import.md PROGRESS.md
git commit -m "feat(editor): CSV import replace-all from toolbar — 에디터 CSV 전체 교체(체크아웃 보유자 한정·확인 모달)"
```

---

### Task 7: 통합 검증 (브라우저 E2E + 전체 회귀)

**Files:**
- Modify: `PROGRESS.md`(최종 항목), 이 계획 파일(체크박스), 발견된 결함 수정분

**Interfaces:**
- Consumes: Task 1~6 전부.

- [x] **Step 1: 검증 환경 기동**

**먼저 `docs/lessons/browser-verification.md`를 읽는다** (dev.db 오염·좀비 프론트·연결 flaky 함정). 요점:
- 좀비 정리: `pkill -f "next dev"` 후 3000 포트 점유 확인(3001 폴백 금지).
- DB 리셋+데모 시드: `docs/db-seed.md` 절차(`backend/`에서 `.venv/bin/python -m scripts.reset_db`).
- backend: `backend/`에서 `.venv/bin/uvicorn app.main:app --reload --port 8000` / frontend: `frontend/`에서 `npm run dev`.
- 브라우저 구동은 lessons 문서의 Playwright+시스템 Chrome 하네스(또는 세션의 Chrome 자동화 도구)로.

- [x] **Step 2: E2E 시나리오**

| # | 시나리오 | 기대 |
|---|---------|------|
| 1 | 템플릿 다운로드(새 맵 다이얼로그) | `bpm-map-template.csv`, BOM+CRLF, 5컬럼 헤더 |
| 2 | 새 맵 + 템플릿 CSV → Create | 에디터로 이동, Start/End 자동 생성, Decide가 마름모(decision), 분기 라벨 approved/rejected, LR 배치 |
| 3 | 에러 CSV(중복 Name) 첨부 | 행 에러 목록 표시, Create 비활성; 파일 제거 시 CSV 없이 생성 가능 |
| 4 | 기존 맵 툴바 임포트 → Confirm | 삭제/생성 요약 수치 정확, 교체 후 새로고침에도 유지, 그룹 삭제 확인 |
| 5 | 임포트 후 undo (Ctrl+Z) | 이전 캔버스로 복귀(다음 자동저장이 서버 반영) |
| 6 | 비보유자/viewer | Import 버튼 미노출(툴바 미노출 또는 버튼 없음) |
| 7 | 인스펙터 URL 필드 | process 노드에 URL 입력 → 저장·새로고침 후 유지; start/end/subprocess에는 행 없음 |
| 8 | EUC-KR CSV(한글 노드명, Excel 레거시 저장) | 한글 정상 파싱·렌더 |

- [x] **Step 3: 전체 회귀**

- `backend/`: `.venv/bin/python -m pytest tests/ -q` → 전체 PASS, `.venv/bin/ruff check app/ tests/` → clean.
- `frontend/`: `npm run test` → PASS, `npm run lint` → 0, `npm run build` → 성공.

- [x] **Step 4: 마무리 커밋**

발견 결함 수정분 + PROGRESS.md 최종 항목("CSV 임포트 — 새 맵 시작·기존 맵 전체 교체·노드 URL 필드, E2E 검증 완료") + 계획 체크박스 전체 갱신:

```bash
git add -A docs/superpowers/plans/2026-07-06-csv-import.md PROGRESS.md
git commit -m "test(csv-import): browser E2E verification + fixes — CSV 임포트 통합 검증·수정"
```

(수정분이 없으면 PROGRESS/플랜 문서만 `docs(progress):` 커밋.)

---

## Self-Review 결과

- **스펙 커버리지:** §1 양식(Task 3 파서·상한·인코딩·템플릿) / §2 변환(Task 3 자동 Start·End·decision·dagre·genId) / §3 새 맵(Task 5) / §4 기존 맵(Task 6 게이트·확인 모달·PUT 재사용·423/409 토스트) / §5 URL(Task 1·2 — 패턴 검증은 Global Constraints의 문서화된 편차) / §6 에러(Task 3 전항목 + 행 번호) / §7 테스트(Task 1 pytest·Task 3 vitest·Task 7 E2E) — 전부 매핑됨.
- **플레이스홀더:** 없음. 단 두 곳은 실행 시점 확인 지시(ModalBackdrop props 대조, `t()` 숫자 보간 방식) — 근거 파일·라인 명시됨.
- **타입 일관성:** `CsvImportOutcome{graph,nodeCount,edgeCount,errors}`·`CsvImportError{line,message}`·`CsvImportSection{outcome,fileName,onChange,disabled}` — Task 3 정의를 4·5·6이 동일 시그니처로 소비. `url`은 백엔드 `str`(항상 반환)·프론트 `url?: string`(옵셔널, `?? ""` 소비)로 일관.
