# 알람(알림) 기능 전수 조사 — 명확화 & 퍼지(삭제) 경로 분류

기준: main `ed15440` (2026-07-16, 브랜치 `worktree-alarm-audit`). 읽기 전용 감사 — 코드 변경 없음.

목적 2가지:
1. **명확화** — "알람"이라 불리는 기능의 실체(서브시스템·데이터 모델·API·생성 이벤트·읽음 규칙·UI 표면)를 코드 근거로 확정.
2. **퍼지(삭제) 분류** — 알림 레코드가 삭제·정리되는 **모든** 경로를 전수 분류하고, 존재하지 않는 경로는 "없음"으로 확정.

---

## 1. 한눈에 — "알람"은 3개 서브시스템

| 구분 | 벨 알림 (notifications) | 수신함 (inbox) | 공지 (notices) |
|---|---|---|---|
| UI 명칭 (KO/EN) | 알림 / Notifications | 알림·승인 / Inbox | 공지사항 / Notices |
| 저장 | `notifications` 테이블 (영속) | **테이블 없음** — 실시간 집계 뷰 | `notices` 테이블 (영속) |
| 성격 | 수신자별 fire-and-forget 스탬프 | "내가 지금 처리할 결재" pending 큐 | 관리자 브로드캐스트, 게시기간 창 |
| 라우터 | `routers/notifications.py` | `routers/inbox.py` | `routers/notices.py` |
| 읽음 상태 | 서버 저장 (`read` 컬럼) | 개념 없음 (처리되면 큐에서 소멸) | 서버 미저장 — 클라 localStorage |
| 사용자 삭제 | **없음** | 해당 없음 (삭제할 레코드 없음) | sysadmin 하드 삭제만 |
| 자동 retention | **없음** | 해당 없음 | 없음 (기간 만료 = 숨김, 삭제 아님) |
| cascade 삭제 | **없음** (FK 의도적 미설정) | 해당 없음 | 없음 |

**교차 관계:**
- 공지 **등록** 시 `notify_all=True`면 활성 직원 전원에게 `type="notice"` 벨 알림 파급 (`notices.py:80-84`). 수정(PATCH) 시엔 불가 — 프론트도 신규 등록에만 체크박스 노출 (`notice-edit-modal.tsx:207-218`).
- 버전 워크플로(제출/승인/반려/게시) = 벨 알림 + inbox 큐 **양쪽**에 나타남.
- 점유권 이전(checkout) = **inbox에만** 나타나고 벨 알림은 생성하지 않음 (`checkout.py`에 Notification 코드 0건 — 비대칭 지점).
- 공지를 삭제해도 그 공지가 뿌린 벨 알림 행은 남는다 (연결 컬럼 자체가 없음).

## 2. 데이터 모델

### 2-1. `Notification` — `models.py:317-330`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | Integer PK | |
| `recipient` | String(100) | login_id 문자열, **FK 아님·인덱스 없음** |
| `type` | String(50) | 6종 (§4) |
| `map_id` / `version_id` | Integer nullable | **FK 미설정** — `models.py:325` 주석: "느슨한 참조(FK 미설정) — 알림은 fire-and-forget 스탬프라 맵/버전 삭제와 무관하게 보존" |
| `message` | Text | default `""` |
| `read` | Boolean | default False |
| `created_at` | DateTime(tz) | KST `_now` |

- **인덱스 전무** — `models.py`의 `Index`는 `ai_chat_sessions`에만 존재. `recipient`/`read` 조회는 풀스캔.
- `deleted_at`·만료 컬럼 없음.

### 2-2. `Notice` — `models.py:358-372`

`title(200)` · `body_md` · `importance("important"|"normal")` · `starts_at`/`ends_at(null=무제한)` · `created_by` · `created_at`. 읽음 컬럼 없음(클라 캐시 — `models.py:359` 주석).

### 2-3. Inbox — 모델 없음

`VersionApproval`/`MapVersion` · `CheckoutRequest` · `ApprovalRequest` 3소스를 매 요청 조인해 `InboxApprovalOut`(`schemas.py:283-306`, `kind` 3종)으로 반환.

## 3. API 표면 전수

### notifications (`/api/notifications`, 전역 인증)

| Method Path | 권한 | 동작 | 위치 |
|---|---|---|---|
| `GET ""` | 본인분만 | `?unread_only` 필터, `created_at DESC`, **페이지네이션 없음(전건)** | `notifications.py:19` |
| `POST /read-all` | 본인 | `recipient==user AND read=False → read=True` 일괄 UPDATE, 204 | `notifications.py:33` |
| `POST /{id}/read` | 본인(타인 것 404) | 개별 `read=True` | `notifications.py:46` |

**DELETE 라우트 없음** — 라우터 전체 3개 엔드포인트가 전부다 (실측 확인).

### inbox (`/api/inbox/approvals`, 전역 인증)

| 출처 | 조건 | kind | 위치 |
|---|---|---|---|
| 버전 게시 승인 | 내가 `MapApprover`이고 미승인인 PENDING 버전 | `version_approval` | `inbox.py:38-67` |
| 점유권 이전 | pending `CheckoutRequest` — 현 점유자/오너 것만, sysadmin은 전부 | `checkout_transfer` | `inbox.py:69-108` |
| 권한/가시성 승인 | pending `ApprovalRequest` — 내가 승인자인 맵만, sysadmin은 전부 | `approval_request` | `inbox.py:110-148` |

GET 단일 라우트. 승인/반려 액션은 각 출처의 기존 엔드포인트 재사용 (inbox에 act 엔드포인트 없음).

### notices (`/api/notices`, 전역 인증)

| Method Path | 권한 | 동작 | 위치 |
|---|---|---|---|
| `GET ""` | 전 유저 | 게시기간 유효분만 | `notices.py:24` |
| `GET /manage` | sysadmin | 기간 무관 전체 | `notices.py:40` |
| `GET /{id}` | 전 유저 | 단건 | `notices.py:54` |
| `POST ""` | sysadmin | 생성 (+`notify_all` 벨 파급) | `notices.py:65` |
| `PATCH /{id}` | sysadmin | 부분 갱신 | `notices.py:90` |
| `DELETE /{id}` | sysadmin | **하드 삭제** (§7 D1) | `notices.py:110` |

## 4. 알림 생성 이벤트 전수 — 7지점 · type 6종

생성 경로는 단일 헬퍼 **`create_notifications`**(`workflow.py:42-64`, 수신자별 행 add, commit은 호출자 책임)뿐. `Notification()` 직접 생성은 이 헬퍼 외에 없음(시드 제외).

| # | 이벤트 | 수신자 | type | 위치 |
|---|---|---|---|---|
| 1 | 승인 요청 (버전 제출) | 활성 승인자 전원 (`load_active_approvers`) | `review_requested` | `versions.py:512` |
| 2 | 전원 승인 완료 → APPROVED | 제출자 1인 | `approved` | `versions.py:566` |
| 3 | 반려 (사유 포함) | 제출자 1인 | `rejected` | `versions.py:610` |
| 4 | 게시 | 활성 승인자 전원 | `published` | `versions.py:662` |
| 5 | 공지 등록 + notify_all | **활성 직원 전원** | `notice` | `notices.py:84` |
| 6 | 승인자 전원 퇴사 → 승인 취소, draft 복귀 | 오너+제출자 (중복 제거) | `approval_cancelled` | `workflow.py:148` |
| 7 | 마지막 미승인자 퇴사 → 자동 APPROVED | 제출자 | `approved` | `workflow.py:160` |

- #6/#7은 AD 동기화의 퇴사자 reconcile(`ad/service.py:204`)에서 트리거.
- #5는 직원 수만큼 행 생성 — 시드 기준 401명이면 공지 1건당 401행.

## 5. 읽음/안읽음 semantics

- **벨 알림**: `read` 컬럼. 개별(`POST /{id}/read`)·일괄(`POST /read-all`) 읽음만 가능, 행은 영구 잔존. unread 소스: 벨 배지 = 프론트 필터(`notification-bell.tsx:51`), 대시보드 `unread_notifications` = 서버 카운트(`dashboard.py:362-366`).
- **공지**: 서버 읽음 없음. 클라 localStorage `bpm.notices.read`(`notices-read.ts`) — **기기/브라우저별로 초기화됨**.
- **inbox**: 읽음 개념 없음. 결재 처리로 pending을 벗어나면 쿼리 조건 탈락으로 목록에서 소멸.

## 6. 프론트엔드 표면

| 표면 | 로드 방식 | 삭제 UX | 비고 |
|---|---|---|---|
| 벨 드롭다운 (`notification-bell.tsx`) | **5초 폴링** (`POLL_MS=5000`) | 없음 | 항목 클릭 이동 없음(읽음 버튼만), 배지는 숫자 없는 점, 25개 증분 렌더 |
| 인박스 알림 탭 (`inbox/page.tsx`) | **마운트 1회, 폴링 없음** | 없음 ("모두 읽음"만) | 카드 열면 자동 읽음, 상세에서 `map_id` 있으면 "관련 맵 보기" 링크 |
| 인박스 승인 탭 | 마운트 1회 | — | 승인/반려 후 재조회로 큐에서 빠짐 (삭제 아님) |
| 공지 열람 (`notices/page.tsx`) | 마운트 1회 | 없음 | 필터 all/important/normal, 읽음은 localStorage |
| 공지 관리 (`notices-manage-panel.tsx`) | sysadmin 전용 (설정→콘텐츠) | **개별 삭제, 2단계 인라인 확인** | 벌크 삭제 없음. live/scheduled/ended 상태 파생 |

API 클라이언트(`lib/api.ts`): `listNotifications`/`markNotificationRead`/`markAllNotificationsRead`(1377-1388), `listNotices`/`listNoticesManage`/`getNotice`/`createNotice`/`updateNotice`/`deleteNotice`(1489-1518), `listInboxApprovals`(856). **notification 삭제 함수는 부재.**

## 7. 퍼지(삭제) 경로 분류 ★

### 7-1. 존재하는 삭제 경로 — 전수 3건

| ID | 분류 | 대상 | 트리거·권한 | 범위 | 성격 | 위치 |
|---|---|---|---|---|---|---|
| **D1** | 명시적 삭제 API | `Notice` 1건 | sysadmin, 공지 관리 패널 (UI 2단계 확인) | 해당 공지만 | `session.delete` **하드 삭제** — 소프트삭제/휴지통 없음, 복구 불가. 파생된 벨 알림 행은 미삭제 | `notices.py:110-122` / `notices-manage-panel.tsx:82-87` |
| **D2** | 운영 스크립트 | 전 테이블 | 개발자 수동 `python -m scripts.reset_db` | DB 전체 | `drop_all→create_all` — 알림 포함 전멸. **운영 서버 실행 금지**(런칭됨) | `reset_db.py:60-61` |
| **D3** | 데모 시드 | `Notification` | 개발자 수동 `seed_inbox_demo` | 데모 맵의 알림만 | 재시드 전 선삭제. **백엔드 전체에서 유일한 `delete(Notification)` 쿼리** | `seed_inbox_demo.py:60` |

즉 **프로덕션 코드에 존재하는 삭제는 D1(공지) 하나뿐**이고, 벨 알림(`Notification`)을 지우는 프로덕션 경로는 0개다.

### 7-2. 없음 확정 목록 (검색으로 배제 — 근거 포함)

| 카테고리 | 판정 | 근거 |
|---|---|---|
| 벨 알림 사용자 삭제 API (개별/전체/읽은것만) | **없음** | `notifications.py` 라우트 3개 전부 GET/read — DELETE 0건 (실측 재확인) |
| 프론트 삭제 UI·클라이언트 함수 | **없음** | `api.ts`에 delete류 함수 0건, 벨/인박스에 삭제 버튼 0건 |
| 개수 상한·기간 retention·생성 시 트리밍 | **없음** | `create_notifications`에 트리밍 없음. 스케줄러/크론 자체가 0건 (`apscheduler\|celery\|add_job\|cron` grep 0). 보존 상한 3종(`app_settings.py:10-17`)은 **AI 챗 전용** |
| 맵 삭제(소프트/휴지통/영구) 연쇄 | **없음(의도)** | `map_id` FK 미설정 + `maps.py`에 Notification 삭제 코드 0건 → 고아 행으로 잔존(dangling map_id) |
| 버전 삭제/만료 연쇄 | **없음** | `versions.py`의 Notification 관여는 생성 4곳뿐. 버전 FK cascade는 `VersionApproval`(승인 집계)에만 있음 |
| 직원 퇴사 프룬 연쇄 | **없음** | `recipient`는 FK 아닌 문자열, `employees.py`에 알림 삭제 0건 — 퇴사자 알림 잔존 |
| 그룹 삭제(7일 retention) 연쇄 | **없음** | `groups.py`의 `GROUP_RETENTION`은 그룹 자신만, 알림 미조작 |
| 공지 삭제 → 파생 벨 알림 연쇄 | **없음** | 공지-알림 연결 컬럼 자체가 없음 |
| inbox 삭제 | **대상 없음** | 저장 테이블이 없는 계산 뷰 — 삭제할 레코드가 존재하지 않음 |

### 7-3. "삭제"로 오인되는 동작 (실제는 다름)

| 겉보기 | 실제 | 위치 |
|---|---|---|
| 벨/인박스 알림 "정리" | `read=True` UPDATE — 행 영구 잔존, 목록에서도 회색 처리로 남음 | `notifications.py:33-60` |
| inbox 항목이 사라짐 | 승인/반려로 `pending` 조건 탈락 — 원본 레코드는 상태만 변경 | `inbox.py:46,74,114` |
| 공지가 목록에서 사라짐 | `ends_at` 경과 시 일반 목록 **숨김** — 레코드·관리자 목록 유지 | `notices.py:31-34,45-51` |
| 공지 "읽음 처리" | 서버 무관, 브라우저 localStorage — 기기 바꾸면 초기화 | `notices-read.ts`, `notices.py:3` |

## 8. 문서 ↔ 코드 불일치 (매뉴얼 보정 후보)

| # | 문서 서술 | 실제 | 위치 |
|---|---|---|---|
| ① | 인박스 "알림 탭 — 몇 초 간격으로 갱신" | 인박스는 마운트 1회 로드·폴링 없음. 5초 폴링은 **벨만** | `user-manual-general-ko.md:143` vs `inbox/page.tsx:126-137` |
| ② | 알림 보존 정책 서술 없음 | 삭제 불가·무한 누적인데 문서 공백 (AI챗·맵·그룹은 보존/휴지통 명시와 대조) | 매뉴얼 전반 |
| ③ | 공지 "수정·삭제는 즉시 반영" | 하드 삭제·복구 불가·휴지통 없음이 빠짐 (맵/그룹 7일 휴지통과 오해 소지) | `admin-manual-ko.md:59` vs `notices.py:122` |
| ④ | 공지사항 탭 "읽음 처리 지원" | 기기별 localStorage — 서버 저장처럼 읽힘 | `user-manual-general-ko.md:138` vs `notices-read.ts` |
| ⑤ | 벨 5초 폴링·전체 알림 발송·대시보드 미읽음 지표 | **일치** (정합 확인) | `backend/app/manual.md:40`, `admin-manual-ko.md:56,124` |

## 9. 리스크 & 후속 후보 (이번 감사 범위 밖 — 백로그)

1. **무한 누적 × 인덱스 전무 × 5초 폴링**: `recipient`/`read` 무인덱스 풀스캔을 전 사용자가 5초마다 수행. notify_all 공지 1건당 직원 수(401)만큼 행 증가. 장기 운영 성능 리스크.
2. **GET 전건 반환**: 서버 페이지네이션 없음 — 누적이 커지면 응답도 비례 증가.
3. **retention 설계 후보**: 예) "읽음 + N일 경과" 삭제, 또는 사용자별 개수 상한 — AI 챗 보존 상한 패턴(`app_settings` + 기회적 프룬) 재사용 가능. 신규 컬럼·인덱스 추가 시 `db.py` `_ADDED_COLUMNS` 등록 필수(운영 DB 리셋 불가).
4. **매뉴얼 보정 4건**: §8 ①~④.
5. **checkout 벨 알림 비대칭**: 점유권 이전 요청이 벨에 안 뜨는 것이 의도인지 재확인.
