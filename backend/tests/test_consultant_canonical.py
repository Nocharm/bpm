"""canonical 모델 검증 테스트 — DB 무관 순수 검증.

canonical은 외부 전달 양식이 아니라 내부 IR — 인터뷰 어댑터(consultant_interview)가 생성하고
import_delivery가 소비한다(2026-08-18 전환, 파일 로더/CLI는 제거됨).
"""

import pytest
from pydantic import ValidationError

from scripts.consultant_canonical import CanonicalError, CanonicalMap, parse_categories

CATS = [
    {"code": "A", "name": "구매", "level": 1, "parent": None},
    {"code": "A1", "name": "직접구매", "level": 2, "parent": "A"},
]


def test_parse_categories_ok() -> None:
    cats = parse_categories({"categories": CATS})
    assert [c.code for c in cats] == ["A", "A1"]
    assert cats[1].parent == "A"


def test_parse_categories_rejects_bad_tree() -> None:
    dup = {"categories": CATS + [{"code": "A", "name": "중복", "level": 1, "parent": None}]}
    with pytest.raises(CanonicalError, match="duplicate"):
        parse_categories(dup)
    orphan = {"categories": [{"code": "B1", "name": "고아", "level": 2, "parent": "NOPE"}]}
    with pytest.raises(CanonicalError, match="parent"):
        parse_categories(orphan)
    skip = {"categories": [CATS[0], {"code": "A9", "name": "레벨점프", "level": 3, "parent": "A"}]}
    with pytest.raises(CanonicalError, match="level"):
        parse_categories(skip)


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


def test_map_from_alias_and_params() -> None:
    m = CanonicalMap.model_validate(make_map())
    assert m.edges[0].source == "N1"  # "from" alias 매핑
    assert m.params.input == "PR"


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


def test_long_input_output_accepted() -> None:
    # sp_input/sp_output은 Text(자유 텍스트, design §2.2) — 숫자형 6필드와 달리 상한이 없다.
    # I-5 픽스에서 실수로 걸었던 50자 상한을 되풀이하지 않도록 회귀 가드.
    long_input = "가" * 500
    long_output = "나" * 500
    m = CanonicalMap.model_validate(make_map(params={"input": long_input, "output": long_output}))
    assert m.params.input == long_input
    assert m.params.output == long_output


def test_overlong_column_fields_rejected() -> None:
    # Node.department와 MapApprover.user_id는 String(100) — sqlite는 폭을 안 걸지만
    # postgres(서버)는 apply 중 크래시한다(finding I-5). 모델 max_length가 사전에 막고,
    # 인터뷰 어댑터는 이 ValidationError를 행 단위 error issue로 수집한다.
    bad_department = make_map(code="L6-04", nodes=[
        {"code": "N1", "name": "요청", "type": "process", "seq": 1, "department": "x" * 101},
    ])
    with pytest.raises(ValidationError):
        CanonicalMap.model_validate(bad_department)
    with pytest.raises(ValidationError):
        CanonicalMap.model_validate(make_map(code="L6-05", approvers=["y" * 101]))
