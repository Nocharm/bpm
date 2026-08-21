# pw-smoke-io-links.mjs teardown 헬퍼 — 소프트삭제(DELETE /api/maps)만으론 행이 남는다(deleted_at
# 플래그일 뿐). SQLAlchemy 모델을 직접 통해 진짜 0잔류를 만든다: ProcessMap.versions/approvers는
# cascade="all, delete-orphan"이라 session.delete(map)이 map_versions/nodes/edges/groups/
# version_events까지 연쇄 삭제하지만, MapPermission은 그 관계 밖이라 별도로 지운다.
#
# login_records는 일부러 건드리지 않는다 — /api/me는 login_id당 KST 하루 1행 dedup이라, 이 스모크가
# 만든 행인지 다른 동시 세션(수동 테스트·다른 스모크)이 그날 먼저 찍은 행인지 occurred_at 시간창만
# 으론 구분할 수 없다(스키마에 세션/요청 식별자가 없다). 잘못 지우면 남의 행을 삭제하는 쪽이 더
# 위험하므로, 하루 최대 1행/로그인id의 잔류를 감수하고 애초에 지우지 않는다(zero-residue 대조에서도
# 이 테이블은 제외 — pw-smoke-io-links.mjs 참고).
# 실행: SMOKE_MAP_ID=<id> .venv/bin/python scripts/_purge-test-map.py
# (backend/ 를 cwd로 — sys.path가 이를 통해 app 패키지를 찾는다)
import asyncio
import os
import sys

sys.path.insert(0, os.getcwd())  # python -c는 스크립트 파일 위치를 sys.path[0]에 넣는다 — cwd(backend/) 명시 필요

from sqlalchemy import delete  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import MapPermission, ProcessMap  # noqa: E402


async def main() -> None:
    map_id = int(os.environ["SMOKE_MAP_ID"])
    async with SessionLocal() as session:
        await session.execute(delete(MapPermission).where(MapPermission.map_id == map_id))
        found = await session.get(ProcessMap, map_id)
        if found is not None:
            await session.delete(found)
        await session.commit()
    print(f"purged map {map_id}")


if __name__ == "__main__":
    asyncio.run(main())
