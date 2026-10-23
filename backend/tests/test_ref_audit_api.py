"""고아 참조 감사 조회 API — GET /api/ref-audit(카드·범위·결과)와 /summary(빨간 점 소스), 설계 2026-10-23 §8."""

import asyncio
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import (
    Employee,
    MapPermission,
    MapVersion,
    Node,
    ProcessCategory,
    ProcessMap,
    UserGroup,
)
from app.settings import settings

SYSADMIN = "api.admin"


@pytest.fixture
def enforced() -> Iterator[None]:
    prev_enforce, prev_sys = settings.dev_enforce_permissions, settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.dev_enforce_permissions, settings.bpm_sysadmins = prev_enforce, prev_sys


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _as(login: str) -> dict[str, str]:
    return {"X-Dev-User": login}


def _actor(login: str) -> Employee:
    """조직 경로가 있는 재직 직원 — 경로가 빈 사용자는 다른 테스트가 남긴 빈 principal 부서 권한에 걸려 범위가 새는 것을 막는다."""
    return Employee(login_id=login, name=login, source="local", active=True, org_l1=f"Actor Org {login}")


def _grant(m: ProcessMap, login: str, role: str) -> MapPermission:
    return MapPermission(map_id=m.id, principal_type="user", principal_id=login, role=role, granted_by="seed")


async def _new_map(session, name: str, *, owner: str, **kw: object) -> ProcessMap:
    m = ProcessMap(name=f"{name} {_uid()}", visibility="private", created_by=owner, owner_id=owner, **kw)
    session.add(m)
    await session.flush()
    return m


async def _add_version(
    session, map_id: int, status: str, departments: list[str], *, holder: str | None = None
) -> MapVersion:
    version = MapVersion(map_id=map_id, label=f"{status} {_uid()}", status=status, checked_out_by=holder)
    session.add(version)
    await session.flush()
    session.add_all(
        Node(id=f"api-{_uid()}", version_id=version.id, title=f"n{i}", department=department)
        for i, department in enumerate(departments)
    )
    return version


def _get_audit(client: TestClient, login: str) -> dict:
    res = client.get("/api/ref-audit", headers=_as(login))
    assert res.status_code == 200, res.text
    return res.json()


def _card(cards: list[dict], key: str) -> dict:
    return next(c for c in cards if c["key"] == key)


# ── 범위·결과 ─────────────────────────────────────────────────────────────


def test_get_ref_audit_editor_scope_and_outcomes(client: TestClient, enforced: None) -> None:
    """Editor는 자기 맵 줄만 본다(남의 맵 줄 없음). 줄마다 결과가 있고 맵 줄엔 역할·버전 라벨이 실린다."""
    tag = _uid()
    editor, owner, stale = f"ed.{tag}", f"own.{tag}", f"Gone Team {tag}"

    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            session.add_all([_actor(editor), Employee(login_id=owner, name=f"Owner {tag}", source="local", active=True)])
            mine = await _new_map(session, "mine", owner=owner, sp_department=stale)
            other = await _new_map(session, "other", owner=owner, sp_department=stale)
            session.add_all([_grant(mine, owner, "owner"), _grant(mine, editor, "editor"),
                             _grant(other, owner, "owner")])
            await _add_version(session, mine.id, "published", [])
            draft = await _add_version(session, mine.id, "draft", [stale, stale], holder=editor)
            await session.commit()
            return {"mine": mine.id, "other": other.id, "draft": draft.id, "label": draft.label}

    ids = asyncio.run(_seed())
    body = _get_audit(client, editor)

    assert set(body) == {"departments", "users", "scope", "generated_at"}
    assert body["scope"] == {"maps": 1, "groups": 0, "categories": 0}
    card = _card(body["departments"], stale)
    assert card["kind"] == "dept" and card["label"] == stale and card["sub"] == ""
    assert {ln["map_id"] for ln in card["lines"]} == {ids["mine"]}
    by_source = {ln["source"]: ln for ln in card["lines"]}
    assert set(by_source) == {"sp_dept", "node_dept"}
    assert all(ln["outcome"] for ln in card["lines"])
    sp_line = by_source["sp_dept"]
    assert sp_line["outcome"] == "notify" and sp_line["map_role"] == "editor"
    assert sp_line["notify_to"] == {"id": owner, "name": f"Owner {tag}", "role": "owner"}
    assert sp_line["from_value"] == stale and sp_line["version_id"] is None
    node_line = by_source["node_dept"]
    assert node_line["outcome"] == "direct" and node_line["count"] == 2
    assert node_line["version_id"] == ids["draft"] and node_line["version_label"] == ids["label"]
    assert node_line["version_status"] == "draft"


def test_card_line_version_status_follows_working_state(client: TestClient, enforced: None) -> None:
    """작업본을 겨냥한 줄은 그 작업본 상태를, 게시본을 겨냥한 줄(새 Draft·게시 대기)은 published를 싣는다."""
    tag = _uid()
    editor, stale = f"ed.{tag}", f"Gone Team {tag}"

    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            session.add(_actor(editor))
            rejected = await _new_map(session, "rejected", owner=f"own.{tag}")
            fresh = await _new_map(session, "fresh", owner=f"own.{tag}")
            waiting = await _new_map(session, "waiting", owner=f"own.{tag}")
            session.add_all(_grant(m, editor, "editor") for m in (rejected, fresh, waiting))
            await _add_version(session, rejected.id, "published", [])
            await _add_version(session, rejected.id, "rejected", [stale])
            await _add_version(session, fresh.id, "published", [stale])
            await _add_version(session, waiting.id, "published", [stale])
            await _add_version(session, waiting.id, "draft", [""])
            await session.commit()
            return {"rejected": rejected.id, "fresh": fresh.id, "waiting": waiting.id}

    ids = asyncio.run(_seed())
    lines = {ln["map_id"]: ln for ln in _card(_get_audit(client, editor)["departments"], stale)["lines"]}

    assert lines[ids["rejected"]]["version_status"] == "rejected"
    assert lines[ids["fresh"]]["outcome"] == "new_draft" and lines[ids["fresh"]]["version_status"] == "published"
    assert lines[ids["waiting"]]["outcome"] == "pending" and lines[ids["waiting"]]["version_status"] == "published"
    assert all(ln["version_label"] for ln in lines.values())


def test_viewer_only_user_sees_empty_page(client: TestClient, enforced: None) -> None:
    """뷰어 권한뿐인 사용자는 고칠 곳이 없다 — 403이 아니라 빈 카드·0 범위·요약 0."""
    tag = _uid()
    viewer, stale = f"view.{tag}", f"Gone Team {tag}"

    async def _seed() -> None:
        async with SessionLocal() as session:
            m = await _new_map(session, "viewed", owner=f"own.{tag}", sp_department=stale)
            session.add_all([_actor(viewer), _grant(m, viewer, "viewer")])
            await session.commit()

    asyncio.run(_seed())
    body = _get_audit(client, viewer)

    assert body["departments"] == [] and body["users"] == []
    assert body["scope"] == {"maps": 0, "groups": 0, "categories": 0}
    assert client.get("/api/ref-audit/summary", headers=_as(viewer)).json() == {"actionable": 0}


def test_scope_counts_for_sysadmin_match_live_rows(client: TestClient, enforced: None) -> None:
    """sysadmin 범위 = 살아 있는 맵·그룹 전부 + 모든 카테고리(소프트삭제는 뺀다)."""

    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            await _new_map(session, "scope live", owner="user.lee")
            session.add(UserGroup(name=f"scope group {_uid()}", status="active", created_by="user.lee"))
            session.add(ProcessCategory(code=f"PC-A-{_uid()}", name="scope", level=1))
            await session.commit()
            return {
                "maps": await session.scalar(
                    select(func.count()).select_from(ProcessMap).where(ProcessMap.deleted_at.is_(None))),
                "groups": await session.scalar(
                    select(func.count()).select_from(UserGroup).where(UserGroup.deleted_at.is_(None))),
                "categories": await session.scalar(select(func.count()).select_from(ProcessCategory)),
            }

    expected = asyncio.run(_seed())

    assert _get_audit(client, SYSADMIN)["scope"] == expected


# ── 카드 합치기 ───────────────────────────────────────────────────────────


def _seed_dept_card(tag: str, owner: str) -> tuple[str, str]:
    """같은 부서를 경로 그룹(오우닝)과 리프 그룹(SP 부서)으로 참조하는 맵의 오너 소유 시드 → (리프명, 경로)."""
    leaf = f"Leaf {tag}"
    path = f"Gone Div {tag}/Gone Office {tag}/{leaf}"

    async def _seed() -> None:
        async with SessionLocal() as session:
            m = await _new_map(session, "dept card", owner=owner, owning_department=path, sp_department=leaf)
            session.add(_grant(m, owner, "owner"))
            await session.commit()

    asyncio.run(_seed())
    return leaf, path


def test_cards_merge_path_and_leaf_into_one_dept_card(client: TestClient, enforced: None) -> None:
    tag = _uid()
    owner = f"own.{tag}"
    leaf, _path = _seed_dept_card(tag, owner)

    body = _get_audit(client, owner)

    cards = [c for c in body["departments"] if c["label"] == leaf]
    assert len(cards) == 1
    card = cards[0]
    assert card["key"] == leaf and card["sub"] == f"Gone Div {tag} › Gone Office {tag}"
    assert {ln["source"] for ln in card["lines"]} == {"owning_dept", "sp_dept"}


def test_cards_merge_keeps_per_line_from_value(client: TestClient, enforced: None) -> None:
    """합쳐진 카드의 줄은 각자 원래 그룹의 값(경로 또는 리프)을 from_value로 가진다 — 적용은 줄별 값으로 한다."""
    tag = _uid()
    owner = f"own.{tag}"
    leaf, path = _seed_dept_card(tag, owner)

    card = _card(_get_audit(client, owner)["departments"], leaf)

    from_values = {ln["source"]: ln["from_value"] for ln in card["lines"]}
    assert from_values == {"owning_dept": path, "sp_dept": leaf}


def test_cards_merge_login_and_name_into_one_user_card(client: TestClient, enforced: None) -> None:
    """로그인 그룹과 이름(표시명·한글명) 그룹이 같은 퇴직자면 한 카드 — 못 찾은 이름은 값 그대로 별도 카드."""
    tag = _uid()
    login, name, korean, nobody = f"gone.{tag}", f"Gone Person {tag}", f"탈퇴 {tag}", f"Nobody {tag}"

    async def _seed() -> None:
        async with SessionLocal() as session:
            session.add(Employee(login_id=login, name=name, korean_name=korean, source="local", active=False))
            await _new_map(session, "gone owner", owner=login)
            await _new_map(session, "by name", owner="user.lee", sp_assignee=name)
            await _new_map(session, "by korean", owner="user.lee", sp_assignee=korean)
            await _new_map(session, "unknown", owner="user.lee", sp_assignee=nobody)
            await session.commit()

    asyncio.run(_seed())
    users = _get_audit(client, SYSADMIN)["users"]

    merged = [c for c in users if c["key"] == login]
    assert len(merged) == 1
    card = merged[0]
    assert card["kind"] == "user" and card["label"] == name and card["sub"] == login
    assert sorted(ln["source"] for ln in card["lines"]) == ["map_owner", "sp_assignee", "sp_assignee"]
    assert {ln["from_value"] for ln in card["lines"]} == {login, name, korean}
    assert not [c for c in users if c["key"] in (name, korean)]
    unknown = _card(users, nobody)
    assert unknown["label"] == nobody and unknown["sub"] == ""


# ── 요약(빨간 점) ─────────────────────────────────────────────────────────


def test_summary_counts_only_actionable_places(client: TestClient, enforced: None) -> None:
    """direct·checkout·new_draft·approval 줄의 곳 수 합만 센다 — 알림·잠김·게시 대기는 점을 켜지 않는다."""
    tag = _uid()
    actor, owner, holder, stale = f"act.{tag}", f"own.{tag}", f"hold.{tag}", f"Gone Team {tag}"

    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            session.add_all([_actor(actor), *(Employee(login_id=login, name=login, source="local", active=True)
                                              for login in (owner, holder))])
            mine = await _new_map(session, "mine", owner=owner, sp_department=stale)  # sp_dept -> notify
            fresh = await _new_map(session, "fresh", owner=owner)
            held = await _new_map(session, "held", owner=owner)
            waiting = await _new_map(session, "waiting", owner=owner)
            locked = await _new_map(session, "locked", owner=owner)
            for m in (mine, fresh, held, waiting, locked):
                session.add(_grant(m, actor, "editor"))
            await _add_version(session, mine.id, "draft", [stale, stale], holder=actor)  # direct, 2곳
            await _add_version(session, fresh.id, "published", [stale])  # new_draft, 1곳
            await _add_version(session, held.id, "draft", [stale], holder=holder)  # notify
            await _add_version(session, waiting.id, "published", [stale])
            await _add_version(session, waiting.id, "draft", [""])  # pending
            await _add_version(session, locked.id, "published", [])
            await _add_version(session, locked.id, "pending", [stale])  # locked
            await session.commit()
            return {"mine": mine.id, "fresh": fresh.id, "held": held.id, "waiting": waiting.id,
                    "locked": locked.id}

    ids = asyncio.run(_seed())
    lines = {(ln["map_id"], ln["source"]): ln["outcome"]
             for ln in _card(_get_audit(client, actor)["departments"], stale)["lines"]}

    assert lines == {
        (ids["mine"], "sp_dept"): "notify", (ids["mine"], "node_dept"): "direct",
        (ids["fresh"], "node_dept"): "new_draft", (ids["held"], "node_dept"): "notify",
        (ids["waiting"], "node_dept"): "pending", (ids["locked"], "node_dept"): "locked",
    }
    assert client.get("/api/ref-audit/summary", headers=_as(actor)).json() == {"actionable": 3}


def test_admin_ref_audit_routes_removed(client: TestClient, enforced: None) -> None:
    """관리 전용 조회 경로는 사라졌다 — 새 경로가 로그인만 요구하는 대체다."""
    assert client.get("/api/admin/ref-audit", headers=_as(SYSADMIN)).status_code == 404
