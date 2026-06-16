"""DN 조직 파싱·필터 순수 함수 테스트 (AAA)."""

from app.ad.org import is_excluded, parse_org


def test_parse_org_four_levels() -> None:
    dn = "CN=Hong,OU=Team A,OU=Dept B,OU=Div C,OU=SAMSUNGBIOLOGICS,DC=corp,DC=com"
    org = parse_org(dn)
    # 제외 토큰(SAMSUNGBIOLOGICS) 제거 후 루트→리프: Div C, Dept B, Team A
    assert (org.org_l1, org.org_l2, org.org_l3) == ("Div C", "Dept B", "Team A")
    assert org.department == "Team A"


def test_parse_org_excludes_tokens_exact_case() -> None:
    dn = "OU=Team,OU=President & CEO,OU=BioLogics Users,DC=corp"
    org = parse_org(dn)
    assert org.org_l1 == "Team"  # 제외 토큰 모두 제거, 남은 Team 하나
    assert org.department == "Team"


def test_parse_org_more_than_three_uses_root_three() -> None:
    dn = "OU=Leaf,OU=L3,OU=L2,OU=L1,DC=corp"  # 리프→루트: Leaf,L3,L2,L1
    org = parse_org(dn)
    # 루트→리프 L1,L2,L3,Leaf 중 루트 3개
    assert (org.org_l1, org.org_l2, org.org_l3) == ("L1", "L2", "L3")
    assert org.department == "L3"


def test_parse_org_fewer_levels_department_fallback() -> None:
    org = parse_org("OU=Only,DC=corp")
    assert (org.org_l1, org.org_l2, org.org_l3) == ("Only", None, None)
    assert org.department == "Only"
    empty = parse_org("CN=NoOu,DC=corp")
    assert empty.department == ""


def test_is_excluded_rules() -> None:
    assert is_excluded("Partners", "a.b", "Name") is True  # org_l1 블랙리스트
    assert is_excluded("Sales", "nodot", "Name") is True  # loginId에 '.' 없음
    assert is_excluded("Sales", "a.b", "Bad_Name") is True  # name에 '_' 포함
    assert is_excluded("Sales", "a.b", "Good Name") is False
