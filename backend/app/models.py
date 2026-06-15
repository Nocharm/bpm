"""SQLAlchemy ORM models — process maps, versions, nodes, edges (docs/spec.md §2)."""

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
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


class Node(Base):
    __tablename__ = "nodes"

    # 클라이언트(캔버스)가 생성하는 안정적 ID — 저장 후에도 노드 정체성 유지
    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("map_versions.id", ondelete="CASCADE")
    )
    # 상하(계층): 부모 노드의 하위 캔버스에 속함. null=버전 최상위 캔버스 (spec §1)
    parent_node_id: Mapped[str | None] = mapped_column(
        ForeignKey("nodes.id", ondelete="CASCADE"), default=None
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
    # 업무 묶음(보이는 그룹 박스) 소속 — 그룹 id, null=무소속. FK 미설정(앱 계층 관리, spec Phase 2)
    group_id: Mapped[str | None] = mapped_column(String(50), default=None)

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
    # 그룹이 놓인 캔버스 스코프 — 노드 parent_node_id와 동일 의미. FK 미설정(그래프 일괄 교체 순서 의존 제거)
    parent_node_id: Mapped[str | None] = mapped_column(String(50), default=None)
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
