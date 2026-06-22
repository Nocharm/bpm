"""SQLAlchemy ORM models — process maps, versions, nodes, edges (docs/spec.md §2)."""

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class ProcessMap(Base):
    __tablename__ = "process_maps"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str | None] = mapped_column(String(100), default=None)
    # 공개 범위 — 'public'=모두 열람, 'private'=권한자만 (Task 3/5에서 게이트 적용)
    visibility: Mapped[str] = mapped_column(String(20), default="private")
    # 맵 소유자 login_id — 생성 시점에 created_by로 설정 예정(Task 3/5 wiring)
    owner_id: Mapped[str | None] = mapped_column(String(100), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    versions: Mapped[list["MapVersion"]] = relationship(
        back_populates="map", cascade="all, delete-orphan"
    )
    approvers: Mapped[list["MapApprover"]] = relationship(
        cascade="all, delete-orphan"
    )


class MapVersion(Base):
    __tablename__ = "map_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    map_id: Mapped[int] = mapped_column(ForeignKey("process_maps.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String(100))
    # 체크아웃 잠금 — 한 명만 편집, TTL 판정은 app/checkout.py (spec §7 Phase C)
    checked_out_by: Mapped[str | None] = mapped_column(String(100), default=None)
    checked_out_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    # 승인 워크플로우 상태 — draft|pending|approved|published|rejected (design 2026-06-14)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    # 현재 사이클 제출자(=submit 시점 체크아웃 보유자 박제) — 게시/회수 권한자
    submitted_by: Mapped[str | None] = mapped_column(String(100), default=None)
    # 최신 반려 사유만 보관 (전이 이력 로그는 두지 않음)
    reject_reason: Mapped[str | None] = mapped_column(String(500), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    map: Mapped[ProcessMap] = relationship(back_populates="versions")
    nodes: Mapped[list["Node"]] = relationship(
        back_populates="version", cascade="all, delete-orphan"
    )
    edges: Mapped[list["Edge"]] = relationship(
        back_populates="version", cascade="all, delete-orphan"
    )
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="version", cascade="all, delete-orphan"
    )
    groups: Mapped[list["Group"]] = relationship(
        back_populates="version", cascade="all, delete-orphan"
    )
    approvals: Mapped[list["VersionApproval"]] = relationship(
        cascade="all, delete-orphan"
    )
    events: Mapped[list["VersionEvent"]] = relationship(
        cascade="all, delete-orphan", order_by="VersionEvent.created_at"
    )


class VersionEvent(Base):
    """버전 생애주기 이벤트 로그 — created/submitted/approved/rejected/published (누가·언제). git-log 타임라인 소스."""

    __tablename__ = "version_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("map_versions.id", ondelete="CASCADE"), index=True
    )
    # created|submitted|approved|rejected|published
    event_type: Mapped[str] = mapped_column(String(20))
    actor: Mapped[str] = mapped_column(String(100))
    # 거절 사유 등 부가 텍스트
    note: Mapped[str | None] = mapped_column(String(500), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Node(Base):
    __tablename__ = "nodes"

    # 클라이언트(캔버스)가 생성하는 안정적 ID — 저장 후에도 노드 정체성 유지
    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("map_versions.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    node_type: Mapped[str] = mapped_column(String(50), default="process")
    # 사용자 지정 색 "#RRGGBB", 빈 값=타입 기본색 (spec §7 Phase A)
    color: Mapped[str] = mapped_column(String(20), default="")
    # BPM 속성 — 자유 텍스트, 빈 값 허용 (spec §7 Phase B)
    assignee: Mapped[str] = mapped_column(String(100), default="")
    department: Mapped[str] = mapped_column(String(100), default="")
    system: Mapped[str] = mapped_column(String(100), default="")
    duration: Mapped[str] = mapped_column(String(50), default="")
    # 복제 계보 루트(원본 노드 ID) — 버전 간 diff 매칭용, 복제 시 서버가 기록 (spec §7 Phase B)
    source_node_id: Mapped[str | None] = mapped_column(String(50), default=None)
    pos_x: Mapped[float] = mapped_column(Float, default=0.0)
    pos_y: Mapped[float] = mapped_column(Float, default=0.0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # [레거시] 단일 그룹 소속 — group_ids 도입 전 데이터. 로드 시 group_ids로 병합(무손실 마이그레이션)
    group_id: Mapped[str | None] = mapped_column(String(50), default=None)
    # 다중 그룹(태그) 소속 — 노드가 여러 그룹에 동시 소속 (design 2026-06-15). JSON 배열
    group_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    # 하위프로세스 노드(node_type="subprocess") — 다른 프로세스를 참조(Call Activity)
    linked_map_id: Mapped[int | None] = mapped_column(Integer, default=None)
    follow_latest: Mapped[bool] = mapped_column(Boolean, default=False)
    # follow_latest=False면 고정 버전. True면 무시하고 렌더 시 최신 발행본 해석.
    linked_version_id: Mapped[int | None] = mapped_column(Integer, default=None)
    # 끝 노드(node_type="end") — 대표 끝(프로세스당 1개, 버전업에도 유지되는 주 출구)
    is_primary_end: Mapped[bool] = mapped_column(Boolean, default=False)

    version: Mapped[MapVersion] = relationship(back_populates="nodes")


class Edge(Base):
    __tablename__ = "edges"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("map_versions.id", ondelete="CASCADE")
    )
    # 선후(흐름) 연결. node FK는 두지 않고 앱 계층에서 검증 — 그래프 일괄 교체 시 삽입 순서 의존 제거
    source_node_id: Mapped[str] = mapped_column(String(50))
    target_node_id: Mapped[str] = mapped_column(String(50))
    label: Mapped[str] = mapped_column(String(200), default="")
    # 엣지 핸들이 붙는 노드 변 — 시각 전용, diff 비교 제외(2026-06-17)
    source_side: Mapped[str] = mapped_column(String(10), default="right")
    target_side: Mapped[str] = mapped_column(String(10), default="left")
    # 다중 출구 식별 — 하위프로세스 노드의 끝별 출력 핸들 id(대표끝="__primary__", 그 외=끝 이름)
    source_handle: Mapped[str | None] = mapped_column(String(200), default=None)
    target_handle: Mapped[str | None] = mapped_column(String(200), default=None)

    version: Mapped[MapVersion] = relationship(back_populates="edges")


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("map_versions.id", ondelete="CASCADE")
    )
    # 노드 삭제 시 코멘트 정리는 graph 라우터가 명시적으로 수행 (sqlite FK pragma 비활성 대비)
    node_id: Mapped[str] = mapped_column(String(50))
    author: Mapped[str] = mapped_column(String(100))
    body: Mapped[str] = mapped_column(Text)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    version: Mapped[MapVersion] = relationship(back_populates="comments")


class Group(Base):
    """업무 묶음 — 부서/담당자별 보이는 그룹 박스 (spec Phase 2). 노드와 같은 (version, parent) 스코프."""

    __tablename__ = "groups"

    # 클라이언트 생성 ID — 노드와 동일하게 안정적 식별자
    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("map_versions.id", ondelete="CASCADE")
    )
    # 상위 그룹 — 중첩(그룹 안 그룹). 같은 스코프 내 다른 그룹 id, null=최상위. FK 미설정(앱 관리)
    parent_group_id: Mapped[str | None] = mapped_column(String(50), default=None)
    label: Mapped[str] = mapped_column(String(200), default="")
    color: Mapped[str] = mapped_column(String(20), default="")

    version: Mapped[MapVersion] = relationship(back_populates="groups")


class MapApprover(Base):
    """맵별 지정 승인자 — 전원 승인(만장일치) 게이트 (design 2026-06-14)."""

    __tablename__ = "map_approvers"

    map_id: Mapped[int] = mapped_column(
        ForeignKey("process_maps.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    # 감사 추적 — 누가 이 승인자를 지정했는지 (§9-3)
    assigned_by: Mapped[str | None] = mapped_column(String(100), default=None)


class VersionApproval(Base):
    """현재 제출 사이클의 승인 집계 — 재제출 시 해당 version 행 전체 삭제(리셋)."""

    __tablename__ = "version_approvals"

    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("map_versions.id", ondelete="CASCADE")
    )
    approver: Mapped[str] = mapped_column(String(100))
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Notification(Base):
    """인앱 알림 — 5초 폴링으로 본인 수신분 조회 (design 2026-06-14)."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipient: Mapped[str] = mapped_column(String(100))
    type: Mapped[str] = mapped_column(String(50))
    # 느슨한 참조(FK 미설정) — 알림은 fire-and-forget 스탬프라 맵/버전 삭제와 무관하게 보존
    map_id: Mapped[int | None] = mapped_column(Integer, default=None)
    version_id: Mapped[int | None] = mapped_column(Integer, default=None)
    message: Mapped[str] = mapped_column(Text, default="")
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Employee(Base):
    """사내 AD 동기화 사용자 — loginId(sAMAccountName) PK. source=ad|local (design 2026-06-16)."""

    __tablename__ = "employees"

    login_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    title: Mapped[str] = mapped_column(String(100), default="")
    source: Mapped[str] = mapped_column(String(10), default="ad")  # ad | local
    role: Mapped[str] = mapped_column(String(10), default="user")  # admin | user
    org_l1: Mapped[str | None] = mapped_column(String(200), default=None)
    org_l2: Mapped[str | None] = mapped_column(String(200), default=None)
    org_l3: Mapped[str | None] = mapped_column(String(200), default=None)
    org_l4: Mapped[str | None] = mapped_column(String(200), default=None)
    org_l5: Mapped[str | None] = mapped_column(String(200), default=None)
    department: Mapped[str] = mapped_column(String(200), default="")
    # AD-derived fields (Task 2) — active from userAccountControl bit 0x2; email from mail attr.
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    email: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class MapPermission(Base):
    """맵별 접근 권한 행 — principal(사용자/부서/그룹)에게 role 부여 (design 2026-06-21 §2.1)."""

    __tablename__ = "map_permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    map_id: Mapped[int] = mapped_column(ForeignKey("process_maps.id", ondelete="CASCADE"))
    # 'user' | 'department' | 'group'
    principal_type: Mapped[str] = mapped_column(String(20))
    # user→login_id; department→org_path 문자열; group→그룹 식별자(Task 4까지 판정 미사용)
    principal_id: Mapped[str] = mapped_column(String(200))
    # 'viewer' | 'editor' | 'owner'
    role: Mapped[str] = mapped_column(String(20))
    granted_by: Mapped[str] = mapped_column(String(100))  # 부여자 login_id
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ApprovalRequest(Base):
    """권한 다운그레이드·가시성 변경 승인 요청 — 버전 게시 승인은 version_approvals 사용 (§2.1)."""

    __tablename__ = "approval_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    map_id: Mapped[int] = mapped_column(ForeignKey("process_maps.id", ondelete="CASCADE"))
    # 'permission_downgrade' | 'visibility_change'
    kind: Mapped[str] = mapped_column(String(30))
    # 요청 상세 — {principal_type, principal_id, from_role, to_role} 또는 {to_visibility}
    payload: Mapped[dict] = mapped_column(JSON)
    requested_by: Mapped[str] = mapped_column(String(100))
    # 'pending' | 'approved' | 'rejected' | 'applied'
    status: Mapped[str] = mapped_column(String(20), default="pending")
    decided_by: Mapped[str | None] = mapped_column(String(100), default=None)
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class UserGroup(Base):
    """사용자 그룹 — map_permissions의 principal_type='group' 대상 (Layer 4 §3a).

    map_permissions.principal_id 는 이 그룹의 id(정수)를 문자열로 보관한다.
    status='active' 그룹만 권한 판정에 적용된다(pending/rejected는 무시).
    """

    __tablename__ = "user_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    # 'pending' | 'active' | 'rejected'
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_by: Mapped[str] = mapped_column(String(100))
    approved_by: Mapped[str | None] = mapped_column(String(100), default=None)
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class UserGroupMember(Base):
    """그룹 구성원 — user(login_id) 또는 department(org_path 문자열, Layer-1 규약).

    department 멤버의 member_id 는 belongs_to_department 와 동일한 org_path 문자열이다.
    """

    __tablename__ = "user_group_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("user_groups.id", ondelete="CASCADE")
    )
    # 'user' | 'department'
    member_type: Mapped[str] = mapped_column(String(20))
    # user→login_id; department→org_path 문자열
    member_id: Mapped[str] = mapped_column(String(200))


class UserGroupManager(Base):
    """그룹 관리자 — 그룹 멤버십을 관리하는 사용자(login_id)."""

    __tablename__ = "user_group_managers"

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("user_groups.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column(String(100))
