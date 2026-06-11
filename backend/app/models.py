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
