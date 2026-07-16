# Subprocess Workflow Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서브프로세스 생성 시 `follow_latest`(최신본 추종)를 모든 생성 경로에서 기본 ON으로, 그리고 게시본 승인 탭에 기존 서브프로세스 지정 카드를 노출한다.

**Architecture:** 두 개의 작은 표면 변경. (1) 5개 생성/기본값 지점을 `false→true`로 뒤집되 읽기/직렬화 폴백(`?? false`)은 유지해 기존 노드 드리프트를 막는다. (2) 자기완결형 `SubprocessInspectorCard`를 승인 탭 슬롯에 한 번 더 마운트한다(백엔드 변경 없음).

**Tech Stack:** Next.js/React (TypeScript, @xyflow/react), FastAPI + SQLAlchemy + Pydantic, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-07-16-subprocess-workflow-improvements-design.md`

## Global Constraints

- 줄바꿈 LF 고정(`.gitattributes`), 다른 EOL 도입 금지.
- 백엔드 전체 그린 확인 명령: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` (backend/ 에서). `.env` 존재 시 이 env 없으면 오탐 실패.
- 프론트 게이트 4종: `npm run lint` · `npx tsc --noEmit` · `npx vitest run` · `npm run build` (frontend/ 에서). vitest·next build는 테스트 파일 타입 에러를 못 잡으니 tsc는 항상 별도 실행.
- `frontend/src/app/maps/[mapId]/page.tsx`는 `[mapId]` 대괄호 디렉터리 → **재귀 `grep`(ugrep)이 조용히 건너뜀**. 확인은 직접 파일 경로 Read/Python으로.
- React Compiler: setState만 호출하는 사소한 핸들러는 plain 함수로(수동 memoization deps 불일치 시 lint/build 실패). 이 플랜은 신규 핸들러를 만들지 않으므로 해당 없음(회귀만 주의).
- 커밋마다 관련 문서(PROGRESS.md) 동반 갱신 후 같은 커밋에 포함. 커밋 메시지: `type(scope): English — 한국어`.
- 데이터 마이그레이션 없음. 기존 DB 행·기존 노드의 저장값은 변경하지 않는다.

---

### Task 1: Backend `follow_latest` default → ON

**Files:**
- Modify: `backend/app/schemas.py:607`
- Modify: `backend/app/models.py:226`
- Test: `backend/tests/test_graph.py` (add one test)

**Interfaces:**
- Consumes: 기존 `_create_version(client)` 헬퍼, `PUT/GET /api/versions/{version_id}/graph`.
- Produces: `NodeIn.follow_latest` 기본값 `True`, `Node.follow_latest` ORM 기본값 `True`. 이후 프론트 변경(Task 2)과 독립.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_graph.py` 끝에 추가 (기존 `test_subprocess_and_handle_fields_roundtrip` 바로 뒤):

```python
def test_subprocess_follow_latest_defaults_on(client: TestClient) -> None:
    """follow_latest 생략 시 기본 True(최신본 추종)로 저장된다."""
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "s", "title": "시작", "node_type": "start", "sort_order": 0},
            {
                "id": "sub",
                "title": "결재",
                "node_type": "subprocess",
                "linked_map_id": 999,
                # follow_latest 생략 — 기본값 검증
                "sort_order": 1,
            },
            {"id": "e", "title": "끝", "node_type": "end", "is_primary_end": True, "sort_order": 2},
        ],
        "edges": [],
    }
    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()
    sub = next(n for n in saved["nodes"] if n["id"] == "sub")
    assert sub["follow_latest"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_graph.py::test_subprocess_follow_latest_defaults_on -q`
Expected: FAIL — `assert False is True` (현재 기본값이 False).

- [ ] **Step 3: Flip the two backend defaults**

`backend/app/schemas.py:607`:
```python
    follow_latest: bool = True
```

`backend/app/models.py:226` (라인 227 주석은 유지):
```python
    follow_latest: Mapped[bool] = mapped_column(Boolean, default=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_graph.py::test_subprocess_follow_latest_defaults_on -q`
Expected: PASS.

- [ ] **Step 5: Run full backend gate (regression)**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: all pass. (기존 follow_latest 테스트는 모두 명시값이라 회귀 없음이 예상되나, 혹시 노드 dict 전체 비교 테스트가 깨지면 그 테스트의 기대값을 새 기본값에 맞게 수정.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/models.py backend/tests/test_graph.py
git commit -m "feat(subprocess): default follow_latest ON in backend schema/model — 서브프로세스 최신본 추종 기본값 ON(백엔드)"
```

---

### Task 2: Frontend creation defaults → ON

**Files:**
- Modify: `frontend/src/lib/csv-import.ts:186`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:613` (`aiNodeToGraphNode`)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:3701` (`handleLibraryDrop`)
- Test: `frontend/src/lib/csv-import.test.ts` (add one test)

**Interfaces:**
- Consumes: 기존 `graphOf(csv)` 헬퍼, `HEADER` 상수, `buildGraphFromCsv`.
- Produces: 신규 생성 노드의 `follow_latest`/`followLatest` 기본 `true`. `page.tsx:3752 addLinkNodeFromMap`은 이미 `true`(변경 안 함).

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/csv-import.test.ts`의 적절한 `describe("buildGraphFromCsv", ...)` 블록 안에 추가(없으면 파일 끝에 새 `it`):

```ts
it("임포트 노드는 follow_latest 기본 ON(최신본 추종)으로 생성된다", () => {
  const graph = graphOf(`${HEADER}\nA,,,,`);
  const a = graph.nodes.find((n) => n.title === "A");
  expect(a?.follow_latest).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/csv-import.test.ts -t "follow_latest 기본 ON"`
Expected: FAIL — received `false` (현재 `NODE_DEFAULTS.follow_latest = false`).

- [ ] **Step 3: Flip the three frontend creation defaults**

`frontend/src/lib/csv-import.ts:186`:
```ts
  follow_latest: true,
```

`frontend/src/app/maps/[mapId]/page.tsx:613` (`aiNodeToGraphNode` 내부, snake_case):
```ts
    follow_latest: true,
```
(주변 컨텍스트로 유일 지정: 바로 위 `linked_map_id: null,`, 아래 `linked_version_id: null,`.)

`frontend/src/app/maps/[mapId]/page.tsx:3701` (`handleLibraryDrop` 내부, camelCase):
```ts
          followLatest: true,
```
(주변 컨텍스트로 유일 지정: 바로 위 `linkedVersionId: pinned,`, 아래 `subEnds,`.)

**변경 금지(경계):** `page.tsx:656`·`page.tsx:1192-1193`·`page.tsx:7814`의 `?? false` 폴백은 그대로 둔다(기존 노드 드리프트 방지). `page.tsx:3752`(`followLatest: true`, `linkedVersionId: null` 위)는 이미 ON.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/csv-import.test.ts -t "follow_latest 기본 ON"`
Expected: PASS. (mergeNode가 boolean을 통과시키지 못해 실패하면, 출력 노드 구성부에서 `follow_latest`가 `NODE_DEFAULTS`로부터 전달되는지 확인 후 대응 — 단, 현재 코드는 `...NODE_DEFAULTS` 스프레드라 전달됨이 예상.)

- [ ] **Step 5: Run full frontend gate (regression)**

Run: `cd frontend && npx vitest run && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass. (기존 `follow_latest: false` 픽스처는 모두 명시값이라 회귀 없음이 예상.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/csv-import.ts "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/csv-import.test.ts
git commit -m "feat(subprocess): default follow_latest ON across FE creation paths — 서브프로세스 최신본 추종 기본값 ON(프론트 생성 경로)"
```

---

### Task 3: Subprocess designation card in the Approval tab

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (`approvalSlot`, `<ApprovalPanel/>` 종료 직후 ~8198)

**Interfaces:**
- Consumes: 기존 `SubprocessInspectorCard`(이미 import됨), `spCanManage`·`spDisabledReason`(page.tsx:1009-1014), `mapId`, `showToast`.
- Produces: 사용자 대면 UI만. 백엔드/타입 변경 없음.

이 태스크는 6700줄 단일 컴포넌트 내 JSX 삽입이라 단위 테스트 하네스가 없다. TDD 대신 타입/빌드 게이트 + 브라우저 실검증으로 수용한다(fabricated 테스트 금지).

- [ ] **Step 1: Insert the card after `<ApprovalPanel/>`**

`frontend/src/app/maps/[mapId]/page.tsx` `approvalSlot` 내, `<ApprovalPanel ... />` 를 닫는 `)}`(약 8198) 다음, `<MapDetailCard`(약 8199) 앞에 삽입:

```tsx
                    {/* 서브프로세스 지정 — 게시본 승인 탭에서도 지정/수정/해제(맵 단위, 오너·관리자). Map 탭 카드와 동일 인스턴스 */}
                    <SubprocessInspectorCard
                      mapId={mapId}
                      canManage={spCanManage}
                      disabledReason={spDisabledReason}
                      onToast={showToast}
                    />
```

- [ ] **Step 2: Type + lint + build gate**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass (import·props 이미 존재하므로 타입 통과).

- [ ] **Step 3: Browser verification (manual/Playwright)**

로컬 네이티브 스택 기동(백엔드 8000 + 프론트 3000, `DEV_ENFORCE_PERMISSIONS=true`는 불필요 — 기본 sysadmin=owner로 지정 가능). 게시본이 있는 맵을 오너로 열고:
- 승인 탭 → `data-id="sp-inspector-card"`가 승인 패널 아래·버전 목록 위에 보인다.
- 게시본 + 오너 → 지정/수정/해제 버튼 활성. "Designate" 클릭 → 모달 저장 → 뱃지 `Designated`.
- 비게시 버전 또는 비오너 → 카드 비활성 + `data-id="sp-inspector-reason"` 사유 노트.
- 기존 Properties·Map 탭 카드, 승인 패널, 버전 목록에 회귀 없음.

관찰 결과(실행 명령 + 본 것)를 그대로 보고. 스택 기동이 불가하면 검증 불가를 명시하고 미검증 항목을 남긴다.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx"
git commit -m "feat(subprocess): show designation card in the approval tab — 승인 탭에 서브프로세스 지정 카드 노출"
```

---

## Final: PROGRESS.md + branch wrap

- [ ] PROGRESS.md의 2026-07-16 항목을 "설계"에서 "구현 완료(Task 1~3 + 게이트 결과)"로 갱신하고 커밋.
- [ ] `superpowers:finishing-a-development-branch`로 머지/PR 옵션 제시.

## Self-Review

- **Spec coverage:** Part 1(5지점) → Task 1(schemas·models) + Task 2(csv-import·page.tsx 2곳) + `addLinkNodeFromMap` 이미 ON(변경 없음, 회귀 확인은 Task 2 gate). Part 2 → Task 3. 비목표(폴백 유지·마이그레이션 없음·백엔드 무변경) 각 태스크에 명시. 갭 없음.
- **Placeholder scan:** 모든 코드 스텝에 실제 코드/명령/기대출력 포함. TODO/TBD 없음. Task 3는 하네스 부재를 명시하고 브라우저 실검증으로 대체(fabricated 테스트 금지 원칙).
- **Type consistency:** `follow_latest`(BE/스키마/CSV/api.ts) ↔ `followLatest`(page.tsx AppNode.data) 표기 구분 정확. `SubprocessInspectorCard` props 4개(mapId·canManage·disabledReason·onToast) 기존 사용처와 동일.
