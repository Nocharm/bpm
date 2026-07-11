# AI graph 병합 통합 + 담당자/부서 기본 금지 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI graph(전체 재생성) 제안을 CSV 임포트의 "제목 매칭 id 재사용 + 캔버스 diff + Import 탭 승인" 파이프라인으로 통합하고, AI의 담당자/부서 자동 지정을 기본 금지한다.

**Architecture:** csv-import.ts의 병합 코어(pick/mergeNode/매칭/부분 배치)를 모듈 스코프로 추출해 CSV·AI 공용화하고 AI 진입점 `buildGraphFromAiProposal`을 추가한다(반환 타입은 기존 `CsvImportOutcome` 그대로 — Import 탭이 무수정 소비). page.tsx는 graph 제안을 기존 CSV 프리뷰 상태 슬롯(previewSource="csv")에 태워 상호배타·자동저장 억제·탭 잠금을 전부 재사용하고, `importOrigin` 상태로 라벨만 구분한다. 백엔드는 프롬프트에서 조직 디렉터리를 제거하고 "명시 요청 시에만" 규칙으로 교체한다.

**Tech Stack:** Next.js/React(React Compiler lint), FastAPI, vitest, pytest, playwright-core+시스템 Chrome

**Spec:** `docs/superpowers/specs/2026-07-11-ai-graph-merge-design.md`

## Global Constraints

- 브랜치: 워크트리 `ai-graph-merge` (EnterWorktree, origin/main 기준).
- **`[mapId]` 브래킷 경로는 시스템 grep(ugrep)이 조용히 건너뜀 — 검색은 반드시 `git grep`.**
- React Compiler lint: effect 내 동기 setState 금지, `useCallback` 수동 deps 불일치 금지.
- **previewSource "ai"|"csv" 단일 슬롯 상호배타 유지** — aa87766이 AI/CSV 프리뷰 중첩 자동저장 버그를 고친 경계. graph 제안은 "csv" 슬롯을 재사용(원산지는 별도 `importOrigin`), ops는 "ai" 슬롯 유지.
- `aiPreviewActive` prop 계약은 **ops 전용으로 잔존** — 파기 금지.
- CSV 임포트 기존 동작 무변경 — 기존 csv-import.test.ts 스위트가 무수정 통과해야 함.
- UI 텍스트 영어(i18n EN/KO 양쪽 등록), raw hex 금지(토큰만), 신규 구조 요소 data-id.
- 커밋 직전 `PROGRESS.md`의 `## 2026-07-11 — AI graph 제안 CSV 병합 통합 + 담당자/부서 기본 금지 설계 (main)` 섹션에 한 줄 추가(코드와 같은 커밋).
- 커밋 메시지 `type(scope): English summary — 한국어 요약` + 트레일러 2줄(Co-Authored-By: Claude Fable 5 / Claude-Session 링크).
- 게이트: backend `.venv/bin/python -m pytest tests/ -q` + `.venv/bin/ruff check app/ tests/`, frontend `npx vitest run` + `node_modules/.bin/tsc --noEmit -p tsconfig.json` + `npm run lint` + `npm run build` (**tsc 필수 — vitest·next build는 테스트 파일 타입 에러를 못 잡는다**).

---

### Task 1: 백엔드 — 디렉터리 제거 + "명시 요청 시에만" 규칙 (TDD)

**Files:**
- Modify: `backend/app/ai_prompt.py`
- Modify: `backend/app/routers/ai.py`
- Test: `backend/tests/test_ai.py`

**Interfaces:**
- Consumes: 현행 `build_system_prompt(manual, current_graph, can_edit, directory=None)` / `build_messages(..., directory=None)` (ai_prompt.py:224-266), `_load_directory`(ai.py:98-108).
- Produces: `build_system_prompt(manual, current_graph, can_edit)` / `build_messages(manual, current_graph, can_edit, instruction, history)` — **directory 파라미터 제거**. 이후 태스크는 백엔드 API 형태 변화 없음(AiChatRequest/AiProposal 무변경).

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ai.py`에서 `test_build_system_prompt_includes_directory`(:515-525 부근, "조직 디렉터리"·"김철수 | 구매팀" in system 단언)를 다음으로 **교체**:

```python
def test_build_system_prompt_has_no_directory_and_explicit_only_rule() -> None:
    # 디렉터리 주입 폐기 — 담당자/부서는 사용자 지시가 명시적으로 요구할 때만 (design 2026-07-11)
    from app.ai_prompt import build_system_prompt
    from app.schemas import GraphOut

    system = build_system_prompt("M", GraphOut(nodes=[], edges=[], groups=[]), True)
    assert "조직 디렉터리" not in system
    assert "명시적으로 요구" in system  # 규칙 ② 교체 확인
```

구조 힌트 테스트(:722-723 부근)의 `assert "담당자 미입력" in hints` 류를 다음으로 교체(같은 테스트 함수 내):

```python
    assert not any("담당자 미입력" in hint for hint in hints)
    assert not any("부서 미입력" in hint for hint in hints)
    assert any("소요시간 미입력" in hint for hint in hints)
```

(`hints`가 문자열이면 `in` 그대로 — 기존 테스트의 자료형을 따를 것. :690-730 부근을 읽고 기존 단언 형태에 맞춰라.)

또한 `build_system_prompt`/`build_messages`를 directory 인자와 함께 부르는 다른 테스트가 있으면(`git grep -n "build_system_prompt\|build_messages" backend/tests/`) 인자를 제거해 시그니처에 맞춘다. `:317`(graph attributes assignee 관통)·`:422`(`담당=김철수` 직렬화 노출)·`:442-457`(ops set_attr assignee)은 **유지** — 명시 요청 경로와 기존값 노출은 계속 유효하다.

- [ ] **Step 2: 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ai.py -q`
Expected: FAIL — "조직 디렉터리"가 여전히 시스템 프롬프트에 있고(TypeError 아님 — directory는 기본값 있는 파라미터), "명시적으로 요구" 부재, 힌트 단언 불일치.

- [ ] **Step 3: 구현**

**(a)** `backend/app/ai_prompt.py`:

- `_INSTRUCTIONS` 규칙 ②(:51) 교체:

```
2. 담당자/부서(attributes의 assignee/department)는 사용자 지시가 명시적으로 요구할 때만 설정하세요. 그 외에는 빈 문자열로 두세요(지어내지 말 것) — 빈 값은 기존 노드의 값을 유지합니다.
```

- graph 예시 꼬리(:20) `(각 노드 담당자 매칭)` 문구 삭제: `예) "구매 발주 프로세스 그려줘" → start "발주 요청" → process "견적 검토" → end.`
- set_attr 예시(:30) `{"action":"set_attr","node_id":<기존id>,"attributes":{"assignee":"홍길동"}}` → `{"action":"set_attr","node_id":<기존id>,"attributes":{"duration":"2일"}}`.
- `_structure_hints`의 BPM 속성 누락 루프(:205) `(("담당자", "assignee"), ("부서", "department"), ("소요시간", "duration"))` → `(("소요시간", "duration"),)` (루프 구조 유지, 주석의 "담당자·부서" 언급도 갱신).
- `build_system_prompt`(:224-246): `directory` 파라미터·`dir_block`(:235)·`[조직 디렉터리 — 담당자/부서는 여기서 매칭]` 블록(:242) 제거.
- `build_messages`(:249-266): `directory` 파라미터 제거.
- `_serialize_node`의 `담당=`/`부서=` 노출(:61-64)은 **수정하지 않는다**.

**(b)** `backend/app/routers/ai.py`:

- `_DIRECTORY_LIMIT`(:70)과 `_load_directory`(:96-106) 삭제.
- 핸들러의 `directory = await _load_directory(session)`(:171)과 `build_messages(..., directory)` 인자 제거 → `build_messages(manual_text, current, can_edit, payload.instruction, payload.history)`.
- import 정리: `Employee`가 `_load_directory` 전용이었으면 `from app.models import ...`에서 제거(`git grep -n "Employee" backend/app/routers/ai.py`로 확인).

- [ ] **Step 4: 전체 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전체 PASS + ruff 클린.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/ai_prompt.py backend/app/routers/ai.py backend/tests/test_ai.py PROGRESS.md
git commit -m "feat(ai): assignee/department only on explicit request — 디렉터리 프롬프트 제거·명시 요청 시에만 담당자/부서"
```

(PROGRESS 한 줄: `- 백엔드: 조직 디렉터리 프롬프트 제거, 담당자/부서는 명시 요청 시에만(규칙②)·미입력 힌트 축소(소요시간만).`)

---

### Task 2: 프론트 lib — buildGraphFromAiProposal 병합 진입점 (TDD)

**Files:**
- Modify: `frontend/src/lib/csv-import.ts`
- Test: `frontend/src/lib/csv-import.test.ts`

**Interfaces:**
- Consumes: 기존 병합 코어(`buildGraphFromCsv` 내부의 `pick`/`mergeNode`/매칭 로직 :376-435, `layoutAddedOnly`:223, `layoutEverything`:215, `NODE_DEFAULTS`:141), `AiNode`/`AiEdge`/`AiGroup` 타입(`@/lib/api` :1349-1372), `genId`.
- Produces: `export function buildGraphFromAiProposal(proposal: AiGraphProposalInput, context?: CsvImportContext): CsvImportOutcome` 및 `export interface AiGraphProposalInput { nodes: AiNode[]; edges: AiEdge[]; groups: AiGroup[] }`. 반환은 기존 `CsvImportOutcome` — Task 3의 page.tsx와 Import 탭이 그대로 소비.

- [ ] **Step 1: 병합 코어 모듈 스코프 추출 (동작 무변경 리팩터)**

`buildGraphFromCsv` 내부의 다음 두 정의를 **모듈 스코프로 이동**(코드 그대로, buildGraphFromCsv는 이동된 것을 참조):

```ts
// 빈 값은 "건드리지 않음" — 제안/CSV가 모르는 속성이 기존 값을 지우지 않게 (CSV·AI 병합 공용)
const pick = (next: string, existing: string): string => (next === "" ? existing : next);

// 매칭 노드: id·좌표·색·그룹·서브프로세스 링크 보존.
// 서브프로세스 노드는 node_type도 보존 — 추론/제안값으로 덮으면 Call Activity 렌더가 깨진다.
const mergeNode = (existing: GraphNode | null, next: GraphNode): GraphNode =>
  existing === null
    ? next
    : {
        ...existing,
        title: next.title,
        node_type: existing.linked_map_id !== null ? existing.node_type : next.node_type,
        description: pick(next.description, existing.description),
        assignee: pick(next.assignee, existing.assignee),
        department: pick(next.department, existing.department),
        system: pick(next.system, existing.system),
        duration: pick(next.duration, existing.duration),
        url: pick(next.url ?? "", existing.url ?? ""),
        url_label: pick(next.url_label ?? "", existing.url_label ?? ""),
        sort_order: next.sort_order,
      };
```

Run: `cd frontend && npx vitest run src/lib/csv-import.test.ts`
Expected: 기존 스위트 전부 PASS (리팩터 무회귀 증명).

- [ ] **Step 2: 실패하는 테스트 작성**

`frontend/src/lib/csv-import.test.ts` 끝에 추가 (파일 상단 import에 `buildGraphFromAiProposal` 추가; 기존 테스트의 픽스처 헬퍼가 있으면 재사용하되 없으면 아래 로컬 헬퍼 사용):

```ts
describe("buildGraphFromAiProposal (2026-07-11 AI graph merge)", () => {
  const aiNode = (key: string, title: string, node_type = "process", attributes: Partial<NonNullable<AiNode["attributes"]>> | null = null): AiNode => ({
    key, title, node_type, description: "",
    attributes: attributes ? { assignee: null, department: null, system: null, duration: null, color: null, url: null, url_label: null, ...attributes } : null,
    group_key: null,
  });
  const baseNode = (id: string, title: string, over: Partial<GraphNode> = {}): GraphNode => ({
    id, title, description: "", node_type: "process", color: "#6a9985", assignee: "홍길동", department: "구매팀",
    system: "", duration: "", url: "", url_label: "", pos_x: 300, pos_y: 200, sort_order: 1,
    group_ids: ["g1"], linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
    ...over,
  });
  const base = (nodes: GraphNode[], edges: GraphEdge[] = []): Graph => ({
    nodes, edges, groups: [{ id: "g1", parent_group_id: null, label: "Lane", color: "" }],
  });

  it("reuses matched node id and preserves coords/color/group/assignee", () => {
    const existing = baseNode("n1", "견적 검토");
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "견적 검토")], edges: [], groups: [] },
      { base: base([existing]) },
    );
    const merged = outcome.graph?.nodes.find((n) => n.title === "견적 검토");
    expect(merged?.id).toBe("n1");
    expect(merged?.pos_x).toBe(300);
    expect(merged?.color).toBe("#6a9985");
    expect(merged?.group_ids).toEqual(["g1"]);
    expect(merged?.assignee).toBe("홍길동"); // AI가 비우면 기존 유지
    expect(outcome.merge.matchedCount).toBeGreaterThanOrEqual(1);
  });

  it("preserves subprocess node_type/link/color on title match", () => {
    const sub = baseNode("s1", "발주 하위", { node_type: "subprocess", linked_map_id: 7, color: "" });
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "발주 하위", "process", { color: "#aa0000" })], edges: [], groups: [] },
      { base: base([sub]) },
    );
    const merged = outcome.graph?.nodes.find((n) => n.id === "s1");
    expect(merged?.node_type).toBe("subprocess");
    expect(merged?.linked_map_id).toBe(7);
    expect(merged?.color).toBe(""); // 매칭 노드 색은 기존 유지(AI 색 무시)
  });

  it("sets assignee when AI provides one explicitly", () => {
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "견적 검토", "process", { assignee: "김담당" })], edges: [], groups: [] },
      { base: base([baseNode("n1", "견적 검토")]) },
    );
    expect(outcome.graph?.nodes.find((n) => n.id === "n1")?.assignee).toBe("김담당");
  });

  it("lists unmatched base nodes as removed and lost edges", () => {
    const a = baseNode("n1", "유지됨");
    const b = baseNode("n2", "사라짐", { sort_order: 2 });
    const edge: GraphEdge = { id: "e1", source_node_id: "n1", target_node_id: "n2", label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null };
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "유지됨")], edges: [], groups: [] },
      { base: base([a, b], [edge]) },
    );
    expect(outcome.merge.removedNodes.map((n) => n.id)).toEqual(["n2"]);
    expect(outcome.merge.lostEdges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("remaps AI edges to reused ids and ignores AI groups when base is non-empty", () => {
    const outcome = buildGraphFromAiProposal(
      {
        nodes: [aiNode("a", "견적 검토"), aiNode("b", "신규 승인")],
        edges: [{ source: "a", target: "b", label: "ok" }],
        groups: [{ key: "gx", label: "AI lane", color: "", parent_key: null }],
      },
      { base: base([baseNode("n1", "견적 검토")]) },
    );
    const added = outcome.graph?.nodes.find((n) => n.title === "신규 승인");
    expect(outcome.graph?.edges).toEqual([
      expect.objectContaining({ source_node_id: "n1", target_node_id: added?.id, label: "ok" }),
    ]);
    expect(outcome.graph?.groups.map((g) => g.id)).toEqual(["g1"]); // 기존 그룹 유지, AI 그룹 무시
    expect(added?.group_ids).toEqual([]);
  });

  it("matches start/end by type and keeps their titles", () => {
    const start = baseNode("st", "시작", { node_type: "start", sort_order: 0 });
    const end = baseNode("en", "완료", { node_type: "end", is_primary_end: true, sort_order: 9 });
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("s", "Start", "start"), aiNode("e", "End", "end")], edges: [], groups: [] },
      { base: base([start, end]) },
    );
    const ids = outcome.graph?.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["en", "st"]);
    expect(outcome.merge.addedNodeIds).toEqual([]);
  });

  it("creates AI groups and full layout on empty base", () => {
    const node = { ...aiNode("a", "단독"), group_key: "gx" };
    const outcome = buildGraphFromAiProposal(
      { nodes: [node], edges: [], groups: [{ key: "gx", label: "AI lane", color: "", parent_key: null }] },
      { base: { nodes: [], edges: [], groups: [] } },
    );
    expect(outcome.graph?.groups).toHaveLength(1);
    expect(outcome.graph?.nodes[0]?.group_ids).toEqual([outcome.graph?.groups[0]?.id]);
  });

  it("fails on empty proposal", () => {
    const outcome = buildGraphFromAiProposal({ nodes: [], edges: [], groups: [] }, {});
    expect(outcome.graph).toBeNull();
    expect(outcome.errors).toHaveLength(1);
  });
});
```

(테스트 파일 import에 `type AiNode`, `type Graph`, `type GraphEdge`, `type GraphNode` 필요분 추가 — 기존 import 스타일을 따를 것. 타입 주석을 명시해 리터럴 widening TS 에러를 만들지 말 것.)

- [ ] **Step 3: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/csv-import.test.ts`
Expected: FAIL — `buildGraphFromAiProposal` export 부재.

- [ ] **Step 4: 구현**

`frontend/src/lib/csv-import.ts` — 상단 import에 `type AiEdge, type AiGroup, type AiNode`를 `./api`에서 추가, 파일 끝(또는 buildGraphFromCsv 아래)에 추가:

```ts
/** AI graph 제안 입력 — AiProposal의 병합에 필요한 서브셋. */
export interface AiGraphProposalInput {
  nodes: AiNode[];
  edges: AiEdge[];
  groups: AiGroup[];
}

/**
 * AI graph 제안 → base와 제목 매칭 병합 (CSV 임포트와 같은 규칙·같은 Outcome).
 * 매칭 노드는 id·좌표·색·그룹·서브프로세스 링크 보존, AI가 비운 속성은 기존값 유지(pick).
 * base가 비어있지 않으면 AI groups 무시(기존 그룹 유지) — 병합 모드의 의도는 기존 맵 다듬기.
 */
export function buildGraphFromAiProposal(
  proposal: AiGraphProposalInput,
  context?: CsvImportContext,
): CsvImportOutcome {
  const emptyMerge = (): CsvMergeInfo => ({ addedNodeIds: [], removedNodes: [], lostEdges: [], matchedCount: 0 });
  if (proposal.nodes.length === 0) {
    return {
      graph: null, nodeCount: 0, edgeCount: 0,
      errors: [{ line: 0, message: "AI proposal has no nodes" }],
      warnings: [], ignoredLabelCount: 0, merge: emptyMerge(),
    };
  }

  const baseNodes = context?.base?.nodes ?? [];
  const isMerge = baseNodes.length > 0;

  // start/end는 타입 우선 매칭 (CSV와 동일 규칙 — validate_process 기본 지정과 정합)
  const baseStart = baseNodes.find((node) => node.node_type === "start") ?? null;
  const baseEnds = baseNodes.filter((node) => node.node_type === "end");
  const baseEnd =
    baseEnds.find((node) => node.is_primary_end) ??
    [...baseEnds].sort((a, b) => a.sort_order - b.sort_order)[0] ??
    null;
  const reservedIds = new Set([baseStart?.id, baseEnd?.id].filter((id): id is string => id !== undefined));
  const byTitle = new Map<string, GraphNode>();
  for (const node of [...baseNodes].sort((a, b) => a.sort_order - b.sort_order)) {
    if (reservedIds.has(node.id)) continue;
    if (!byTitle.has(node.title)) byTitle.set(node.title, node);
  }

  // 빈 캔버스 전용 — AI 그룹 생성(임시키 → 실제 id)
  const groupKeyToId = new Map<string, string>();
  const aiGroups: Graph["groups"] = isMerge
    ? []
    : proposal.groups.map((group) => {
        const id = genId();
        groupKeyToId.set(group.key, id);
        return { id, parent_group_id: null, label: group.label, color: group.color };
      });
  if (!isMerge) {
    // parent_key는 1차 생성 후 해석 (같은 응답 내 참조)
    proposal.groups.forEach((group, index) => {
      aiGroups[index].parent_group_id = group.parent_key
        ? groupKeyToId.get(group.parent_key) ?? null
        : null;
    });
  }

  const matchedIds = new Set<string>();
  const addedNodeIds: string[] = [];
  const keyToId = new Map<string, string>(); // AI 임시키 → 최종 id (edges 재매핑용)
  const byId = new Map(baseNodes.map((node) => [node.id, node]));
  let startUsed = false;
  let endUsed = false;
  const resolveId = (node: AiNode): string => {
    if (node.node_type === "start" && baseStart && !startUsed) {
      startUsed = true;
      matchedIds.add(baseStart.id);
      return baseStart.id;
    }
    if (node.node_type === "end" && baseEnd && !endUsed) {
      endUsed = true;
      matchedIds.add(baseEnd.id);
      return baseEnd.id;
    }
    const existing = byTitle.get(node.title);
    if (existing && !matchedIds.has(existing.id)) {
      matchedIds.add(existing.id);
      return existing.id;
    }
    const id = genId();
    addedNodeIds.push(id);
    return id;
  };

  const nodes: GraphNode[] = proposal.nodes.map((node, index) => {
    const id = resolveId(node);
    keyToId.set(node.key, id);
    const attr = node.attributes;
    const existing = byId.get(id) ?? null;
    const groupId = !isMerge && node.group_key ? groupKeyToId.get(node.group_key) : undefined;
    const candidate: GraphNode = {
      ...NODE_DEFAULTS,
      id,
      // start/end 타입 매칭은 기존 제목 유지 — "시작"을 "Start"로 덮으면 거짓 변경 (CSV와 동일)
      title:
        existing && (node.node_type === "start" || node.node_type === "end")
          ? existing.title
          : node.title,
      node_type: node.node_type,
      description: node.description,
      assignee: attr?.assignee ?? "",
      department: attr?.department ?? "",
      system: attr?.system ?? "",
      duration: attr?.duration ?? "",
      url: attr?.url ?? "",
      url_label: attr?.url_label ?? "",
      color: attr?.color ?? "",
      group_ids: groupId ? [groupId] : [],
      sort_order: index,
    };
    const merged = mergeNode(existing, candidate);
    // 신규 노드는 AI 색 허용, 매칭 노드는 mergeNode({...existing})가 기존 색 유지
    return merged;
  });

  // 대표 끝 보장 — 백엔드 validate_process(대표 끝 1개)와 정합. 매칭 end는 기존 플래그를 이미 보존.
  const ends = nodes.filter((node) => node.node_type === "end");
  if (ends.length > 0 && !ends.some((node) => node.is_primary_end)) {
    ends[0].is_primary_end = true;
  }

  const edges: GraphEdge[] = proposal.edges
    .map((edge) => {
      const source = keyToId.get(edge.source);
      const target = keyToId.get(edge.target);
      if (!source || !target) return null;
      return {
        id: genId(),
        source_node_id: source,
        target_node_id: target,
        label: edge.label,
        source_side: "right",
        target_side: "left",
        source_handle: null,
        target_handle: null,
      };
    })
    .filter((edge): edge is GraphEdge => edge !== null);

  const positioned = isMerge
    ? layoutAddedOnly(nodes, edges, new Set(addedNodeIds), baseNodes)
    : layoutEverything(nodes, edges);

  const removedNodes = baseNodes.filter((node) => !matchedIds.has(node.id));
  const keptEdgeKeys = new Set(edges.map((e) => `${e.source_node_id}→${e.target_node_id}`));
  const lostEdges = (context?.base?.edges ?? []).filter(
    (e) => !keptEdgeKeys.has(`${e.source_node_id}→${e.target_node_id}`),
  );

  return {
    graph: { nodes: positioned, edges, groups: isMerge ? context?.base?.groups ?? [] : aiGroups },
    nodeCount: positioned.length,
    edgeCount: edges.length,
    errors: [],
    warnings: [],
    ignoredLabelCount: 0,
    merge: { addedNodeIds, removedNodes, lostEdges, matchedCount: matchedIds.size },
  };
}
```

**구현 노트:** AI graph 스키마는 `_check_graph_integrity`(백엔드)가 엣지의 키 참조 무결성을 이미 보장하므로 `keyToId.get`의 null 분기는 방어용이다. 위 코드는 완결형 — 그대로 옮기되 lint가 지적하는 미사용 변수만 정리.

- [ ] **Step 5: 통과 확인 (신규 + 기존 CSV 스위트)**

Run: `cd frontend && npx vitest run src/lib/csv-import.test.ts && npx vitest run && node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: 전부 PASS, tsc 0 errors.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/lib/csv-import.ts frontend/src/lib/csv-import.test.ts PROGRESS.md
git commit -m "feat(csv-import): AI graph proposal merge entry — AI 제안 병합 진입점(제목 매칭 id 재사용)"
```

(PROGRESS 한 줄: `- 병합 공용화: pick/mergeNode 모듈 추출(무변경) + buildGraphFromAiProposal(매칭 id 재사용·서브프로세스 보존·base 있으면 AI 그룹 무시) vitest 8종.`)

---

### Task 3: page.tsx — graph 제안을 병합 프리뷰로 + ops 서브프로세스 색 가드

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`

**Interfaces:**
- Consumes: Task 2의 `buildGraphFromAiProposal`, 기존 `enterCsvPreview`(:1486-1529)/`applyCsvImport`(:1533)/`cancelCsvPreview`(:1603)/`csvOutcome`/`previewSource`/`previewRef`, `buildGraph`(:583), `nodesRef`/`edgesRef`/`groupsRef` 미러.
- Produces: `enterAiGraphPreview(proposal: AiProposal): void`(패널 `onGraphProposal`에 연결), `importOrigin: "csv" | "ai" | null` 상태(Task 4의 탭 라벨이 소비), `applyAiProposal` 삭제. `applyAiOps`는 시그니처 무변경.

- [ ] **Step 1: 프리뷰 진입 코어 추출 + importOrigin 상태**

`previewSource` 선언(:825) 옆에 추가:

```ts
  // Import 탭 라벨용 원산지 — 프리뷰 상태 슬롯(previewSource="csv")은 CSV/AI graph가 공유한다
  const [importOrigin, setImportOrigin] = useState<"csv" | "ai" | null>(null);
```

`enterCsvPreview`(:1486-1529)의 본문(:1489의 `const outcome = csvOutcome;` 이후 전체)을 `startImportPreview(outcome: CsvImportOutcome, origin: "csv" | "ai")`로 추출한다 — 본문은 그대로, 다음 3곳만 다르게:
- `const outcome = csvOutcome;` 제거(파라미터 사용), null 가드는 유지.
- `setPreviewSource("csv");` 다음에 `setImportOrigin(origin);` 추가.
- `setCsvImportOpen(false);`는 origin==="csv"일 때만 의미 있으나 무해하므로 그대로 둔다.

`enterCsvPreview`는 래퍼로 축소:

```ts
  const enterCsvPreview = useCallback(() => {
    // 슬롯이 이미 점유 중이면(주로 AI 프리뷰) 무시 — 툴바 게이팅이 우선 막지만 방어적으로 한 번 더 확인
    if (previewRef.current !== null) return;
    if (csvOutcome?.graph) startImportPreview(csvOutcome, "csv");
  }, [csvOutcome, startImportPreview]);
```

(`startImportPreview`도 useCallback — deps는 기존 enterCsvPreview의 것에서 csvOutcome 제거.)

- [ ] **Step 2: enterAiGraphPreview 추가 + applyAiProposal 삭제**

`applyAiProposal`(:1612-1671) 전체를 다음으로 **교체**:

```ts
  // AI graph 제안 → CSV와 같은 병합 프리뷰 (design 2026-07-11) — 전량 교체 경로 폐기
  const enterAiGraphPreview = useCallback(
    (proposal: AiProposal) => {
      if (proposal.kind !== "graph") return;
      // 프리뷰 슬롯 점유 중(CSV든 AI ops든) 진입 금지 — aa87766 중첩 자동저장 방지 경계 유지
      if (previewRef.current !== null) {
        showToast(t("preview.busy"));
        return;
      }
      if (versionId === null) return;
      const outcome = buildGraphFromAiProposal(proposal, {
        base: buildGraph(nodesRef.current, edgesRef.current, groupsRef.current),
      });
      if (!outcome.graph) {
        showToast(t("ai.error"));
        return;
      }
      setCsvFileName(null);
      setCsvOutcome(outcome);
      startImportPreview(outcome, "ai");
    },
    [versionId, startImportPreview, showToast, t],
  );
```

패널 마운트(:7362) `onGraphProposal={applyAiProposal}` → `onGraphProposal={enterAiGraphPreview}`.

`aiNodeToGraphNode`(:555-579)는 `applyAiOps`의 add 경로(:1702)가 계속 쓰므로 **유지**. `applyAiProposal` 삭제로 미사용이 된 import(예: `layoutWithDagre`가 다른 곳에서 안 쓰이면)는 lint가 알려주는 것만 정리.

- [ ] **Step 3: apply/cancel에 importOrigin 리셋 + ops 서브프로세스 색 가드**

`applyCsvImport`(:1541-1542 성공 블록)와 `cancelCsvPreview`(:1604-1606)에 `setImportOrigin(null);` 각각 추가.

`applyAiOps`의 set_attr 반영(:1762 부근)에서 color 줄만 교체:

```ts
                    // 서브프로세스 색은 시스템 고정(바이올렛) — AI가 보내도 데이터 오염 방지 (design 2026-07-11 ④)
                    ...(attr.color != null && node.data.nodeType !== "subprocess"
                      ? { color: attr.color }
                      : {}),
```

- [ ] **Step 4: importSlot에 origin 전달 (Task 4의 prop 선반영)**

`importSlot`(:8017-8029)의 `<CsvImportTab ...>`에 `origin={importOrigin ?? "csv"}` prop 추가. (Task 4가 prop을 정의하기 전이므로 **이 시점엔 컴파일 에러** — Step 5의 검증은 Task 4 완료 후 몰아서 한다면 순서를 바꿔도 되지만, 독립 커밋을 위해 이 태스크에서는 prop 추가를 **보류**하고 Task 4에서 함께 넣는 것을 선택한다. 이 스텝은 **스킵하고 Task 4로 이관** — 여기 남긴 이유는 이관 사실을 명시하기 위함.)

- [ ] **Step 5: 검증 + 커밋**

Run: `cd frontend && npx vitest run && node_modules/.bin/tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: 전부 PASS/0 errors (React Compiler 룰 포함 — `startImportPreview`/`enterAiGraphPreview`의 useCallback deps는 lint가 검증).

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" PROGRESS.md
git commit -m "feat(editor): AI graph proposals enter merge preview — AI graph 제안 병합 프리뷰 전환·ops 서브프로세스 색 가드"
```

(PROGRESS 한 줄: `- 에디터: applyAiProposal(전량 교체) 폐기 → enterAiGraphPreview(병합 프리뷰, previewSource=csv 슬롯 공유+importOrigin), ops set_attr 서브프로세스 색 무시.`)

---

### Task 4: Import 탭 라벨 일반화 + 챗 graph 카드 안내 + i18n

**Files:**
- Modify: `frontend/src/components/csv-import-tab.tsx`
- Modify: `frontend/src/components/ai-chat-panel.tsx`
- Modify: `frontend/src/components/ai-chat-cards.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (importSlot에 origin prop — Task 3 Step 4에서 이관)

**Interfaces:**
- Consumes: Task 3의 `importOrigin` 상태, 기존 `CsvImportTab` props(:15-23), `ProposalSummaryCard({ kind, payload, preview })`(ai-chat-cards.tsx), 패널의 `previewAttached`(:148-153)·카드 preview 조건(:656)·폴백 블록(:681).
- Produces: `CsvImportTab`에 `origin: "csv" | "ai"` prop, `ProposalSummaryCard`에 `footer?: string` prop. i18n 키 4종.

- [ ] **Step 1: i18n 키 추가 (EN/KO 양쪽)**

EN 섹션(`"csvImport.tabIntro"` 부근):

```ts
  "csvImport.tabIntroAi": "AI proposal merged by node title — **{matched} matched** (id preserved), **{added} added**. Removed nodes are listed below.",
  "ai.proposalOpenImport": "Applied to the canvas as a merge preview — review & apply in the Import tab on the right.",
```

KO 섹션(같은 키 짝):

```ts
  "csvImport.tabIntroAi": "AI 제안을 노드 제목 기준으로 병합했습니다 — **매칭 {matched}**(id 보존), **추가 {added}**. 소멸 노드는 아래 목록에서 처리하세요.",
  "ai.proposalOpenImport": "캔버스에 병합 미리보기로 적용됨 — 우측 Import 탭에서 검토·적용하세요.",
```

- [ ] **Step 2: CsvImportTab origin prop**

`CsvImportTabProps`에 `origin: "csv" | "ai";` 추가, 인트로만 분기:

```ts
      <MarkdownView
        className="md"
        source={t(origin === "ai" ? "csvImport.tabIntroAi" : "csvImport.tabIntro", { matched: merge.matchedCount, added: merge.addedNodeIds.length })}
      />
```

`page.tsx`의 importSlot `<CsvImportTab ...>`에 `origin={importOrigin ?? "csv"}` 추가.

- [ ] **Step 3: 챗 카드 — graph는 preview 버튼 제거 + 라이브 안내 푸터**

`ai-chat-panel.tsx`:
- `previewAttached`(:149-153)의 kind 조건을 `latestAssistant.kind === "ops"`만으로 축소(graph 제거).
- 카드 preview prop 조건(:656)은 previewAttached 축소로 자동으로 ops 전용이 된다 — 변경 불필요하나, graph 라이브 카드에 안내 푸터를 넘긴다. `ProposalSummaryCard` 렌더(:~650대)의 preview 계산 아래에 footer 전달:

```tsx
                    <ProposalSummaryCard
                      kind={message.kind}
                      payload={message.payload}
                      preview={
                        aiPreviewActive && previewAttached && message.id === latestAssistant?.id
                          ? { onCommit: onCommitPreview, onDiscard: onDiscardPreview }
                          : undefined
                      }
                      footer={
                        message.kind === "graph" && message.id < 0
                          ? t("ai.proposalOpenImport")
                          : undefined
                      }
                    />
```

`ai-chat-cards.tsx`의 `ProposalSummaryCard` props에 `footer?: string` 추가, 읽기전용 푸터 분기 교체:

```tsx
      ) : (
        <div className="border-t border-hairline px-2.5 py-1.5 text-fine text-ink-tertiary">
          {footer ?? t("ai.proposalReadOnly")}
        </div>
      )}
```

(시그니처: `export function ProposalSummaryCard({ kind, payload, preview, footer }: { kind: "graph" | "ops"; payload: AiMessagePayload; preview?: { onCommit?: () => void; onDiscard?: () => void }; footer?: string })`.)

- [ ] **Step 4: 검증 + 커밋**

Run: `cd frontend && npx vitest run && node_modules/.bin/tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: 전부 PASS/0 errors.

```bash
git add frontend/src/components/csv-import-tab.tsx frontend/src/components/ai-chat-panel.tsx frontend/src/components/ai-chat-cards.tsx frontend/src/lib/i18n-messages.ts "frontend/src/app/maps/[mapId]/page.tsx" PROGRESS.md
git commit -m "feat(ai-chat): graph commit unified into Import tab — graph 커밋 Import 탭 일원화·카드 안내 푸터"
```

(PROGRESS 한 줄: `- UX: Import 탭 origin 라벨(AI/CSV)·챗 graph 카드는 안내 푸터(커밋 버튼은 ops 전용), i18n 2키.`)

---

### Task 5: 브라우저 검증 + 최종 게이트

**Files:**
- Create: `frontend/scripts/pw-verify-ai-graph-merge.mjs`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 1-4 전체. 기존 검증 스크립트 관례(`pw-verify-compare-403.mjs`: playwright-core + 시스템 Chrome + `bpm.devUser` localStorage + route mock). 데모 시드(`backend: .venv/bin/python -m scripts.reset_db`).
- Produces: 검증 스크립트 + PROGRESS 완료 기록.

- [ ] **Step 1: 검증 스크립트 작성**

`frontend/scripts/pw-verify-ai-graph-merge.mjs` — 골자 (기존 `pw-verify-compare-403.mjs`의 셋업 패턴 재사용, 서버는 실행자가 기동):

```js
// AI graph 병합 프리뷰 검증 — ①graph 제안 → Import 탭 노출 ②Apply 후 매칭 노드 id 불변
// ③챗 graph 카드에 안내 푸터. AI 응답은 route mock — 실제 AI 서버 불필요.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3010 node scripts/pw-verify-ai-graph-merge.mjs
// 전제: backend(8010, reset_db 시드, AI_ENABLED=true 불필요 — /ai/chat는 mock) + 프론트(3010).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3010";
const MAP = Number(process.env.VERIFY_MAP ?? 1);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});
const page = await ctx.newPage();

// 에디터가 실제 로드하는 버전 id를 네트워크 요청에서 포착 — versions[0] 가정은 기본 선택 규칙과 어긋날 수 있다
let vid = null;
page.on("request", (req) => {
  const match = req.url().match(/\/api\/versions\/(\d+)\/graph/);
  if (match && vid === null) vid = Number(match[1]);
});
await page.goto(`${BASE}/maps/${MAP}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 60000 });
check("0a editor version id captured", vid !== null, String(vid));
const before = await (await ctx.request.get(`${BASE}/api/versions/${vid}/graph`)).json();
const targetNode = before.nodes.find((n) => n.node_type === "process");
check("0 seed graph loaded", Boolean(targetNode), `nodes=${before.nodes.length}`);

// AI 응답 mock — 기존 노드 제목 1개 에코 + 신규 1개
const proposal = {
  kind: "graph",
  message: "polish",
  nodes: [
    { key: "a", title: targetNode.title, node_type: targetNode.node_type, description: "", attributes: null, group_key: null },
    { key: "b", title: "AI Verify Added", node_type: "process", description: "", attributes: null, group_key: null },
  ],
  edges: [{ source: "a", target: "b", label: "" }],
  groups: [],
  ops: [], steps: [], findings: [],
  session_id: null,
};
await page.route("**/ai/chat", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(proposal) }),
);

// AI 패널 열고 전송 (패널 토글 → textarea → 전송)
await page.locator('button[title="AI 도우미"], button[title="AI assistant"]').first().click();
await page.waitForSelector('[data-id="ai-chat-list"]', { timeout: 8000 });
await page.locator("textarea").last().fill("폴리싱해줘");
await page.keyboard.press("Meta+Enter");

// ① Import 탭 프리뷰 진입
await page.waitForSelector('[data-id="csv-import-tab"]', { timeout: 10000 });
check("1 import tab opened for AI graph proposal", true);

// ③ 챗 graph 카드 안내 푸터
const cardText = await page.locator('[data-id="ai-proposal-card"]').last().innerText().catch(() => "");
check("3 chat card shows import-tab notice", /Import tab|Import 탭/.test(cardText), cardText.slice(0, 60));

// ② Apply → 매칭 노드 id 불변 + 신규 추가
await page.locator('[data-id="csv-import-apply"]').click();
await page.waitForSelector('[data-id="csv-import-tab"]', { state: "detached", timeout: 10000 });
const after = await (await ctx.request.get(`${BASE}/api/versions/${vid}/graph`)).json();
const kept = after.nodes.find((n) => n.id === targetNode.id);
check("2a matched node id preserved after apply", Boolean(kept), targetNode.id);
check("2b new node added", after.nodes.some((n) => n.title === "AI Verify Added"));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
```

(주의: `/ai/chat` 호출엔 백엔드 AI_ENABLED가 꺼져 있어도 route mock이 네트워크 전에 가로챈다. 단 패널이 `aiEnabled=false`면 입력이 disabled — **백엔드를 `AI_ENABLED=true`로 기동**하거나(`AI_ENABLED=true .venv/bin/uvicorn ...`) mock이므로 실제 AI 서버 주소는 불필요. `versionId` 추출 evaluate 블록은 사용하지 않으면 삭제. 체크아웃 보유가 편집 전제라면 시드 상태에 따라 `POST /api/versions/{vid}/checkout`을 request로 선행하고, Apply 423 시 그 처리를 스크립트에 반영하라 — 스크립트 작성자는 실제 실행하며 조정한다.)

- [ ] **Step 2: 서버 기동 + 실행**

```bash
lsof -ti :3010 -ti :8010 2>/dev/null | xargs kill -9 2>/dev/null
cd backend && .venv/bin/python -m scripts.reset_db
AI_ENABLED=true .venv/bin/uvicorn app.main:app --port 8010 &   # 백그라운드
cd ../frontend && npm install --no-save playwright-core
BACKEND_URL=http://localhost:8010 npx next dev -p 3010 &        # 백그라운드
# curl --retry-connrefused 로 준비 대기 후:
BASE_URL=http://localhost:3010 node scripts/pw-verify-ai-graph-merge.mjs
# 종료: lsof -ti :3010 -ti :8010 | xargs kill -9
```

Expected: 전 체크 PASS. 실패 시 좀비 서버·시드 오염 먼저 의심.

- [ ] **Step 3: 최종 게이트 + 커밋**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd ../frontend && npx vitest run && node_modules/.bin/tsc --noEmit -p tsconfig.json && npm run lint && npm run build
```

Expected: 전부 PASS/0 errors.

```bash
git add frontend/scripts/pw-verify-ai-graph-merge.mjs PROGRESS.md
git commit -m "test(ai): browser verify for AI graph merge preview — 병합 프리뷰 브라우저 검증(id 보존·Import 탭·카드 안내)"
```

(PROGRESS 한 줄: 검증 결과 요약 + `- 완료: AI graph 병합 파이프라인 — 비교모드 유의미화·서브프로세스 보존. 배포 영향 없음(DB 무변경).`)
