# Framework 슬롯 거버넌스 트랙 D+E — 임포트 플레이스홀더·문서 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인터뷰 임포트가 이 L5 전달분에 없는 taskId(타 L5의 L6)로 향하는 연계 엣지를 버리지 않고 플레이스홀더 노드로 남기며, 그 코드의 맵이 나중에(다른 전달분으로) 생기면 자동으로 연결한다. 그리고 슬롯 거버넌스 전체를 `docs/spec.md`·매뉴얼에 반영한다.

**Architecture:** 어댑터(`scripts/consultant_interview.py`)는 한쪽 끝점만 rows에 없는 엣지를 `external=True`로 보존한다. 임포터(`scripts/import_consultant.py` 연계 배치)는 엣지 끝점 코드까지 DB(`consultant_code`)에서 찾아 있으면 외부 L6 노드로, 없으면 `linked_map_id NULL + source_node_id = make_node_id("__ext__", code)` 플레이스홀더로 배치하고, pass 1 직후 `resolve_external_placeholders`가 이번 전달로 생긴 맵 코드와 같은 키의 플레이스홀더(전 캔버스 draft)를 연결한다.

**Tech Stack:** Python(pytest) / Markdown.

**Spec:** `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md` §8(임포트 플레이스홀더)·§13 트랙 D·E.

## Global Constraints

- 트랙 A+B·C 완료 상태. 브랜치·게이트 명령은 앞 플랜과 동일.
- **전제 확인 결과(2026-09-06 실측)**: 인터뷰 JSON `relations.edges[]`는 `src`/`dst` taskId만 싣고 외부 task의 이름·L5 코드는 없다(`docs/samples/consultant-interview-sample/calibration-l5.json`). 따라서 플레이스홀더 제목은 taskId 코드, `placeholder_category_id`는 NULL로 시작한다 — 산출물 계약 확장(외부 task의 이름·L5)은 인터뷰 트랙에 별도 요청.
- 어댑터 이슈 문구는 기존 규약(영어+한글 병기). 임포트 경로는 승인·이벤트 기록 없음(spec §9).
- 문서 규칙: `docs/spec.md`는 살아있는 명세(절 추가만, 이동 금지), 매뉴얼은 ko/en 대칭, 명령은 bash/PowerShell 병기 대상 아님(기능 설명만).

---

### Task 1: 어댑터 — 외부 taskId 엣지 보존(`external`)

**Files:**
- Modify: `backend/scripts/consultant_interview.py:95-108` (`InterviewLinkageEdge`), `:503-510` (엣지 검증)
- Test: `backend/tests/test_interview_import_api.py` (또는 어댑터 단위 테스트 파일 — `git grep -l 'InterviewLinkageEdge' backend/tests`로 실측)

**Interfaces:**
- Produces: `InterviewLinkageEdge.external: bool = False`(끝점 중 하나가 rows 밖), `InterviewLinkage.external_codes: list[str]`(정렬·중복 제거).

- [ ] **Step 1: 실패 테스트**

어댑터를 직접 부르는 기존 테스트 파일(`git grep -n 'def test_.*adapter\|parse_interview' backend/tests | head`)에 추가 — 헬퍼 이름은 실측(`parse_interview_json` 등):

```python
def test_adapter_keeps_edge_to_external_task_as_placeholder_source() -> None:
    """한쪽 끝점이 rows에 없는 엣지는 드랍하지 않고 external로 보존 — 양쪽 다 없으면 드랍 (spec 2026-09-06 §8)."""
    doc = _minimal_interview_doc(l5_code="EXT-L5", task_ids=["t1", "t2"])  # 파일 내 기존 최소 문서 헬퍼 사용/신설
    doc["relations"]["edges"] = [
        {"src": "t1", "dst": "t2", "kind": "seq"},
        {"src": "t2", "dst": "other-l5-task-9", "kind": "seq"},
        {"src": "ghost-a", "dst": "ghost-b", "kind": "seq"},
    ]
    result = parse_interview(doc)
    edges = {(e.source, e.target): e for e in result.linkage.edges}
    assert ("t1", "t2") in edges and edges[("t1", "t2")].external is False
    assert ("t2", "other-l5-task-9") in edges and edges[("t2", "other-l5-task-9")].external is True
    assert ("ghost-a", "ghost-b") not in edges
    assert result.linkage.external_codes == ["other-l5-task-9"]
    assert any("placeholder" in i.message for i in result.issues)
```

- [ ] **Step 2: 실패 확인** — `AttributeError: external` 또는 엣지 누락으로 FAIL.

- [ ] **Step 3: 구현**

`InterviewLinkageEdge`에 필드 추가:

```python
    # 끝점 중 하나가 이 전달분 rows 밖(타 L5의 L6) — 임포터가 플레이스홀더 노드로 배치 (spec 2026-09-06 §8)
    external: bool = False
```

`InterviewLinkage`에 `external_codes: list[str] = field(default_factory=list)`.

엣지 검증(`if src not in row_names or dst not in row_names:` 블록) 교체:

```python
        src_known, dst_known = src in row_names, dst in row_names
        if not src_known and not dst_known:
            issues.append(AdapterIssue(
                "warning", epath, f"edge references unknown taskId {src!r}→{dst!r} - dropped (존재하지 않는 taskId를 가리켜 제외됨)"))
            continue
        external = not (src_known and dst_known)
        if external:
            ext = dst if src_known else src
            if ext not in linkage.external_codes:
                linkage.external_codes.append(ext)
            issues.append(AdapterIssue(
                "warning", epath,
                f"edge to external taskId {ext!r} kept as placeholder (다른 L5의 업무 - 플레이스홀더 노드로 배치됨)"))
```

`InterviewLinkageEdge(...)` 생성 인자에 `external=external` 추가. 마지막에 `linkage.external_codes.sort()`.

- [ ] **Step 4: 통과 확인 + Commit**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -p no:cacheprovider -k interview && .venv/bin/ruff check app/ scripts/ tests/
git add backend/scripts/consultant_interview.py backend/tests/
git commit -m "feat(import): keep linkage edges to external tasks as placeholder sources — 외부 taskId 엣지를 플레이스홀더 원료로 보존"
```

---

### Task 2: 임포터 — 플레이스홀더 노드 배치 + 재전달 해소

**Files:**
- Modify: `backend/scripts/import_consultant.py:719-870` (`import_delivery` pass 1 직후 해소 호출), `:1240-1440` (연계 배치)
- Test: `backend/tests/test_interview_import_api.py` (`_linkage_graph` 헬퍼 재사용)

**Interfaces:**
- Produces: `EXTERNAL_LINEAGE_SCOPE = "__ext__"`, `external_lineage_key(code) -> str` (= `make_node_id("__ext__", code)`), `async resolve_external_placeholders(session, code_to_map: dict[str, int], report) -> int`.

- [ ] **Step 1: 실패 테스트**

```python
def test_external_edge_becomes_placeholder_and_resolves_on_later_delivery(client: TestClient) -> None:
    """L5-A 전달분의 엣지가 아직 없는 taskId를 가리키면 플레이스홀더 노드+엣지로 남고,
    그 taskId를 담은 L5-B 전달분이 오면 A 캔버스의 플레이스홀더가 자동 연결된다 (spec 2026-09-06 §8)."""
    doc_a = _linkage_graph("PHX-A")            # rows: 이 L5의 task 2~3개, relations.edges 포함
    ext_code = "phx-b-task-0001"
    doc_a["relations"]["edges"].append({"src": doc_a["rows"][0]["taskId"], "dst": ext_code, "kind": "seq"})
    res_a = client.post("/api/categories/import-interview", files=_files(doc_a), data={"mode": "apply"})
    assert res_a.status_code == 200, res_a.text
    canvas_a = _canvas_map_id(client, "PHX-A")
    graph_a = client.get(f"/api/versions/{_draft_id(client, canvas_a)}/graph").json()
    ph = [n for n in graph_a["nodes"] if n["node_type"] == "subprocess" and n["linked_map_id"] is None]
    assert len(ph) == 1 and ph[0]["title"] == ext_code and ph[0]["placeholder_category_id"] is None
    assert any(e["target_node_id"] == ph[0]["id"] for e in graph_a["edges"])

    doc_b = _linkage_graph("PHX-B", task_ids=[ext_code, "phx-b-task-0002"])
    res_b = client.post("/api/categories/import-interview", files=_files(doc_b), data={"mode": "apply"})
    assert res_b.status_code == 200, res_b.text
    graph_a2 = client.get(f"/api/versions/{_draft_id(client, canvas_a)}/graph").json()
    resolved = next(n for n in graph_a2["nodes"] if n["id"] == ph[0]["id"])
    assert resolved["linked_map_id"] is not None
    assert graph_a2["subprocess_refs"][str(resolved["linked_map_id"])]["category_path"].endswith("PHX-B")
    # 재임포트 멱등 — 플레이스홀더가 다시 생기지 않는다
    client.post("/api/categories/import-interview", files=_files(doc_a), data={"mode": "apply"})
    graph_a3 = client.get(f"/api/versions/{_draft_id(client, canvas_a)}/graph").json()
    assert not [n for n in graph_a3["nodes"] if n["node_type"] == "subprocess" and n["linked_map_id"] is None]
```

`_linkage_graph`·`_files`·`_canvas_map_id`·`_draft_id`는 파일의 기존 헬퍼 이름으로 맞춘다(없는 것은 `test_apply_seeds_linkage_canvas_and_is_idempotent` 본문을 헬퍼로 추출). `import-interview` 요청 형식(multipart 파일 + mode)은 그 테스트 그대로.

- [ ] **Step 2: 실패 확인** — 플레이스홀더 0개로 FAIL.

- [ ] **Step 3: 임포터 — 배치**

`import_consultant.py` 상단(`make_node_id` 아래):

```python
EXTERNAL_LINEAGE_SCOPE = "__ext__"


def external_lineage_key(code: str) -> str:
    """타 L5 taskId 플레이스홀더의 계보 키 — 캔버스 L5와 무관하게 코드만으로 결정돼 재전달 해소가 전 캔버스를 찾는다."""
    return make_node_id(EXTERNAL_LINEAGE_SCOPE, code)
```

연계 배치(1244 `placed = ...`)의 조회 대상을 엣지 끝점까지 넓힌다:

```python
        lookup_codes = set(linkage.map_codes) | {e.source for e in linkage.edges} | {e.target for e in linkage.edges}
        placed = (await session.execute(
            select(ProcessMap.id, ProcessMap.consultant_code, ProcessMap.name).where(
                ProcessMap.consultant_code.in_(sorted(lookup_codes)),
                ProcessMap.deleted_at.is_(None),
            )
        )).all()
```

`placed_codes = {c for c in linkage.map_codes if c in map_ids}` 뒤에:

```python
        # 외부 L6 — DB에 있으면 실 노드(외부 L6 색·배지), 없으면 플레이스홀더 (spec 2026-09-06 §8)
        external_present = {c for c in linkage.external_codes if c in map_ids}
        external_missing = [c for c in linkage.external_codes if c not in map_ids]
        present_codes = placed_codes | external_present | set(external_missing)
        flow, branch_of, back_pairs = expand_linkage_branches(linkage.edges, present_codes)
```

(`expand_linkage_branches(linkage.edges, placed_codes)` 호출을 위 줄로 대체.) 기존 플레이스홀더 재사용 — `existing` 노드 로드 뒤:

```python
        placeholder_nodes: dict[str, Node] = {
            n.source_node_id: n for n in existing
            if n.node_type == "subprocess" and n.linked_map_id is None and n.source_node_id
        }
```

`missing` 산출 다음에 외부 배치 목록:

```python
        missing_external = [c for c in external_present if map_ids[c] not in node_by_map]
        missing_placeholders = [c for c in external_missing if external_lineage_key(c) not in placeholder_nodes]
```

격자 크기와 루프 확장 — `grid = grid_positions(0, len(missing) + len(missing_branches), base_y)`를

```python
        grid = grid_positions(
            0, len(missing) + len(missing_external) + len(missing_placeholders) + len(missing_branches), base_y
        )
```

로 바꾸고, 기존 `missing` 루프 뒤·분기 루프 앞에:

```python
        offset = len(missing)
        for i, c in enumerate(missing_external):
            px, py = grid[offset + i]
            node = Node(
                id=uuid.uuid4().hex, version_id=draft.id, title=map_names.get(map_ids[c], c),
                node_type="subprocess", linked_map_id=map_ids[c], follow_latest=True,
                pos_x=px, pos_y=py, sort_order=next_sort + offset + i,
            )
            session.add(node)
            node_by_map[map_ids[c]] = node
            added += 1
        offset += len(missing_external)
        for i, c in enumerate(missing_placeholders):
            px, py = grid[offset + i]
            node = Node(
                id=uuid.uuid4().hex, version_id=draft.id, source_node_id=external_lineage_key(c),
                title=c, node_type="subprocess", linked_map_id=None, placeholder_category_id=None,
                follow_latest=True, pos_x=px, pos_y=py, sort_order=next_sort + offset + i,
            )
            session.add(node)
            placeholder_nodes[external_lineage_key(c)] = node
            added += 1
            report.add(code, "linkage", f"placeholder for external task {c} (map not delivered yet)")
        offset += len(missing_placeholders)
```

분기 노드 루프의 격자 인덱스(`grid[len(missing) + j]`)와 `sort_order`(`next_sort + len(missing) + j`)를 `offset + j`로 교정. `_node_of`에 플레이스홀더 분기:

```python
        def _node_of(key: str) -> Node | None:
            if key in branch_of:
                return branch_nodes.get(make_node_id(code, key))
            if key in map_ids:
                return node_by_map.get(map_ids[key])
            return placeholder_nodes.get(external_lineage_key(key))
```

- [ ] **Step 4: 임포터 — 재전달 해소**

`import_delivery`의 pass 1 종료 직후(`existing[cmap.code] = new_map` 루프가 끝나고 pass 2 진입 전):

```python
    # 외부 플레이스홀더 해소 — 이번 전달로 생긴/결착된 코드와 같은 계보 키를 가진 플레이스홀더를 전 캔버스 draft에서 연결 (spec 2026-09-06 §8)
    await resolve_external_placeholders(
        session, {cmap.code: existing[cmap.code].id for cmap in maps if cmap.code in existing}, report
    )
```

모듈 함수:

```python
async def resolve_external_placeholders(
    session: AsyncSession, code_to_map: dict[str, int], report: ImportReport
) -> int:
    """linked_map_id 없는 플레이스홀더 중 source_node_id가 external_lineage_key(code)인 노드를 연결한다.
    라이브 draft만 — confirmed 스냅샷은 이력이라 불변."""
    if not code_to_map:
        return 0
    key_to_map = {external_lineage_key(c): mid for c, mid in code_to_map.items()}
    names = {
        mid: name for mid, name in (await session.execute(
            select(ProcessMap.id, ProcessMap.name).where(ProcessMap.id.in_(list(code_to_map.values())))
        )).all()
    }
    rows = (await session.execute(
        select(Node).join(MapVersion, MapVersion.id == Node.version_id).where(
            Node.node_type == "subprocess", Node.linked_map_id.is_(None),
            Node.source_node_id.in_(list(key_to_map.keys())), MapVersion.status == "draft",
        )
    )).scalars().all()
    for node in rows:
        node.linked_map_id = key_to_map[node.source_node_id]
        node.title = names.get(node.linked_map_id, node.title)
        node.follow_latest = True
    if rows:
        report.add("linkage", "linkage", f"resolved {len(rows)} external placeholder node(s)")
    return len(rows)
```

`ImportReport` 타입 이름·`report.add` 시그니처는 파일의 기존 사용을 따른다.

- [ ] **Step 5: 통과 확인 + Commit**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -p no:cacheprovider && .venv/bin/ruff check app/ scripts/ tests/
git add backend/scripts/import_consultant.py backend/tests/test_interview_import_api.py
git commit -m "feat(import): place external-task placeholders on the L5 canvas and resolve them on later deliveries — 미배치 taskId 플레이스홀더 배치·재전달 해소"
```

- [ ] **Step 6: 실브라우저 확인(QA S8)** — 샘플 JSON 사본에 외부 taskId 엣지를 넣어 설정 → Framework → Interview import로 적용 후 캔버스에서 플레이스홀더 점선 노드+엣지 확인, 스크린샷을 `docs/qa/2026-09-fw-slot-governance-qa.md` S8 결과에 기록.

---

### Task 3: 문서 — spec.md·매뉴얼·스펙 각주·PROGRESS

**Files:**
- Modify: `docs/spec.md` (§7 끝에 절 추가), `docs/manual/user-manual-general-ko.md:56 부근`, `user-manual-general-en.md:56 부근`, `user-manual-editing-ko.md`/`-en.md`(L5 연계 캔버스 챕터 §11), `admin-manual-ko.md:108(§6 전체 승인 큐)·276(§13 Framework 관리)`, `admin-manual-en.md` 대응 절, `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md §8`, `PROGRESS.md`

- [ ] **Step 1: spec.md**

§7 마지막에:

```markdown
### 7.x 업무 체계 슬롯 수명주기 (2026-09-06)

- **슬롯** = `process_maps.category_id`(L5 소속, L5 전용) + `consultant_code`(재전달 결착 키). 변경 5액션 `assign·unassign·move·replace·delete`는 `POST /api/maps/{id}/slot-changes`(dry_run 미리보기) 한 곳으로 들어온다.
- **승인**: 요청자가 L5 직속 관리자/sysadmin이면 즉시 적용(화면은 안내 모달), 아니면 `ApprovalRequest(kind="fw_slot")`. 이동은 보내는·받는 L5 각 1명(동일인 1회). 결정은 `POST /api/approval-requests/{id}/decide`, 철회 `DELETE /maps/{id}/slot-changes/pending`.
- **적용**(`app/framework_slots.py apply_slot_change`): 데이터 변경 + 홈 L5 캔버스 draft 노드 재지정(대체·후계자 삭제, 엣지 유지) + `retired_to_map_id` 계보 + `framework_slot_events` 이력 + `fw_slot_applied` 알림. 해제·삭제 노드는 링크를 끊지 않고 미싱 룩으로 표시, 확정 게이트 `stale_link`가 잡는다.
- **가드**: `mode='normal'`만 슬롯 보유. 슬롯 맵의 `DELETE /maps/{id}`·`copy retire_source`는 409 → slot-changes. 임포트는 승인 없이 그대로(부트스트랩), 미배치 taskId 엣지는 플레이스홀더 노드로.
```

- [ ] **Step 2: 매뉴얼**

- 사용자 일반(ko 56 근처 Framework 보기 단락 뒤, en 대칭): "체계 필을 눌러 열리는 창에서 연결·해제·다른 L5로 이동·슬롯 이양을 할 수 있습니다. 해당 L5의 관리자가 아니면 **승인 요청**이 만들어지고, 관리자가 승인 탭·인박스에서 처리하면 반영됩니다(이동은 양쪽 L5 관리자 승인). 대기 중엔 창 상단에 배너가 뜨고 요청자는 철회할 수 있습니다. 슬롯이 있는 맵의 삭제와 복사+은퇴도 같은 승인 흐름을 탑니다."
- 사용자 편집(L5 연계 캔버스 챕터): "해제·이양·삭제된 L6 노드는 점선 에러 룩과 배너(교체)로 표시되고 확정 체크리스트의 '끊긴 링크'에 잡힙니다. 후계 맵 노드엔 14일간 '최근 이양' 배지가 붙고, 노드에 마우스를 올리면 좌하단에 이양된 날·업데이트된 날·해제된 날이 뜹니다."
- 관리자(§6 전체 승인 큐): 항목 종류에 "슬롯 변경(fw_slot) — 액션·대상·n/m 측 진행". (§13 Framework 관리): "L5 직속 관리자가 그 L5 소속 L6의 슬롯 변경 승인자. 관리자 본인이 바꾸면 즉시 적용(안내 모달). 임포트로 생긴 외부 taskId 플레이스홀더는 재전달로 자동 해소."
- en은 같은 내용 영어로.

- [ ] **Step 3: 스펙 §8 각주** — "전제 확인(구현 전)" 항목을 "확인 결과(2026-09-06): 산출물에 외부 task 이름·L5 없음 → 제목=코드, placeholder_category_id NULL. 계약 확장은 인터뷰 트랙 백로그"로 갱신.

- [ ] **Step 4: PROGRESS + Commit**

PROGRESS 2026-09-06 섹션에 1줄: `- **트랙 D+E**: 어댑터 외부 taskId 엣지 보존(external) → 임포터 플레이스홀더 배치(source_node_id = make_node_id("__ext__", code))·재전달 해소(resolve_external_placeholders, draft만) → spec.md §7.x·매뉴얼 6종 갱신.`

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -p no:cacheprovider
git add docs/spec.md docs/manual docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md PROGRESS.md
git commit -m "docs(framework): slot lifecycle section, manual updates and placeholder import note — 슬롯 수명주기 명세·매뉴얼 반영"
```

- [ ] **Step 5: 마감** — `superpowers:finishing-a-development-branch`로 dev 머지 여부를 사용자와 결정(머지 시 PROGRESS 항목 압축, 스펙·플랜 폐기 정책은 main 머지 후).
