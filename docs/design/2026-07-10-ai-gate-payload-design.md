# AI 권한 게이트 + 제안 페이로드 저장 — 설계

날짜: 2026-07-10 · 브랜치(예정): feat/ai-gate-payload · 사용자 결정 3건 반영

## 목적

AI 챗 개선 2건을 한 브랜치로 처리한다.

1. **권한 게이트** — AI 챗과 그래프 조회가 로그인만 하면 임의 version_id로 비공개 맵 데이터를 읽을 수 있는 공백을 닫는다.
2. **제안 페이로드 저장** — analysis/walkthrough/graph/ops 제안의 원자료가 어디에도 영속되지 않아 과거 대화 재열람 시 카드가 텍스트로 강등되는 갭을 없앤다.

## 확정된 사용자 결정

| 갈림길 | 결정 |
|--------|------|
| 게이트 범위 | AI 챗 라우트 + 그래프 조회 GET 2종 (넓은 read-path 전체는 비범위) |
| 과거 graph/ops 카드 | 읽기전용 요약 카드 — 재적용 버튼 없음 |
| 카드 렌더 구조 | 메시지 부착형으로 라이브·히스토리 통일 |
| 페이로드 저장 형식 | `ai_chat_messages.payload` nullable Text 컬럼 1개 (JSON 직렬화, 별도 테이블 없음) |

## ① 권한 게이트 (backend)

기존 정석 의존성 재사용 — 새 권한 로직 없음.

- `POST /versions/{version_id}/ai/chat` (`backend/app/routers/ai.py:138`) — `Depends(permissions.deps.require_version_map_role("viewer"))` 추가.
- `GET /versions/{version_id}/graph` · `GET /versions/{version_id}/graph/all` (`backend/app/routers/graph.py:106,77`) — 동일 게이트 추가. 쓰기 PUT은 이미 editor 게이트(`graph.py:118`) — 무변경.
- 오류 시맨틱은 기존 관례(`permissions/access.py:103-116`): 버전/맵 없음 **404**, 권한 부족 **403**, private 은닉용 404 위장 금지.
- 게이트가 핸들러보다 먼저 실행 → "AI 비활성 + 무권한"은 503이 아닌 403. 의도된 순서(무권한자에게 기능 상태 비노출).
- `/ai/models`·`/ai/tips`는 맵 데이터 없음 — 게이트 대상 아님. 세션 API(`ai_sessions.py`)는 이미 본인 소유만(타인 404).
- 기본 환경(`DEV_ENFORCE_PERMISSIONS=false` + `AUTH_ENABLED=false`)에서는 전원 sysadmin → 동작 무변화. 기존 테스트·로컬 개발 회귀 없음.
- **프론트 영향**: 에디터 진입은 이미 게이트된 맵 상세 GET의 403 모달이 선차단. 그래프 GET 403은 딥링크·임베드 등 심층 경로에서만 발생 가능. 서브프로세스 임베드는 library 라우터 자체 마스킹(`library.py:100-104`)이라 별도 경로 — **구현 시 비교 화면·딥뷰·홈의 그래프 호출처 전수 확인을 검증 항목에 포함**.

## ② 페이로드 저장 (backend)

- `models.py` `AiChatMessage`에 `payload: Text | None` 추가. assistant 메시지에만, kind별 서브셋:
  - analysis → `{"findings": [...]}`
  - walkthrough → `{"steps": [...]}`
  - graph → `{"nodes": [...], "edges": [...], "groups": [...]}`
  - ops → `{"ops": [...]}`
  - answer → NULL
- **`db.py _ADDED_COLUMNS`에 수동 등록** — startup 자동보강 필수 절차(이 프로젝트의 신규 컬럼 관례).
- `routers/ai.py` write-through(`ai.py:196-212`)에서 검증 완료된 `AiProposal`로부터 직렬화해 저장.
- `AiChatMessageOut`(`schemas.py`)에 `payload` 필드 추가 — 조회 시 JSON 디코드해 객체 반환. **디코드 실패 시 NULL 강등**(페이로드 오염이 대화 조회를 죽이지 않게).
- 구 행은 payload NULL — 마이그레이션 불요.

## ③ 카드 렌더 통일 (frontend)

- `lib/chat-sessions.ts` `ChatMessage`에 `kind`·`payload` 보존 — 현재 `toChatMessage`가 버리는 필드 복원. `lib/api.ts` `AiChatMessageRow`에 `payload` 타입 추가.
- `ai-chat-panel.tsx`: 분리 임시 state(`findings`/`steps`, 라인 140-143) 제거 → **메시지별 부착 카드**. 라이브 응답도 proposal에서 kind+payload를 실은 메시지로 append — 렌더 경로 단일화. 세션 전환·새로고침 후에도 카드 복원.
- kind별 카드:
  - analysis → findings 카드(심각도 레일·하이라이트 클릭 유지). 사라진 노드 클릭은 부모(`page.tsx` highlightNode)에서 no-op.
  - walkthrough → 스텝퍼. **히스토리 카드는 자동재생 없음**(수동 이전/다음만).
  - graph/ops → 읽기전용 요약 카드(노드/엣지/오퍼레이션 갯수 + 항목 목록). 재적용 버튼 없음.
- 라이브 graph/ops의 커밋/취소 카드(`aiPreviewActive` prop 파이프라인, 부모 `page.tsx:7272` 마운트)는 유지하되 해당 메시지에 부착 — 커밋/취소 후 읽기전용 요약 카드로 남음.
- payload NULL 메시지(구 데이터·answer)는 텍스트만 — 우아한 강등.

## 테스트·검증

- backend: `test_permission_gates.py`의 `enforce`+`act_as`+`seed_map` 픽스처 재사용 — private 무grant 403 / public 200 / viewer grant 200 × (ai chat, graph GET 2종). `test_ai_chat_history.py`에 payload 저장·조회·오염 NULL 강등 케이스 추가.
- frontend: `chat-sessions.test.ts` 갱신(kind/payload 보존), 브라우저 스모크 `pw-smoke-ai-chat-history.mjs` 메시지 부착 카드 구조 보정 + 히스토리 카드 재현 체크 추가.
- 수동: `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys`로 backend 기동, viewer 계정 시나리오 실검증(--reload는 .env 재로드 안 함 — 완전 재기동).
- 게이트: pytest 전체 + ruff + npm lint/build 통과 후 머지.

## 비범위 (이번 브랜치에서 하지 않음)

- 과거 제안 재적용 버튼(읽기전용으로 확정).
- 버전 목록·상세 등 넓은 read-path 게이팅(PROGRESS 기록대로 별도 Phase).
- 매뉴얼 30k 절단/디렉터리 100명 컷 개선, 토큰 계측, 스트리밍, 첨부 기능 — 후속 후보로만 유지.

## 함정 메모 (구현 시)

- `frontend/src/app/maps/[mapId]/page.tsx`는 브래킷 경로라 시스템 grep(ugrep)이 조용히 건너뜀 — **`git grep` 또는 Python으로 검색**.
- `ai-chat-panel.tsx`는 set-state-in-effect 잠복 2곳 존재(React Compiler 미적용으로 침묵) — 이번 리팩터로 표면화될 수 있음, 파생 배열은 모듈 상수로 identity 안정화.
- sqlite(로컬)·postgres(서버) 양쪽에서 Text 컬럼 추가 확인.
