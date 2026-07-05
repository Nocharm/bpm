# 신규 화면 4종 + 공유 셸 설계 (피드백 / 공지사항 / 매뉴얼 / 알림·승인 인박스)

- 작성일: 2026-07-05
- 브랜치: `worktree-feat+new-pages` (워크트리 `.claude/worktrees/feat+new-pages`)
- 시안: `/Users/hyeonjin/Desktop/NewDesign/` (PNG 9종 + DC export HTML 3종 `Inbox Page.html`·`Notice Page.html`·`New Screens.html`)
- 관련 문서: `frontend/AGENTS.md`, `rules/frontend/design.md`, `docs/spec.md`

## 1. 목적 · 범위

기존 Next.js 프론트엔드에 새 화면 4종을 **기존 컴포넌트·토큰·규약으로 재구현**한다. DC 시안은 참고용 목업이며 복붙하지 않는다.

**이번 범위(In scope)**
1. 알림·승인 **인박스** `/inbox`
2. **공지사항** 열람 `/notices` + 설정 '공지사항 관리' 탭
3. **매뉴얼** 뷰어 `/manual` + 설정 '매뉴얼' 편집·게시 탭
4. **피드백** 사이드 패널(전역) + 전체 페이지 `/feedback` (관리자 상태변경 포함)
5. **공유 셸**: TopNav 3-way 세그먼트 탭 + 피드백 버튼
6. **대시보드**: 설정 '분석 > 대시보드' **진입 카드 스텁만** (상세 화면은 이후)

**이번 제외(Out of scope)**
- 대시보드 상세 화면(집계 차트·버전상태 분포·팀별 활성·최근 이벤트) — 별도 배치
- 스크린샷 첨부(피드백) — 시안에서도 없음

## 2. 확정된 결정

| 항목 | 결정 |
|---|---|
| 대시보드 | 설정 진입 카드 스텁만, 상세는 이후 |
| 공지 읽음 상태 | **서버 테이블 없이 클라이언트 localStorage 캐시** (홈 `recent-maps.ts` 패턴). 열어본 공지 id를 캐시, 미열람만 뱃지/점. 기기별(동기화 안 됨) — 읽음 뱃지 편의 용도 |
| 매뉴얼 게시본 | **DB 저장 + 프론트 직접 편집·게시**. `manual.md`는 시드 fallback, `GET /api/manual`은 DB 우선 |
| 피드백 | 사이드패널 등록 + 전체페이지 + **관리자 상태변경 UI 포함** |
| 작성 권한 | 공지/매뉴얼 작성·피드백 상태변경 = **sysadmin** (기존 설정 콘솔 관리 탭 게이팅과 동일) |
| 인박스 승인 집계 | **신규 통합 엔드포인트** `GET /api/inbox/approvals` (버전 승인 내 담당분 + checkout 이전요청 + approval-requests) |
| 매뉴얼 다크모드 토글 | 전역 다크모드 아님(앱 라이트 전용, design.md §7). **매뉴얼 본문 영역 한정 읽기 테마 토글**로 국한 (`prefers-color-scheme` 미사용, 명시적 클래스) |

## 3. 절대 규칙 (구현 내내 준수)

- **디자인 토큰만** — 하드코딩 hex 금지. `text-ink`/`text-ink-secondary`/`text-ink-tertiary`, `bg-surface`/`bg-surface-alt`, `border-hairline`, `text-accent`/`bg-accent-tint`, `text-body-strong`/`text-caption`/`text-fine` 등 기존 어휘 재사용. 상태 뱃지는 `status-badge.tsx` 재사용.
- **i18n 필수** — 모든 문자열은 `useI18n()`의 `t(...)`. `lib/i18n-messages.ts`의 flat dotted key(en/ko 양쪽) 추가.
- **KST** — 표시는 `lib/datetime`의 `formatKst`/`formatKstShort`. `toLocaleString()`/`getHours()` 금지. 백엔드 시각은 `app.clock.now()`.
- **id 생성** — `genId()` from `@/lib/id` (never `crypto.randomUUID()`).
- **React Compiler** — setState만 호출하는 핸들러는 `useCallback` 대신 plain function. effect 내 동기 setState 금지.
- **grep 함정** — ugrep이 `[mapId]` 브라켓 디렉토리 스킵 → `find`+개별 grep/Read.
- **재사용 우선** — `top-nav.tsx`, `notification-bell.tsx`, `markdown-view.tsx`, `status-badge.tsx`, `modal-backdrop.tsx`, `confirm-dialog.tsx`, `toast-stack.tsx`, `tooltip.tsx`, `components/admin/approval-queue.tsx`, `components/permissions/pending-approvals-panel.tsx`, 설정 구조는 `app/settings/page.tsx`.

## 4. 백엔드 설계 (`backend/app`)

패턴: 모델 `models.py`, 스키마 `schemas.py`(Pydantic v2 `ConfigDict(from_attributes=True)`, In=`*Create/*Update`, Out=`*Out`), 라우터 `routers/<name>.py`(`APIRouter(prefix="/api/<name>", dependencies=[Depends(get_current_user)])`), `main.py`에 import+`include_router`. 현재 사용자 = `Depends(get_current_user)`(login_id 문자열). sysadmin = `app.permissions.logic.is_sysadmin`. 알림 발송 = `workflow.create_notifications(session, recipients, type=, map_id=, version_id=, message=)`.

### 4.1 Notice (공지)
```
Notice: id(PK), title(str), body_md(Text), importance(str 'important'|'normal'),
        starts_at(DateTime tz), ends_at(DateTime tz, nullable=무제한),
        created_by(str login_id), created_at(DateTime tz, default clock.now)
```
읽음 추적 컬럼 없음(클라 캐시). 상태(게시중/예약/종료)는 저장하지 않고 `starts_at`/`ends_at` vs `now()`로 파생.

엔드포인트:
- `GET /api/notices` — 게시기간 유효분(`starts_at <= now <= ends_at` or `ends_at is null`), 중요도·최신순. Out에 `importance, title, body_md`(목록은 요약 가능), `created_by`, `starts_at`, `ends_at`, `created_at`.
- `GET /api/notices/{id}` — 단건 상세(body_md 포함).
- `GET /api/notices/manage` — sysadmin, 게시기간 무관 전체(관리 목록: 상태 파생·게시기간 표시).
- `POST /api/notices` — sysadmin. body: title/importance/starts_at/ends_at/body_md/`notify_all`(bool). `notify_all` 시 전 사용자 대상 `create_notifications(type="notice", message=title)`.
- `PATCH /api/notices/{id}` — sysadmin.
- `DELETE /api/notices/{id}` — sysadmin.

"전체 사용자" 대상은 `Employee`(active) login_id 목록으로 fan-out.

### 4.2 Feedback (피드백)
```
Feedback: id(PK), kind(str 'bug'|'suggestion'|'question'|'etc'), body(Text),
          author(str login_id), context(JSON: {route, map_id?, version_id?}),
          status(str 'new'|'in_progress'|'done', default 'new'),
          created_at(DateTime tz, default clock.now)
```
엔드포인트:
- `POST /api/feedback` — 로그인 사용자. body: kind/body/context.
- `GET /api/feedback` — 목록 + 집계. 응답에 `items[]` + `counts{total, mine, in_progress, done}`(mine = author==현재유저). 비-sysadmin은 전체 열람 허용(시안이 전체 피드백 페이지) — 단 목록 노출 정책은 sysadmin=전체, 일반=전체 열람 가능(작성자만 필터는 '내 피드백' 카드 클릭으로 클라 필터).
- `PATCH /api/feedback/{id}` — sysadmin. status 변경.

### 4.3 ManualDoc (매뉴얼)
```
ManualDoc: id(PK, 단일 행 id=1 upsert), format(str 'markdown'|'html'),
           content(Text), updated_by(str), updated_at(DateTime tz onupdate)
```
- `GET /api/manual` — 인증 사용자. DB 행 있으면 `{format, content, updated_at}`, 없으면 `{format:'markdown', content: get_manual(), updated_at:null}`(파일 fallback).
- `PUT /api/manual` — sysadmin. body: format/content. upsert(id=1).

### 4.4 Notifications / Inbox
- `POST /api/notifications/read-all` — 현재 사용자 미읽음 전부 `read=True`. (기존 `notifications.py`에 추가)
- `GET /api/inbox/approvals` — **신규 라우터/핸들러**. 현재 사용자가 결정해야 할 항목 통합 리스트:
  - **버전 승인 대기**: `MapVersion.status=='pending'` AND 맵에 `MapApprover(user_id==me)` AND 내 `VersionApproval` 없음. (신규 쿼리 — 기존엔 목록 엔드포인트 없음)
  - **점유 이전 요청**: 기존 `checkout.get_pending_checkout_requests` 로직 재사용.
  - **권한/가시성 승인 요청**: 기존 `permissions` `ApprovalRequest` pending(사용자 관련분).
  - 통합 Out: `[{source:'version'|'checkout'|'approval_request', id, map_id?, map_name?, version_id?, version_label?, requested_by?, created_at, ...}]`.
  - 각 소스의 승인/반려 액션은 **기존 엔드포인트 재사용**(버전 approve/reject, checkout decide, approval-request decide) — 인박스는 조회·라우팅만 신설.

## 5. 프론트엔드 공유 셸

### 5.1 TopNav (`components/top-nav.tsx`)
현재: `<nav>` 좌(브랜드 Link) / 우(`NotificationBell` · 유저칩 · ko/en 토글). 변경:
- **중앙(또는 브랜드 우측) 3-way 세그먼트 탭** — ko/en 세그먼트의 `inline-flex rounded-sm border` 패턴 재사용. 탭: 맵목록 `/`, 공지 `/notices`, 인박스 `/inbox`. `usePathname()` import 추가로 활성 강조(`bg-accent-tint text-accent`).
  - 공지 탭 뱃지: `notices-read` 캐시 기반 미읽음 수(0이면 숨김).
  - 인박스 탭 뱃지: 미읽음 알림 수(`listNotifications` unread) + 승인대기 수. `NotificationBell`의 폴링과 중복 최소화 — 카운트는 가벼운 폴링/공유.
- **우측 액션에 피드백 버튼**(`MessageSquare` lucide, `text-accent` 아웃라인) → 사이드 패널 오픈.
- 홈 레이아웃 불변 — 셸만 얹음.

### 5.2 피드백 사이드 패널 (`components/feedback-side-panel.tsx`, 신규)
- 우측 슬라이드인(`modal-backdrop` 또는 자체 오버레이, `--shadow-lg`).
- 유형 세그먼트 한 행(버그/제안/문의/기타) + 본문 textarea + "현재 화면(route)/열린 맵 자동 첨부" 안내(context 자동 수집: `usePathname`, 열린 mapId).
- 제출 → `POST /api/feedback`(context 포함) → 토스트.
- 하단 "모든 피드백 보기" → `router.push('/feedback')`.
- TopNav에 마운트(전역). 열림 상태는 로컬 컴포넌트 state.

### 5.3 공용 lib
- `lib/notices-read.ts` (신규, `recent-maps.ts` 패턴): localStorage key `bpm.notices.read` = 읽은 notice id 배열. `getReadIds()`, `markRead(id)`, `isUnread(id, ids)`, `countUnread(notices)`. SSR 가드(window 체크).
- `lib/api.ts`: `listNotices`, `getNotice`, `listNoticesManage`, `createNotice`, `updateNotice`, `deleteNotice`, `submitFeedback`, `listFeedback`, `updateFeedbackStatus`, `getManual`, `putManual`, `markAllNotificationsRead`, `getInboxApprovals`. 각 함수는 얇은 `request<T>` 래퍼.
- `lib/i18n-messages.ts`: `notices.*`, `inbox.*`, `manual.*`, `feedback.*`, `nav.tab.*` 등 en/ko 키.

## 6. 화면별 상세

### 6.1 공지 뷰어 `/notices` (`src/app/notices/page.tsx`, client)
- TopNav 아래 마스터-디테일. 좌 목록: 필터(전체/중요/일반), "안읽음 N"(캐시), 각 항목 중요도 뱃지·미읽음 점(캐시)·제목·작성자·날짜. 우 상세: `MarkdownView source={body_md}` + 중요 뱃지·작성자·`formatKst`·게시기간.
- 항목 클릭 → `notices-read.markRead(id)` → 점 제거, 미읽음 카운트 감소.
- 데이터: `listNotices()`(게시 유효분).

### 6.2 설정 '공지사항 관리' 탭 (`components/settings` 또는 `app/settings` 하위 패널)
- 설정 탭 체계에 편입: `TabId`에 `"notices"` 추가, `CATEGORIES`에 '콘텐츠' 카테고리(access `sysadmin`) 신설(공지사항·매뉴얼 묶음).
- 목록: 상태(게시중/예약/종료 파생) 뱃지·제목·중요도·게시기간·⋯ 액션(수정/삭제). 헤더 "등록된 공지 N건 · 게시중 M건" + "새 공지 등록".
- **등록 모달** (`NoticeEditModal`): 제목 / 중요도(중요·일반 세그먼트) / **게시기간 캘린더 date-range** / "무제한 게시" 체크(체크 시 `ends_at=null`, 캘린더 비활성) / 본문 md textarea("마크다운 지원") / "등록 시 전체 사용자에게 알림 발송" 체크 / 임시저장·게시. 캘린더는 자체 경량 date-range(외부 의존 없이, 시안대로 월 그리드).

### 6.3 인박스 `/inbox` (`src/app/inbox/page.tsx`, client)
- 마스터-디테일(좌1:우2). 탭 2개: 승인 대기 / 알림.
  - **승인 대기**: `getInboxApprovals()` 리스트. 우 상세: 요청 메타(맵/버전/요청자/시각) + 소스별 본문. 버전 승인건은 **만장일치 체크리스트**(승인자별 승인 여부, 기존 `approval-panel`/`workflow-actions` 패턴 재사용) + 승인/반려(기존 엔드포인트). checkout·approval_request는 각 decide.
  - **알림**: `listNotifications()`. 항목 클릭 → 상세(메시지 + "관련 맵 보기" 링크 map_id 있을 때). "모두 읽음" → `markAllNotificationsRead()`. 개별 읽음 → 기존 `markNotificationRead`.

### 6.4 매뉴얼 뷰어 `/manual` (`src/app/manual/page.tsx`, client)
- 좌 TOC(본문 H2/H3에서 파생) + 우 `MarkdownView`. 상단: 본문검색(입력 → 매치 하이라이트/스크롤, `Ctrl+K` 포커스), 읽기 도구(읽기폭 토글, 본문 한정 읽기 테마 토글). 코드블록 복사·인라인 code 더블클릭 복사는 `MarkdownView` 기존 기능.
- 데이터: `getManual()`(DB 우선, 파일 fallback). format=html이면 (sanitized) HTML 렌더, markdown이면 `MarkdownView`.

### 6.5 설정 '매뉴얼' 탭
- `TabId` `"manual"` 추가(콘텐츠 카테고리). 편집·게시 화면: format 토글(마크다운/HTML), `.md` 업로드(FileReader), "배포본 불러오기"(`get_manual()` 파일 시드 로드), **미리보기 버튼**(모달/오버레이로 뷰어 프리뷰 — 실시간 미리보기 없음), 게시(`putManual`). "현재 게시본 vX · 배포 포함본" 메타.

### 6.6 피드백 전체 페이지 `/feedback` (`src/app/feedback/page.tsx`, client)
- 헤더 "피드백" + "피드백 보내기"(사이드 패널 오픈). 집계 카드 4개(전체/내 피드백/작업 중/완료 — `counts`). 유형 필터(전체/버그/제안/문의/기타) + 검색. 목록 테이블(유형 뱃지·제목·작성자·상태 뱃지·등록일 `formatKstShort`).
- **관리자 상태변경**: sysadmin이면 행에서 상태 변경(드롭다운/`⋯` 액션 → `updateFeedbackStatus`). 상태 뱃지는 `status-badge` 재사용(new=신규/in_progress=작업중/done=완료 매핑).

### 6.7 설정 '분석 > 대시보드' 진입 스텁
- `CATEGORIES`에 '분석' 카테고리 + `TabId` `"dashboard"`. 콘텐츠: "운영 대시보드 열기" 진입 카드(아이콘 + 설명 + →) + "세부 지표 구성은 추후 보완 예정" 안내. 링크 대상(상세 화면)은 이후 — 현재는 비활성/placeholder.

## 7. 권한 요약
- 열람: `/notices`·`/manual`·`/inbox`·`/feedback` = 로그인 사용자.
- 작성/관리: 공지 CUD·매뉴얼 PUT·피드백 status PATCH = **sysadmin**. 프론트도 sysadmin 아닐 때 관리 UI 숨김(설정 탭 access `sysadmin`).
- 로컬 검증: 기본 전원 sysadmin이라 비-sysadmin 뷰 확인은 `DEV_ENFORCE_PERMISSIONS=true` + `BPM_SYSADMINS=admin.sys`로 `backend/`에서 기동 필요.

## 8. 빌드 순서 (프론트 확인 가능한 최소 단위)

각 스텝은 프론트에서 눈으로 확인 가능한 단위로 끊고, 커밋 전 `PROGRESS.md` + 검토문서(`SCREEN-NEW-PAGES.md`)를 함께 갱신한다. 스텝 중 발생한 수정은 해당 스텝의 **서브과제 행**으로 검토문서 표에 계속 추가한다.

- **P0 백엔드 파운데이션** — Notice/Feedback/ManualDoc 모델·스키마·라우터, notifications read-all, inbox/approvals, main.py 등록. 검증: `pytest` 스모크 + 각 엔드포인트 수동 호출.
- **P1 공유 셸** — TopNav 3-way 탭 + 피드백 버튼 + 피드백 사이드 패널 + api.ts/i18n/notices-read.ts. 검증: 세 라우트 탭 이동·강조, 피드백 패널 열림·제출.
- **P2 공지** — 뷰어 `/notices` → 설정 관리 탭 → 등록 모달(캘린더). 검증: 목록/상세/미읽음 점, 등록→목록 반영→알림 발송.
- **P3 인박스** — `/inbox` 알림 탭 → 승인 대기 탭. 검증: 알림 모두읽음, 승인/반려 반영.
- **P4 매뉴얼** — 뷰어 `/manual` → 설정 편집·게시 탭. 검증: TOC/검색/복사, 편집→게시→뷰어 반영.
- **P5 피드백 페이지** — `/feedback` 집계·목록·필터 → 관리자 상태변경. 검증: 등록분 노출, 상태변경 반영.
- **P6 대시보드 스텁** — 설정 진입 카드. 검증: 카드 표시.

각 P는 하위 최소 단위로 다시 쪼개 커밋(예: P1a 탭, P1b 피드백 버튼·패널). lint+build는 매 커밋 전 통과.

## 9. 검증 방법
- 프론트: `npm run lint` + `npm run build`(React Compiler 규칙) 매 커밋 전 통과. 브라우저 수동 검증(시현 데이터 시드).
- 백엔드: `backend/tests` 패턴으로 신규 라우터 스모크 테스트(Notice/Feedback/Manual CRUD, inbox 집계). 외부 의존 mock, 내부 로직 실경로.
- KST/토큰/i18n 준수 자체 점검.

## 10. 미해결 · 이후
- 대시보드 상세 화면(별도 spec).
- 매뉴얼 읽기 테마 토글의 정확한 스타일 범위(본문 한정) — 구현 중 사용자 확인.
- 피드백 목록 열람 정책(전체 공개 vs 작성자/관리자 한정) — 현재 전체 열람 + '내 피드백' 클라 필터로 진행, 필요 시 조정.
