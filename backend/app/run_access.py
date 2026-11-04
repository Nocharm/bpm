"""실행 체크(Run) 하위 범위 보이기 — 하위 맵을 볼 수 있다고 확인된 범위의 기록(노드 id·제목)만 싣는다.

공유 실행은 하위 맵을 볼 수 있는 참여자가 들어가 기록을 남겨도, 바깥 맵만 볼 수 있는 사람이 같은 실행을 연다.
판정은 기본 가림이다: 고정 행이 없는 범위(루프가 고정을 지웠거나 하위 맵 영구 삭제로 고정 행이 사라진 범위)는
어느 맵인지 알 수 없어 아무에게도 보이지 않는다. 상세(`run_service.build_run_detail`)가 쓰고, 코멘트·알림·대시보드
(Task 5 이후)도 같은 판정을 쓴다 (보안 리뷰 S4·S5, 판정 R16).
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MapVersion, Run, RunScope
from app.permissions.access import get_effective_role
from app.permissions.logic import role_rank


def _list_ancestor_paths(scope_path: str) -> list[str]:
    """`a/b/c` → [`a`, `a/b`] — 그 범위를 품은 바깥 하위 범위들."""
    segments = scope_path.split("/")
    return ["/".join(segments[:depth]) for depth in range(1, len(segments))]


async def get_visible_scope_paths(session: AsyncSession, run: Run, user: str) -> set[str]:
    """사용자가 볼 수 있는 하위 범위 경로 — 고정된 범위 중 그 맵을 viewer 이상으로 보고, 바깥 범위도 모두 보이는 것."""
    rows = (
        await session.execute(
            select(RunScope.scope_path, MapVersion.map_id)
            .join(MapVersion, MapVersion.id == RunScope.version_id)
            .where(RunScope.run_id == run.id)
        )
    ).all()
    roles = {map_id: await get_effective_role(session, user, map_id) for map_id in {map_id for _, map_id in rows}}
    viewable = {path for path, map_id in rows if role_rank(roles[map_id]) >= role_rank("viewer")}
    return {path for path in viewable if all(parent in viewable for parent in _list_ancestor_paths(path))}


def is_scope_visible(path: str, visible: set[str]) -> bool:
    """최상위(바깥 맵)는 실행을 연 사람이면 늘 보이고, 하위 범위는 확인된 목록에 있을 때만 보인다."""
    return path == "" or path in visible
