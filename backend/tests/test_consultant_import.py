"""컨설턴트 임포트 — 스키마·엔진 테스트. 설계: docs/design/2026-08-08-consultant-hierarchy-design.md"""

from fastapi.testclient import TestClient


def test_schema_has_consultant_columns(client: TestClient) -> None:
    # 신규 테이블·컬럼이 create_all로 생기고, 운영 ALTER 목록에도 등록돼 있는지(_ADDED_COLUMNS 누락 방지)
    import asyncio

    from sqlalchemy import text

    from app.db import _ADDED_COLUMNS, SessionLocal

    async def _check() -> None:
        async with SessionLocal() as session:
            await session.execute(text("SELECT id, code, name, level, parent_id, sort_order FROM process_categories"))
            await session.execute(text(
                "SELECT category_id, consultant_code, sp_input, sp_output FROM process_maps"
            ))

    asyncio.run(_check())
    added = {(t, c) for t, c, _ in _ADDED_COLUMNS}
    for col in ("category_id", "consultant_code", "sp_input", "sp_output"):
        assert ("process_maps", col) in added


def _canonical_map(**over: object):
    from scripts.consultant_canonical import CanonicalMap

    base = {
        "code": "L6-01", "name": "원자재 구매", "category": "A1", "owner": "cons.owner",
        "approvers": ["cons.appr"], "department": "Consult Div/Consult Team",
        "params": {"duration": "1.30", "annual_count": "12", "fte": "0.5", "input": "PR", "output": "PO"},
        "nodes": [
            {"code": "N1", "name": "요청", "type": "process", "seq": 1},
            {"code": "N2", "name": "발주", "type": "process", "seq": 2},
        ],
        "edges": [], "links": [],
    }
    base.update(over)
    return CanonicalMap.model_validate(base)


def test_build_graph_rows_chain_and_ids() -> None:
    from scripts.import_consultant import build_graph_rows, make_node_id

    nodes, edges, warnings = build_graph_rows(_canonical_map(), link_targets={})
    assert warnings == []
    by_type = {}
    for n in nodes:
        by_type.setdefault(n.node_type, []).append(n)
    assert len(by_type["start"]) == 1 and len(by_type["end"]) == 1
    assert by_type["end"][0].is_primary_end is True
    # 결정적 계보(source_node_id) — 같은 입력이면 재실행에도 동일 (버전 비교 매칭의 핵심).
    # Node.id 자체는 테이블 전역 PK라 빌드마다 새 uuid(clone_graph와 같은 계보 규약).
    assert by_type["process"][0].source_node_id == make_node_id("L6-01", "N1")
    nodes2, _, _ = build_graph_rows(_canonical_map(), link_targets={})
    assert sorted(n.source_node_id for n in nodes) == sorted(n.source_node_id for n in nodes2)
    # 체인: Start→N1→N2→End — 엣지 끝점을 id→source_node_id로 매핑해 계보로 비교
    by_id = {n.id: n for n in nodes}
    pairs = {
        (by_id[e.source_node_id].source_node_id, by_id[e.target_node_id].source_node_id)
        for e in edges
    }
    n1, n2 = make_node_id("L6-01", "N1"), make_node_id("L6-01", "N2")
    start_id, end_id = make_node_id("L6-01", "__start__"), make_node_id("L6-01", "__end__")
    assert pairs == {(start_id, n1), (n1, n2), (n2, end_id)}
    # 레이아웃 — rank가 x로 단조 증가 (계보 키로 조회)
    xs = {n.source_node_id: n.pos_x for n in nodes}
    assert xs[start_id] < xs[n1] < xs[n2] < xs[end_id]


def test_build_graph_rows_link_node_seeds_params() -> None:
    from scripts.consultant_canonical import CanonicalParams
    from scripts.import_consultant import build_graph_rows, make_node_id

    cmap = _canonical_map(links=[{"to_map": "L6-02", "after_node": "N1"}])
    target_params = CanonicalParams(annual_count="7", fte="1.5")
    nodes, edges, warnings = build_graph_rows(cmap, link_targets={"L6-02": (99, target_params)})
    sp = next(n for n in nodes if n.node_type == "subprocess")
    assert sp.linked_map_id == 99 and sp.follow_latest is True
    assert sp.annual_count == "7" and sp.fte == "1.5"
    assert sp.source_node_id == make_node_id("L6-01", "__link__L6-02")
    by_id = {n.id: n for n in nodes}
    pairs = {
        (by_id[e.source_node_id].source_node_id, by_id[e.target_node_id].source_node_id)
        for e in edges
    }
    assert (make_node_id("L6-01", "N1"), sp.source_node_id) in pairs


def test_build_graph_rows_missing_link_target_warns() -> None:
    from scripts.import_consultant import build_graph_rows

    cmap = _canonical_map(links=[{"to_map": "GHOST"}])
    nodes, edges, warnings = build_graph_rows(cmap, link_targets={})
    assert not any(n.node_type == "subprocess" for n in nodes)
    assert any("GHOST" in w for w in warnings)


def _run(coro):
    import asyncio

    return asyncio.run(coro)


def _seed_import_employees() -> None:
    from app.db import SessionLocal
    from app.models import Employee

    async def _seed() -> None:
        async with SessionLocal() as session:
            for login, org in (("cons.owner", ("Consult Div", "Consult Team")), ("cons.appr", ())):
                if await session.get(Employee, login) is None:
                    orgs = dict(zip(("org_l1", "org_l2"), org))
                    session.add(Employee(login_id=login, name=login, source="local", active=False, **orgs))
            await session.commit()

    _run(_seed())


def test_upsert_categories_idempotent(client) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory
    from scripts.consultant_canonical import CanonicalCategory
    from scripts.import_consultant import upsert_categories

    cats = [
        CanonicalCategory(code="A", name="구매", level=1, parent=None),
        CanonicalCategory(code="A1", name="직접구매", level=2, parent="A"),
    ]

    async def _twice() -> tuple[dict, dict, list]:
        async with SessionLocal() as session:
            first = await upsert_categories(session, cats)
            await session.commit()
        cats[1].name = "직접구매(개정)"
        async with SessionLocal() as session:
            second = await upsert_categories(session, cats)
            await session.commit()
            # code로 좁혀 조회 — 세션 스코프 DB를 공유하는 test_categories_api.py의 CAT-* 시드가
            # 섞여도(파일 실행 순서 무관) 이 테스트의 대상 행만 본다.
            rows = (
                await session.scalars(
                    select(ProcessCategory)
                    .where(ProcessCategory.code.in_(["A", "A1"]))
                    .order_by(ProcessCategory.code)
                )
            ).all()
        return first, second, rows

    first, second, rows = _run(_twice())
    assert first == second  # 같은 code → 같은 id (멱등)
    assert [r.code for r in rows] == ["A", "A1"]
    assert rows[1].name == "직접구매(개정)" and rows[1].parent_id == first["A"]


def test_upsert_categories_recomputes_ui_child_levels(client) -> None:
    """delivery code(RCLV-*)만 업서트해도 UI 생성 자식(ui-* code, 임포트 대상 아님)의 level이
    조상 depth 변경에 맞춰 트리 전체 BFS로 따라와야 한다(merge review FIX 1 — level==depth
    불변식은 list_category_nodes 롤업·create/move의 parent.level+1 가드가 전제로 삼는다)."""
    from app.db import SessionLocal
    from app.models import ProcessCategory
    from scripts.consultant_canonical import CanonicalCategory
    from scripts.import_consultant import upsert_categories

    async def _flow() -> int:
        async with SessionLocal() as session:
            ids = await upsert_categories(
                session, [CanonicalCategory(code="RCLV-A", name="A", level=1, parent=None)]
            )
            # UI에서 만든 자식 — 생성 당시(A가 level 1)엔 level=2가 맞았다.
            ui_child = ProcessCategory(
                code="ui-rclv-child", name="UI child", level=2,
                parent_id=ids["RCLV-A"], sort_order=0,
            )
            session.add(ui_child)
            await session.commit()
            await session.refresh(ui_child)
            assert ui_child.level == 2
            ui_child_id = ui_child.id

        # 재전달 — A를 새 루트 아래 한 단계 더 깊게 재부모(level 1→2)
        async with SessionLocal() as session:
            await upsert_categories(
                session,
                [
                    CanonicalCategory(code="RCLV-ROOT", name="Root", level=1, parent=None),
                    CanonicalCategory(code="RCLV-A", name="A", level=2, parent="RCLV-ROOT"),
                ],
            )
            await session.commit()

        async with SessionLocal() as session:
            row = await session.get(ProcessCategory, ui_child_id)
            return row.level

    assert _run(_flow()) == 3  # A: 1→2, UI child follows: 2→3


def test_resolve_owning_department(client) -> None:
    from app.db import SessionLocal
    from app.orgchart import load_dept_index, load_valid_org_prefixes
    from scripts.import_consultant import resolve_owning_department

    _seed_import_employees()

    async def _resolve() -> list:
        async with SessionLocal() as session:
            known = await load_valid_org_prefixes(session)
            index = await load_dept_index(session)
            return [
                await resolve_owning_department(
                    session, known, index, "Consult Div/Consult Team", "cons.owner"
                ),
                await resolve_owning_department(session, known, index, "Nope/Nowhere", "cons.owner"),
                await resolve_owning_department(session, known, index, "", "cons.appr"),
            ]

    direct, fallback, none = _run(_resolve())
    assert direct == ("Consult Div/Consult Team", None)
    assert fallback[0] == "Consult Div/Consult Team" and "fallback" in (fallback[1] or "")
    assert none[0] is None and none[1] is not None


def test_resolve_owning_department_uses_dept_chain(client) -> None:
    """departments 체인 보유 오너의 폴백·known은 resolver 경로(트림 반영) — org 컬럼 원본이 아니다.

    조직 기준 전환(2026-08) 후 임포트가 raw org_l 조합을 쓰면 피커·오우닝 검증과 어긋난
    고아 경로가 박히는 회귀 가드.
    """
    from app.db import SessionLocal
    from app.models import Department, Employee
    from app.orgchart import load_dept_index, load_valid_org_prefixes
    from scripts.import_consultant import resolve_owning_department

    async def _arrange() -> None:
        async with SessionLocal() as session:
            if await session.get(Department, "CIMP-L1") is None:
                for code, parent, level, name in (
                    ("CIMP-L1", None, 1, "Consult Corp"),
                    ("CIMP-L2", "CIMP-L1", 2, "Consult Biz"),
                    ("CIMP-L3", "CIMP-L2", 3, "Consult Office"),
                    ("CIMP-L4", "CIMP-L3", 4, "Consult Chain Team"),
                ):
                    session.add(Department(dept_code=code, parent_dept_code=parent, level=level, name=name))
            if await session.get(Employee, "cons.chain") is None:
                session.add(Employee(
                    login_id="cons.chain", name="cons.chain", source="local", active=False,
                    dept_code="CIMP-L4", org_l1="Raw Legacy Div", org_l2="Raw Legacy Team",
                ))
            await session.commit()

    async def _resolve() -> tuple:
        async with SessionLocal() as session:
            known = await load_valid_org_prefixes(session)
            index = await load_dept_index(session)
            fallback = await resolve_owning_department(session, known, index, "", "cons.chain")
            raw_dept = await resolve_owning_department(
                session, known, index, "Raw Legacy Div/Raw Legacy Team", "cons.chain"
            )
            return known, fallback, raw_dept

    _run(_arrange())
    known, fallback, raw_dept = _run(_resolve())
    # 상위 2레벨(org_trim_levels) 트림 후 체인 경로만 유효 집합에 존재
    assert "Consult Office/Consult Chain Team" in known
    assert fallback[0] == "Consult Office/Consult Chain Team"
    # raw org 컬럼 조합은 더 이상 known이 아니다 → resolver 경로로 폴백
    assert raw_dept[0] == "Consult Office/Consult Chain Team" and "fallback" in (raw_dept[1] or "")


def _delivery(maps=None):
    from scripts.consultant_canonical import CanonicalCategory

    cats = [
        CanonicalCategory(code="A", name="구매", level=1, parent=None),
        CanonicalCategory(code="A1", name="직접구매", level=2, parent="A"),
    ]
    return cats, maps if maps is not None else [_canonical_map()]


async def _import_once(maps=None, label="Consultant import"):
    from app.db import SessionLocal
    from scripts.import_consultant import import_delivery

    cats, cmaps = _delivery(maps)
    async with SessionLocal() as session:
        report = await import_delivery(session, categories=cats, maps=cmaps, actor="admin.sys", label=label)
        await session.commit()
    return report


def test_initial_import_creates_published_map(client) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapApprover, MapPermission, MapVersion, Node, ProcessMap

    _seed_import_employees()
    report = _run(_import_once())
    assert report.counts() == {"created": 1}

    async def _load():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-01"))).one()
            v = (await session.scalars(select(MapVersion).where(MapVersion.map_id == m.id))).one()
            nodes = (await session.scalars(select(Node).where(Node.version_id == v.id))).all()
            perms = (await session.scalars(select(MapPermission).where(MapPermission.map_id == m.id))).all()
            apprs = (await session.scalars(select(MapApprover).where(MapApprover.map_id == m.id))).all()
        return m, v, nodes, perms, apprs

    m, v, nodes, perms, apprs = _run(_load())
    assert m.owner_id == "cons.owner" and m.owning_department == "Consult Div/Consult Team"
    assert m.category_id is not None and m.visibility == "public"
    assert m.sp_designated_at is not None and m.sp_input == "PR" and m.sp_output == "PO"
    assert m.sp_duration == "1.30"
    assert v.status == "published" and v.version_number == 1
    assert {n.node_type for n in nodes} == {"start", "process", "end"}
    assert [(p.principal_id, p.role) for p in perms] == [("cons.owner", "owner")]
    assert [a.user_id for a in apprs] == ["cons.appr"]


def test_reimport_unchanged_is_noop(client) -> None:
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap

    _seed_import_employees()
    _run(_import_once())

    async def _snapshot():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-01"))).one()
            return m.sp_changed_at, m.updated_at

    sp_changed_before, updated_before = _run(_snapshot())

    report = _run(_import_once())
    assert report.counts() == {"unchanged": 1}

    async def _count():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-01"))).one()
            return await session.scalar(select(func.count()).select_from(MapVersion).where(MapVersion.map_id == m.id))

    assert _run(_count()) == 1  # 새 버전 없음

    # 내용 무변경 재전달은 아무것도 쓰지 않는다 — 안 그러면 updated_at이 갱신돼 홈 목록
    # (updated_at desc)이 무변경 맵으로 도배되고 sp_changed_at 이력도 오염된다 (finding I-1).
    sp_changed_after, updated_after = _run(_snapshot())
    assert sp_changed_after == sp_changed_before
    assert updated_after == updated_before


def test_reimport_changed_publishes_new_version(client) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap

    _seed_import_employees()
    _run(_import_once())
    changed = _canonical_map()
    changed.nodes[0].name = "요청(개정)"
    report = _run(_import_once(maps=[changed], label="Delivery 2"))
    assert report.counts() == {"updated": 1}

    async def _versions():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-01"))).one()
            return (await session.scalars(
                select(MapVersion).where(MapVersion.map_id == m.id).order_by(MapVersion.id)
            )).all()

    versions = _run(_versions())
    assert [v.status for v in versions] == ["expired", "published"]
    assert versions[1].version_number == 2  # 현업 편집 있어도 같은 규칙 — 아무것도 안 막는다


def test_reimport_preserves_governance_fields(client) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessMap

    _seed_import_employees()
    _run(_import_once())

    async def _handover():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-01"))).one()
            m.owner_id = "someone.else"  # 이양 후 거버넌스 변경 시뮬레이션
            m.visibility = "private"
            await session.commit()

    _run(_handover())
    changed = _canonical_map(name="이름 개정")
    _run(_import_once(maps=[changed]))

    async def _load():
        async with SessionLocal() as session:
            return (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-01"))).one()

    m = _run(_load())
    assert m.owner_id == "someone.else" and m.visibility == "private"  # 거버넌스 불변
    assert m.name == "이름 개정"  # 콘텐츠는 갱신


def test_param_normalization_warnings(client) -> None:
    _seed_import_employees()
    bad = _canonical_map(code="L6-77", params={"duration": "about 3 days", "cost_krw": "100", "cost_usd": "1"})
    report = _run(_import_once(maps=[bad]))
    warnings = [r for r in report.rows if r[1] == "warning"]
    assert any("duration" in w[2] for w in warnings)
    assert any("cost" in w[2] for w in warnings)


def test_partial_redelivery_preserves_link_node_params(client) -> None:
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import MapVersion, Node, ProcessMap

    _seed_import_employees()
    a = _canonical_map(code="L6-PART-A", links=[{"to_map": "L6-PART-B"}])
    b = _canonical_map(code="L6-PART-B", params={"annual_count": "42", "fte": "3.0"})
    _run(_import_once(maps=[a, b]))

    # Delivery 2 — A만 재전달(내용 동일), B는 이전 전달분에만 있던 DB-only 연계 대상.
    a_again = _canonical_map(code="L6-PART-A", links=[{"to_map": "L6-PART-B"}])
    report = _run(_import_once(maps=[a_again], label="Delivery 2"))
    assert report.counts() == {"unchanged": 1}

    async def _load():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-PART-A"))).one()
            version_count = await session.scalar(
                select(func.count()).select_from(MapVersion).where(MapVersion.map_id == m.id)
            )
            v = (await session.scalars(
                select(MapVersion).where(MapVersion.map_id == m.id, MapVersion.status == "published")
            )).one()
            sp = (await session.scalars(
                select(Node).where(Node.version_id == v.id, Node.node_type == "subprocess")
            )).one()
        return version_count, sp

    version_count, sp = _run(_load())
    assert version_count == 1  # 새 버전 안 찍힘
    assert sp.annual_count == "42" and sp.fte == "3.0"  # 값 유실 없음


def test_duplicate_map_code_in_delivery_errors_on_second(client) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessMap

    _seed_import_employees()
    first = _canonical_map(code="L6-DUP-01", name="First")
    second = _canonical_map(code="L6-DUP-01", name="Second")
    report = _run(_import_once(maps=[first, second]))
    assert report.counts() == {"created": 1, "error": 1}
    assert ("L6-DUP-01", "error", "duplicate map code in delivery — skipped") in report.rows

    async def _load():
        async with SessionLocal() as session:
            return (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-DUP-01"))).one()

    m = _run(_load())
    assert m.name == "First"  # 첫 항목만 처리, 중복은 스킵


def test_link_target_uses_normalized_params(client) -> None:
    # 링크 대상(B)의 무효 annual_count가 정규화("" 소거) 없이 그대로 연계 노드에 박히던 버그
    # (finding I-2) — link_targets가 raw params 대신 정규화된 값을 써야 한다.
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, Node, ProcessMap

    _seed_import_employees()
    a = _canonical_map(code="L6-NORM-A", links=[{"to_map": "L6-NORM-B"}])
    b = _canonical_map(code="L6-NORM-B", params={"annual_count": "twelve"})
    report = _run(_import_once(maps=[a, b]))
    warnings = [r for r in report.rows if r[1] == "warning"]
    assert any(code == "L6-NORM-B" and "annual_count" in detail for code, _, detail in warnings)

    async def _load():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-NORM-A"))).one()
            v = (await session.scalars(
                select(MapVersion).where(MapVersion.map_id == m.id, MapVersion.status == "published")
            )).one()
            return (await session.scalars(
                select(Node).where(Node.version_id == v.id, Node.node_type == "subprocess")
            )).one()

    sp = _run(_load())
    assert sp.annual_count == ""  # 무효값은 드롭 — "twelve"가 그대로 새지 않는다


def test_reimport_trashed_map_errors(client) -> None:
    # 휴지통(소프트삭제) 맵을 재전달로 되살리지 않는다(finding I-3) — _purge_expired가 7일
    # 내 그 맵을 새로 얹은 버전째 영구삭제할 수 있어서다.
    from sqlalchemy import func, select

    from app.clock import now as now_kst
    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap

    _seed_import_employees()
    _run(_import_once(maps=[_canonical_map(code="L6-TRASH-1")]))

    async def _trash():
        async with SessionLocal() as session:
            found = (await session.scalars(
                select(ProcessMap).where(ProcessMap.consultant_code == "L6-TRASH-1")
            )).one()
            found.deleted_at = now_kst()
            await session.commit()

    _run(_trash())

    report = _run(_import_once(maps=[_canonical_map(code="L6-TRASH-1")], label="Delivery 2"))
    assert ("L6-TRASH-1", "error", "map is in trash — restore or purge before re-import") in report.rows

    async def _load():
        async with SessionLocal() as session:
            m = (await session.scalars(
                select(ProcessMap).where(ProcessMap.consultant_code == "L6-TRASH-1")
            )).one()
            version_count = await session.scalar(
                select(func.count()).select_from(MapVersion).where(MapVersion.map_id == m.id)
            )
        return m, version_count

    m, version_count = _run(_load())
    assert m.deleted_at is not None  # 휴지통 상태 불변 — 되살아나지 않음
    assert version_count == 1  # 재게시 없음(휴지통 맵은 pass 2에서 제외)


def test_duplicate_name_different_codes_warns_but_both_import(client) -> None:
    # 맵 이름 중복은 차단·강제개명 대상이 아니다(컨트롤러 결정, finding I-4) — 컨설턴트 식별은
    # consultant_code이므로 이름 충돌은 경고만 남기고 둘 다 정상 임포트한다.
    _seed_import_employees()
    first = _canonical_map(code="L6-NAME-1", name="Shared Name")
    second = _canonical_map(code="L6-NAME-2", name="Shared Name")
    report = _run(_import_once(maps=[first, second]))
    assert report.counts() == {"created": 2}
    warnings = [r for r in report.rows if r[1] == "warning"]
    assert any("duplicate map name" in detail for _, _, detail in warnings)


def test_annual_count_without_inbound_link_warns(client) -> None:
    # design §4 "아무것도 안 잃는다"의 반례 — annual_count/fte가 있는데 이번 전달분에 인바운드
    # 연계가 없으면 그 값은 어디에도 집계되지 않는다(finding I-6). 경고로 표면화.
    _seed_import_employees()
    report = _run(_import_once(maps=[_canonical_map(code="L6-LONE", links=[])]))
    warnings = [r for r in report.rows if r[1] == "warning" and r[0] == "L6-LONE"]
    assert any("landing site" in detail for _, _, detail in warnings)


def test_chunked_commit_across_both_passes(client) -> None:
    # commit_every=1로 3개 맵을 임포트 — pass 1(껍데기 생성)·pass 2(그래프/버전) 양쪽 모두
    # 맵마다 커밋 경계를 넘어야 한다. fix round 1: pass 1도 청크 커밋해야 크래시 시 미완성
    # 껍데기가 전달분 전체 규모로 쌓이지 않는다(design §8).
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap
    from scripts.import_consultant import import_delivery

    _seed_import_employees()
    codes = ["L6-CHNK-1", "L6-CHNK-2", "L6-CHNK-3"]
    maps = [_canonical_map(code=c) for c in codes]
    cats, cmaps = _delivery(maps)

    async def _apply_chunked():
        async with SessionLocal() as session:
            report = await import_delivery(
                session, categories=cats, maps=cmaps, actor="admin.sys",
                label="CHUNK", commit_every=1,
            )
            await session.commit()
        return report

    report = _run(_apply_chunked())
    assert report.counts() == {"created": 3}

    async def _load():
        async with SessionLocal() as session:
            out = []
            for code in codes:
                m = (await session.scalars(
                    select(ProcessMap).where(ProcessMap.consultant_code == code)
                )).one()
                v = (await session.scalars(
                    select(MapVersion).where(MapVersion.map_id == m.id, MapVersion.status == "published")
                )).one()
                out.append((m, v))
        return out

    results = _run(_load())
    assert len(results) == 3
    assert all(v.status == "published" for _, v in results)


# ── 인터뷰 임포트 확장 (design 2026-08-18) — owner 폴백·pending 거버넌스 예외·description ──


def test_owner_pending_column_registered() -> None:
    from app.db import _ADDED_COLUMNS

    assert ("process_maps", "consultant_owner_pending") in {(t, c) for t, c, _ in _ADDED_COLUMNS}


def test_owner_none_falls_back_to_actor_and_marks_pending(client) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapPermission, ProcessMap

    _seed_import_employees()
    cmap = _canonical_map(
        code="IV-P1", name="교정 준비", owner=None, approvers=[], department="",
        description="[Interview]\nGMP: yes",
    )
    report = _run(_import_once(maps=[cmap]))
    assert report.counts() == {"created": 1}
    assert any(a == "warning" and "owner missing" in d for _, a, d in report.rows)

    async def _load():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "IV-P1"))).one()
            perms = (await session.scalars(select(MapPermission).where(MapPermission.map_id == m.id))).all()
        return m, perms

    m, perms = _run(_load())
    assert m.owner_id == "admin.sys" and m.consultant_owner_pending is True
    assert m.owning_department is None  # actor 조직으로 오염 금지 — 실오너 배정 시 재해석 (design §4)
    assert m.description.startswith("[Interview]")
    assert [(p.principal_id, p.role) for p in perms] == [("admin.sys", "owner")]


def test_pending_map_governance_updated_on_redelivery_with_owner(client) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapApprover, MapPermission, ProcessMap

    _seed_import_employees()
    base = dict(code="IV-P2", name="교정 수행")
    _run(_import_once(maps=[_canonical_map(**base, owner=None, approvers=[], department="")]))
    report = _run(_import_once(maps=[_canonical_map(
        **base, owner="cons.owner", approvers=["cons.appr"], department="Consult Div/Consult Team",
    )]))
    assert any(a == "governance" for _, a, _ in report.rows)

    async def _load():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "IV-P2"))).one()
            perms = (await session.scalars(select(MapPermission).where(MapPermission.map_id == m.id))).all()
            apprs = (await session.scalars(select(MapApprover).where(MapApprover.map_id == m.id))).all()
        return m, perms, apprs

    m, perms, apprs = _run(_load())
    assert m.owner_id == "cons.owner" and m.consultant_owner_pending is False
    assert m.owning_department == "Consult Div/Consult Team"
    assert [(p.principal_id, p.role) for p in perms] == [("cons.owner", "owner")]
    assert [a.user_id for a in apprs] == ["cons.appr"]


def test_description_changes_detected_and_stable(client) -> None:
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap

    _seed_import_employees()

    def _make():
        return _canonical_map(code="IV-D1", name="설명 변경 감지")

    _run(_import_once(maps=[_make()]))

    # 맵 description만 변경 → fields_changed(updated), 새 버전 없음
    with_desc = _make()
    with_desc.description = "[Interview]\nStart condition: 주기 도래"
    report = _run(_import_once(maps=[with_desc]))
    assert report.counts() == {"updated": 1}

    # 노드 description 변경 → graph_changed → 새 버전 게시
    def _make_node_desc():
        m = _make()
        m.description = "[Interview]\nStart condition: 주기 도래"
        m.nodes[0].description = "EAM에서 작업지시를 연다"
        return m

    report2 = _run(_import_once(maps=[_make_node_desc()]))
    assert report2.counts() == {"updated": 1}

    async def _counts():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "IV-D1"))).one()
            n = await session.scalar(
                select(func.count()).select_from(MapVersion).where(MapVersion.map_id == m.id)
            )
        return m, n

    m, version_count = _run(_counts())
    assert m.description == "[Interview]\nStart condition: 주기 도래"
    assert version_count == 2

    # 동일 내용 재전달(새 객체) → unchanged — description이 시그니처를 흔들지 않는다
    report3 = _run(_import_once(maps=[_make_node_desc()]))
    assert report3.counts() == {"unchanged": 1}
    assert _run(_counts())[1] == 2
