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
| S1a | 공유 셸 | S1 폴리시(사용자 시현) — 탭 **아이콘**(맵목록 Map·공지 Megaphone·인박스 Inbox, 14px/1.5) + **슬라이딩 박스 인디케이터**(grid-cols-3 등폭·`w-1/3`·`translateX(idx*100%)`·`duration-350 ease-spring`, 비활성 경로=opacity0) + **폰트 축소**(text-caption→text-fine). | lint/build✅ | 아이콘·폰트·레이아웃 스크린샷✅ / 활성 슬라이드=인증탭 | ✅ | 4e29a7b |
| S1b | 공유 셸 | 로그인 상태 반영(사용자 시현) — **미로그인 시 유저칩 "Login"**(클릭 시 `/login`, 로그인 시 이름+드롭다운 유지) + **미로그인 시 피드백 버튼 숨김**(`{user && …}`). i18n `nav.guest`(고아 제거)→`nav.login`. | lint/build✅ | ⏳ 브라우저(:3001 재기동 후) | ⏳ | (this) |
| S2a | 피드백 | **백엔드 `Feedback`** — 모델(id/kind/body/author/context JSON/status/created_at) + `routers/feedback.py`(POST 201·GET 집계·PATCH sysadmin) + schemas(Create/Out/Counts/ListOut/StatusUpdate) + `main.py` 등록 + `tests/test_feedback.py`. | ruff✅·pytest 4/4·전체 385✅ | (백엔드) | ✅ | (this) |
| S2b | 피드백 | **프론트 피드백 진입** — `lib/api.ts`(submit/list/updateStatus + 타입) + i18n `feedback.*` + **TopNav 피드백 버튼**(MessageSquare·accent) + **`feedback-side-panel.tsx`**(우측 슬라이드인·유형 세그먼트·본문·현재 route/맵# 자동첨부·제출 토스트·"모든 피드백 보기"→`/feedback` placeholder). 시안 `피드백 버튼위치.png` | lint/build✅ | 패널·제출 e2e(id=3 저장) 스크린샷✅ | ✅ | 2e360a8 |
| S2c | 피드백 | 패널 디자인 정합(사용자 시안) — 유형 **세그먼트 컨트롤**(회색 트랙+흰 활성 pill)·헤더 서브타이틀·유형/내용 라벨·컨텍스트 노트 **raw 라우트 표시 삭제**(자동첨부 안내만)·**하단 2행 버튼**(모든 피드백 보기 풀폭 + 취소/보내기 1:2) + **본문 4000자 제한·`n/4000` 카운터**(백엔드 max_length 일치). | lint/build✅ | 패널 정합·카운터·제출 e2e(context route "/") 스크린샷✅ | ✅ | (this) |
| S3 | 피드백 | **전체 페이지 `/feedback`** — 집계 카드(전체/내 accent/작업중/완료 %) + 유형 필터·검색 + 목록(유형 뱃지·내용 truncate·작성자·상태·등록일) + **관리자 상태변경**(sysadmin `<select>`, 비-sysadmin은 읽기 뱃지). counts·filtered는 렌더 계산(React Compiler). + 공유 스토어 `lib/feedback-panel.ts`(TopNav 패널을 어느 화면 버튼이든 오픈). 시안 `피드백 화면.png` | lint/build✅ | 렌더·집계·유형뱃지·페이지 버튼→패널 스크린샷✅ | ✅ | 89c071b |
| S3b | 피드백 | 필 재디자인 + 상태변경→상세/관리 모달(사용자 요청) — 유형·상태 **채운 파스텔 필**(공유 `lib/feedback-meta`) · 상태 `new→draft`(Draft/In Progress/Done) · 목록 select 제거→**행 클릭 상세 모달**(`feedback-detail-modal`). **모달**: 상태변경(관리자)·답글(관리자·done제외 잠금)·본문수정/삭제(작성자·draft만) + 본문/답글/완료 시각. **백엔드**: Feedback +reply·body_edited_at·reply_at·done_at, PATCH 필드별 권한검증, DELETE, 테스트 7건. 시안 `피드백 화면.png` | ruff✅·pytest 7/7·388✅·lint/build✅ | 필·모달·답글저장(reply_at)·완료(done_at·답글잠금) e2e 스크린샷✅ | ✅ | (this) |
| S4 | 공지 | **백엔드 `Notice`** — 모델 + `routers/notices.py`(GET 게시기간필터·상세·manage·POST notify_all fan-out·PATCH·DELETE, sysadmin CUD) + 테스트 5건 + `lib/notices-read.ts`(localStorage 읽음 캐시) + api + **뷰어 `/notices`**(좌 목록 전체/중요/일반·미읽음 점·안읽음 N·중요/일반 파스텔 필 / 우 `MarkdownView` 상세·게시기간). 클릭 시 읽음 캐시. 시안 `공지화면.png` | ruff✅·pytest 5/5·393✅·lint/build✅ | 뷰어·필·미읽음(4→3)·마크다운·읽음캐시 e2e 스크린샷✅ | ✅ | 413af49 |
| S4a | 공지 | 뷰어 시안 정합(사용자) — **홈 폭**(`max-w-[80rem]`·경계 rounded 카드) + rounded-full 필터·선택 좌측 액센트바·본문 1줄 미리보기·읽음("읽음"·회색·프리뷰 생략)·상세 아바타 서클·게시기간·**피드백 콜아웃**(클릭 시 패널). 시안 `공지화면.png` | lint/build✅ | 카드·홈폭·필·미리보기·읽음·상세 아바타/게시기간/콜아웃 스크린샷✅ | ✅ | 184b601 |
| S4b | 공지 | 뷰어 폴리시(사용자) — 목록 메타 **시간 노출**(MM-DD HH:mm)·**제목+내용 첫줄** 전 항목 노출(읽음 포함)·선택 카드 **강조선 제거**+곡선 최소(rounded-xs, 손톱형)·**바깥 테두리 제거**(홈 맵 리스트처럼, 내부 구분선만). | lint/build✅ | 시간·첫줄·선택·무테두리 스크린샷✅ | ✅ | 008dcef |
| S4c | 공지 | 목록 카드화(사용자) — 각 항목 **border+bg 카드**(gap 간격)·읽음표시/시간 **우측정렬**(justify-between)·제목 전 항목 **진하게**(font-semibold text-ink). | lint/build✅ | 카드·우측정렬·진한 제목 스크린샷✅ | ✅ | 697b51e |
| S4d | 공지 | 선택 카드 **좌측 테두리 강조**(사용자) — `border-l-2 border-l-accent`(+accent-tint), 나머지 hairline. + 상세 본문은 채팅봇용 `markdown-view` 재사용 확인. | lint/build✅ | 좌측 강조 스크린샷✅ | ✅ | (this) |
| — | 공지 | (후속) TopNav 공지 탭 미읽음 뱃지 — 뷰어의 읽음 캐시 기반. 별도 폴리시로 이월. | — | — | ⏳ | — |
| S5 | 공지 | **설정 '공지사항 관리' 탭**(콘텐츠 카테고리 신설·sysadmin) — 목록(게시중/예약/종료 상태 파생·중요도·게시기간·수정/삭제) + **등록/수정 모달**(제목·중요도 세그먼트·**게시기간 date-range 캘린더**(자체)·무제한 체크·본문 md·전체 알림 발송). KST 경계 ISO 저장. `components/notices/{date-range-calendar,notice-edit-modal,notices-manage-panel}`. 시안 `공지사항관리화면.png`·`달력모달-….png` | lint/build✅ | 탭·테이블·모달·캘린더 range(17~20·4일간)·등록 e2e(예약 상태 파생) 스크린샷✅ | ✅ | (this) |
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
