# AI 챗 서버 저장 + 맵 단위 히스토리 — 설계

2026-07-08 · 브랜치 `feat/ai-chat-server-history` (베이스: `feat/ai-incremental-edit`)

## 배경 / 문제

AI 챗 대화가 브라우저 localStorage(`bpm.aiChat.v{versionId}`)에만 저장된다. 버전 단위로 쪼개져 같은 맵의 다른 버전을 열면 대화가 안 보이고, 세션당 최근 40개 메시지 캡으로 긴 대화의 앞부분이 잘리며, 기기/브라우저가 바뀌면 전부 사라진다. 맵별로 대화를 이어 보고 필터할 방법이 없다.

## 확정 결정 (브레인스토밍 Q&A)

| 결정 | 내용 |
|---|---|
| 저장 위치 | 서버 DB (정규화 2테이블 + write-through — 접근 A 채택) |
| 대화 귀속 | **사용자 + 맵** 단위. 에디터에선 현재 맵 대화가 기본, 다른 맵 대화는 열람만(입력 비활성 + 해당 맵 이동 버튼) |
| 보존 정책 | 개수+기간 혼합, 상한은 app_settings로 런타임 조정 |
| 목록 UX | 히스토리 목록형 — 동시 4개 제한·LRU 닫기 확인 제거 |
| 기존 데이터 | 새 출발 — localStorage 마이그레이션 없음(구 키는 읽지 않음) |
| ai_chat_logs | 흡수·대체 — 테이블·관리자 토글·적재 코드 제거 |

## 1. 데이터 모델 (`backend/app/models.py`)

```
ai_chat_sessions
  id            int PK
  map_id        FK maps.id (ondelete CASCADE), index      ← 귀속: 맵
  login_id      str(100), index                           ← 귀속: 사용자
  title         str(200)                                  ← 첫 사용자 질문에서 서버가 파생(공백 정리, 40자 컷)
  created_at    datetime  ← KST clock.now
  updated_at    datetime  ← 메시지 적재 시 갱신, 목록 정렬 기준(desc)

ai_chat_messages
  id            int PK
  session_id    FK ai_chat_sessions.id (ondelete CASCADE), index
  role          str(10)  "user" | "assistant"
  content       Text      ← user=질문 원문, assistant=proposal.message
  kind          str(20) | None  ← assistant만: answer/graph/ops/analysis/walkthrough
  version_id    int | None      ← 당시 열려 있던 버전 id(추적용 순수 정수 — FK 아님, 버전 삭제돼도 메시지 보존)
  created_at    datetime  ← KST
```

- graph/ops 제안 페이로드(nodes/edges/ops)는 저장하지 않는다 — 미리보기는 휘발, 적용 결과는 캔버스 저장이 원장. 텍스트 대화만 보관.
- 스키마는 startup `create_all`로 생성(기존 방식). 인덱스: `(login_id, map_id)` 복합 조회가 주 경로.

## 2. API

### 2-1. `POST /api/ai/chat` 확장 (핵심 — write-through)

- 요청에 `session_id: int | None` 추가.
  - `None`이면 **첫 메시지 시점에 세션 생성**(빈 세션 행 없음). title은 질문에서 파생.
  - 값이 있으면 소유(`login_id`)·맵 일치(세션의 map_id == 버전의 map_id) 검증 — 불일치 404.
- AI 답변 생성 성공 후 **user 메시지 + assistant 메시지를 같은 트랜잭션으로 적재**하고, 응답에 `session_id`를 포함해 반환.
- AI 호출 실패 시 아무것도 저장하지 않는다(유령 메시지 없음).
- 버전 접근 권한 검증은 현행 유지. AI에 보내는 history는 현행대로 클라이언트가 최근 6턴 전송(저장량과 독립).

### 2-2. 세션 조회/삭제 (신규, 전부 본인 것만)

- `GET /api/ai/chat-sessions?map_id=<id>` — 내 세션 목록(id·title·updated_at·메시지 수), updated_at desc.
- `GET /api/ai/chat-sessions` (map_id 생략) — 내 전체 세션 + 맵 정보(map_id·맵 이름) 포함 → "다른 맵 대화" 목록용. 소프트삭제된 맵의 세션은 제외.
- `GET /api/ai/chat-sessions/{id}/messages?before=<message_id>&limit=30` — 최근부터 역방향 페이징(id 커서). 응답은 시간 오름차순 배열 + `has_more`.
- `DELETE /api/ai/chat-sessions/{id}` — 본인 세션 삭제.
- 접근 제어: 모든 세션 엔드포인트는 `login_id == 본인`만 — 타인 세션은 404(존재 노출 안 함). 관리자 열람 화면은 이번 범위에 없음.

## 3. 보존 정리 (app_settings — 관리자 런타임 조정)

| 키 | 기본값 | 시행 시점 |
|---|---|---|
| `ai_chat_max_sessions_per_map` | 20 | `/ai/chat` 적재 후 — 사용자×맵당 초과분을 updated_at 오래된 순으로 삭제 |
| `ai_chat_max_messages_per_session` | 200 | `/ai/chat` 적재 후 — 세션 내 오래된 메시지부터 삭제 |
| `ai_chat_retention_days` | 180 | 세션 목록 조회 시 — 본인 세션 중 마지막 활동(updated_at) 후 경과분 삭제 |

- 크론 없이 쓰기/조회 시점에 기회적으로 정리(사용자별 소량이라 충분).
- 관리자 설정 패널(ai-chat-settings-panel.tsx)의 기존 "Q&A 로그 토글" 자리를 이 3개 숫자 입력으로 교체. 기능 팁 관리는 유지.
- 값 검증: 양의 정수만 허용(범위 가드), 잘못된 값은 400.

## 4. 프론트 (ai-chat-panel.tsx · api.ts · chat-sessions.ts)

- `chat-sessions.ts`의 localStorage 스토어(파싱/직렬화/이행/40개 캡) 제거. 제목 파생은 백엔드로 이동. 관련 vitest는 삭제·대체.
- `api.ts`: `AiChatSessionSummary`·`AiChatMessage` 타입 + `getAiChatSessions(mapId?)`/`getAiChatMessages(sessionId, before?, limit?)`/`deleteAiChatSession(sessionId)` + `aiChat`에 sessionId 파라미터.
- 패널 상태: 서버 목록/메시지 기반으로 교체.
  - **제거**: 카운터 n/4, LRU 확인 다이얼로그, 세션 용량 진행바(localStorage 전용 개념), 구 localStorage 키 접근(방치 — 읽지도 지우지도 않음).
  - **유지**: 입력 잔여 링(2000자), 글자 크기 조절, 메시지 타임스탬프(formatKstShort), 스크롤 상단 청크 로딩(+로딩 중 기능 팁), 마크다운 렌더.
- 목록 드롭다운 = 히스토리: 현재 맵 세션(최근 활동순, 제목+시각) + 세션별 삭제 버튼 + 하단 "다른 맵 대화" 확장 섹션(맵별 그룹, 맵 이름 표시).
- **다른 맵 세션 열람**: 메시지 표시는 동일하되 입력창 비활성(placeholder로 사유 안내) + "Open this map" 버튼 → `/maps/{mapId}?aiChat=<sessionId>` 이동. 에디터는 `aiChat` 쿼리 파라미터를 보고 챗 패널을 열고 해당 세션을 활성화한다.
- 새 대화 버튼: 클라이언트 임시 상태(서버 행 없음) — 첫 전송에 `session_id: null`로 생성. 빈 새 대화가 이미 활성인 상태에서 또 누르면 재사용(빈 행 중복 방지, 현행 동작 유지).
- 전송 흐름: user 메시지 낙관 표시 → `/ai/chat` 응답으로 assistant 추가 + 반환된 `session_id` 채택(신규 생성 시 목록 갱신). 실패 시 에러 메시지는 로컬 표시만(서버 미저장 — 새로고침 시 사라지는 게 의도).
- 저장된 assistant content가 빈 문자열(핸들러 없는 kind)이면 렌더 시 현행 `ai.unsupportedKind` 폴백 적용.
- i18n: 신규 키(en/ko) — 다른 맵 섹션 라벨, 읽기전용 placeholder, Open this map, 삭제 확인, 로딩/재시도 등.

## 5. ai_chat_logs 흡수·제거

- `models.AiChatLog`, 라우터 적재 코드, `app_settings.AI_CHAT_LOG_KEY`·토글, 관리자 UI 토글, 관련 테스트 제거.
- `create_all`은 테이블을 드롭하지 않음 — 로컬은 `python -m scripts.reset_db`로 정리, 서버는 배포 노트(PROGRESS)에 `DROP TABLE ai_chat_logs;` 1회 수동 실행 안내.

## 6. 에러 처리

- `/ai/chat` 실패: 패널에 에러 메시지 로컬 표시(현행 유지).
- 세션 목록/메시지 로딩 실패: 패널 내 인라인 재시도 버튼(전역 배너 아님).
- 세션 404(정리로 사라짐 등): 목록 새로고침 후 새 대화 상태로 폴백.

## 7. 테스트

- **pytest**: 지연 생성(첫 메시지에 세션+title)·write-through 트랜잭션(성공 시 2행, AI 실패 시 0행)·소유/맵 일치 검증(타인·불일치 404)·메시지 페이징(before 커서·has_more)·개수/기간 정리(설정 상한 반영)·삭제·app_settings 신규 키 검증·ai_chat_logs 제거 정리.
- **vitest**: api 클라이언트 타입/파라미터, 남는 파생 유틸. localStorage 스토어 테스트 삭제.
- **브라우저 e2e(playwright+시스템 Chrome)**: dev.db에 세션·메시지 직접 시드 → 현재 맵 목록/다른 맵 섹션/읽기전용+이동 버튼/`?aiChat=` 진입/페이징/삭제 검증. 전송 플로우는 mocked `/ai/chat`으로 낙관 표시·session_id 채택만 확인(write-through 자체는 pytest 몫).

## 범위 외 (명시)

- 대화 검색·제목 수정·다른 사용자와 공유·관리자 열람 화면.
- localStorage 기존 대화 마이그레이션.
- AI에 보내는 컨텍스트 길이 정책 변경(현행 6턴 유지).
