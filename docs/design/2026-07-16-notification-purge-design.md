# 알림 통합·삭제(퍼지)·100개 한도 — 설계 스펙

2026-07-16 · 브랜치 `worktree-alarm-audit` · 선행 감사: `../qa/alarm-audit.md` (main ed15440 기준)

## 0. 목표와 확정 결정

벨 알림(notifications)을 실사용 가능한 알림함으로 완성한다: 승인 이벤트 커버리지 통합, 사용자 삭제 수단(개별/일괄/조건), 인당 100개 한도, 벨→알림 탭 네비게이션, 카테고리 필터, 관리자 기간 퍼지.

사용자 확정 결정:
1. 승인 관련 알림은 **요청 발생 + 처리 결과** 양쪽 모두 생성 (버전 워크플로와 대칭).
2. 100개 한도 초과 시 **읽음 여부 무관, 오래된 순 삭제**.
3. 관리자 퍼지 모달의 "고유 알림 목록"은 **type+message로 묶고 수신자 수 표시**.
4. 후속 조치 중 **인덱스 추가 + 매뉴얼 보정 4건** 포함, GET 페이지네이션·기간 자동 retention 제외.

전제(감사에서 확정): 벨 모달과 알림 탭은 이미 같은 `listNotifications` 목록 사용 — 유지. 알림 저장 모델(FK 없는 영속 스탬프)·5초 폴링 유지. inbox 승인 탭·notices 구조 변경 없음(승인 요청은 지금처럼 승인 탭에도 계속 노출). **DB 신규 컬럼 없음** — 인덱스 2개만 추가.

## 1. 신규 알림 이벤트 — type 6종 추가 (기존 6 → 12종)

생성은 전부 기존 단일 헬퍼 `create_notifications`(`workflow.py`) 경유 — 생성 경로 단일성 불변식 유지.

| 이벤트 | 수신자 (요청자 본인 제외, 중복 제거) | type | 메시지 템플릿 (영어, 기존 관례) | 생성 위치 |
|---|---|---|---|---|
| 점유권 이전 요청 | 현 점유자(`checked_out_by`) + 맵 owner 권한자 | `checkout_requested` | `{name} requested checkout of '{label}'` | `checkout.py` request_checkout |
| 점유권 요청 승인 | 요청자(`requested_by`) | `checkout_approved` | `Your checkout request for '{label}' was approved` | `checkout.py` decide_checkout_request |
| 점유권 요청 거절 | 요청자 | `checkout_rejected` | `Your checkout request for '{label}' was rejected` | 〃 |
| 권한/가시성 변경 요청 | 해당 맵 활성 승인자 (`load_active_approvers`) | `permission_requested` | `{name} requested {a visibility change\|a permission change} on '{map}'` | `permissions.py`의 ApprovalRequest 생성 3지점 (154·197·294행 부근) |
| 권한/가시성 요청 승인 | 요청자 | `permission_approved` | `Your request on '{map}' was approved` | ApprovalRequest 처리(승인) 지점 |
| 권한/가시성 요청 반려 | 요청자 | `permission_rejected` | `Your request on '{map}' was rejected` | ApprovalRequest 처리(반려) 지점 |

- 수신자 결정은 inbox 집계(`inbox.py`)의 노출 대상과 일치시킨다(승인 탭에서 보는 사람 = 벨 알림 받는 사람).
- `map_id`/`version_id`는 가능한 값 채움(네비게이션·관련 맵 링크용).
- checkout 요청 **회수(withdraw)** 알림은 범위 밖.

## 2. 인당 100개 한도

- `create_notifications` 내부: 행 add 후, 이번 호출의 수신자별로 `recipient` 기준 최신 100개(`created_at DESC, id DESC`)를 넘는 행을 같은 세션에서 delete. commit은 기존대로 호출자 책임(동일 트랜잭션).
- 상수 `NOTIFICATION_CAP = 100` — 비즈니스 상수, Settings 기본값만(.env 항목 없음, `rules/backend/config.md` 분류).
- 기존 100개 초과 사용자는 다음 알림 수신 시점에 자연 트리밍(일괄 정리는 관리자 퍼지로 가능).

## 3. 백엔드 API

### 3-1. 사용자용 — `routers/notifications.py` (전역 인증, 본인 것만)

| Method Path | Body/Query | 동작 |
|---|---|---|
| `DELETE /notifications/{id}` | — | 개별 하드 삭제. `recipient != user`면 404(기존 read 엔드포인트와 동일 패턴). 204 |
| `POST /notifications/bulk-delete` | `{ids?: int[], read_only?: true, before?: date}` | 조건 중 **정확히 1개**만 허용(0개 또는 2개 이상이면 422). 항상 `recipient == user` 강제. 반환 `{deleted: int}` |

- `ids`: 본인 소유가 아닌 id는 조용히 무시(교집합만 삭제).
- `read_only: true`: 본인의 `read=True` 행 전부.
- `before`: 해당 날짜 00:00 KST **미만**(그 날짜 이전 날들의 알림) 삭제. 날짜 해석은 KST(`clock.py`).

### 3-2. 관리자용 — `routers/admin.py` (sysadmin)

| Method Path | 동작 |
|---|---|
| `GET /admin/notifications/purge-preview?from&to` | `[from 00:00, to 24:00) KST` 내 알림을 `(type, message)`로 group by → `[{type, message, count, first_at, last_at}]`, `last_at DESC` 정렬. from/to 필수 |
| `POST /admin/notifications/purge` | body `{from, to, groups: [{type, message}]}` — 기간 내에서 확정된 `(type, message)` 묶음과 일치하는 **전 수신자 행** 하드 삭제. 반환 `{deleted: int}`. groups 빈 배열이면 422 |

범용 테이블 삭제 프레임워크는 만들지 않는다 — 알림 전용 엔드포인트.

## 4. 인덱스 + `db.py` 자동 보강 확장

- `ix_notifications_recipient_read` (recipient, read) — 5초 폴링 목록·unread 카운트.
- `ix_notifications_recipient_created` (recipient, created_at) — 정렬·캡 트리밍·날짜 조건 삭제.
- `models.py` `Notification.__table_args__`에 Index 선언(신규 DB) + `db.py`에 `_ADDED_COLUMNS`와 나란히 `_ADDED_INDEXES` 목록 신설 → startup에서 `CREATE INDEX IF NOT EXISTS`(sqlite/postgres 공통 지원). 운영 DB 리셋 불필요.

## 5. 프론트 — 벨 드롭다운 (`notification-bell.tsx`)

- 항목별 버튼 2개: 읽음(기존) + 삭제(X, `DELETE /notifications/{id}` 후 로컬 목록에서 제거).
- **버튼 외 영역 클릭 → `/inbox?notification=<id>` 이동.** 드롭다운 닫힘.
- 5초 폴링·숫자 없는 점 배지·25개 증분 렌더 유지.

## 6. 프론트 — 알림 탭 (`inbox/page.tsx`)

- **딥링크**: `useSearchParams`로 `?notification=<id>` 읽어 알림 탭 활성 + 해당 알림 상세 자동 오픈(기존 `openNotification` 재사용 → 자동 읽음 처리) 후 `router.replace`로 파라미터 소거(재트리거 방지). 목록에 없는 id(이미 삭제됨)는 조용히 무시.
- **카테고리 필 필터** (기존 읽음 필터·검색과 병행, `IconPillFilter` 스타일 재사용):
  - All / Version / Checkout / Permission / Notice
  - 매핑: Version = `review_requested·approved·rejected·approval_cancelled·published`, Checkout = `checkout_*`, Permission = `permission_*`, Notice = `notice`, 미지의 type은 All에서만 노출.
- **선택 모드**: 항목 체크박스 + 전체 선택 + "선택 삭제" → ConfirmDialog(모달 컨벤션: 아이콘+요약박스, 건수 표시) → `bulk-delete {ids}`.
- **읽은 알림 삭제** 버튼 → ConfirmDialog → `bulk-delete {read_only:true}`.
- **오래된 알림 삭제**: 날짜 선택(기존 date input 패턴) → ConfirmDialog에 해당 날짜 이전 건수 표시(클라이언트가 보유한 전체 목록(≤100건)에서 직접 계산) → `bulk-delete {before}` (실 삭제 건수는 서버 반환값 기준).
- 항목별 개별 삭제 버튼.
- 삭제 후 목록 재조회(또는 로컬 제거) + unread 배지 자연 갱신.
- 신규 type 6종의 카드 표기(아이콘/라벨)는 기존 type 표기 체계에 추가.

## 7. 관리자 퍼지 — 설정 → Database → Tables (`table-viewer.tsx`)

- `notifications` 테이블 선택 시에만: 기간 필터(from/to date input) + "Delete in range" 버튼 노출. 다른 테이블엔 어떤 삭제 UI도 없음.
- 버튼 → 모달: `purge-preview` 결과(고유 묶음: type · message · 수신자 수 · 기간)를 체크박스 목록으로 표시, **기본 전체 선택**. 최종 "Delete" → `purge` 호출 → 삭제 행 수 토스트 → 테이블 뷰 재조회.
- preview 결과 0건이면 삭제 버튼 비활성.

## 8. i18n·매뉴얼

- i18n: 필 라벨(All/Version/Checkout/Permission/Notice), 삭제 버튼·모달 문구, 관리자 퍼지 문구 — KO/EN 쌍 (`i18n-messages.ts`).
- 매뉴얼(같은 패스에서, 한/영 + 번들 `backend/app/manual.md` 동기화):
  - 신규: 알림 삭제 4종·100개 한도·벨 클릭 네비게이션·카테고리 필터·관리자 퍼지.
  - 감사 불일치 4건 교정: ① 인박스 알림 탭은 자동 갱신 아님(벨만 5초) ② 알림 보존 정책(100개 한도) 명시 ③ 공지 삭제는 즉시·복구 불가(휴지통 없음) ④ 공지 읽음은 기기별(localStorage).

## 9. 검증

- **pytest**: 신규 이벤트 6종 수신자·본인 제외·중복 제거 / 개별 삭제 소유권(타인 404) / bulk-delete 3모드 + 조건 0·2개 422 + recipient 격리 / 100캡 트리밍(101번째 생성 시 최고령 삭제, 읽음 무관) / purge-preview 그룹핑·기간 경계(KST) / purge 삭제 범위·sysadmin 게이트 / `_ADDED_INDEXES` 부트스트랩 멱등성.
- **프론트 게이트**: vitest(카테고리 매핑·선택 로직) + `tsc --noEmit` + lint + build.
- **Playwright 실검증**: 벨 항목 클릭 → 알림 탭 딥링크 오픈 / 개별·일괄·읽은것·날짜 삭제 / 관리자 퍼지 플로우. (KST 버킷은 sqlite에서 재현 안 되는 함정 유의 — 대시보드 교훈.)

## 10. 리스크·머지 고려

- **`worktree-workflow-improvements`(e0f3e73, 미머지)가 inbox 승인 탭을 수정 중** — 같은 파일(`inbox/page.tsx`)이라 머지 순서에 따라 충돌 정리 필요. 이번 작업은 알림 탭 영역 중심으로 diff를 좁게 유지.
- 관리자 퍼지는 하드 삭제·복구 불가 — 모달 2단계(미리보기 확정) UI가 안전장치. 매뉴얼에 명시.
- `before`/기간 해석은 KST 고정(`clock.py`) — 서버 tz 차이로 인한 경계 오류 주의(테스트로 고정).
