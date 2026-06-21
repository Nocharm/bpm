"""DN 조직 파싱·필터 순수 함수 테스트 (AAA)."""

from app.ad.org import is_excluded, org_path, parse_org


def test_parse_org_four_levels() -> None:
    dn = "CN=Hong,OU=Team A,OU=Dept B,OU=Div C,OU=SAMSUNGBIOLOGICS,DC=corp,DC=com"
    org = parse_org(dn)
    # 제외 토큰(SAMSUNGBIOLOGICS) 제거 후 루트→리프: Div C, Dept B, Team A
    assert (org.org_l1, org.org_l2, org.org_l3) == ("Div C", "Dept B", "Team A")
    assert (org.org_l4, org.org_l5) == (None, None)
    assert org.department == "Team A"


def test_parse_org_excludes_tokens_exact_case() -> None:
    dn = "OU=Team,OU=President & CEO,OU=BioLogics Users,DC=corp"
    org = parse_org(dn)
    assert org.org_l1 == "Team"  # 제외 토큰 모두 제거, 남은 Team 하나
    assert org.department == "Team"


def test_parse_org_five_levels_uses_root_five() -> None:
    # 4 OU: 루트→리프 L1,L2,L3,Leaf — 5레벨로 확장되어 l4까지 채워짐
    dn = "OU=Leaf,OU=L3,OU=L2,OU=L1,DC=corp"
    org = parse_org(dn)
    assert (org.org_l1, org.org_l2, org.org_l3, org.org_l4, org.org_l5) == ("L1", "L2", "L3", "Leaf", None)
    assert org.department == "Leaf"

    # 6 OU: 5개 초과이므로 루트 쪽 5개만
    dn6 = "OU=L6,OU=L5,OU=L4,OU=L3,OU=L2,OU=L1,DC=corp"
    org6 = parse_org(dn6)
    assert (org6.org_l1, org6.org_l2, org6.org_l3, org6.org_l4, org6.org_l5) == ("L1", "L2", "L3", "L4", "L5")
    assert org6.department == "L5"


def test_parse_org_fewer_levels_department_fallback() -> None:
    org = parse_org("OU=Only,DC=corp")
    assert (org.org_l1, org.org_l2, org.org_l3, org.org_l4, org.org_l5) == ("Only", None, None, None, None)
    assert org.department == "Only"
    empty = parse_org("CN=NoOu,DC=corp")
    assert empty.department == ""


def test_org_path_joins_levels() -> None:
    # 정상 케이스 — l1~l3만
    assert org_path("A", "B", "C", None, None, "C") == "A/B/C"
    # 5레벨 모두
    assert org_path("A", "B", "C", "D", "E", "E") == "A/B/C/D/E"
    # 모두 None → department 반환 (로컬 시드 폴백)
    assert org_path(None, None, None, None, None, "구매팀") == "구매팀"
    # 일부만
    assert org_path("A", None, None, None, None, "A") == "A"


def test_is_excluded_rules() -> None:
    assert is_excluded("Partners", "a.b", "Name") is True  # org_l1 블랙리스트
    assert is_excluded("Sales", "nodot", "Name") is True  # loginId에 '.' 없음
    assert is_excluded("Sales", "a.b", "Bad_Name") is True  # name에 '_' 포함
    assert is_excluded("Sales", "a.b", "Good Name") is False
