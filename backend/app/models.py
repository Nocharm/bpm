"""SQLAlchemy ORM models — process maps, versions, nodes, edges (docs/spec.md §2)."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.clock import now as _now_kst


def _now() -> datetime:
    return _now_kst()  # 타임스탬프 기준시 KST (app.clock)


class Base(DeclarativeBase):
    pass


class AppSetting(Base):
    """앱 런타임 설정 — key-value 단건. sysadmin이 재배포 없이 설정 화면에서 변경."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(500))
    updated_by: Mapped[str | None] = mapped_column(String(100), default=None)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class AiChatSession(Base):
    """AI 챗 대화 세션 — 사용자×맵 귀속 서버 원장. 목록 정렬 기준은 updated_at desc."""

    __tablename__ = "ai_chat_sessions"
    __table_args__ = (Index("ix_ai_chat_sessions_login_map", "login_id", "map_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    map_id: Mapped[int] = mapped_column(ForeignKey("process_maps.id", ondelete="CASCADE"))
    login_id: Mapped[str] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    # ORM cascade로 세션 삭제 시 메시지 동반 삭제 — sqlite FK pragma에 의존하지 않는다
    messages: Mapped[list["AiChatMessage"]] = relationship(cascade="all, delete-orphan")


class AiChatMessage(Base):
    """AI 챗 메시지 — user 질문/assistant 답변 + 제안 페이로드(kind별 서브셋 JSON)."""

    __tablename__ = "ai_chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("ai_chat_sessions.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(10))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    kind: Mapped[str | None] = mapped_column(String(20), default=None)  # assistant만
    # 제안 원자료(kind별 서브셋 JSON 문자열) — 히스토리 재열람 시 카드 재현. user/answer는 NULL
    payload: Mapped[str | None] = mapped_column(Text, default=None)
    # 당시 열려 있던 버전 id — 추적용 순수 정수(FK 아님: 버전 삭제돼도 대화 보존)
    version_id: Mapped[int | None] = mapped_column(Integer, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


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
    # 소프트 삭제 시각 — None=정상, 값 있으면 휴지통(1주 내 복구 가능, 이후 lazy 영구삭제) (DL)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    # 오우닝 부서 — org_path 문자열(예: "Division/Office/Team"). NULL=누락(레거시 맵).
    # 소속 직원은 effective_role에서 editor 바닥값을 파생받는다 — 권한 행 없음 (spec 2026-07-10)
    owning_department: Mapped[str | None] = mapped_column(String(200), default=None)
    # ── 서브프로세스 지정(designation) — 지정된 맵만 라이브러리 피커 노출 (spec 2026-07-06) ──
    # NULL=미지정. 값 있으면 지정 시각(플래그 겸용, KST).
    sp_designated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    # 지정 어트리뷰트 — 노드 BPM 필드와 1:1 (department 지정 시 필수). 해제해도 유지(재지정 프리필).
    sp_department: Mapped[str | None] = mapped_column(String(100), default=None)
    sp_assignee: Mapped[str | None] = mapped_column(String(100), default=None)
    sp_system: Mapped[str | None] = mapped_column(String(100), default=None)
    sp_duration: Mapped[str | None] = mapped_column(String(50), default=None)
    # SP 지정 파라미터 3종 — 회당 소요시간·회당 추가비용(원/달러 배타)·회당 투입인원.
    # 연간 건수·FTE는 부모 맥락 값이라 노드 행에 저장한다 (design 2026-07-13 §2.2).
    sp_cost_krw: Mapped[str | None] = mapped_column(String(50), default=None)
    sp_cost_usd: Mapped[str | None] = mapped_column(String(50), default=None)
    sp_headcount: Mapped[str | None] = mapped_column(String(50), default=None)
    sp_url: Mapped[str | None] = mapped_column(String(500), default=None)
    sp_url_label: Mapped[str | None] = mapped_column(String(100), default=None)
    # 최근 지정/해제/수정 1건 기록 — 이력 테이블 없이 맵과 1:1
    sp_changed_by: Mapped[str | None] = mapped_column(String(100), default=None)
    sp_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
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
    # 직전 점유자 — 이전/요청승인으로 점유가 넘어온 출처(누구에게서). 최초 생성자 점유는 None.
    checked_out_from: Mapped[str | None] = mapped_column(String(100), default=None)
    # 승인 워크플로우 상태 — draft|pending|approved|published|rejected|expired (design 2026-06-14)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    # 맵 내 게시 순번 — publish 시 채번, 만료 후에도 불변. 미게시 버전은 NULL.
    version_number: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
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
    # 회당 단가 파라미터 — 비용은 원/달러 배타 2필드, 연간 건수·FTE는 노드 값 (design 2026-07-13 §2.1)
    cost_krw: Mapped[str] = mapped_column(String(50), default="")
    cost_usd: Mapped[str] = mapped_column(String(50), default="")
    headcount: Mapped[str] = mapped_column(String(50), default="")
    annual_count: Mapped[str] = mapped_column(String(50), default="")
    fte: Mapped[str] = mapped_column(String(50), default="")
    # 참조 링크 — 노드당 1개, 빈 값 허용 (CSV import design 2026-07-06)
    url: Mapped[str] = mapped_column(String(500), default="")
    # 참조 링크 표시 라벨 — url 있을 때만 의미(스키마 validator가 함께 소거) (url-label design 2026-07-07)
    url_label: Mapped[str] = mapped_column(String(100), default="")
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
    follow_latest: Mapped[bool] = mapped_column(Boolean, default=True)
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


class Feedback(Base):
    """사용자 피드백 — 유형·본문·컨텍스트·상태·관리자 답글 (design 2026-07-05)."""

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 유형 — bug | suggestion | question | etc
    kind: Mapped[str] = mapped_column(String(20))
    body: Mapped[str] = mapped_column(Text, default="")
    author: Mapped[str] = mapped_column(String(100))
    # 제출 시점 컨텍스트 — {route, map_id?, version_id?} 자동 첨부(느슨한 참조)
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    # 처리 상태 — draft(작성자 수정/삭제 가능) | in_progress | done(잠금)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    # 관리자 답글 — status가 done이 아닐 때만 작성/수정
    reply: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # 본문 수정 / 답글 갱신 / 완료 처리 시각 — 모달 표시용(없으면 None)
    body_edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    reply_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class Notice(Base):
    """공지사항 — 마크다운 본문·중요도·게시기간 (design 2026-07-05). 읽음은 클라 캐시."""

    __tablename__ = "notices"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    body_md: Mapped[str] = mapped_column(Text, default="")
    # 중요도 — important | normal
    importance: Mapped[str] = mapped_column(String(20), default="normal")
    # 게시기간 — starts_at부터 노출, ends_at=None이면 무제한
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ManualDoc(Base):
    """사용 매뉴얼 문서 — 다중 행(언어별 목록, F10). 행이 없으면 뷰어는 manual.md 파일 fallback.

    (기존 단일 게시본(id=1 upsert, S8)에서 확장 — 레거시 행은 language 기본 ko로 흡수.)
    """

    __tablename__ = "manual_docs"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 목록 제목 — 저장 시 본문(마크다운 첫 헤딩·html 첫 h태그)에서 자동 추출
    title: Mapped[str] = mapped_column(String(200), default="")
    # 문서 언어(ko|en) — 뷰어의 한/영 토글 상태에 맞는 목록만 노출
    language: Mapped[str] = mapped_column(String(5), default="ko")
    # 게시본 포맷 — markdown | html
    format: Mapped[str] = mapped_column(String(20), default="markdown")
    content: Mapped[str] = mapped_column(Text, default="")
    # 목록 정렬 — 업로드 순서. 한/영 페어는 동일 순번 가정(언어 전환 시 같은 순번 문서 열기)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
    updated_by: Mapped[str | None] = mapped_column(String(100), default=None)


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
    # 한글이름·한글그룹 — AD 미제공. 어드민 JSON 임포트로만 채운다(spec 2026-07-09). sync 미간섭.
    korean_name: Mapped[str] = mapped_column(String(200), default="")
    korean_dept: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class DeptInfo(Base):
    """부서 부가정보 — 영문 부서명(리프) 키. AD 미제공 필드(한글 부서명·부서장), 어드민 JSON 임포트로만 채운다."""

    __tablename__ = "dept_info"

    department: Mapped[str] = mapped_column(String(200), primary_key=True)
    korean_name: Mapped[str] = mapped_column(String(200), default="")
    manager: Mapped[str] = mapped_column(String(200), default="")
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
    # 소프트삭제(매니저 삭제/거절) — 설정 후 7일 경과 시 _purge_expired_groups가 영구삭제
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    # 이름 변경 시각 — active 상태에서 주 1회 rename 제한 판정용
    name_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )


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


class CheckoutRequest(Base):
    """점유권 이전 요청 — editor+가 현 점유자·오너·sysadmin에게 요청, decide로 승인/거절 (Task 3)."""

    __tablename__ = "checkout_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("map_versions.id", ondelete="CASCADE"), index=True
    )
    requested_by: Mapped[str] = mapped_column(String(100))
    # 'pending' | 'approved' | 'rejected' | 'withdrawn'
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class LoginRecord(Base):
    """로그인/활동 기록 — 사용자 현황조사용. /api/me 호출 시 1건 기록(집계·리포트는 후속)."""

    __tablename__ = "login_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    login_id: Mapped[str] = mapped_column(String(100), index=True)
    # 조회 편의용 표시명 스냅샷(없으면 None)
    name: Mapped[str | None] = mapped_column(String(200), default=None)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )


class AiUsageEvent(Base):
    """AI 호출 1건의 usage 기록 — 원문(질문 내용) 없이 계량만. 대시보드 집계용 (design 2026-07-11)."""

    __tablename__ = "ai_usage_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )
    login_id: Mapped[str] = mapped_column(String(100), index=True)
    # FK 아님 — 맵/버전이 삭제돼도 통계 보존 (ai_chat_messages.version_id와 동일 관례)
    map_id: Mapped[int] = mapped_column(Integer)
    version_id: Mapped[int] = mapped_column(Integer)
    model: Mapped[str] = mapped_column(String(200), default="")  # 요청 선택자(빈값=서버 기본)
    kind: Mapped[str | None] = mapped_column(String(20), default=None)  # 실패 시 None
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, default=None)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, default=None)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)


class DashboardPermission(Base):
    """대시보드 열람 권한 행 — principal(사용자/부서/그룹)에게 부여. 역할 구분 없음
    (행이 있으면 열람, 없으면 403). principal 해석 규약은 map_permissions과 동일.
    """

    __tablename__ = "dashboard_permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 'user' | 'department' | 'group'
    principal_type: Mapped[str] = mapped_column(String(20))
    # user→login_id; department→org_path 문자열; group→user_groups.id 문자열
    principal_id: Mapped[str] = mapped_column(String(200))
    granted_by: Mapped[str] = mapped_column(String(100))
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DashboardCoverageDept(Base):
    """커버리지 % 의 분모가 되는 부서 목록 — sysadmin이 지정, 전원에게 동일 적용."""

    __tablename__ = "dashboard_coverage_depts"

    # org_path 문자열(루트→리프, "A/B/C") — 하위 부서 맵도 이 부서에 귀속해 센다
    org_path: Mapped[str] = mapped_column(String(200), primary_key=True)
    added_by: Mapped[str] = mapped_column(String(100))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
