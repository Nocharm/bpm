"""AD distinguishedName → 조직 레벨 파싱 + 동기화 제외 판정 (순수 함수, design 2026-06-16 §4)."""

import re
from dataclasses import dataclass

# 조직 OU에서 제외할 토큰 — 대소문자·공백 정확 일치
EXCLUDED_OU_TOKENS = frozenset(
    {"BioLogics Users", "BioLogics Groups", "SAMSUNGBIOLOGICS", "President & CEO"}
)
# org_l1이 이 중 하나면 동기화 제외
EXCLUDED_ORG_L1 = frozenset(
    {"Partners", "Partner", "External users", "delete", "Client", "TEST", "View"}
)


@dataclass(frozen=True)
class OrgLevels:
    org_l1: str | None
    org_l2: str | None
    org_l3: str | None
    org_l4: str | None
    org_l5: str | None
    department: str


def _extract_ou_values(dn: str) -> list[str]:
    """DN에서 OU= 값만 등장순(리프→루트)으로. 이스케이프된 콤마(\\,)는 분리하지 않는다."""
    parts = re.split(r"(?<!\\),", dn)
    values: list[str] = []
    for part in parts:
        attr, sep, value = part.strip().partition("=")
        if sep and attr.strip().upper() == "OU":
            values.append(value.strip().replace("\\,", ","))
    return values


def parse_org(dn: str) -> OrgLevels:
    leaf_to_root = _extract_ou_values(dn)
    kept = [ou for ou in leaf_to_root if ou not in EXCLUDED_OU_TOKENS]
    root_to_leaf = list(reversed(kept))
    top5 = root_to_leaf[:5]  # 5개 초과면 루트 쪽 5개
    l1 = top5[0] if len(top5) > 0 else None
    l2 = top5[1] if len(top5) > 1 else None
    l3 = top5[2] if len(top5) > 2 else None
    l4 = top5[3] if len(top5) > 3 else None
    l5 = top5[4] if len(top5) > 4 else None
    department = l5 or l4 or l3 or l2 or l1 or ""
    return OrgLevels(l1, l2, l3, l4, l5, department)


def org_path(
    l1: str | None,
    l2: str | None,
    l3: str | None,
    l4: str | None,
    l5: str | None,
    department: str,
) -> str:
    """조직 레벨을 루트→리프 "/" 구분 문자열로. 모두 None이면 department 반환.

    부서 principal_id 규약: 관리자는 이 문자열로 부서에 권한을 부여하고,
    Task 2 매처가 emp.org_path == P 또는 startswith(P + "/") 로 소속 판정.
    """
    levels = [lv for lv in (l1, l2, l3, l4, l5) if lv is not None]
    return "/".join(levels) if levels else department


def is_active(uac: int | None) -> bool:
    """Derive account active status from userAccountControl.

    AD bit 0x2 (ACCOUNTDISABLE) set → account disabled → active=False.
    Missing uac (attribute not returned by AD) → treated as active (conservative default).
    """
    if uac is None:
        return True
    return not bool(uac & 0x2)


def is_excluded(org_l1: str | None, login_id: str, name: str) -> bool:
    if org_l1 in EXCLUDED_ORG_L1:
        return True
    if "." not in login_id:
        return True
    if "_" in name:
        return True
    return False
