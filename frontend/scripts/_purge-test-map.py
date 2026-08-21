# pw-smoke-io-links.mjs teardown 헬퍼 — 소프트삭제(DELETE /api/maps)만으론 행이 남는다(deleted_at
# 플래그일 뿐). SQLAlchemy 모델을 직접 통해 진짜 0잔류를 만든다: ProcessMap.versions/approvers는
# cascade="all, delete-orphan"이라 session.delete(map)이 map_versions/nodes/edges/groups/
# version_events까지 연쇄 삭제하지만, MapPermission은 그 관계 밖이라 별도로 지운다. /api/me가
# 매 방문마다 남기는 login_records도 이 스모크가 브라우저를 띄운 부산물이라 함께 지운다.
# 실행: SMOKE_MAP_ID=<id> SMOKE_STARTED_AT=<ISO> .venv/bin/python scripts/_purge-test-map.py
# (backend/ 를 cwd로 — sys.path가 이를 통해 app 패키지를 찾는다)
import asyncio
import os
import sys
from datetime import datetime

sys.path.insert(0, os.getcwd())  # python -c는 스크립트 파일 위치를 sys.path[0]에 넣는다 — cwd(backend/) 명시 필요

from sqlalchemy import delete  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import LoginRecord, MapPermission, ProcessMap  # noqa: E402


async def main() -> None:
    map_id = int(os.environ["SMOKE_MAP_ID"])
    started_at = datetime.fromisoformat(os.environ["SMOKE_STARTED_AT"].replace("Z", "+00:00"))
    dev_user = os.environ.get("SMOKE_DEV_USER", "admin.sys")
    async with SessionLocal() as session:
        await session.execute(delete(MapPermission).where(MapPermission.map_id == map_id))
        await session.execute(
            delete(LoginRecord).where(LoginRecord.login_id == dev_user, LoginRecord.occurred_at >= started_at)
        )
        found = await session.get(ProcessMap, map_id)
        if found is not None:
            await session.delete(found)
        await session.commit()
    print(f"purged map {map_id}")


if __name__ == "__main__":
    asyncio.run(main())
