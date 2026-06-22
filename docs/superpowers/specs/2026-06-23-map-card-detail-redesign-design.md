# 맵 카드 & 상세정보 개편 — 설계 (2026-06-23)

## 목표

홈(`/`)의 맵 목록 UX를 정리하고, 버전 영역을 "누가·언제 절차를 진행했는지" 보이는 git-log 타임라인으로 바꾼다. description 입력 경로(현재 UI에 없음)를 복원한다.

> 배경: `ProcessMap.description`은 백엔드(`models.py:22`, `MapCreate`/`MapUpdate`)에 존재하나, 프론트 생성 다이얼로그·`createMap(name)`에 누락되어 **UI에서 입력 불가** → 항상 빈 문자열. 버전(`MapVersion`)은 `created_at`은 있으나 스키마에 미노출이고, 버전 "작성자/절차 수행자" 필드가 없다.

## 범위 (승인된 결정)

- description 입력처: **생성 다이얼로그 + 설정 페이지**. 상세정보 패널의 description은 **읽기전용**.
- 버전 히스토리: **전체 생애주기 이벤트 로그**(신규 테이블) — created/submitted/approved/rejected/published, 각 actor+timestamp.
- 버전 그래프: **세로 git-log 타임라인**(분기 없음).
- 상세정보 상단 Open 링크: **유지**. 좌하단(footer) Open 링크만 삭제.

비범위(YAGNI): 버전 분기/병합 그래프, description 인라인 편집, checkout 등 비-마일스톤 이벤트 기록.

---

## A. 맵 카드 (`frontend/src/components/maps/map-card.tsx`)

| # | 변경 | 세부 |
|---|------|------|
| A1 | description 표시 제거 | 현재 line-clamp-1 description(line 79-81) 삭제 |
| A2 | 이름 클릭 → 같은 탭 열기 | name을 `Link href={/maps/{id}}`로. 카드 본문 클릭은 기존 `onSelect`(선택) 유지. 이름 Link에 `onClick=stopPropagation` |
| A3 | 우측 상단 아이콘 → 새 탭 | 기존 ExternalLink Link에 `target="_blank" rel="noopener"`, aria-label `home.openNewWindow` |

- 카드 본문 클릭(=선택)과 이름 클릭(=열기), 우상단(=새 탭)이 명확히 분리.
- `data-id`: `map-card-name`, `map-card-open-newtab`.

## B. 상세정보 패널 (`frontend/src/components/maps/map-detail-card.tsx`)

| # | 변경 | 세부 |
|---|------|------|
| B1 | description 읽기전용 영역 | `border-hairline rounded-sm bg-surface p-3` 박스. 값 없으면 `text-ink-tertiary` 힌트(`home.descEmpty`). `data-id=map-detail-description` |
| B2 | 멤버 vs 버전 시각 분리 | 멤버 섹션은 그룹 칩/리스트 유지(소폭 정리). 버전 섹션은 D의 타임라인 컴포넌트로 교체 |
| B3 | 좌하단 Open 삭제 | footer의 Open Link(line ~215) 제거. Settings·Delete 유지. 상단 Open 링크(line 112-120)는 유지 |
| B4 | Delete 확인 모달 | Delete 버튼 클릭 시 즉시 호출하지 않고 `ConfirmDialog` 오픈 → 확인 시 `onDelete(id)` |

## C. 반응형 (`frontend/src/app/page.tsx`)

- 현재: 상세는 `<aside className="hidden ... xl:flex">`(line 129) → 폭 < xl(1280px)에서 **사라짐**.
- 변경:
  - **≥ xl**: 우측 사이드 `<aside>` 유지(현행).
  - **< xl**: 선택된 카드 `<li>` **바로 아래** 인라인 아코디언으로 `MapDetailCard` 표시.
- 애니메이션: 아코디언 래퍼에 `grid-template-rows: 0fr → 1fr` + `overflow-hidden` 전환, `ease-smooth`/`duration-350`. 펼침/접힘(deselect) 모두 부드럽게.
- 리스트는 단일 컬럼 `<ul>`(line 115)이라, 선택 카드 인덱스 뒤에 아코디언 행 삽입이 단순. 사이드 `<aside>`는 `hidden xl:flex`, 인라인 아코디언은 `xl:hidden`로 상호배타.
- `data-id`: `map-detail-accordion`(인라인), `map-detail-aside`(사이드).

## D. 버전 히스토리 — git-log 타임라인

### D1. 데이터 모델 (`backend/app/models.py`)

신규 `VersionEvent`:

```python
class VersionEvent(Base):
    __tablename__ = "version_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("map_versions.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(20))   # created|submitted|approved|rejected|published
    actor: Mapped[str] = mapped_column(String(...))        # login_id (models.py 기존 user 컬럼 길이 관례 따름)
    note: Mapped[str | None] = mapped_column(Text, default=None)  # 거절 사유 등
    created_at: Mapped[datetime] = mapped_column(default=...)      # 기존 created_at 관례 따름
```

- 스키마 생성: startup `create_all`(CLAUDE.md 관례). 마이그레이션 별도 없음.
- 삭제 전파: 버전 삭제 시 events cascade.

### D2. 이벤트 기록 지점 (`backend/app/routers/versions.py`)

각 워크플로 분기에서 커밋 전 `VersionEvent` 1건 추가:

| 엔드포인트 | event_type | actor | note |
|-----------|-----------|-------|------|
| `POST /maps/{map_id}/versions` (create_version) | `created` | 요청자 | — |
| `POST /versions/{id}/submit` | `submitted` | 요청자 | — |
| approve 분기 | `approved` | 요청자(승인자) | — |
| reject 분기 | `rejected` | 요청자 | 거절 사유 |
| publish 분기 | `published` | 요청자 | — |

- approve/reject/publish 엔드포인트의 정확한 위치는 구현 단계에서 versions.py 재확인(submit 이후 라인). 멱등/권한 가드 로직은 건드리지 않고 이벤트 append만 추가.
- 헬퍼: `record_version_event(session, version_id, event_type, actor, note=None)` 1개로 통일.

### D3. 백필

- 기존 버전에 `created` 이벤트가 없을 수 있음 → 멱등 백필: 버전별 `created` 이벤트가 없으면 `created_at` 기준으로 1건 합성. actor는 맵 `owner_id`(없으면 `created_by`, 그것도 없으면 `"unknown"`) best-effort.
- 위치: `scripts/reset_db` 시드에 포함(개발/데모). 운영 기존 데이터는 일회성 백필 스크립트 또는 시드 재실행으로 처리(이번 범위는 시드까지).

### D4. API (`backend/app/schemas.py`, 버전 직렬화)

- `VersionOut`에 추가:
  - `created_at: datetime`
  - `events: list[VersionEventOut]`
- `VersionEventOut`: `{ id: int, event_type: str, actor: str, note: str | None, created_at: datetime }`
- 정렬(고정): API는 `created_at` **오름차순**(시간순)으로 반환. UI는 **최신이 위**가 되도록 역순 렌더.
- 노출 경로: 상세 패널은 `getMap(mapId)`(GET `/maps/{id}`) 한 번으로 versions+events를 받으므로 **임베드**. 별도 엔드포인트 추가 없음. (버전당 이벤트 N이 작아 패널 용도 부담 없음.)

### D5. UI 컴포넌트 (`frontend/src/components/maps/version-timeline.tsx`, 신규)

- git-log 세로 타임라인: 커밋 점(●) + 세로 연결선, 행마다:
  - `event_type` 아이콘(Lucide 16px, strokeWidth 1.5, 고정 매핑): created=GitCommit, submitted=Send, approved=Check, rejected=X, published=Upload
  - actor, 상대 시각(`created_at`)
  - 최신이 위.
- 멤버 섹션과 시각적으로 구분(다른 레이아웃·아이콘 언어).
- 토큰만 사용(raw hex 금지). `data-id=version-timeline`, 행 `data-id=version-event-{id}`.
- 프론트 타입(`api.ts`): `Version`에 `createdAt`/`events` 추가, `VersionEvent` 타입 신설.

## E. description 입력처

### E1. 생성 다이얼로그 (`frontend/src/components/permissions/create-map-dialog.tsx`)

- name 입력 아래 description `<textarea>` 추가. `data-id=create-map-description`.
- `frontend/src/lib/api.ts` `createMap(name: string)` → `createMap(name: string, description: string)`; body에 `description` 포함. (백엔드 `MapCreate.description` 이미 수용.)
- 호출부(`page.tsx` 생성 핸들러) 시그니처 갱신.

### E2. 설정 페이지 (`frontend/src/app/maps/[mapId]/settings/page.tsx`)

- description 편집 필드 추가 → 저장 시 `PATCH /maps/{id}`(`MapUpdate.description`, `update_map` line 166 이미 지원). `data-id=settings-description`.

## F. 신규 공용 컴포넌트 — `ConfirmDialog` (`frontend/src/components/confirm-dialog.tsx`)

- `ModalBackdrop` + `createPortal` 재사용(기존 모달 관례).
- props: `interface ConfirmDialogProps { title: string; message: string; confirmLabel: string; cancelLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void; }`
- danger=true면 confirm 버튼 error 토큰 스타일.
- `data-id=confirm-dialog`, `confirm-dialog-confirm`, `confirm-dialog-cancel`.
- 우선 Delete map에 사용. 범용으로 두되 추가 사용처는 만들지 않음(YAGNI).

## G. i18n (`frontend/src/lib/i18n-messages.ts`, en/ko 동시)

신규 키(값은 구현 시 확정):
- `home.openNewWindow` — "Open in new window"
- `home.descEmpty` — "No description"
- `home.confirmDeleteTitle` / `home.confirmDeleteMessage` / `common.confirm` / `common.cancel`
- `perm.createDialog.descriptionLabel` / `...descriptionPlaceholder`
- `settings.descriptionLabel`
- `home.verEvent.created|submitted|approved|rejected|published` — 타임라인 라벨

## 영향 파일 요약

**Frontend**
- `src/components/maps/map-card.tsx` (A)
- `src/components/maps/map-detail-card.tsx` (B, 타임라인 연결)
- `src/components/maps/version-timeline.tsx` (신규, D5)
- `src/components/confirm-dialog.tsx` (신규, F)
- `src/app/page.tsx` (C 반응형 + 생성 핸들러 시그니처)
- `src/components/permissions/create-map-dialog.tsx` (E1)
- `src/app/maps/[mapId]/settings/page.tsx` (E2)
- `src/lib/api.ts` (createMap 시그니처, Version/VersionEvent 타입)
- `src/lib/i18n-messages.ts` (G)

**Backend**
- `app/models.py` (VersionEvent)
- `app/schemas.py` (VersionOut.created_at/events, VersionEventOut)
- `app/routers/versions.py` (이벤트 기록 + 헬퍼)
- 버전 직렬화 지점(VersionOut 채우는 곳; getMap/maps.py 또는 versions.py)
- `scripts/reset_db` (백필 시드)

## 검증

- 백엔드 pytest: (1) 각 워크플로 액션이 올바른 event_type/actor 행을 남김, (2) `VersionOut`에 created_at·events 직렬화, (3) 백필 멱등성(이미 created 있으면 미생성), (4) 기존 테스트 회귀 없음(266 baseline). ruff clean.
- 프론트: `npx tsc --noEmit` 통과. 가능 시 브라우저로 카드 이름/새탭/아코디언/삭제확인/타임라인 수동 확인(서버/원격 IP 컨텍스트 주의 — secure context 관련은 무관).

## 리스크 / 가정

- 백필 actor가 owner 부재 시 "unknown"으로 표기될 수 있음(과거 데이터 한정).
- 반응형 아코디언: 단일 컬럼 `<ul>` 전제. 추후 다중 컬럼 그리드로 바뀌면 삽입 로직 재검토 필요.
- events 임베드는 버전당 이벤트 수가 작다는 전제(마일스톤만 기록). 폭증 시 별도 엔드포인트로 분리.
