"""로그인 시도 제한 — 앱이 AD에 무제한 bind를 중계해 실계정을 잠그는 것을 막는다 (설계 §4).

프로세스 메모리에만 둔다. 백엔드는 단일 uvicorn 프로세스라 이걸로 충분하다.
"""

from app.clock import now as now_kst

# 임계치를 올리면 무차별 대입 여지가 커지고, 내리면 오타 몇 번에 잠긴다. AD 기본 잠금정책보다 빡빡하게.
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 300

_failures: dict[str, list[float]] = {}


def check_and_count(key: str) -> bool:
    """윈도 내 시도가 임계 미만이면 이번 시도를 세고 True. 성공하면 reset이 지운다.

    느린 AD bind 전에 센다 — 실패를 bind 뒤에만 세면 동시 요청 수십 건이 전부 검사를 통과해 AD bind로
    중계돼, 막으려던 AD 계정 잠금을 오히려 키웠다 (리뷰 2026-10-19 C-6). 검사와 기록 사이에 await가 없어
    단일 이벤트 루프에서 원자적이다.
    """
    now = now_kst().timestamp()
    recent = [t for t in _failures.get(key, []) if now - t < WINDOW_SECONDS]
    if len(recent) >= MAX_ATTEMPTS:
        _failures[key] = recent
        return False
    recent.append(now)
    _failures[key] = recent
    return True


def reset(key: str) -> None:
    """로그인 성공 시 호출 — 정상 사용자가 이전 오타로 잠기지 않게."""
    _failures.pop(key, None)


def clear_all() -> None:
    """테스트 전용."""
    _failures.clear()
