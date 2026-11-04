"""실행 체크(Run) 하위 범위 가리기 — 하위 맵을 볼 수 없는 사람에게 그 범위의 기록(노드 id·제목)을 숨긴다.

공유 실행은 하위 맵을 볼 수 있는 참여자가 들어가 기록을 남겨도, 바깥 맵만 볼 수 있는 사람이 같은 실행을 연다.
상세(`run_service.build_run_detail`)가 쓰고, 코멘트·알림·대시보드(Task 5 이후)도 같은 판정을 쓴다 (보안 리뷰 S4).
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MapVersion, Run, RunScope
from app.permissions.access import get_effective_role
from app.permissions.logic import role_rank


async def get_hidden_scope_paths(session: AsyncSession, run: Run, user: str) -> set[str]:
    """사용자가 볼 수 없는 하위 범위 경로 — 고정된 범위마다 그 버전의 맵 역할을 보고, 숨긴 범위 아래 범위도 모두 넣는다."""
    rows = (
        await session.execute(
            select(RunScope.scope_path, MapVersion.map_id)
            .join(MapVersion, MapVersion.id == RunScope.version_id)
            .where(RunScope.run_id == run.id)
        )
    ).all()
    roles = {map_id: await get_effective_role(session, user, map_id) for map_id in {map_id for _, map_id in rows}}
    blocked = {path for path, map_id in rows if role_rank(roles[map_id]) < role_rank("viewer")}
    return {path for path, _ in rows if is_hidden_scope(path, blocked)}


def is_hidden_scope(scope_path: str, hidden: set[str]) -> bool:
    """숨긴 범위 그 자체이거나 그 아래 범위 — 고정 행이 없는 아래 경로(코멘트만 남은 범위 등)도 가린다."""
    return any(scope_path == path or scope_path.startswith(f"{path}/") for path in hidden)
