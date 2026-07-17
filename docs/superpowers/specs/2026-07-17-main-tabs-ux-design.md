# Main Tabs UX Refresh — Design (2026-07-17)

메인 탭(Maps · Inbox · Notices)과 Feedback 패널의 특정 페인포인트를 개선한다. 전면 리디자인이 아니라 **죽은 공간 활용 + 인지성 개선 + 조직도 그룹화**에 집중한다.

## 0. Context & Base State

- **Branch**: `worktree-main-tabs-ux` (worktree `.claude/worktrees/main-tabs-ux`), base = dev `0b72270`.
- **dev가 이미 제공하는 것** — 재작업하지 않는다:
  - **Inbox 알림 카테고리 아이콘 + 필터**: `frontend/src/lib/notification-categories.ts`
    (`NotificationCategory = "version" | "checkout" | "permission" | "subprocess" | "notice"`,
    `getNotificationCategory(type)`, `NOTIFICATION_CATEGORIES`) + `inbox/page.tsx`의
    `categoryFilter` state·`CATEGORY_ICONS`·`IconPillFilter`·`typeIcon()`. → 사용자 요청 "알림 카테고리 아이콘 구분(필터 적용)"은 **충족됨**.
  - `sp_description` SP 필드, 알림 삭제/퍼지 API(이 작업과 무관).
- **미변경(main과 동일)**: `frontend/src/app/page.tsx`(홈), `notices/page.tsx`, `feedback/page.tsx`,
  `components/top-nav.tsx`, `components/feedback-side-panel.tsx`, `components/maps/map-card.tsx`.
- **백엔드 변경 없음** — 전 항목이 기존 엔드포인트만 사용(`GET /maps`, `GET /directory`,
  `GET /inbox/approvals`, `GET /feedback`, 알림). 딥링크도 클라이언트 전용.

## 1. Maps 좌측 — 오우닝 부서 조직도 아코디언

**목표**: 좌측 맵 리스트를 owning department 조직도로 계층 그룹화한다. 최근 밴드는 우측 대시보드로 이동한다.

**데이터**
- 그룹 키 = `MapSummary.owning_department` (org_path, `/` 구분 문자열, 1–5 레벨. 명시적 부모 없음 — prefix로 계층 암시).
- 트리 구축 = `GET /directory` → `departments: DirectoryDept[]` (각 행 `id`=full org_path, `name`=리프 세그먼트, `korean_name`, `manager`). `getDirectory()` / `useDirectory()`(`frontend/src/lib/directory.ts`) 재사용.
- 트리는 각 `DirectoryDept.id`를 `/`로 split해 클라이언트에서 구성(부모 = 마지막 세그먼트 제외 prefix).

**동작**
- **브라우즈 모드(검색어·상태/권한/가시성 필터 없음)** → 아코디언. 리프 팀 노드가 해당 부서 소유 맵(`MapCard`, **디자인 그대로**)을 담고, 상위 부서 노드는 접기/펼치기 + 하위 맵 롤업 카운트.
- **검색·필터 활성** → 기존 평면 목록(현행 유지). 아코디언은 브라우즈 전용.
- `owning_department = null`(레거시) → 최하단 **`Unassigned department`** 버킷.
- 펼침 상태는 세션 유지(`sessionStorage`, 기존 `bpm.home.filters`와 별도 키 예: `bpm.home.orgOpen`). 초기: 내가 owner/editor인 맵이 있는 부서는 펼침, 나머지 접힘(1st cut은 전부 접힘도 허용).
- **`[SP]` 배지**: `MapCard`에 `sp_designated_at != null`이면 작은 배지 1개 추가. 카드의 나머지 레이아웃/스타일은 **불변**.

**파일**: `frontend/src/app/page.tsx`(리스트 렌더 분기), 신규 `frontend/src/components/maps/org-accordion.tsx`(트리 구성+렌더), `frontend/src/components/maps/map-card.tsx`([SP] 배지), `frontend/src/lib/org-tree.ts`(org_path[] → 트리 순수함수, 단위테스트 대상).

**결정됨**: 필터행 `Subprocess` 토글은 **선택** — 기본 포함(기존 Status/Role/Owning 필터와 동일 패턴, 카드 디자인 불변). 사용자가 spec 리뷰에서 빼자 하면 제거.

**Out of scope**: 부서장/조직 관리, owning_department 편집(설정에 이미 존재).

## 2. Maps 우측 — 홈 대시보드 (미선택 시)

**목표**: 아무 맵도 선택 안 됐을 때의 빈 우측 aside(`home.detailEmpty`, `page.tsx:695`)를 대시보드로 대체. 맵 선택 시 = 기존 `MapDetailCard` 그대로.

**섹션 3개**
1. **Needs your attention** — `GET /inbox/approvals`(`listInboxApprovals()`) 결과. 유저 스코프 이미 서버 처리. `kind`별(version_approval / checkout_transfer / approval_request) 카드 + 각 항목 클릭 → 해당 버전/인박스로 이동. 0건이면 섹션 숨김(또는 "all caught up").
2. **My unfinished drafts** — `listMaps()`에서 `latest_version_status === "draft" && my_role !== "viewer"` 필터. "마저 마무리하세요" 성격의 이어하기 목록. 0건이면 섹션 숨김.
3. **Recently opened** — 좌측에서 이동. `getRecentMaps()`(localStorage) ∩ 접근 가능 맵, 최신순. 각 카드: 맵명 + 상대시각 + owning dept + `[SP]`.

**최근 진입 애니메이션 (핵심 — 사용자 요청 ②)**
- 오작동이 아니라 **순서 변화 비가시성**이 문제. 맵 탭 복귀/재로딩 시 최근 목록 최상단이 바뀌었으면(직전 top id 대비) **새 항목이 위에서 내려오며 아래 목록이 밀리는 스태거 진입**을 재생 → 사용자가 "갱신됐음"을 인지.
- 구현: 직전 top id를 `sessionStorage`(예: `bpm.home.recentTop`)에 보관. 마운트 시 현재 top ≠ 저장값이면 애니메이션 트리거(엑셀 모달 스태거 등장 패턴 `excel-export-modal.tsx` 참조). `prefers-reduced-motion` 가드.
- top 변화 없으면 애니메이션 없음(매 렌더 반복 방지).

**파일**: `frontend/src/app/page.tsx`(우측 aside 분기), 신규 `frontend/src/components/maps/home-dashboard.tsx`(3섹션), 신규 `frontend/src/components/maps/recent-opened-list.tsx`(진입 애니메이션 포함). i18n 키 추가.

**가정**: "미완성 초안" 판정은 `latest_version_status === "draft"`로 충분(별도 백엔드 집계 불필요). 확정 시 사용.

## 3. Feedback 패널 — 최근 피드백 + 진행상황

**목표**: 작성폼 아래 남는 공간에 최근 피드백 카드 목록 노출. 카드/"보러가기" 클릭 → 피드백 페이지 해당 글 상세 모달 오픈.

**데이터/동작**
- `listFeedback()` → `FeedbackList`. **내 피드백**(author === 현재 login_id, `getCurrentUser()`)만 최신순 N개(예: 5). 각 카드: `kind` 아이콘(bug/suggestion/question/etc) + `body` 발췌 + 상태칩(`draft`/`in_progress`/`done`, `lib/feedback-meta.ts` 라벨/스타일 재사용).
- 카드/"보러가기" 클릭 → `router.push("/feedback?feedback=<id>")` 후 패널 닫기.
- **딥링크(신규)**: `feedback/page.tsx`가 마운트 시 `?feedback=<id>` 읽어 `selectedId` seed → `FeedbackDetailModal` 자동 오픈. 모달 닫으면 param 정리(replace).
- 위치: 작성폼(kind 세그먼트 + textarea + Cancel/Submit) 아래. 목록이 없으면 섹션 비표시. 스크롤은 목록 영역만.

**파일**: `frontend/src/components/feedback-side-panel.tsx`(하단 목록 섹션 추가), `frontend/src/app/feedback/page.tsx`(딥링크 param 처리). i18n 키 추가.

**Out of scope**: 피드백 작성/수정/삭제 로직 변경, 상태 전이.

## 4. Inbox 미선택 우측 — 활동 요약 다이제스트

**목표**: 우측 detail aside가 미선택일 때의 placeholder(`inbox.selectPrompt` / `inbox.approvalsSelectPrompt`)를 활동 요약으로 대체.

**동작**
- **Notifications 탭 미선택** → 카테고리별 건수(기존 5카테고리 `NOTIFICATION_CATEGORIES` + `getNotificationCategory` 재사용) + 미읽음 수 요약. "Select a notification to read →" 유지.
- **Approvals 탭 미선택** → 대기 승인 건수 요약, 0건이면 "✓ All caught up".
- 데이터는 이미 로드된 `items`/`approvals` state에서 파생(추가 fetch 없음).

**파일**: `frontend/src/app/inbox/page.tsx`(우측 aside 미선택 분기), 신규 `frontend/src/components/inbox-digest.tsx`(공용 다이제스트 뷰 — Notices와 형태 공유 가능하면 재사용). i18n 키 추가.

## 5. Notices 미선택 우측 — 활동 요약 다이제스트

**목표**: `notices/page.tsx`의 `notices.selectPrompt` placeholder(`:230`, `notice-detail-aside`)를 다이제스트로 대체.

**동작**: 미읽음/전체 건수 + 최신 중요(important) 공지 1건 강조(클릭 시 해당 공지 선택). 읽음은 기존 클라 캐시(`notices-read`) 기준. 추가 fetch 없음.

**파일**: `frontend/src/app/notices/page.tsx`(우측 aside 미선택 분기), 다이제스트 뷰(4번과 형태 공유). i18n 키 추가.

## 6. Cross-cutting

- **i18n**: 신규 문자열은 전부 `frontend/src/lib/i18n-messages.ts`에 ko/en 동시 추가(하드코딩 금지). UI 영어 기본.
- **디자인 토큰**: raw hex 금지, 토큰 클래스/`var(--color-*)`만. Lucide 16px strokeWidth 1.5. 라이트 전용.
- **React Compiler 함정**: setState-only 핸들러는 plain 함수, effect 내 동기 setState 금지(reloadKey/anchor 파생). `frontend/AGENTS.md` 준수.
- **id 생성**: `genId()`(`crypto.randomUUID` 금지).

## 7. Verification

- **단위테스트(vitest)**: `lib/org-tree.ts`(org_path[] → 트리, Unassigned 처리, prefix 롤업), "미완성 초안" 필터 파생, 최근 top 변화 판정.
- **브라우저 검증(Playwright + 시스템 Chrome)**: (a) 조직도 아코디언 펼침/접힘·검색 시 평면 전환, (b) 대시보드 3섹션·최근 진입 애니메이션(top 변화 시), (c) Feedback 최근카드→딥링크 모달, (d) Inbox/Notices 미선택 다이제스트. 데모 시드로 실기동(devUser).
- 로컬 네이티브 실행(backend uvicorn + frontend `npm run dev`)로 확인. `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS=""` 로 전체 pytest 그린 확인.

## 8. Risks / Open

- **아코디언 ↔ 기존 정렬/무한슬라이스/권한 그룹 경계 상호작용**: 브라우즈=아코디언 / 검색·필터=평면으로 모드 분리해 복잡도 격리. 아코디언 모드에서는 권한 그룹 경계선·최근 밴드 로직 미적용.
- **owning_department null 비중**: 레거시 맵 다수면 `Unassigned` 버킷이 커질 수 있음 — 정상. 필요 시 최상단 대신 최하단 유지.
- **딥링크 param 잔존**: 모달 닫을 때 `?feedback` 제거(`router.replace`)로 새로고침 재오픈 방지.
- **⑤ 범위 확인**: dev의 Inbox 카테고리 구현이 사용자 의도를 완전히 만족하는지 spec 리뷰에서 최종 확인.
