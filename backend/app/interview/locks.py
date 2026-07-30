"""인터뷰 세션 단위 asyncio 락 — 턴·draw·첨부 추출의 facts/seq lost-update 방지 (hardening T3).

프로세스 내 직렬화 전제: uvicorn 단일 워커(compose 기본). 멀티 워커 전환 시 DB 락으로 대체 필요.
"""

import asyncio

# 루프별 레지스트리 — asyncio.Lock은 루프에 묶이므로 테스트(asyncio.run 다회)에서 격리 필수.
# kb/indexing._semaphores와 동일 관례(닫힌 루프 정리).
_locks: dict[asyncio.AbstractEventLoop, dict[int, asyncio.Lock]] = {}


def interview_lock(interview_id: int) -> asyncio.Lock:
    """해당 인터뷰의 프로세스 내 락 — 같은 루프·같은 id면 동일 인스턴스."""
    loop = asyncio.get_running_loop()
    per_loop = _locks.get(loop)
    if per_loop is None:
        for stale in [known for known in _locks if known.is_closed()]:
            del _locks[stale]
        per_loop = {}
        _locks[loop] = per_loop
    lock = per_loop.get(interview_id)
    if lock is None:
        lock = asyncio.Lock()
        per_loop[interview_id] = lock
    return lock
