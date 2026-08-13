# 승인 워크플로 코멘트 + 에러 메시지 정리 — 설계 스펙

- **날짜**: 2026-08-14
- **상태**: 사용자 승인 완료 (구현 전)
- **브랜치**: dev에서 분기한 새 워크트리 `feat/approval-comments`
- **관련**: 거버넌스 UX(dev 머지 10a79b6)의 humanizeApiError 체계 확장

## 0. 목표 (한 줄)

토스트/에러에 노출되는 원시 JSON을 인간화하고, 승인 워크플로 각 단계에 선택 코멘트를 달아
버전 카드 "코멘트 보기" 모달로 이력을 보여준다. 거절 배너는 거절자 필 + 사유로 재디자인한다.

## 1. 확정된 결정 (사용자 Q&A)

| 결정 | 선택 |
|---|---|
| 에러 스윕 범위 | **Group A 전수** (원시 `err.message`에 JSON body 노출 ~50곳). Group B(서버 영어 detail만 노출 ~30곳)는 유지 |
| 에러코드 노출 | **폴백에만 코드** — i18n 매핑 히트는 문구만, 미스는 `{detail} (HTTP 403)`, detail 없으면 `Request failed (HTTP 500)`. 원문 JSON은 `console.error`로 항상 콘솔 보존 |
| 코멘트 입력 단계 | **submit·approve·publish·withdraw 4종 전부** 선택 입력 (reject는 기존 필수 사유 유지) |
| 코멘트 보기 모달 내용 | **코멘트 있는 이벤트만** (거절 사유 포함). 0건이면 버튼 숨김 |
| 받은함 거절 사유 유실 버그 | **이번 작업에 포함** |
| 저장 구조 | **`VersionEvent.note` 재사용** (스키마 무변경) + `ApprovalRequest.decision_reason` 컬럼 1개 신설 |

## 2. 현재 상태 (탐색 실측, dev 기준)

- `frontend/src/lib/api.ts:245-252, 808-814` — throw 시 메시지에 응답 body(JSON)를 그대로 포함:
  `API POST /versions/12/reject failed: 409 — {"detail":"…"}`.
- `frontend/src/lib/api-errors.ts:27-31` — `humanizeApiError(err, t)`: detail 접두 매핑 12종, 미스면 raw detail 반환. 사용처는 12곳뿐.
- Group A(원시 `err.message` 노출) ~50곳: 홈 `page.tsx:141,155,338,366,983` · 에디터 `maps/[mapId]/page.tsx` 약 30곳(:1601,:1801,:2163,:2429,:2480,:2552,:2596-2621,:2657-2673,:2763,:2808,:2875,:2932-2998,:3012-3040,:4932,:5047,:5072) · compare `:1219` · `versions-publish-panel.tsx:183,194` · approvers-panel · danger-zone · subprocess-designation-panel/modal · create-map-dialog · checkout-requests-panel · admin 6파일 · groups 3파일 · approver-manager · subprocess-inspector-card · node-summary-modal · word-quick-create-dialog · ai-chat-panel · ai-chat-settings-panel · interview-preview · dashboard/access-sidebar.
- 거절 사유 표시는 에디터 헤더 한 곳뿐(`maps/[mapId]/page.tsx:7374-7378`) — 맨 `text-error` 인라인 텍스트. 버전 카드에는 미표시.
- `VersionEvent.note`(String 500, `models.py:252`)에 reject 사유가 이미 기록됨(`versions.py:761`).
  submit(:648)·approve(:683, **승인자별 기록**)·publish(:832)·withdraw(:952)도 이벤트 기록 지점 존재.
- 바로철회: `versions.py:931-965` — 승인 0건·비거절 철회는 `submitted` 이벤트 하드삭제, withdrawn 기록 없음.
- `MapDetail.versions[].events`(`VersionEventOut.note` 포함)가 이미 FE로 내려오지만 **미렌더** (`evt.note` grep 0건).
- 받은함 버그: `inbox/page.tsx:1088-1093`이 거절 사유를 입력받아 `onAct(false, reason)`로 넘기지만
  `actApproval`(:301)이 `decideApprovalRequest(a.id, "reject")`로 사유를 **버림**. `DecisionIn`(schemas.py:235)에 reason 필드 없음.
- 모달 인프라: `ModalBackdrop`(mousedown-origin+click), `ConfirmDialog.input`(textarea), `clampToViewport`,
  keyframes `window-open`(scale 0.4→1, 고정 center origin). **동적 transform-origin(클릭점 기준) 패턴은 부재.**

## 3. 백엔드 설계

### 3.1 버전 워크플로 코멘트 (스키마 무변경)

- `schemas.py`: `SubmitIn`에 `comment: str | None = Field(None, max_length=500)` 추가.
  approve/publish/withdraw 공용 `CommentIn`(같은 필드) 신설, body는 `CommentIn | None`.
  공백만 있는 문자열은 None으로 정규화(validator).
- `versions.py`: 기존 `record_version_event` 4곳에 `note=comment` 전달. reject는 변경 없음.
- **바로철회 정합**: 무기록 경로(승인 0건·비거절)는 기존 삭제 로직 그대로 — submit 코멘트가 이벤트 행과 함께
  자동 삭제된다. 이 경로에서 넘어온 withdraw comment는 서버가 무시(기록할 이벤트가 없음). FE는 입력란 자체를 숨긴다(§5.3).

### 3.2 받은함 거절 사유 저장

- `models.py`: `ApprovalRequest.decision_reason: Mapped[str | None] = mapped_column(String(500), default=None)`.
- `db.py`: `_ADDED_COLUMNS`에 등록 (운영 자동 ALTER — 리셋 불가).
- `schemas.py`: `DecisionIn.reason: str | None = Field(None, max_length=500)` · `ApprovalRequestOut.decision_reason` 노출.
- `permissions.py` decide: 거절 시 `decision_reason` 저장, 거절 알림 메시지 말미에 `: {reason}` 동봉
  (permission/rename/sp_designation/visibility 거절 메시지 빌드 지점).

### 3.3 테스트 (pytest)

- 4단계 comment → 해당 이벤트 note 기록 확인.
- 바로철회 시 submitted 이벤트·note 동반 삭제 / 기록 경로(거절 후·승인 1건 이상) withdraw note 기록.
- decide reject + reason → `decision_reason` 저장·알림 메시지 동봉. reason 없는 기존 호출 하위호환.

## 4. 프론트 — 에러 스윕 (Group A 전수)

- `api.ts` throw 2곳(:245, :808)에 `console.error` 추가 — 원문(JSON 포함) 콘솔 보존.
- `api-errors.ts` 폴백 확장: 매핑 미스 + detail 존재 → `{detail} (HTTP {status})` ·
  ApiError인데 detail 파싱 불가 → `t("apiError.requestFailed", {status})`(신규 키, "Request failed (HTTP {status})") ·
  비-ApiError는 기존 `err.message` 그대로.
- Group A ~50곳 전부 `humanizeApiError(err, t)` 경유로 전환. Group B는 건드리지 않는다.
- **토스트 에러 톤**: `ToastItem.tone?: "error"` — `toast-stack.tsx`에서 XCircle 16px + `border-error` 좌측 보더.
  에러를 토스트하는 지점(스윕 대상)만 opt-in. 성공 토스트는 기존 그대로.
- **랜드마인**: `maps/[mapId]/settings/page.tsx:119`의 `/failed: 40[13]/` 원시 문자열 필터는 인간화 후 무력화됨 →
  `ApiError.status`(401/403) 기반 판정으로 전환(에러 객체를 받는 지점에서 판정 후 토스트).

## 5. 프론트 — 워크플로 UX

### 5.1 거절 배너 재디자인 (에디터 헤더)

`maps/[mapId]/page.tsx:7374`의 인라인 빨간 텍스트 → 컴팩트 배너 칩:

- `rounded-sm` · 에러 틴트 배경(`--color-error-tint` 토큰이 @theme에 없으면 추가) · `border-error` 헤어라인.
- 구성: XCircle 16px(strokeWidth 1.5) · "Rejected" `text-caption-strong` · **거절자 필**(User 아이콘 + `rejected_by`
  이름 — `nameById` 해석, 기존 필 스타일 재사용) · 사유 텍스트(truncate + `title` 툴팁).
- `data-id="wf-rejected-banner"`. 헤더 밀도 유지(text-caption/fine, 한 줄).

### 5.2 전이 모달 코멘트 입력 (4종)

- submit/approve/publish/withdraw 다이얼로그(`components/version/*-confirm-dialog.tsx`)에 기존
  `ConfirmDialog.input` 재사용 — placeholder "Add a comment (optional)" (i18n).
- 상태는 reject-dialog 패턴대로 **호출자 소유**: 에디터(`maps/[mapId]/page.tsx:9754-9836`)와
  설정 패널(`versions-publish-panel.tsx:385-464`) 두 마운트 지점 동일 적용.
- `api.ts`: `submitVersion(id, {to_visibility?, comment?})` · `approveVersion/publishVersion/withdrawVersion(id, {comment?})`.
- 셀프 게시 팝오버(빠른 경로 submit→approve→publish 체인)는 코멘트 없음 유지.
- 받은함: `decideApprovalRequest(id, decision, reason?)`로 확장, reject 시 입력값 전달(유실 버그 픽스).

### 5.3 withdraw 입력란 게이팅

기록이 남는 경로에서만 코멘트 입력 표시: `status === "rejected"` 또는 `workflow.approvals.length >= 1`.
무기록 바로철회(pending·승인 0건)는 입력란 숨김 — 서버 동작(§3.1)과 대칭.

### 5.4 버전 카드 "코멘트 보기" 모달

- **트리거**: `versions-publish-panel` 행 액션 영역(:266-357)에 MessageSquare 16px 고스트 아이콘 버튼 +
  코멘트 개수(`text-fine`). note 있는 이벤트 0건이면 버튼 숨김. `data-id="version-comments-open-{versionId}"`.
- **데이터**: 기존 `MapDetail.versions[].events` 재사용(API 무변경). 패널이 이벤트를 못 받고 있으면 설정
  페이지의 맵 상세 응답에서 스레딩(구현 시 실측), 워크플로 액션 후 리프레시.
- **모달**: 신규 `components/version/comment-history-modal.tsx`, `data-id="version-comments-modal"`.
  note 있는 이벤트만 시간순: 단계 아이콘(Send=submitted / CheckCircle=approved / XCircle=rejected /
  Upload=published / Undo2=withdrawn) + 작성자 필 + KST 시각(기존 포맷 유틸) + note 본문.
  제목 "Comments — {version label}". 방어적 빈 상태 문구 1줄(버튼 숨김과 별개로 레이스 대비).
- **닫힘**: 바깥 **mousedown 즉시 닫힘**(사용자 명시 요구 — 읽기전용 모달이라 드래그 오발 리스크 수용,
  기존 ModalBackdrop의 mousedown-origin 패턴 대신 raw mousedown) + Escape.
- **등장 애니메이션**: 클릭 지점→중앙 확대. 트리거에서 `{x: clientX, y: clientY}` 캡처, 카드에 CSS 변수
  `--from-dx/--from-dy`(클릭점 − 뷰포트 중앙) 인라인 주입, globals.css 신규 keyframes:
  `from { opacity:0; transform: translate(var(--from-dx), var(--from-dy)) scale(0.3) }` → `to { transform:none }`,
  350ms `var(--ease-overshoot)`. `prefers-reduced-motion`은 페이드만. 코드베이스 최초의 동적 origin 패턴.

## 6. i18n · 디자인 규칙

- 신규 키 EN·KO 동시 추가: `apiError.requestFailed`, 코멘트 placeholder, 모달 제목/빈 상태, 배너 라벨 등.
- UI 영어 기본, Lucide 16px/1.5, raw hex 금지(토큰만), 다크모드 미지원, 버튼 눌림은 전역 base 위임.
- 신규 인터랙티브 요소에 `data-id`(surface-role kebab-case) 부여.

## 7. 검증 계획

- **BE**: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" pytest tests/ -q` 전체 그린 + `ruff check`.
- **FE**: vitest · lint · `tsc --noEmit` · `npm run build` 4종 게이트.
- **브라우저(Playwright+시스템 Chrome)**: 모달 등장 애니(클릭점 기준) · 바깥 mousedown 닫힘 · 에러 토스트
  인간화 문구 · 거절 배너 렌더. dev.db 오염 함정 유의(`docs/lessons/browser-verification.md`).
- 커밋 단위: ① 백엔드 코멘트+사유 ② 에러 스윕 ③ 거절 배너+전이 모달 코멘트 ④ 코멘트 보기 모달.
  각 커밋에 PROGRESS.md 동반(`rules/common/git.md`).

## 8. 범위 밖 (이번에 안 함)

- Group B(~30곳, 서버 영어 detail 노출) i18n 매핑 확장.
- 에디터 표면의 코멘트 보기(버전 카드 = 설정 패널만).
- 셀프 게시 체인 코멘트, submit 코멘트의 알림 메시지 동봉(거절 사유 동봉만 포함).
- ApprovalRequest 계열(rename/visibility/permission/SP)의 단계별 코멘트 이력 모달 — decision_reason 저장·알림 동봉까지만.
