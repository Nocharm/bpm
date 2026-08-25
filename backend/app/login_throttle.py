"""로그인 시도 제한 — 앱이 AD에 무제한 bind를 중계해 실계정을 잠그는 것을 막는다 (설계 §4).

프로세스 메모리에만 둔다. 백엔드는 단일 uvicorn 프로세스라 이걸로 충분하다.
"""

from app.clock import now as now_kst

# 임계치를 올리면 무차별 대입 여지가 커지고, 내리면 오타 몇 번에 잠긴다. AD 기본 잠금정책보다 빡빡하게.
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 300

_failures: dict[str, list[float]] = {}


def check_and_count(key: str) -> bool:
    """윈도 내 실패가 임계 미만이면 True. 호출 자체는 카운트하지 않는다."""
    now = now_kst().timestamp()
    recent = [t for t in _failures.get(key, []) if now - t < WINDOW_SECONDS]
    # recent가 비면 키를 남기지 않는다 — 안 그러면 무작위 loginId를 뿌리는 스캐너가
    # dict를 무한히 키운다(딕셔너리는 프로세스 재시작 전까지 절대 안 줄어든다).
    if recent:
        _failures[key] = recent
    else:
        _failures.pop(key, None)
    return len(recent) < MAX_ATTEMPTS


def record_failure(key: str) -> None:
    _failures.setdefault(key, []).append(now_kst().timestamp())


def reset(key: str) -> None:
    """로그인 성공 시 호출 — 정상 사용자가 이전 오타로 잠기지 않게."""
    _failures.pop(key, None)


def clear_all() -> None:
    """테스트 전용."""
    _failures.clear()
