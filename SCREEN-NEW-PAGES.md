# 신규 화면 4종 — 계획 · 검토 트래커 (단일)

시안(`/Users/hyeonjin/Desktop/NewDesign/`, PNG 9 + DC HTML 3) 기준으로 **피드백 · 공지사항 · 매뉴얼 · 알림·승인 인박스** 4종 + 공유 셸 신규 구현. 브랜치 `worktree-feat+new-pages`(워크트리). 설계는 `docs/superpowers/specs/2026-07-05-new-screens-design.md`.

**방식: 프론트에서 확인 가능한 최소 단위(vertical slice)로 분할** — 각 슬라이스는 필요한 백엔드(모델/라우터)를 함께 포함해 **끝나면 프론트에서 눈으로 검증**되도록 한다. 단위별 커밋 · 커밋 전 PROGRESS + 이 표 동반 갱신 · 스텝 중 수정사항은 **해당 스텝의 서브과제 행**으로 표에 계속 추가.

## 검토 환경

| 로컬 | 값 |
|------|-----|
| frontend | `npm run dev` :3000 |
| backend | `.venv/…/uvicorn app.main:app --reload --port 8000` (`/api`는 프론트가 프록시) |
| 권한 시현 | 기본 전원 sysadmin → 비-sysadmin(관리 UI 숨김) 검증은 `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys`로 `backend/` 기동 (`--reload`는 .env 재로드 안 함 → 완전 재기동) |

검증=lint+build(+해당 시 pytest/vitest) · 시현=브라우저 · 검토결과: ✅OK / 🔧수정→반영 / ⏳미정 / ⏸보류.

## 절대 규칙 (전 단위 공통)
- 디자인 토큰만(raw hex 금지) · i18n 필수(`t()`·en/ko 양쪽) · KST(`formatKst`/`formatKstShort`) · `genId()`(crypto.randomUUID 금지) · React Compiler(setState-only 핸들러=plain fn) · LF · UI 영어/데이터 한글 · Lucide 16px/1.5.
- 재사용 우선: `top-nav`·`notification-bell`·`markdown-view`·`status-badge`·`modal-backdrop`·`confirm-dialog`·`toast-stack`·`tooltip`·`admin/approval-queue`·`permissions/pending-approvals-panel`·설정 `app/settings/page.tsx` 구조.
- 백엔드 신규 테이블은 startup `create_all` 자동 생성(핸드오프 승인). 작성/관리 권한 = sysadmin.

## 마스터 표

| ID | 화면 | 단위 / 내용 | 검증 | 시현 | 검토결과 | 커밋 |
|----|------|-------------|------|------|---------|------|
| S1 | 공유 셸 | **TopNav 3-way 세그먼트 탭**(맵목록 `/`·공지 `/notices`·인박스 `/inbox`, `usePathname` 강조, ko/en 세그먼트 패턴 재사용) + `/notices`·`/inbox` **빈 placeholder 라우트**. 백엔드 무관. 구현: `NAV_TABS`(브랜드+탭 좌측 그룹 래핑·맵목록은 `/`·`/maps` 활성)·i18n `nav.tab.*`. 시안 `피드백 버튼위치.png` | lint/build✅ | ✅(스크린샷) | ✅ | a3e6a32 |
| S1a | 공유 셸 | S1 폴리시(사용자 시현) — 탭 **아이콘**(맵목록 Map·공지 Megaphone·인박스 Inbox, 14px/1.5) + **슬라이딩 박스 인디케이터**(grid-cols-3 등폭·`w-1/3`·`translateX(idx*100%)`·`duration-350 ease-spring`, 비활성 경로=opacity0) + **폰트 축소**(text-caption→text-fine). | lint/build✅ | 아이콘·폰트·레이아웃 스크린샷✅ / 활성 슬라이드=인증탭 | ⏳ | (this) |
| S2a | 피드백 | **백엔드 `Feedback`** — 모델(id/kind/body/author/context JSON/status/created_at) + `routers/feedback.py`(POST 201·GET 집계·PATCH sysadmin) + schemas(Create/Out/Counts/ListOut/StatusUpdate) + `main.py` 등록 + `tests/test_feedback.py`. | ruff✅·pytest 4/4·전체 385✅ | (백엔드) | ✅ | (this) |
| S2b | 피드백 | **프론트 피드백 진입** — `lib/api.ts`(submit/list/updateStatus + 타입) + i18n `feedback.*` + **TopNav 피드백 버튼** + **`feedback-side-panel.tsx`**(유형 세그먼트 한 행·본문·현재 route/맵 자동첨부·제출 토스트·"모든 피드백 보기"→`/feedback`). 시안 `피드백 버튼위치.png` | ⏳ | ⏳ | ⏳ | — |
| S3 | 피드백 | **전체 페이지 `/feedback`** — 집계 카드(전체/내/작업중/완료) + 유형 필터 + 목록(유형·제목·작성자·상태 뱃지·등록일) + **관리자 상태변경 UI**(sysadmin). 시안 `피드백 화면.png` | ⏳ | ⏳ | ⏳ | — |
| S4 | 공지 | **백엔드 `Notice` 모델+`routers/notices.py`**(GET 목록·상세, 관리 CUD) + `lib/notices-read.ts`(localStorage 읽음 캐시) + api + **뷰어 `/notices`**(좌 목록 전체/중요/일반·미읽음 점·"안읽음 N" / 우 `MarkdownView` 상세). 시안 `공지화면.png` | ⏳ | ⏳ | ⏳ | — |
| S5 | 공지 | **설정 '공지사항 관리' 탭**(콘텐츠 카테고리 신설·sysadmin) — 목록(게시중/예약/종료 상태·중요도·게시기간·수정/삭제) + **등록 모달**(제목·중요도·**게시기간 캘린더 range**·무제한 체크·본문 md·전체 알림 발송). 등록→뷰어 반영·`notify_all` fan-out. 시안 `공지사항관리화면.png`·`달력모달-….png` | ⏳ | ⏳ | ⏳ | — |
| S6 | 인박스 | **알림 탭** — `POST /api/notifications/read-all` + **`/inbox`** 마스터-디테일 셸 + 알림 탭(`listNotifications`·개별/모두 읽음·"관련 맵 보기"). 시안 `Inbox Page.html` | ⏳ | ⏳ | ⏳ | — |
| S7 | 인박스 | **승인 대기 탭** — `GET /api/inbox/approvals`(버전승인 내담당 + checkout 이전요청 + approval-requests 통합) + 승인건 만장일치 체크리스트·승인/반려(기존 엔드포인트 재사용). 시안 `Inbox Page.html` | ⏳ | ⏳ | ⏳ | — |
| S8 | 매뉴얼 | **백엔드 `ManualDoc` 모델 + `GET/PUT /api/manual`**(DB 우선·`manual.md` fallback) + **뷰어 `/manual`**(좌 TOC + 우 `MarkdownView`·본문검색 `Ctrl+K`·읽기폭 토글·본문한정 읽기테마 토글·코드복사). 시안 `메뉴얼 뷰 화면.png` | ⏳ | ⏳ | ⏳ | — |
| S9 | 매뉴얼 | **설정 '매뉴얼' 편집·게시 탭**(sysadmin) — md/HTML 토글·`.md` 업로드·배포본 불러오기·**미리보기 버튼**(실시간 미리보기 없음)·게시(`putManual`). 편집→게시→뷰어 반영. 시안 `메뉴얼 편집화면.png` | ⏳ | ⏳ | ⏳ | — |
| S10 | 대시보드 | **설정 '분석 > 대시보드' 진입 카드 스텁**(카테고리 신설) — "운영 대시보드 열기" 카드 + "세부 지표 추후 보완" 안내. 상세 화면은 이후 배치. 시안 `대시보드 진입점.png` | ⏳ | ⏳ | ⏳ | — |

## 비고
- **진행 순서**: S1(셸) → S2·S3(피드백) → S4·S5(공지) → S6·S7(인박스) → S8·S9(매뉴얼) → S10(대시보드 스텁). 저위험·풀스택 1회(피드백)로 패턴 정립 후 확장.
- **각 슬라이스는 백엔드+프론트를 함께 포함**해 프론트에서 검증되게 한다. 큰 슬라이스는 착수 시 서브유닛 행(S2a/S2b…)으로 분리.
- 각 단위는 독립 커밋 + **PROGRESS·이 표 동반 갱신**(`rules/common/git.md`). 매 커밋 전 lint+build 통과.
- **미해결**: 대시보드 상세(별도 spec) · 매뉴얼 읽기테마 스타일 범위(본문 한정, 구현 중 확인) · 피드백 목록 열람 정책(전체 열람+내 필터로 진행).
