"""로컬 계정(외부 컨설턴트) 관리 — sysadmin 전용, ldap 모드 한정 (설계 §5)."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_sysadmin
from app.db import get_session
from app.models import Employee, LocalCredential
from app.passwords import hash_password
from app.permissions import logic
from app.schemas import LocalAccountIn, LocalAccountOut, LocalAccountPatch
from app.settings import settings

router = APIRouter(prefix="/api/admin/local-accounts", tags=["local-accounts"])


def _ensure_ldap_mode() -> None:
    """UI 숨김만으로 막지 않는다 — 다른 모드에선 엔드포인트 자체가 없다."""
    if settings.resolved_auth_mode() != "ldap":
        raise HTTPException(status_code=404, detail="not found")


def _to_out(employee: Employee, credential: LocalCredential) -> LocalAccountOut:
    return LocalAccountOut(
        login_id=employee.login_id,
        name=employee.name,
        department=employee.department,
        dept_code=employee.dept_code,
        role=employee.role,
        is_sysadmin=credential.is_sysadmin,
        env_sysadmin=employee.login_id in settings.sysadmin_login_ids(),
        active=employee.active,
        created_by=credential.created_by,
        updated_at=credential.updated_at,
    )


@router.get("", response_model=list[LocalAccountOut])
async def list_local_accounts(
    actor: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> list[LocalAccountOut]:
    _ensure_ldap_mode()
    credentials = (await session.execute(select(LocalCredential))).scalars().all()
    out: list[LocalAccountOut] = []
    for credential in credentials:
        employee = await session.get(Employee, credential.login_id)
        if employee is not None:
            out.append(_to_out(employee, credential))
    return out


@router.post("", response_model=LocalAccountOut, status_code=201)
async def create_local_account(
    body: LocalAccountIn,
    actor: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> LocalAccountOut:
    _ensure_ldap_mode()
    existing = await session.get(Employee, body.login_id)
    if existing is not None and existing.source != "local":
        # 실제 AD 계정을 로컬 계정으로 가로채는 것을 막는다 (설계 §5)
        raise HTTPException(
            status_code=409, detail=f"login id {body.login_id} already belongs to a directory user"
        )
    if await session.get(LocalCredential, body.login_id) is not None:
        raise HTTPException(status_code=409, detail=f"local account {body.login_id} already exists")

    employee = existing or Employee(login_id=body.login_id, source="local")
    employee.name = body.name
    employee.role = body.role
    employee.dept_code = body.dept_code
    employee.active = True
    session.add(employee)

    credential = LocalCredential(
        login_id=body.login_id,
        password_hash=hash_password(body.password),
        is_sysadmin=body.is_sysadmin,
        created_by=actor,
    )
    session.add(credential)
    await session.commit()

    if body.is_sysadmin:
        logic.add_granted_sysadmin(body.login_id)
    return _to_out(employee, credential)


@router.patch("/{login_id}", response_model=LocalAccountOut)
async def update_local_account(
    login_id: str,
    body: LocalAccountPatch,
    actor: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> LocalAccountOut:
    _ensure_ldap_mode()
    credential = await session.get(LocalCredential, login_id)
    employee = await session.get(Employee, login_id)
    if credential is None or employee is None:
        raise HTTPException(status_code=404, detail=f"local account {login_id} not found")

    if body.name is not None:
        employee.name = body.name
    if body.role is not None:
        employee.role = body.role
    if body.dept_code is not None:
        employee.dept_code = body.dept_code
    if body.active is not None:
        employee.active = body.active
    if body.password is not None:
        credential.password_hash = hash_password(body.password)
    if body.is_sysadmin is not None:
        credential.is_sysadmin = body.is_sysadmin
    await session.commit()

    if body.is_sysadmin is True:
        logic.add_granted_sysadmin(login_id)
    elif body.is_sysadmin is False:
        logic.remove_granted_sysadmin(login_id)
    return _to_out(employee, credential)


@router.delete("/{login_id}", status_code=204)
async def delete_local_account(
    login_id: str,
    actor: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> Response:
    _ensure_ldap_mode()
    credential = await session.get(LocalCredential, login_id)
    if credential is None:
        raise HTTPException(status_code=404, detail=f"local account {login_id} not found")
    await session.delete(credential)
    employee = await session.get(Employee, login_id)
    if employee is not None and employee.source == "local":
        await session.delete(employee)
    await session.commit()
    logic.remove_granted_sysadmin(login_id)
    return Response(status_code=204)
