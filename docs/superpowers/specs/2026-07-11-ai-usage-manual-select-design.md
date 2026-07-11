# AI 토큰 사용량 계측·집계(B1) + 매뉴얼 섹션 선별(B2) — 설계

날짜: 2026-07-11 · 브랜치(예정): ai-usage-manual (워크트리) · 머지는 사용자 최종 확인 후

## 목적

1. **B1**: vLLM 응답의 `usage`(현재 `ai_client.call_ai`가 폐기)를 호출별 이벤트로 저장하고, 관리자 대시보드에서 사용량(누가/어느 맵/모델/토큰/실패율)을 집계 표시한다. 이후 프롬프트 개선의 측정 기반.
2. **B2**: 매뉴얼 30,000자 단순 절단을 질문 관련 섹션 선별로 대체해 프롬프트 토큰을 줄이고 매뉴얼이 커져도 품질이 유지되게 한다. 효과는 B1의 평균 prompt 토큰으로 전후 비교.

## 확정된 사용자 결정

| 갈림길 | 결정 |
|--------|------|
| 저장 형태 | **호출별 이벤트 행**(`ai_usage_events`) — login_records 선례, SQL 임의 집계, 원문 미저장 |
| 통계 UI 위치 | 설정 콘솔 Analytics > **Dashboard 탭의 기존 스텁 확장**(새 탭 없음) |
| 머지 | 전 게이트 통과 후 사용자 최종 확인 → 머지 |

## ① B1 — usage 수집 (backend)

- `backend/app/ai_client.py` `call_ai`: 반환을 **`AiReply` dataclass**(`content: str, prompt_tokens: int | None, completion_tokens: int | None`)로 확장 — `data.get("usage")`에서 획득, 없으면 None(비표준 서버 방어). 교체 가능 경계 파일 원칙 유지.
- 테스트 영향: `tests/test_ai.py`의 `_fake_ai`가 content 문자열을 반환하는 목 — **AiReply 반환으로 1곳 수정**(chat history 등 다른 테스트 파일은 `_fake_ai`를 import하므로 자동 전파).
- 신규 테이블 **`ai_usage_events`**(models.py 클래스 추가 → startup create_all 자동 생성, 수동 DDL 불요 — `LoginRecord` 선례):
  - `id, occurred_at(DateTime tz, default=_now KST, index), login_id(str100), map_id(int, FK 아님 — 맵 삭제돼도 통계 보존), version_id(int), model(str200 — 요청 선택자, 빈값 허용), kind(str20 — 응답 종류, 실패 시 None), prompt_tokens(int|None), completion_tokens(int|None), ok(bool)`.
- 기록 시점 (`routers/ai.py`):
  - **성공**: write-through 트랜잭션에 이벤트 insert 동봉(kind=proposal.kind, 토큰=usage).
  - **실패**(AI 서버 오류·2회 JSON 불량 → 502): `ok=false`, 토큰/kind NULL로 **별도 커밋** 후 502 — 대화 저장은 기존대로 안 함. 이벤트 기록 실패가 502 응답 자체를 막지 않게 방어.
  - 질문 원문은 저장하지 않음(구 ai_chat_logs 폐기 취지 유지).
- 보존 정책 없음(행 소형·사람 속도 호출) — 필요 시 후속.

## ② B1 — 집계 API + 대시보드 (fullstack)

- `backend/app/routers/dashboard.py`(라우터 전역 `require_sysadmin`)에 **`GET /api/dashboard/ai-usage`** 추가. 응답:
  - `last7`/`last30`: `{calls, failed, prompt_tokens, completion_tokens}` (KST now 기준 timedelta 범위 — 기존 dashboard 7일 카운트 관례).
  - `top_users`(30일, 상위 5): `{login_id, name(employees 조인, 없으면 login_id), calls, total_tokens}`.
  - `top_maps`(30일, 상위 5): `{map_id, name(process_maps 조인, 삭제 시 "(deleted)"), calls, total_tokens}`.
  - 집계는 전부 SQL(`func.sum`/`count`/`group_by`) — 프론트 계산 없음.
- `frontend/src/components/settings/dashboard-panel.tsx`의 스텁("metricsComingSoon") 자리에 **AI usage 섹션**: StatCard 4개(7일 호출 수·7일 실패율·7일 토큰 합·30일 토큰 합) + 상위 사용자/맵 2열 소표. 기존 StatCard·표 패턴과 i18n(EN/KO) 준수, 주요 요소 data-id.

## ③ B2 — 매뉴얼 섹션 선별 (backend, 순수 함수)

- 신규 파일 `backend/app/manual_select.py`, 순수 함수 **`select_manual_sections(text: str, instruction: str, budget: int) -> str`** (TDD):
  - `## ` 헤딩(레벨 2)으로 섹션 분할 — 실측: ko 매뉴얼 15섹션 `N. 제목` 형식이라 answer 인용 규칙(ai_prompt 규칙 5)과 정합. 헤딩 앞 프리앰블(문서 제목 등)은 항상 포함.
  - 점수: instruction의 **한글 2-gram**(공백·기호 제거 후)과 섹션 텍스트 2-gram의 중첩 크기, 섹션 제목 매칭은 가중(×3). 의존성 없음.
  - 출력: **TOC(전체 섹션 헤딩 목록) 항상 포함** + 점수 내림차순으로 섹션 본문을 budget까지 채움(섹션 통째 단위, 원문 순서로 재배열해 출력).
  - **전체 텍스트가 budget 이하면 그대로 반환**(소형 매뉴얼 무변화). 전 섹션 0점이면 TOC + 원문 앞쪽 섹션 순(보수적 폴백 — 현행 절단과 유사).
- 통합: `routers/ai.py` `_load_manual_text` 합본 결과에 적용. budget은 모듈 상수 `_MANUAL_SELECT_BUDGET = 12000`(자), 기존 `_MANUAL_AI_LIMIT = 30000` 절단은 최종 가드로 유지.

## 검증

- pytest: ①AiReply 반환·usage None 방어 ②성공/실패 이벤트 기록(트랜잭션 동봉·502 시 ok=false) ③집계 API(시드 이벤트 → 합계·실패·상위 정렬) ④manual_select 순수 함수(분할·TOC·budget·소형 무변화·0점 폴백·섹션 통째 단위) ⑤기존 스위트 무회귀(_fake_ai 전파 확인).
- frontend: vitest 무회귀 + tsc + lint + build. 대시보드 섹션은 수동 확인(또는 기존 pw 패턴 체크 1개 — 계획에서 결정).
- **머지는 사용자 최종 확인 후** — 브랜치 완료 시점에 보고하고 대기.

## 비범위

스트리밍(B3)·첨부(B4), usage 보존 정책·기간 커스텀 필터, 임베딩/RAG(2-gram 부족 시 후속), 히스토리 턴을 점수에 반영.

## 함정 메모

- `_fake_ai` 반환 타입 변경은 test_ai를 import하는 전 테스트에 전파 — 시그니처 한 곳만 고칠 것.
- 이벤트 기록은 write-through와 같은 세션 — 실패 경로에서는 rollback 후 별도 insert/commit(502 전파 유지).
- 대시보드 프론트 게이트는 UI 편의일 뿐 서버 require_sysadmin이 최종 보호(기존 관례).
- 브래킷 경로 검색은 `git grep`. 프론트 게이트에 tsc --noEmit 필수.
