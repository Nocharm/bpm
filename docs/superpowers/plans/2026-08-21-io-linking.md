# 노드 IO 연결(불러오기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다른 노드의 IO 항목을 참조 연결(불러오기)하고, 원본 한 곳의 수정이 모든 미러에 일괄 반영되는 링크 그룹 기능 구현.

**Architecture:** 기존 줄 정렬 텍스트 계약(`*_forms` 선례)을 따라 노드 4·맵 2 컬럼을 추가하고, 링크는 itemId-only 참조로 해석(렌더 시 인덱스). FE 단일 소스 모듈 `lib/io-items.ts`가 판정·후보·불러오기·전파·정합화를 전담하고, 백엔드는 무해석 왕복. UI는 MultiValueInput 확장 + EdgeSelectModal 패턴의 불러오기 모달.

**Tech Stack:** Next.js/React (@xyflow/react), FastAPI + SQLAlchemy + Pydantic, vitest, pytest, Playwright(시스템 Chrome 스모크).

**Spec:** `docs/superpowers/specs/2026-08-21-io-linking-design.md` — 모든 태스크는 이 스펙의 §번호를 근거로 한다. 실행자는 스펙을 먼저 읽을 것.

## Global Constraints

- **작업 위치:** 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/io-linking`, 브랜치 `feat/io-linking`. 모든 명령·커밋은 이 디렉터리에서. 시작 시 `pwd`와 `git branch --show-current`로 확인.
- **커밋 형식:** `type(scope): English summary — 한국어 요약` + 본문 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러. 커밋마다 `PROGRESS.md` 최신 섹션(`## 2026-08-21 — 노드 IO 연결…`)에 1줄 추가를 같은 커밋에 포함.
- **id 생성은 `genId()`(`@/lib/id`)** — `crypto.randomUUID()` 금지(평문 HTTP insecure context).
- **신규 DB 컬럼은 `backend/app/db.py` `_ADDED_COLUMNS` 등록 필수** — 운영 DB는 리셋 불가, 자동 ALTER로만 보강된다.
- **TS:** strict, `any` 금지. React Compiler가 수동 메모이제이션 deps 불일치 시 빌드를 깨뜨림 — 사소한 핸들러는 plain function으로. effect 내 동기 setState 금지.
- **UI:** 영어 기본, 신규 문자열은 `frontend/src/lib/i18n-messages.ts`의 en/ko 두 섹션 모두에 추가. raw hex 금지(토큰만). Lucide 아이콘(행 내 12px/strokeWidth 1.5). 인터랙티브 요소에 `data-id`.
- **grep 함정:** 이 환경의 `grep -r`은 ugrep이라 `[mapId]` 같은 브래킷 디렉터리를 건너뜀 — page.tsx는 명시 경로로 `grep -n "패턴" "frontend/src/app/maps/[mapId]/page.tsx"`.
- **게이트 명령** (전부 워크트리 기준):
  - BE: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` · `.venv/bin/ruff check app/ tests/`
  - FE: `cd frontend && npx vitest run` · `npx tsc --noEmit` · `npm run lint` · `npm run build`
- **줄 정렬 계약(스펙 §3):** `*_forms`/`*_ids`/`*_links`/`*_flags`는 전부 text 줄과 1:1 인덱스 정렬, 빈 줄=없음, 짧으면 이후 없음, 후행 공백 줄만 소거. split/join은 반드시 `lib/io-items.ts` 헬퍼로.

---

### Task 0: 워크트리 환경 준비 (커밋 없음)

**Files:** 없음 (환경만)

- [ ] **Step 1: backend venv 구성**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/io-linking/backend
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
```

- [ ] **Step 2: frontend node_modules 구성** — 메인 체크아웃에서 APFS 클론(빠름, turbopack 심링크 거부 회피). 실패 시 `npm install`.

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/io-linking/frontend
cp -Rc /Users/hyeonjin/Documents/bpm/frontend/node_modules ./node_modules || npm install
```

- [ ] **Step 3: 베이스라인 게이트 확인** — Global Constraints의 BE/FE 게이트를 한 번 돌려 시작점 그린 확인. (pytest 전체는 오래 걸리면 `-q -x tests/test_graph.py tests/test_versions.py`로 축약 가능, 마지막 태스크에서 전체 실행.)

---

### Task 1: 백엔드 스키마 스레딩 — 컬럼 6개 + 검증 + upsert/clone/지정

**Files:**
- Modify: `backend/app/models.py` (Node ~:330 `output_forms` 아래, ProcessMap ~:187 `sp_output_forms` 아래)
- Modify: `backend/app/db.py` (`_ADDED_COLUMNS` 말미 ~:112)
- Modify: `backend/app/schemas.py` (NodeIn ~:909, `_trim_trailing_form_lines` :965, SubprocessDesignationIn ~:103, SubprocessRefOut ~:1048)
- Modify: `backend/app/routers/graph.py` (upsert :303-304 아래)
- Modify: `backend/app/routers/versions.py` (clone_graph :85-88 아래)
- Modify: `backend/app/routers/maps.py` (지정 저장 :1055-1056 아래)
- Modify: `backend/app/subprocess.py` (get_subprocess_refs select/kwargs/tuple 3곳, :85·:111·:136 부근)
- Test: `backend/tests/test_graph.py`, `backend/tests/test_versions.py`

**Interfaces:**
- Consumes: 기존 줄 정렬 계약(`input_forms` 선례).
- Produces: Node 컬럼 `output_ids`·`input_links`·`output_links`·`input_flags`(str, default "") / ProcessMap 컬럼 `sp_input_ids`·`sp_output_ids`(str|None) / `SubprocessDesignationIn.input_ids`·`.output_ids`(str, default "") / `SubprocessRefOut.input_ids`·`.output_ids`(str|None). GET/PUT graph·clone·지정 저장 전 경로 왕복.

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_graph.py`의 `test_node_io_item_forms_roundtrip`(:801) 바로 아래에 추가:

```python
def test_node_io_link_columns_roundtrip(client: TestClient) -> None:
    """IO 링크 컬럼 왕복 — 줄 정렬 유지, 후행 공백 줄 소거 (io-linking design §3)."""
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n0", "title": "시작", "node_type": "start"},
            {
                "id": "n1", "title": "원본",
                "output": "회의록\n견적서",
                "output_ids": "itm_a1\n",  # 첫 항목만 원본 — 후행 빈 줄 소거 기대
            },
            {
                "id": "n2", "title": "미러",
                "input": "회의록",
                "input_links": "itm_a1",
                "input_flags": "optional",
            },
        ],
        "edges": [],
    }
    res = client.put(f"/api/versions/{version_id}/graph", json=graph)
    assert res.status_code == 200
    saved = client.get(f"/api/versions/{version_id}/graph").json()
    n1 = next(n for n in saved["nodes"] if n["id"] == "n1")
    n2 = next(n for n in saved["nodes"] if n["id"] == "n2")
    assert n1["output_ids"] == "itm_a1"
    assert n2["input_links"] == "itm_a1"
    assert n2["input_flags"] == "optional"
```

그리고 `backend/tests/test_versions.py`의 `test_create_version_clones_graph`(:101)의 그래프 페이로드 노드에 `"output_ids": "itm_c1"`, `"input_links": "itm_c1"`, `"input_flags": "optional"`을 추가하고(같은 노드/이웃 노드에 적절히), 클론 결과 단언에 세 필드가 **그대로 복사**됨을 추가(:132 부근 패턴).

- [ ] **Step 2: 실패 확인**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_graph.py::test_node_io_link_columns_roundtrip tests/test_versions.py::test_create_version_clones_graph -q
```
Expected: FAIL (unknown field/컬럼 부재).

- [ ] **Step 3: 구현** — 각 파일에 기존 `*_forms` 줄 바로 아래 대칭으로 추가:

`models.py` Node (:330 `output_forms` 아래):
```python
    # IO 링크(불러오기) — 줄 정렬 계약은 input_forms와 동일. output_ids=원본 항목 id(원본만),
    # *_links=미러의 원본 itemId 참조, input_flags=필수/선택(빈 줄=required, "optional"만 명시).
    # 설계: docs/superpowers/specs/2026-08-21-io-linking-design.md §3
    output_ids: Mapped[str] = mapped_column(Text, default="")
    input_links: Mapped[str] = mapped_column(Text, default="")
    output_links: Mapped[str] = mapped_column(Text, default="")
    input_flags: Mapped[str] = mapped_column(Text, default="")
```

`models.py` ProcessMap (:187 아래):
```python
    # SP 지정 IO 항목 id — 지정 저장 시 전 줄 부여(소비 맵의 미러가 참조). 줄 정렬은 sp_input과 1:1
    sp_input_ids: Mapped[str | None] = mapped_column(Text, default=None)
    sp_output_ids: Mapped[str | None] = mapped_column(Text, default=None)
```

`db.py` `_ADDED_COLUMNS` 말미:
```python
    ("nodes", "output_ids", "TEXT DEFAULT ''"),
    ("nodes", "input_links", "TEXT DEFAULT ''"),
    ("nodes", "output_links", "TEXT DEFAULT ''"),
    ("nodes", "input_flags", "TEXT DEFAULT ''"),
    ("process_maps", "sp_input_ids", "TEXT"),
    ("process_maps", "sp_output_ids", "TEXT"),
```

`schemas.py` NodeIn (:909 아래):
```python
    # IO 링크 — itemId-only 참조. 서버는 무해석 왕복, 정합성은 FE reconcile 담당 (io-linking §3)
    output_ids: str = ""
    input_links: str = ""
    output_links: str = ""
    input_flags: str = ""
```
`_trim_trailing_form_lines` validator(:965) 필드 목록을 `("input_forms", "output_forms", "output_ids", "input_links", "output_links", "input_flags")`로 확장.

`schemas.py` SubprocessDesignationIn (:103 아래) — 동일 rstrip validator 추가:
```python
    # SP IO 항목 id — 지정 모달이 전 줄 부여(소비 맵 미러의 참조 대상) (io-linking §3)
    input_ids: str = Field(default="")
    output_ids: str = Field(default="")

    @field_validator("input_ids", "output_ids", mode="after")
    @classmethod
    def _trim_trailing_id_lines(cls, value: str) -> str:
        return value.rstrip()
```

`schemas.py` SubprocessRefOut (:1048 아래):
```python
    # SP IO 항목 id — 미러 해석용 (io-linking §3)
    input_ids: str | None = None
    output_ids: str | None = None
```

`graph.py` upsert(:304 아래) 4줄: `existing.output_ids = node.output_ids` 등. (신규 insert는 `**node.model_dump()`라 자동.)

`versions.py` clone_graph(:88 아래) 4줄 그대로 복사 — **리매핑 없음**(itemId는 노드 id와 무관, 스펙 §3):
```python
            output_ids=node.output_ids,
            input_links=node.input_links,
            output_links=node.output_links,
            input_flags=node.input_flags,
```

`maps.py` 지정 저장(:1056 아래):
```python
    found_map.sp_input_ids = payload.input_ids or None
    found_map.sp_output_ids = payload.output_ids or None
```

`subprocess.py` get_subprocess_refs — select 목록(:86 아래)에 `ProcessMap.sp_input_ids, ProcessMap.sp_output_ids` 추가, 생성자 kwargs(:112 부근)에 `input_ids=sp_input_ids, output_ids=sp_output_ids`, 언패킹 튜플(:137 부근)에 `sp_input_ids, sp_output_ids` — 3곳 순서를 정확히 일치시킬 것.

- [ ] **Step 4: 통과 확인** — Step 2 명령 재실행 → PASS. 이어서 BE 전체 게이트(pytest 전체 + ruff) 그린 확인.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/db.py backend/app/schemas.py backend/app/routers/graph.py backend/app/routers/versions.py backend/app/routers/maps.py backend/app/subprocess.py backend/tests/test_graph.py backend/tests/test_versions.py PROGRESS.md
git commit -m "feat(io-linking): thread IO link columns through backend — IO 링크 컬럼 백엔드 스레딩"
```

---

### Task 2: FE 타입·직렬화 스레딩 — api/canvas/page 왕복 + CSV/AI/복사 가드

**Files:**
- Modify: `frontend/src/lib/api.ts` (GraphNode :128 아래 · SubprocessRef :205 부근 · 지정 payload 타입 :474 부근)
- Modify: `frontend/src/lib/canvas.ts` (NodeData — `output_forms` 계열 필드 인근, :40 위쪽 IO 필드 존 확인 후)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (`toAppNodes` :589 아래 · `buildGraph` :736 아래 · `aiNodeToGraphNode` :681 아래 · `applyCtrlDragCopy` copies.push :3569 부근)
- Modify: `frontend/src/lib/csv-import.ts` (NODE_DEFAULTS :198 아래 · mergeNode :283 아래)
- Modify: `frontend/src/lib/node-clipboard.ts` (`buildPaste` :48)
- Test: `frontend/src/lib/csv-import.test.ts` (기존 파일 있으면 추가, 없으면 mergeNode 보존 규칙만 검증하는 신규)

**Interfaces:**
- Consumes: Task 1 백엔드 필드명.
- Produces: `GraphNode.output_ids?/input_links?/output_links?/input_flags?: string` · `NodeData`에 동명 optional 필드 · `SubprocessRef.input_ids/output_ids: string | null` · 지정 payload에 `input_ids?/output_ids?: string`. 이후 태스크는 전부 이 필드명을 사용.

- [ ] **Step 1: 실패 테스트 작성** — mergeNode 보존 규칙(스펙 §3: 텍스트 동일=유지/변경=소거). csv-import의 mergeNode가 export되어 있지 않으면 export를 추가하지 말고, 기존 csv-import 테스트 파일의 임포트 병합 경로(공개 API) 테스트 패턴을 따른다. 검증 내용:

```ts
// 기존 노드: output "회의록", output_ids "itm_1", input "PR", input_links "itm_9", input_flags "optional"
// CSV가 output 텍스트를 바꾸면 → output_ids/output_links "" 소거
// CSV가 input 셀을 비우면(기존 유지) → input_links/input_flags 보존
```

- [ ] **Step 2: 실패 확인** — `cd frontend && npx vitest run src/lib/csv-import.test.ts` → FAIL.

- [ ] **Step 3: 구현**
  - `api.ts` GraphNode(:128 아래):
    ```ts
    // IO 링크 — output_ids=원본 항목 id, *_links=미러의 원본 itemId, input_flags=필수/선택("optional"만 명시)
    output_ids?: string;
    input_links?: string;
    output_links?: string;
    input_flags?: string;
    ```
  - `api.ts` SubprocessRef(:205 부근, input_forms 아래): `input_ids: string | null; output_ids: string | null;`
  - `api.ts` 지정 payload 타입(:474 부근 input_forms 있는 인터페이스): `input_ids?: string; output_ids?: string;`
  - `canvas.ts` NodeData: IO 필드 존(`input`/`output`/`input_forms` 선언부를 찾아 그 아래)에 `output_ids?: string; input_links?: string; output_links?: string; input_flags?: string;` 추가.
  - `page.tsx` `toAppNodes`(:589 아래) 4줄: `output_ids: node.output_ids ?? "",` 등. `buildGraph`(:736 아래) 4줄: `output_ids: node.data.output_ids ?? "",` 등.
  - `page.tsx` `aiNodeToGraphNode`(:681 아래) 4줄 전부 `""` (AI 표면 제외 — forms와 동일 주석).
  - `csv-import.ts` NODE_DEFAULTS(:198 아래) 4줄 `""` + 주석 `// CSV/AI 표면 제외 — IO 링크 (io-linking §3)`.
  - `csv-import.ts` mergeNode(:283 아래):
    ```ts
    output_ids: mergedText.output === (existing.output ?? "") ? existing.output_ids ?? "" : "",
    output_links: mergedText.output === (existing.output ?? "") ? existing.output_links ?? "" : "",
    input_links: mergedText.input === (existing.input ?? "") ? existing.input_links ?? "" : "",
    input_flags: mergedText.input === (existing.input ?? "") ? existing.input_flags ?? "" : "",
    ```
  - **노드 복사 2경로에서 `output_ids` 소거**(스펙 §6 — itemId 중복 방지, links/flags는 유지):
    - `page.tsx` `applyCtrlDragCopy`의 `copies.push({ ... data: ... })`에서 복사 데이터에 `output_ids: ""`.
    - `node-clipboard.ts` `buildPaste`(:48)의 노드 데이터 구성부에 `output_ids: ""`.
- [ ] **Step 4: 통과 확인** — Step 2 재실행 PASS + `npx tsc --noEmit` + `npx vitest run` 전체 그린.
- [ ] **Step 5: Commit** — `feat(io-linking): thread link fields through FE serialization and guards — FE 직렬화·CSV/AI/복사 가드 스레딩`

---

### Task 3: `lib/io-items.ts` A — 줄 헬퍼·상태 판정·인덱스·SP id 부여

**Files:**
- Create: `frontend/src/lib/io-items.ts`
- Test: `frontend/src/lib/io-items.test.ts`

**Interfaces:**
- Consumes: Task 2의 NodeData/SubprocessRef 필드.
- Produces (이후 태스크가 그대로 사용):
  ```ts
  export type IoSide = "input" | "output";
  export type IoListKind = "in" | "out" | "spin" | "spout";
  export type IoItemState = "origin" | "mirror" | "plain";
  export interface IoLinkFields { input?: string; output?: string; input_forms?: string; output_forms?: string; output_ids?: string; input_links?: string; output_links?: string; input_flags?: string; }
  export interface IoNode { id: string; data: IoLinkFields & { label: string; nodeType: string; linkedMapId?: number | null } }
  export type SpRefMap = ReadonlyMap<number, SubprocessRef>;
  export interface IoOriginRef { itemId: string; nodeId: string; kind: "out" | "spin" | "spout"; index: number; text: string; form: string }
  export function getIoLine(joined: string | null | undefined, index: number): string
  export function setIoLine(joined: string | null | undefined, index: number, value: string): string
  export function countIoLines(joined: string | null | undefined): number
  export function getIoItemState(node: IoNode, side: IoSide, index: number): IoItemState
  export function buildIoIndex(nodes: IoNode[], spRefs: SpRefMap): Map<string, IoOriginRef>
  export interface IoMirrorSite { nodeId: string; side: IoSide; index: number }
  export function buildIoMirrorIndex(nodes: IoNode[]): Map<string, IoMirrorSite[]>
  export function assignSpIoIds(newText: string, oldText: string | null | undefined, oldIds: string | null | undefined): string
  ```
- 파일 첫 줄 주석: `// IO 연결(불러오기) 단일 소스 — 줄 정렬·판정·인덱스·후보·불러오기·전파. 설계: docs/superpowers/specs/2026-08-21-io-linking-design.md`

- [ ] **Step 1: 실패 테스트 작성** — `io-items.test.ts` (vitest, `canvas.test.ts` 스타일). 최소 케이스:

```ts
import { describe, expect, it } from "vitest";
import {
  assignSpIoIds, buildIoIndex, buildIoMirrorIndex, getIoItemState, getIoLine, setIoLine,
  type IoNode, type SpRefMap,
} from "./io-items";

const node = (id: string, data: Partial<IoNode["data"]>): IoNode => ({
  id, data: { label: id, nodeType: "process", ...data },
});
const NO_SP: SpRefMap = new Map();

describe("io line helpers", () => {
  it("getIoLine은 범위 밖·빈 문자열에서 빈 값", () => {
    expect(getIoLine("a\nb", 1)).toBe("b");
    expect(getIoLine("a", 3)).toBe("");
    expect(getIoLine(undefined, 0)).toBe("");
  });
  it("setIoLine은 빈 줄 패딩 후 교체, 후행 빈 줄 소거", () => {
    expect(setIoLine("", 2, "x")).toBe("\n\nx");
    expect(setIoLine("a\nb\nc", 2, "")).toBe("a\nb");
    expect(setIoLine("a", 0, "z")).toBe("z");
  });
});

describe("state & index", () => {
  const origin = node("A", { output: "회의록\n견적", output_ids: "itm_1" });
  const mirror = node("B", { input: "회의록", input_links: "itm_1" });
  it("origin/mirror/plain 판정", () => {
    expect(getIoItemState(origin, "output", 0)).toBe("origin");
    expect(getIoItemState(origin, "output", 1)).toBe("plain");
    expect(getIoItemState(mirror, "input", 0)).toBe("mirror");
  });
  it("같은 줄 id+link 공존 시 origin 우선(무효 링크는 reconcile 소거 대상)", () => {
    const both = node("C", { output: "x", output_ids: "itm_9", output_links: "itm_1" });
    expect(getIoItemState(both, "output", 0)).toBe("origin");
  });
  it("인덱스 — 중복 itemId는 먼저 만난 쪽만, 빈 텍스트 줄 id는 무시", () => {
    const dup = node("D", { output: "복제", output_ids: "itm_1" });
    const idx = buildIoIndex([origin, dup, mirror], NO_SP);
    expect(idx.get("itm_1")).toMatchObject({ nodeId: "A", kind: "out", index: 0, text: "회의록" });
  });
  it("SP 노드는 지정 ref의 spin/spout로 인덱싱, 미지정 SP는 제외", () => {
    const sp = node("S", { nodeType: "subprocess", linkedMapId: 7 });
    const refs: SpRefMap = new Map([[7, {
      designated: true, input: "원료 목록", output: "검사 성적서",
      input_ids: "sp_in1", output_ids: "sp_out1", input_forms: "", output_forms: "Excel",
    } as never]]);
    const idx = buildIoIndex([sp], refs);
    expect(idx.get("sp_out1")).toMatchObject({ nodeId: "S", kind: "spout", form: "Excel" });
    expect(idx.get("sp_in1")).toMatchObject({ nodeId: "S", kind: "spin" });
  });
  it("미러 역인덱스", () => {
    const m = buildIoMirrorIndex([origin, mirror]);
    expect(m.get("itm_1")).toEqual([{ nodeId: "B", side: "input", index: 0 }]);
  });
});

describe("assignSpIoIds", () => {
  it("텍스트 일치 줄은 기존 id 보존, 신규·개명 줄은 새 id, 전 줄 부여", () => {
    const out = assignSpIoIds("검사 성적서\n신규 항목", "검사 성적서", "sp_out1");
    const lines = out.split("\n");
    expect(lines[0]).toBe("sp_out1");
    expect(lines[1]).not.toBe("");
    expect(lines[1]).not.toBe("sp_out1");
  });
  it("빈 텍스트면 빈 결과", () => {
    expect(assignSpIoIds("", "구항목", "sp_1")).toBe("");
  });
});
```

(SP ref 목킹의 `as never`는 SubprocessRef 전체 필드를 채우지 않기 위한 테스트 한정 캐스트 — 구현에서 사용하는 필드만 채운다. 타입 에러가 나면 `Pick<SubprocessRef, ...>` 헬퍼 타입으로 대체.)

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/io-items.test.ts` → FAIL (모듈 없음).

- [ ] **Step 3: 구현** — 핵심 코드:

```ts
export function getIoLine(joined: string | null | undefined, index: number): string {
  return (joined ?? "").split("\n")[index]?.trim() ?? "";
}

export function setIoLine(joined: string | null | undefined, index: number, value: string): string {
  const lines = (joined ?? "").split("\n");
  while (lines.length <= index) lines.push("");
  lines[index] = value;
  // 후행 공백 줄만 소거 — 백엔드 rstrip 계약과 동치 (io-linking §3)
  return lines.join("\n").replace(/\s+$/, "");
}

export function countIoLines(joined: string | null | undefined): number {
  const v = joined ?? "";
  return v === "" ? 0 : v.split("\n").length;
}

export function getIoItemState(node: IoNode, side: IoSide, index: number): IoItemState {
  if (side === "output" && getIoLine(node.data.output_ids, index) !== "") return "origin";
  const links = side === "input" ? node.data.input_links : node.data.output_links;
  return getIoLine(links, index) !== "" ? "mirror" : "plain";
}

export function buildIoIndex(nodes: IoNode[], spRefs: SpRefMap): Map<string, IoOriginRef> {
  const index = new Map<string, IoOriginRef>();
  const addList = (
    nodeId: string, kind: IoOriginRef["kind"],
    ids: string | null | undefined, texts: string | null | undefined, forms: string | null | undefined,
  ) => {
    (ids ?? "").split("\n").forEach((raw, i) => {
      const itemId = raw.trim();
      const text = getIoLine(texts, i);
      // 중복 itemId는 먼저 만난 쪽만 원본 인정 — 이후 발견분은 reconcile이 소거 (io-linking §5)
      if (itemId === "" || text === "" || index.has(itemId)) return;
      index.set(itemId, { itemId, nodeId, kind, index: i, text, form: getIoLine(forms, i) });
    });
  };
  for (const node of nodes) {
    if (node.data.nodeType === "subprocess") {
      const ref = node.data.linkedMapId != null ? spRefs.get(node.data.linkedMapId) : undefined;
      if (!ref?.designated) continue;
      addList(node.id, "spin", ref.input_ids, ref.input, ref.input_forms);
      addList(node.id, "spout", ref.output_ids, ref.output, ref.output_forms);
    } else {
      addList(node.id, "out", node.data.output_ids, node.data.output, node.data.output_forms);
    }
  }
  return index;
}

export function buildIoMirrorIndex(nodes: IoNode[]): Map<string, IoMirrorSite[]> {
  const map = new Map<string, IoMirrorSite[]>();
  for (const node of nodes) {
    for (const side of ["input", "output"] as const) {
      const links = side === "input" ? node.data.input_links : node.data.output_links;
      (links ?? "").split("\n").forEach((raw, i) => {
        const itemId = raw.trim();
        if (itemId === "") return;
        const sites = map.get(itemId) ?? [];
        sites.push({ nodeId: node.id, side, index: i });
        map.set(itemId, sites);
      });
    }
  }
  return map;
}

// SP 지정 저장 시 전 줄 id 부여 — 텍스트 일치 줄은 기존 id 승계(재정렬 안전), 개명·신규는 새 id.
// 개명은 소비 맵 링크의 보수적 해산으로 이어진다(reconcile) — CSV 규칙과 동일 결정 (io-linking §3)
export function assignSpIoIds(
  newText: string, oldText: string | null | undefined, oldIds: string | null | undefined,
): string {
  if (newText === "") return "";
  const oldLines = (oldText ?? "").split("\n").map((s) => s.trim());
  const oldIdLines = (oldIds ?? "").split("\n");
  const used = new Set<number>();
  return newText
    .split("\n")
    .map((line) => {
      const text = line.trim();
      const j = oldLines.findIndex((old, k) => old !== "" && old === text && !used.has(k));
      if (j >= 0) {
        used.add(j);
        const kept = (oldIdLines[j] ?? "").trim();
        if (kept !== "") return kept;
      }
      return genId();
    })
    .join("\n")
    .replace(/\s+$/, "");
}
```

임포트: `import { genId } from "@/lib/id";` · `import type { SubprocessRef } from "@/lib/api";`.

- [ ] **Step 4: 통과 확인** — 대상 테스트 + `npx tsc --noEmit` 그린.
- [ ] **Step 5: Commit** — `feat(io-linking): io-items core — line helpers, state, index — IO 링크 코어(줄 헬퍼·판정·인덱스)`

---

### Task 4: `lib/io-items.ts` B — 흐름 경로·후보 수집

**Files:**
- Modify: `frontend/src/lib/io-items.ts`
- Test: `frontend/src/lib/io-items.test.ts`

**Interfaces:**
- Consumes: Task 3 전부 + `getIncomingEdges`/`getOutgoingEdges`(`@/lib/canvas`), `Edge`(`@xyflow/react`).
- Produces:
  ```ts
  export function getFlowPathBetween(edges: Edge[], fromId: string, toId: string): string[]  // 전방 BFS 최단 경로 엣지 id, 불가면 []
  export function canReachForward(edges: Edge[], fromId: string, toId: string): boolean     // fromId!==toId 전제
  export interface IoImportCandidate {
    nodeId: string; nodeLabel: string; list: IoListKind; index: number;
    text: string; form: string; groupId: string | null; isSp: boolean;
    hop: number; pathEdgeIds: string[];
  }
  export function collectIoImportCandidates(opts: {
    nodes: IoNode[]; edges: Edge[]; spRefs: SpRefMap; nodeId: string; side: IoSide;
  }): IoImportCandidate[]   // hop 오름차순, 2홉 초과 포함(모달이 hop<=2로 1차 필터)
  ```

- [ ] **Step 1: 실패 테스트 작성** — 케이스: ①직선 A→B→C에서 C 인풋 후보 = B(hop1)·A(hop2)의 아웃풋 항목, pathEdgeIds가 실제 엣지 체인 ②아웃풋 후보 = 다운스트림 인풋 ③자기 노드 제외 ④이미 같은 그룹에 연결된 항목 제외(alreadyLinked) ⑤자기 그룹 재수입 제외(원본이 요청 노드인 미러 후보) ⑥미지정 SP 제외, 지정 SP는 spout/spin으로 등장 ⑦사이클 A→B→A에서 무한루프 없음 ⑧빈 텍스트 줄 제외 ⑨미러 후보의 groupId는 원본 itemId, 댕글링 링크 후보는 groupId null. 엣지 목킹: `{ id: "e1", source: "A", target: "B" } as Edge`.

- [ ] **Step 2: 실패 확인** — vitest FAIL.

- [ ] **Step 3: 구현** —

```ts
export function getFlowPathBetween(edges: Edge[], fromId: string, toId: string): string[] {
  if (fromId === toId) return [];
  const parent = new Map<string, { prev: string; edgeId: string }>();
  const seen = new Set([fromId]);
  let frontier = [fromId];
  while (frontier.length > 0 && !parent.has(toId)) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const edge of getOutgoingEdges(edges, cur)) {
        if (seen.has(edge.target)) continue;
        seen.add(edge.target);
        parent.set(edge.target, { prev: cur, edgeId: edge.id });
        next.push(edge.target);
      }
    }
    frontier = next;
  }
  if (!parent.has(toId)) return [];
  const path: string[] = [];
  for (let cur = toId; cur !== fromId; ) {
    const step = parent.get(cur);
    if (!step) return [];
    path.unshift(step.edgeId);
    cur = step.prev;
  }
  return path;
}

export function canReachForward(edges: Edge[], fromId: string, toId: string): boolean {
  return getFlowPathBetween(edges, fromId, toId).length > 0;
}
```

`collectIoImportCandidates` — BFS로 홉 계산(인풋=incoming 역방향, 아웃풋=outgoing 순방향, `seen`으로 사이클 차단) 후 노드별 항목 전개:

```ts
export function collectIoImportCandidates(opts: {
  nodes: IoNode[]; edges: Edge[]; spRefs: SpRefMap; nodeId: string; side: IoSide;
}): IoImportCandidate[] {
  const { nodes, edges, spRefs, nodeId, side } = opts;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const index = buildIoIndex(nodes, spRefs);
  const self = byId.get(nodeId);
  const alreadyLinked = new Set(
    ((side === "input" ? self?.data.input_links : self?.data.output_links) ?? "")
      .split("\n").map((s) => s.trim()).filter((s) => s !== ""),
  );
  // 홉 계산 — 인풋은 업스트림(incoming의 source), 아웃풋은 다운스트림(outgoing의 target)
  const hops = new Map<string, number>();
  const seen = new Set([nodeId]);
  let frontier = [nodeId];
  for (let hop = 1; frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const cur of frontier) {
      const stepEdges = side === "input" ? getIncomingEdges(edges, cur) : getOutgoingEdges(edges, cur);
      for (const edge of stepEdges) {
        const nb = side === "input" ? edge.source : edge.target;
        if (seen.has(nb)) continue;
        seen.add(nb);
        hops.set(nb, hop);
        next.push(nb);
      }
    }
    frontier = next;
  }
  const results: IoImportCandidate[] = [];
  for (const [candId, hop] of hops) {
    const cand = byId.get(candId);
    if (!cand) continue;
    const isSp = cand.data.nodeType === "subprocess";
    const ref = isSp && cand.data.linkedMapId != null ? spRefs.get(cand.data.linkedMapId) : undefined;
    if (isSp && !ref?.designated) continue; // 미지정 SP는 원본이 될 수 없음 (io-linking §2)
    // 인풋이 가져올 것 = 상대의 아웃풋(spout) / 아웃풋이 가져올 것 = 상대의 인풋(spin) (§1-3·4)
    const wantOutput = side === "input";
    const list: IoListKind = isSp ? (wantOutput ? "spout" : "spin") : wantOutput ? "out" : "in";
    const texts = isSp ? (wantOutput ? ref!.output : ref!.input) : wantOutput ? cand.data.output : cand.data.input;
    const forms = isSp ? (wantOutput ? ref!.output_forms : ref!.input_forms) : wantOutput ? cand.data.output_forms : cand.data.input_forms;
    const pathEdgeIds = side === "input"
      ? getFlowPathBetween(edges, candId, nodeId)
      : getFlowPathBetween(edges, nodeId, candId);
    (texts ?? "").split("\n").forEach((raw, i) => {
      const text = raw.trim();
      if (text === "") return;
      let groupId: string | null;
      if (isSp) {
        groupId = getIoLine(wantOutput ? ref!.output_ids : ref!.input_ids, i) || null;
      } else if (wantOutput) {
        groupId = getIoLine(cand.data.output_ids, i) || getIoLine(cand.data.output_links, i) || null;
      } else {
        groupId = getIoLine(cand.data.input_links, i) || null;
      }
      if (groupId !== null && !index.has(groupId)) groupId = null; // 댕글링은 일반 항목 취급
      if (groupId !== null) {
        if (alreadyLinked.has(groupId)) return;              // 같은 그룹 중복 불러오기 방지 (§4)
        if (index.get(groupId)?.nodeId === nodeId) return;   // 자기 그룹 재수입 방지
      }
      results.push({
        nodeId: candId, nodeLabel: cand.data.label, list, index: i,
        text, form: getIoLine(forms, i), groupId, isSp, hop, pathEdgeIds,
      });
    });
  }
  return results.sort((a, b) => a.hop - b.hop);
}
```

- [ ] **Step 4: 통과 확인** — vitest + tsc 그린.
- [ ] **Step 5: Commit** — `feat(io-linking): flow paths and import candidates — 흐름 경로·불러오기 후보 수집`

---

### Task 5: `lib/io-items.ts` C — 불러오기 실행 (미러·인수·승계·합류·SP)

**Files:**
- Modify: `frontend/src/lib/io-items.ts`
- Test: `frontend/src/lib/io-items.test.ts`

**Interfaces:**
- Consumes: Task 3·4 전부.
- Produces:
  ```ts
  export type IoImportAction = "mirror" | "takeover" | "succession" | "join";
  export function applyIoImport<N extends IoNode>(opts: {
    nodes: N[]; edges: Edge[]; spRefs: SpRefMap;
    nodeId: string; side: IoSide; candidate: IoImportCandidate;
  }): { nodes: N[]; action: IoImportAction } | null   // null = 해석 실패(원본 소실 등) — 호출부는 무시
  ```

- [ ] **Step 1: 실패 테스트 작성** — 스펙 §2 표의 5케이스 전부:
  1. **mirror**: 인풋이 일반 아웃풋 불러오기 → 원본에 id 부여(genId), 요청 노드 인풋에 텍스트/폼 복사 + link 줄. flag 줄은 추가 안 함(기본 required).
  2. **mirror(기존 그룹)**: 인풋이 이미 원본인 아웃풋 불러오기 → id 재부여 없이 그 itemId로 미러.
  3. **takeover**: 아웃풋이 일반 인풋 불러오기 → 새 itemId, 요청 아웃풋에 원본 줄(텍스트/폼 이관), 대상 인풋은 미러 전환(link 줄만 추가, 텍스트 불변).
  4. **succession**: A→B→D, B.아웃풋 원본·D.인풋 미러 상태에서 A(상류).아웃풋이 D.인풋 불러오기 → itemId가 A로 이동(A output_ids), B는 미러 강등(output_ids 소거+output_links 기록), D 링크 줄 불변.
  5. **join**: 병렬 C(원본 B에 비도달)의 아웃풋이 D.인풋 불러오기 → C.아웃풋이 B 그룹 미러로 합류. 순환(A⇄B)일 때도 join.
  6. **SP join**: 원본 kind spin/spout이면 상류여도 항상 join.
  단언은 각 노드의 `input`/`output`/`*_forms`/`output_ids`/`*_links` 문자열 전체를 비교(줄 정렬 검증 겸용).

- [ ] **Step 2: 실패 확인** — vitest FAIL.

- [ ] **Step 3: 구현** —

```ts
// 요청 노드의 side 목록 끝에 항목 1줄 추가 — forms/links/ids 줄 정렬 동반
function appendIoRow<N extends IoNode>(
  node: N, side: IoSide, row: { text: string; form: string; link: string; originId: string },
): N {
  const texts = side === "input" ? node.data.input : node.data.output;
  const idx = countIoLines(texts);
  const nextTexts = idx === 0 ? row.text : `${texts}\n${row.text}`;
  const data: IoLinkFields = { ...node.data };
  if (side === "input") {
    data.input = nextTexts;
    data.input_forms = setIoLine(node.data.input_forms, idx, row.form);
    data.input_links = setIoLine(node.data.input_links, idx, row.link);
  } else {
    data.output = nextTexts;
    data.output_forms = setIoLine(node.data.output_forms, idx, row.form);
    data.output_links = setIoLine(node.data.output_links, idx, row.link);
    data.output_ids = setIoLine(node.data.output_ids, idx, row.originId);
  }
  return { ...node, data: { ...node.data, ...data } };
}

export function applyIoImport<N extends IoNode>(opts: {
  nodes: N[]; edges: Edge[]; spRefs: SpRefMap;
  nodeId: string; side: IoSide; candidate: IoImportCandidate;
}): { nodes: N[]; action: IoImportAction } | null {
  const { nodes, edges, spRefs, nodeId, side, candidate } = opts;
  const index = buildIoIndex(nodes, spRefs);
  const origin = candidate.groupId ? (index.get(candidate.groupId) ?? null) : null;
  const mapNode = (list: N[], id: string, fn: (n: N) => N) => list.map((n) => (n.id === id ? fn(n) : n));

  if (side === "input") {
    // 인풋은 항상 미러 (io-linking §2) — 일반 아웃풋이면 원본 id를 먼저 부여
    let next = nodes;
    let itemId = origin?.itemId ?? null;
    if (itemId === null) {
      if (candidate.list !== "out") return null; // SP 항목은 id 상시 보유 — 여기 올 수 없음
      itemId = genId();
      next = mapNode(next, candidate.nodeId, (n) => ({
        ...n, data: { ...n.data, output_ids: setIoLine(n.data.output_ids, candidate.index, itemId!) },
      }));
    }
    const text = origin?.text ?? candidate.text;
    const form = origin?.form ?? candidate.form;
    next = mapNode(next, nodeId, (n) => appendIoRow(n, "input", { text, form, link: itemId!, originId: "" }));
    return { nodes: next, action: "mirror" };
  }

  // side === "output"
  if (origin === null) {
    if (candidate.list !== "in") return null;
    // 소유권 인수 — 아웃풋이 일반 인풋을 불러오면 아웃풋이 원본이 된다 (io-linking §2)
    const itemId = genId();
    let next = mapNode(nodes, candidate.nodeId, (n) => ({
      ...n, data: { ...n.data, input_links: setIoLine(n.data.input_links, candidate.index, itemId) },
    }));
    next = mapNode(next, nodeId, (n) =>
      appendIoRow(n, "output", { text: candidate.text, form: candidate.form, link: "", originId: itemId }));
    return { nodes: next, action: "takeover" };
  }

  const upstream =
    origin.kind === "out" &&
    canReachForward(edges, nodeId, origin.nodeId) &&
    !canReachForward(edges, origin.nodeId, nodeId); // 순환이면 승계 없음 (io-linking §2)
  if (upstream) {
    // 원본 승계 — itemId를 합류자 아웃풋으로 이동, 구 원본은 미러 강등. 미러들 링크 줄은 불변(자동 재지향)
    let next = mapNode(nodes, origin.nodeId, (n) => ({
      ...n,
      data: {
        ...n.data,
        output_ids: setIoLine(n.data.output_ids, origin.index, ""),
        output_links: setIoLine(n.data.output_links, origin.index, origin.itemId),
      },
    }));
    next = mapNode(next, nodeId, (n) =>
      appendIoRow(n, "output", { text: origin.text, form: origin.form, link: "", originId: origin.itemId }));
    return { nodes: next, action: "succession" };
  }
  // 병렬·하류·순환·SP 원본 → 그룹 합류 (io-linking §2)
  const next = mapNode(nodes, nodeId, (n) =>
    appendIoRow(n, "output", { text: origin.text, form: origin.form, link: origin.itemId, originId: "" }));
  return { nodes: next, action: "join" };
}
```

- [ ] **Step 4: 통과 확인** — vitest + tsc 그린.
- [ ] **Step 5: Commit** — `feat(io-linking): import execution (mirror/takeover/succession/join) — 불러오기 4시나리오+SP 실행`

---

### Task 6: `lib/io-items.ts` D — 전파·정합화 (겸용 단일 함수)

**Files:**
- Modify: `frontend/src/lib/io-items.ts`
- Test: `frontend/src/lib/io-items.test.ts`

**Interfaces:**
- Consumes: Task 3의 인덱스·헬퍼.
- Produces:
  ```ts
  export function propagateIoLinks<N extends IoNode>(nodes: N[], spRefs: SpRefMap): { nodes: N[]; changed: boolean }
  export function getIoLinkPeers(nodes: IoNode[], spRefs: SpRefMap, nodeId: string, side: IoSide, index: number):
    { groupId: string | null; origin: IoOriginRef | null; mirrors: IoMirrorSite[] }
  ```
  `propagateIoLinks`는 전파와 로드 정합화 **겸용**(스펙 §5): 미러 텍스트/폼을 원본 값으로 동기화, 원본 소실 링크는 소거(복사본 전환), 같은 줄 id+link 공존은 링크 소거, 원본 인덱스에 없는(중복·빈 텍스트 줄) id는 소거. `changed`가 false면 입력 배열을 그대로 반환(참조 동일 — 렌더 루프 방지).

- [ ] **Step 1: 실패 테스트 작성** — 케이스: ①원본 텍스트 변경 후 propagate → 모든 미러(인풋·아웃풋, 복수 노드) 동기화 ②원본 항목 삭제(텍스트 줄 제거로 id가 빈 텍스트 위에 남음) → 미러 링크 소거+텍스트 보존 ③원본 노드 자체 부재 → 동일 ④중복 itemId 두 노드 → 뒤쪽 id 소거 ⑤id+link 같은 줄 공존 → link 소거 ⑥변경 없음 → `changed === false`이고 반환 배열이 입력과 **동일 참조** ⑦SP 원본 드리프트(ref 텍스트만 바뀐 상황) → 미러 치유. `getIoLinkPeers`: 원본 항목에서 mirrors 목록, 미러 항목에서 origin, plain에서 전부 null/[].

- [ ] **Step 2: 실패 확인** — vitest FAIL.

- [ ] **Step 3: 구현** — 노드별로 4컬럼 문자열을 지역 변수로 복사해 수정 후, 하나라도 바뀌었을 때만 새 노드 객체 생성:

```ts
export function propagateIoLinks<N extends IoNode>(nodes: N[], spRefs: SpRefMap): { nodes: N[]; changed: boolean } {
  const index = buildIoIndex(nodes, spRefs);
  let changed = false;
  const next = nodes.map((node) => {
    const d = node.data;
    let { input = "", output = "", input_forms = "", output_forms = "", output_ids = "", input_links = "", output_links = "" } = d;
    // ① 원본 id 정리 — 인덱스가 인정하지 않는 id(중복 후발·빈 텍스트 줄)는 소거
    if (d.nodeType !== "subprocess") {
      output_ids.split("\n").forEach((raw, i) => {
        const id = raw.trim();
        if (id === "") return;
        const o = index.get(id);
        if (!o || o.nodeId !== node.id || o.index !== i) output_ids = setIoLine(output_ids, i, "");
      });
    }
    // ② 미러 정리·동기화
    const syncSide = (side: IoSide) => {
      let links = side === "input" ? input_links : output_links;
      links.split("\n").forEach((raw, i) => {
        const itemId = raw.trim();
        if (itemId === "") return;
        // 같은 줄 원본 id 공존(무효) 또는 원본 소실·자기 참조 → 링크 소거(복사본 전환)
        const o = index.get(itemId) ?? null;
        const invalid = (side === "output" && getIoLine(output_ids, i) !== "") || o === null || o.nodeId === node.id;
        if (invalid) {
          links = setIoLine(links, i, "");
          return;
        }
        if (side === "input") {
          if (getIoLine(input, i) !== o.text) input = setIoLine(input, i, o.text);
          if (getIoLine(input_forms, i) !== o.form) input_forms = setIoLine(input_forms, i, o.form);
        } else {
          if (getIoLine(output, i) !== o.text) output = setIoLine(output, i, o.text);
          if (getIoLine(output_forms, i) !== o.form) output_forms = setIoLine(output_forms, i, o.form);
        }
      });
      if (side === "input") input_links = links;
      else output_links = links;
    };
    syncSide("input");
    syncSide("output");
    const dirty =
      input !== (d.input ?? "") || output !== (d.output ?? "") ||
      input_forms !== (d.input_forms ?? "") || output_forms !== (d.output_forms ?? "") ||
      output_ids !== (d.output_ids ?? "") || input_links !== (d.input_links ?? "") || output_links !== (d.output_links ?? "");
    if (!dirty) return node;
    changed = true;
    return { ...node, data: { ...d, input, output, input_forms, output_forms, output_ids, input_links, output_links } };
  });
  return { nodes: changed ? next : nodes, changed };
}
```

주의: 미러 텍스트 동기화의 `setIoLine`은 후행 공백 소거를 하지만 미러 텍스트는 항상 비어있지 않으므로(원본 text 비공백 보장) 중간 줄 소실이 없다. `getIoLinkPeers`는 `buildIoIndex`+`buildIoMirrorIndex` 결합:

```ts
export function getIoLinkPeers(
  nodes: IoNode[], spRefs: SpRefMap, nodeId: string, side: IoSide, index: number,
): { groupId: string | null; origin: IoOriginRef | null; mirrors: IoMirrorSite[] } {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return { groupId: null, origin: null, mirrors: [] };
  let groupId: string | null = null;
  if (node.data.nodeType === "subprocess") {
    const ref = node.data.linkedMapId != null ? spRefs.get(node.data.linkedMapId) : undefined;
    groupId = getIoLine(side === "input" ? ref?.input_ids : ref?.output_ids, index) || null;
  } else if (side === "output") {
    groupId = getIoLine(node.data.output_ids, index) || getIoLine(node.data.output_links, index) || null;
  } else {
    groupId = getIoLine(node.data.input_links, index) || null;
  }
  if (groupId === null) return { groupId: null, origin: null, mirrors: [] };
  const origin = buildIoIndex(nodes, spRefs).get(groupId) ?? null;
  const mirrors = buildIoMirrorIndex(nodes).get(groupId) ?? [];
  return { groupId, origin, mirrors };
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/io-items.test.ts` 전체 + tsc 그린.
- [ ] **Step 5: Commit** — `feat(io-linking): propagation and reconciliation — 전파·정합화 겸용 패스`

---

### Task 7: MultiValueInput 확장 — 호버 공개 + 메뉴·미러 행·플래그·해제 콜백

**Files:**
- Modify: `frontend/src/components/multi-value-input.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (en :881 부근 / ko :2644 부근 — 두 섹션 모두)

**Interfaces:**
- Consumes: Lucide `Link2`, `Link2Off`, `Plus`, `X` — (`Link2`가 없으면 `Link`/`Unlink` 사용, 16px 미만 행이라 size 12).
- Produces — 기존 호출부(NodeDetailsFields·SP 지정 모달) **무변경 호환**을 유지하는 optional props:
  ```ts
  idsValue?: string;      // output 쪽 원본 id 줄 — 아이콘 표시·커밋 정렬용
  linksValue?: string;    // 미러 링크 줄 — 행 잠금·아이콘·커밋 정렬용
  flagsValue?: string;    // 인풋 필수/선택 줄("" = required) — 주면 플래그 필 열 노출
  originGroupIndexes?: ReadonlySet<number>;  // 미러가 1개 이상 있는 원본 행(아이콘 표시)
  onImport?: (at: { x: number; y: number }) => void;  // 주면 + 버튼이 2항목 메뉴로
  importDisabledReason?: string;                      // dirty 시 메뉴 항목 비활성 툴팁
  onUnlink?: (index: number, at: { x: number; y: number }) => void;
  onNavigateLinked?: (index: number) => void;
  onHoverLinked?: (side: "row", index: number | null) => void;  // 행 단위 호버(원본·미러 공통)
  onCommit: (joined: string, formsJoined?: string, extras?: { ids: string; links: string; flags: string }) => void;
  ```
  `ItemRow`는 `{ text, form, id, link, flag }`로 확장 — splitRows/commit이 5열 동반 정렬(빈 텍스트 행 드롭 시 다른 열도 함께 드롭 → 정렬 자동 유지).

- [ ] **Step 1: i18n 키 추가** (en/ko 두 섹션):
  `io.addNew` "Add new"/"직접 추가" · `io.importFromNode` "Import from node…"/"다른 노드에서 불러오기…" · `io.linkedTooltip` "Linked — edited at its origin"/"연결됨 — 원본에서 수정" · `io.unlinkTooltip` "Disconnect"/"연결 해제" · `io.flagRequired` "Required"/"필수" · `io.flagOptional` "Optional"/"선택".

- [ ] **Step 2: 구현** — 변경 지점:
  1. **행 버퍼 확장**: `splitRows`가 `idsValue/linksValue/flagsValue`도 같은 인덱스로 실어 `{text, form, id, link, flag}` 반환. `commit`은 kept 행에서 5열을 각각 join(후행 공백 소거)해 `onCommit(joined, formsJoined, { ids, links, flags })` 호출 — extras는 세 값 중 하나라도 제공된 호출부에만 의미(비제공 호출부는 무시). 외부 동기화 비교(:55-62)도 5열 비교로 확장.
  2. **+ 버튼 호버 공개**: 편집 브랜치 최상위 div에 `group/iosec` 클래스 추가, + 버튼에 `opacity-0 transition-opacity duration-150 group-hover/iosec:opacity-100 focus-visible:opacity-100` + 텍스트 "Add" 제거(아이콘만, `aria-label={label + " add"}` 유지).
  3. **+ 메뉴**: `onImport`가 없으면 기존처럼 즉시 행 추가. 있으면 클릭 시 로컬 state로 소형 메뉴(버튼 아래 `absolute` 배치, `z-10`, `rounded-md border border-hairline bg-surface p-1 shadow-md`) — 항목 2개: `io.addNew`(기존 addRow), `io.importFromNode`(클릭 좌표로 `onImport({x: e.clientX, y: e.clientY})`). `importDisabledReason`이 있으면 후자 `disabled` + `title`. 바깥 클릭/Esc로 닫힘(문서 mousedown 리스너 — 기존 모달 컨벤션과 동일하게 mousedown 기준). data-id: `${dataId}-add-menu`, `${dataId}-add-new`, `${dataId}-add-import`.
  4. **미러 행**(`row.link !== ""`): 번호 배지 대신 아이콘 버튼(data-id `${dataId}-link-${i}`) — 기본 `Link2`, 행 CSS `group/mvrow` 호버 시 `Link2Off`로 스왑(두 아이콘을 겹쳐 opacity 토글), `title={t("io.unlinkTooltip")}`, 클릭 → `onUnlink?.(i, {x: e.clientX, y: e.clientY})`. 텍스트 `<input>`은 `readOnly` + `text-ink-secondary bg-surface-pearl cursor-pointer` + `title={t("io.linkedTooltip")}` + 클릭 → `onNavigateLinked?.(i)`. DataFormPicker 대신 폼 텍스트를 정적 `text-fine text-ink-tertiary`로 표시. 행 onMouseEnter/Leave → `onHoverLinked?.("row", i / null)`.
  5. **원본 행**(`row.id !== "" && originGroupIndexes?.has(i)`): 번호 배지 앞이 아니라 배지 대신 `Link2` 아이콘(비버튼, `text-accent`) — 호버 시 `onHoverLinked` 동일 발화. 편집은 평소대로 가능.
  6. **플래그 필**(`flagsValue !== undefined`인 편집 행): 폼 피커 왼쪽에 소형 토글 버튼 — `row.flag === "optional"`이면 라벨 `t("io.flagOptional")` 회색조(`text-ink-tertiary border-hairline`), 아니면 `t("io.flagRequired")` 액센트 틴트(`text-accent bg-accent-tint`). 클릭 → flag `""` ↔ `"optional"` 토글 후 commit. readOnly 브랜치에서는 `optional`일 때만 `· Optional` 접미 표시(기본값 노이즈 방지). data-id `${dataId}-flag-${i}`.
  7. **readOnly 브랜치**: `row.link !== ""` 또는 `originGroupIndexes?.has(i)`면 번호 앞에 `Link2` 12px 아이콘, 행 hover → `onHoverLinked`.

- [ ] **Step 3: 검증** — `npx tsc --noEmit`·`npm run lint`·`npx vitest run`(기존 스냅샷 회귀 없음). 컴포넌트 자동 테스트는 없음 — 동작 검증은 Task 9의 배선 후 Task 10 스모크에서 실측(여기서 "verified" 주장 금지).
- [ ] **Step 4: Commit** — `feat(io-linking): multi-value-input link rows, hover-reveal add menu, flags — 미러 행·호버 공개 메뉴·플래그`

---

### Task 8: IoImportModal — 불러오기 선택 모달

**Files:**
- Create: `frontend/src/components/io-import-modal.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `IoImportCandidate`(Task 4), `ModalBackdrop`, `clampToViewport`(`@/lib/clamp-viewport`), `useI18n`. EdgeSelectModal(`edge-select-modal.tsx`)의 크롬 관례 — portal, 투명 백드롭, 헤더 캡션+X, Esc, 스태거 `edge-row-in`, 내부 스크롤, 하단 Cancel.
- Produces:
  ```ts
  export function IoImportModal(props: {
    side: IoSide;
    position: { x: number; y: number };
    candidates: IoImportCandidate[];        // hop 오름차순 전체(전 흐름)
    onPick: (candidate: IoImportCandidate) => void;
    onHoverCandidate?: (candidate: IoImportCandidate | null) => void;
    onClose: () => void;
  })
  ```

- [ ] **Step 1: i18n 키** — `io.importTitleInput` "Import an upstream output"/"업스트림 아웃풋 불러오기" · `io.importTitleOutput` "Import a downstream input"/"다운스트림 인풋 불러오기" · `io.showMore` "Show more"/"더 보기" · `io.filterPlaceholder` "Filter items"/"항목 검색" · `io.noCandidates` "No connected items"/"연결된 후보가 없습니다" · `io.linkedBadge` "Linked"/"연결됨" · `io.spBadge` "SP"/"SP".

- [ ] **Step 2: 구현** — EdgeSelectModal(:28-131)을 본떠 작성. 차이점:
  - 폭 `w-72`, 리스트 상한 `max-h-[220px]`.
  - 헤더 아래 필터 입력(`data-id="io-import-filter"`, `text-caption`, 텍스트/노드명 부분일치 필터).
  - 로컬 state `expanded: boolean` — false면 `hop <= 2`만 표시하고, 초과 후보가 있으면 리스트 끝에 `io.showMore` 행(`data-id="io-import-show-more"`, 클릭 시 `setExpanded(true)`).
  - 노드별 그룹핑: hop 순 정렬된 후보를 nodeId 연속 구간으로 묶어, 구간 첫 행 위에 노드명 캡션(`text-fine text-ink-tertiary truncate`, `title`) 표시.
  - 후보 행(`data-id={`io-import-row-${c.nodeId}-${c.list}-${c.index}`}`): `[항목 텍스트(truncate, flex-1)] [폼 필(text-fine, 있을 때만)] [배지]`. 배지: `c.isSp`면 `io.spBadge`(회색 필), `c.groupId`면 `Link2` 12px 아이콘 + `title={t("io.linkedBadge")}`.
  - 행 `onMouseEnter={() => onHoverCandidate?.(c)}` / `onMouseLeave={() => onHoverCandidate?.(null)}` / 클릭 → `onHoverCandidate?.(null); onPick(c)`.
  - 빈 후보면 `io.noCandidates` 안내(`data-id="io-import-empty"`).
  - `clampToViewport(position.x, position.y, 288, 추정높이)`.
- [ ] **Step 3: 검증** — tsc·lint 그린 (렌더 실측은 Task 10 스모크).
- [ ] **Step 4: Commit** — `feat(io-linking): io import modal — 불러오기 선택 모달`

---

### Task 9: page.tsx·카드 배선 — 하이라이트·불러오기·전파·정합화·네비게이션 + SP 지정 id

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/components/node-details-card.tsx`
- Modify: `frontend/src/components/node-details-fields.tsx`
- Modify: `frontend/src/components/permissions/subprocess-designation-modal.tsx`
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 3-8 전부. page.tsx 기존 부품: `highlightNode`(:2105 — 선택+fitView), `hoveredEdgeId` 패턴(:6242), `styledEdges` memo(:6176), `updateSelectedData`(:4706), `subprocessRefs` memo(:1388), NodeDetailsCard 마운트(:9166).
- Produces: 최종 사용자 플로우 전체.

- [ ] **Step 1: i18n 키** — `io.unlinkConfirm` "Disconnect from origin? The item stays as an editable copy."/"원본과 연결을 해제할까요? 항목은 수정 가능한 복사본으로 남습니다" · `io.unlinkAction` "Disconnect"/"해제" · `io.importSaveFirst` "Save this card first"/"카드를 먼저 저장하세요" · 토스트 4종: `io.importedMirror` "Linked to origin"/"원본에 연결됨" · `io.importedTakeover` "Ownership moved to this output"/"소유권이 이 아웃풋으로 이동" · `io.importedSuccession` "Edit point moved to this output"/"편집점이 이 아웃풋으로 이동" · `io.importedJoin` "Joined the existing group"/"기존 그룹에 합류".

- [ ] **Step 2: `NodeDetailsPatch`·카드 draft 확장** — `node-details-fields.tsx` `NodeDetailsPatch`에 `output_ids?/input_links?/output_links?/input_flags?: string` 추가. `node-details-card.tsx` `DETAIL_FIELDS`에 4필드 추가(`COUNT_FIELDS`는 불변), `values` prop 타입은 `Record<DetailField, string>`이라 자동 — page.tsx 마운트부(:9170)의 values 객체에 4필드 추가 (`selectedNode.data.output_ids ?? ""` 등).

- [ ] **Step 3: NodeDetailsFields → MultiValueInput 스레딩** — `NodeDetailsFieldsProps`에 추가:
  ```ts
  outputIds?: string; inputLinks?: string; outputLinks?: string; inputFlags?: string;
  io?: {
    originGroupIndexes: ReadonlySet<number>;          // output 원본 행
    inputLinkedIndexes?: undefined;                    // (불필요 — linksValue로 판정)
    onImport: (side: IoSide, at: { x: number; y: number }) => void;
    importDisabledReason?: string;
    onUnlink: (side: IoSide, index: number, at: { x: number; y: number }) => void;
    onNavigate: (side: IoSide, index: number) => void;
    onHoverItem: (side: IoSide, index: number | null) => void;
  };
  ```
  input MVI에는 `linksValue={inputLinks} flagsValue={inputFlags}`, output MVI에는 `idsValue={outputIds} linksValue={outputLinks} originGroupIndexes={io?.originGroupIndexes}`를 전달하고, `onCommit`에서 extras를 패치로 병합: input → `{ input, input_forms, input_links: extras.links, input_flags: extras.flags }`, output → `{ output, output_forms, output_ids: extras.ids, output_links: extras.links }`. `io`가 없으면(다른 호출 표면) 기존 동작 그대로.

- [ ] **Step 4: NodeDetailsCard — 해제 팝오버(draft 수준)·불러오기 게이트** —
  - 카드 로컬 state `unlinkAsk: { side: IoSide; index: number; at: {x,y} } | null`. MVI `onUnlink` → set. 팝오버는 카드가 직접 portal 렌더(EdgeSelectModal 크롬 축소판): `clampToViewport(at.x, at.y, 256, 96)`, 문구 `io.unlinkConfirm`, 버튼 `io.unlinkAction`(accent)/`common.cancel`. 확인 시 `mergePatch({ [side === "input" ? "input_links" : "output_links"]: setIoLine(shown(...), index, "") })` — **draft에만 반영, Save 전 취소 가능(스펙 §4-3)**. data-id `io-unlink-popover`/`io-unlink-confirm`/`io-unlink-cancel`.
  - `dirty`면 MVI에 `importDisabledReason={t("io.importSaveFirst")}` 전달 — draft와 즉시 커밋되는 불러오기의 충돌 차단.
  - SP 읽기전용 브랜치(:129-156)의 IO 행에도: 항목 id가 그룹을 가지면(`props.io?.spLinkedIndexes` — page가 spin/spout별 Set 전달) `Link2` 아이콘 + hover → `onHoverItem`. props에 `spLinkedInputIndexes?: ReadonlySet<number>; spLinkedOutputIndexes?: ReadonlySet<number>` 추가.

- [ ] **Step 5: page.tsx 배선** —
  1. **상태**: `hoveredEdgeId` 옆(:947)에
     ```ts
     const [ioHighlight, setIoHighlight] = useState<{ nodeIds: string[]; edgeIds: string[] } | null>(null);
     const [ioImport, setIoImport] = useState<{ side: IoSide; nodeId: string; at: { x: number; y: number } } | null>(null);
     ```
  2. **styledEdges**(:6205 근처): `hoveredEdgeId` 처리와 같은 위치에
     ```ts
     if (ioHighlightEdgeIds?.has(edge.id)) { next = { ...next, className: [next.className, "edge-hover-highlight"].filter(Boolean).join(" ") }; }
     ```
     memo 위에서 `const ioHighlightEdgeIds = ioHighlight ? new Set(ioHighlight.edgeIds) : null;` 파생, deps에 `ioHighlight` 추가 (React Compiler deps 정합 주의).
  3. **노드 하이라이트**: `<ReactFlow nodes={...}>`에 공급되는 memo(`grep -n "nodes={" "frontend/src/app/maps/[mapId]/page.tsx"`로 특정)에서 `ioHighlight?.nodeIds` 포함 노드에 `className: "io-node-highlight"` 병합(기존 className 보존). `globals.css`의 `.edge-hover-highlight`(:378) 근처에:
     ```css
     /* IO 링크 호버 — 상대 노드 링 강조 (io-linking §4) */
     .react-flow__node.io-node-highlight { outline: 2px solid var(--color-accent); outline-offset: 3px; border-radius: 8px; }
     ```
  4. **로드 정합화**: `rootGraph` 로드 후 `setNodes(toAppNodes(graph))`하는 지점(들)을 `grep -n "toAppNodes(" page.tsx`로 특정하고, 에디터 초기 로드 경로에서
     ```ts
     const loaded = toAppNodes(graph);
     const spMap = new Map(Object.entries(graph.subprocess_refs ?? {}).map(([k, v]) => [Number(k), v]));
     const { nodes: reconciled, changed } = propagateIoLinks(loaded, spMap);
     setNodes(reconciled);
     if (changed && !readOnly) scheduleAutoSave();   // 치유분은 다음 PUT에 동승 (스펙 §5)
     ```
     비교/읽기 전용 뷰 경로는 건드리지 않는다(치유는 메모리만 — setNodes 전 propagate만 적용하고 save 안 함).
  5. **원본 수정 전파**: `updateSelectedData`(:4706)에서 patch 키에 IO 필드(`input|output|input_forms|output_forms|output_ids|input_links|output_links`)가 하나라도 있으면, setNodes updater 말미에 `propagateIoLinks(mapped, subprocessRefsRef.current).nodes`를 반환. `subprocessRefsRef`는 `nodesRef` 패턴(:2107 참조)과 동일하게 `subprocessRefs` memo를 미러하는 ref로 신설. deps 배열 정합 필수.
  6. **불러오기 실행**: NodeDetailsCard 마운트(:9166)에 `io` prop 전달 —
     - `onImport: (side, at) => setIoImport({ side, nodeId: selectedNode.id, at })`
     - `onHoverItem`: `getIoLinkPeers(nodes, subprocessRefs, nodeId, side, index)` → origin+mirrors의 nodeId 집합과, 각 상대에 대해 `getFlowPathBetween` 양방향 중 비어있지 않은 쪽 엣지 합집합으로 `setIoHighlight({...})`; index null이면 `setIoHighlight(null)`.
     - `onNavigate`: peers.origin 있으면 `highlightNode(peers.origin.nodeId)`.
     - `originGroupIndexes`: `buildIoMirrorIndex(nodes)` 기반 — 선택 노드 output_ids 줄 중 미러가 1개 이상인 인덱스 Set (`useMemo`).
     - SP 카드용 `spLinked*Indexes`: 선택 SP 노드 ref의 `input_ids`/`output_ids` 줄 중 미러 보유 인덱스 Set.
  7. **모달 렌더**: EdgeSelectModal 렌더부(:10202) 옆에
     ```tsx
     {ioImport && (
       <IoImportModal
         side={ioImport.side}
         position={ioImport.at}
         candidates={collectIoImportCandidates({ nodes, edges, spRefs: subprocessRefs, nodeId: ioImport.nodeId, side: ioImport.side })}
         onHoverCandidate={(c) => setIoHighlight(c ? { nodeIds: [c.nodeId], edgeIds: c.pathEdgeIds } : null)}
         onPick={(c) => {
           const result = applyIoImport({ nodes: nodesRef.current, edges, spRefs: subprocessRefs, nodeId: ioImport.nodeId, side: ioImport.side, candidate: c });
           setIoImport(null);
           setIoHighlight(null);
           if (!result) return;
           recordChange(false);
           setNodes(result.nodes);
           scheduleAutoSave();
           showToast(t(IMPORT_TOAST_KEY[result.action]));
         }}
         onClose={() => { setIoImport(null); setIoHighlight(null); }}
       />
     )}
     ```
     `IMPORT_TOAST_KEY = { mirror: "io.importedMirror", takeover: "io.importedTakeover", succession: "io.importedSuccession", join: "io.importedJoin" } as const` (컴포넌트 밖 상수). 후보 계산은 모달 열림 시에만 — 렌더 표현식 그대로면 충분(모달 없으면 미실행).
  8. **읽기전용**: `readOnly`면 카드가 원래 편집 UI를 안 그리므로 추가 게이트 불필요 — 읽기 브랜치의 아이콘·호버만 동작.
- [ ] **Step 6: SP 지정 모달 id 부여** — `subprocess-designation-modal.tsx` 저장 핸들러(페이로드 구성부를 `grep -n "input_forms" frontend/src/components/permissions/subprocess-designation-modal.tsx`로 특정)에서:
  ```ts
  input_ids: assignSpIoIds(payload.input, existing?.input ?? "", existing?.input_ids ?? ""),
  output_ids: assignSpIoIds(payload.output, existing?.output ?? "", existing?.output_ids ?? ""),
  ```
  (`existing`은 모달이 이미 받는 현행 지정값 prop — 실제 prop 이름에 맞출 것.)
- [ ] **Step 7: 검증** — `npx tsc --noEmit` · `npm run lint` · `npx vitest run` · `npm run build` 전부 그린. 수동 확인: `npm run dev` + 백엔드 기동 후 브라우저에서 ①+ 버튼 호버 공개·메뉴 ②불러오기(미러 생성)·행 호버 하이라이트 ③원본 수정→미러 반영 ④해제 팝오버→Save 전 취소 ⑤미러 클릭 네비게이션. 실행한 명령과 관찰 결과를 보고에 명시(실측 없이 "verified" 금지).
- [ ] **Step 8: Commit** — `feat(io-linking): editor wiring — highlight, import, propagation, unlink, sp ids — 에디터 배선(하이라이트·불러오기·전파·해제·SP id)`

---

### Task 10: Playwright 스모크 + 전체 게이트

**Files:**
- Create: `frontend/pw-smoke-io-links.mjs` (기존 `pw-smoke-*.mjs` 위치·구조 확인: `ls frontend/pw-smoke*.mjs`; 없으면 저장소 루트에서 `ls **/pw-smoke*` — 기존 파일과 같은 디렉터리·헤더 관례를 따른다. 참고 모델: pw-smoke-edge-style)
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 7-9의 data-id들 (`inspector-detail-input-add`, `inspector-detail-input-add-import`, `io-import-row-*`, `inspector-detail-input-link-0`, `io-unlink-popover` 등).

- [ ] **Step 1: 스모크 작성** — 기존 스모크의 부트스트랩(시스템 Chrome + dev 서버 + admin.sys 로그인 + 시드/teardown try/finally — dev.db 잔류 금지 선례)을 재사용. 시나리오:
  1. 테스트 맵 생성, 노드 A(output "회의록")→B 엣지 연결, B 선택.
  2. Details 카드 input 섹션 호버 → + 버튼 표시 확인 → 클릭 → 메뉴에서 Import → 모달 행에 A의 "회의록" 노출 → 행 호버 시 `.edge-hover-highlight` 엣지와 `.io-node-highlight` 노드 존재 확인 → 클릭.
  3. B input에 미러 행(readOnly input + link 아이콘) 확인, 저장 대기 후 리로드해도 유지.
  4. A output 텍스트를 "회의록 v2"로 수정·카드 Save → B input 텍스트 동기화 확인.
  5. B 미러의 link 아이콘 클릭 → 팝오버 → Disconnect → 행이 편집 가능으로 전환(텍스트 유지) → 카드 Save 없이 노드 재선택 시 원복(draft 취소) 확인 → 다시 해제+Save 시 영속 확인.
  6. teardown: 생성 맵 삭제, dev.db 잔류 0 확인.
- [ ] **Step 2: 스모크 실행** — 백엔드(`.venv/bin/uvicorn app.main:app --port 8000`)+프론트(`npm run dev`) 기동 후 `node pw-smoke-io-links.mjs` 전 시나리오 PASS. 3000 포트 좀비 프론트 주의(전수 pkill 후 재기동 — lessons/browser-verification.md).
- [ ] **Step 3: 전체 게이트** — BE: pytest 전체(env 3종 세팅)+ruff / FE: vitest 전체·tsc·lint·build 전부 그린. 결과 수치를 보고에 기록.
- [ ] **Step 4: Commit** — `test(io-linking): e2e smoke for io linking — IO 링크 스모크 + 게이트 그린` (PROGRESS에 브랜치 마무리 1줄 포함).

---

## Self-Review 결과 (플랜 작성 시점)

- 스펙 §1-①~⑨ ↔ Task 7(①·⑧·⑨ UI)·8(②)·4(③·④)·5(⑤ 소유권)·9(⑤ 네비·⑥·전파)·3(⑦ SP 인덱스) 매핑 확인. §3 컬럼 6개 = Task 1, 저장 경로 표 = Task 1·2, §5 = Task 6·9, §6 노드 복사 = Task 2, 스모크 = Task 10.
- 타입 일관성: `IoNode/IoSide/IoImportCandidate/applyIoImport/propagateIoLinks/getIoLinkPeers/assignSpIoIds` 시그니처를 Interfaces 블록 간 대조 완료.
- 알려진 열린 지점(실행 중 확인): ①`<ReactFlow nodes=...>` memo의 정확한 이름(Task 9 Step 5-3에서 grep으로 특정) ②SP 지정 모달의 기존값 prop 이름(Step 6) ③pw-smoke 파일 위치(Task 10). 각 단계에 특정 방법을 명시했다.
