"""canonical 전달물 파서 테스트 — DB 무관 순수 검증."""

import json
from pathlib import Path

import pytest

from scripts.consultant_canonical import (
    CanonicalError,
    CanonicalMap,
    load_categories,
    load_maps,
)


def write(path: Path, obj: object) -> Path:
    path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    return path


CATS = [
    {"code": "A", "name": "구매", "level": 1, "parent": None},
    {"code": "A1", "name": "직접구매", "level": 2, "parent": "A"},
]


def test_load_categories_ok(tmp_path: Path) -> None:
    cats = load_categories(write(tmp_path / "categories.json", {"categories": CATS}))
    assert [c.code for c in cats] == ["A", "A1"]
    assert cats[1].parent == "A"


def test_load_categories_rejects_bad_tree(tmp_path: Path) -> None:
    dup = {"categories": CATS + [{"code": "A", "name": "중복", "level": 1, "parent": None}]}
    with pytest.raises(CanonicalError, match="duplicate"):
        load_categories(write(tmp_path / "c1.json", dup))
    orphan = {"categories": [{"code": "B1", "name": "고아", "level": 2, "parent": "NOPE"}]}
    with pytest.raises(CanonicalError, match="parent"):
        load_categories(write(tmp_path / "c2.json", orphan))
    skip = {"categories": [CATS[0], {"code": "A9", "name": "레벨점프", "level": 3, "parent": "A"}]}
    with pytest.raises(CanonicalError, match="level"):
        load_categories(write(tmp_path / "c3.json", skip))


def make_map(**over: object) -> dict:
    base = {
        "code": "L6-01", "name": "원자재 구매", "category": "A1", "owner": "hong.gd",
        "approvers": ["kim.cs"], "department": "Div/Team", "visibility": "public",
        "params": {"duration": "1.30", "input": "PR", "output": "PO"},
        "nodes": [
            {"code": "N1", "name": "요청", "type": "process", "seq": 1},
            {"code": "N2", "name": "승인", "type": "decision", "seq": 2},
        ],
        "edges": [{"from": "N1", "to": "N2", "label": ""}],
        "links": [{"to_map": "L6-02", "after_node": "N2"}],
    }
    base.update(over)
    return base


def test_load_maps_jsonl(tmp_path: Path) -> None:
    lines = [json.dumps(make_map()), "", json.dumps(make_map(code="L6-02", links=[]))]
    maps, errors = load_maps((tmp_path / "maps.jsonl").write_text("\n".join(lines), encoding="utf-8") and tmp_path / "maps.jsonl")
    assert errors == []
    assert [m.code for m in maps] == ["L6-01", "L6-02"]
    assert maps[0].edges[0].source == "N1"  # "from" alias 매핑
    assert maps[0].params.input == "PR"


def test_load_maps_collects_line_errors(tmp_path: Path) -> None:
    bad_edge = make_map(code="L6-03", edges=[{"from": "N1", "to": "GHOST"}])
    lines = [json.dumps(make_map()), "{broken json", json.dumps(bad_edge)]
    path = tmp_path / "maps.jsonl"
    path.write_text("\n".join(lines), encoding="utf-8")
    maps, errors = load_maps(path)
    assert [m.code for m in maps] == ["L6-01"]
    assert len(errors) == 2
    assert "line 2" in errors[0]
    assert "line 3" in errors[1] and "GHOST" in errors[1]


def test_map_validates_duplicate_node_codes() -> None:
    with pytest.raises(ValueError, match="duplicate node code"):
        CanonicalMap.model_validate(
            make_map(nodes=[{"code": "N1", "name": "a", "type": "process", "seq": 1},
                            {"code": "N1", "name": "b", "type": "process", "seq": 2}])
        )


def test_map_validates_duplicate_link_targets() -> None:
    # 같은 to_map을 두 번 링크하면 가상 노드 code(__link__{to_map})가 충돌해 계보/배선이 꼬인다
    # (finding M-1) — 파서 단계에서 명확한 에러로 막는다.
    with pytest.raises(ValueError, match="duplicate link target"):
        CanonicalMap.model_validate(
            make_map(links=[{"to_map": "L6-02"}, {"to_map": "L6-02", "after_node": "N2"}])
        )


def test_load_maps_rejects_overlong_fields(tmp_path: Path) -> None:
    # Node.department/assignee/system과 MapApprover.user_id는 각각 String(100) — sqlite는 폭을
    # 안 걸지만 postgres(서버)는 apply 중 크래시한다(finding I-5). 파서 단계 max_length로 막아
    # load_maps가 라인 에러로 수집하게 한다(크래시 아님).
    long_dept = "x" * 101
    long_approver = "y" * 101
    bad_department = make_map(code="L6-04", nodes=[
        {"code": "N1", "name": "요청", "type": "process", "seq": 1, "department": long_dept},
        {"code": "N2", "name": "승인", "type": "decision", "seq": 2},
    ])
    bad_approver = make_map(code="L6-05", approvers=[long_approver])
    lines = [json.dumps(bad_department), json.dumps(bad_approver)]
    path = tmp_path / "maps.jsonl"
    path.write_text("\n".join(lines), encoding="utf-8")
    maps, errors = load_maps(path)
    assert maps == []
    assert len(errors) == 2
