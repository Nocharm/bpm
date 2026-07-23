# AI 컨설턴트 인터뷰 모드 — 설계 (2026-07-23)

전문 컨설턴트가 인터뷰하며 프로세스 맵을 그려주는 풀스크린 편집 모드. 기존 AI챗(우측 패널, 자유 대화)과 별개의 표면이며, 목적은 단순 "맵 그려주는 봇"이 아니라 **조직 표준화 장치** — 질문을 통해 명확화하고 맵의 톤(명명·세분도)을 통일해 사람 편차를 최소화하고, 축적된 기록으로 계속 개선한다.

## 0. 확정 결정사항 (브레인스토밍 Q&A)

| 축 | 결정 |
|---|---|
| 시나리오 | 셋 다 — ①신규 맵 작성 ②기존 맵 개선 ③문서 기반 초안 후 공동 개선. 공통 목표: 톤 통일·편차 최소화·기록 재학습 |
| 화면 | 풀스크린 컨설팅 모드 (`/maps/[mapId]/consult`) — 좌 인터뷰 패널 + 우 라이브 맵 프리뷰 |
| 인터뷰 구조 | 고정 7스테이지 + 적응 스킵(문서/기존 맵이 채운 단계는 확인만) |
| 지식 소스 | 세션 첨부 문서 · 조직 공용 라이브러리 · 게시 맵 코퍼스 · 과거 인터뷰 기록 (4종 전부) |
| UX 원칙 | 가시화된 안을 선택지(A/B/C) 형식으로 제시 · 스테이지 체크포인트 저장·이전 복귀 |
| 유사 SP 제안 | 임베딩으로 유사 서브프로세스 맵 탐지 → Call Activity 링크 제안 |
| 임베딩 | 사내 bge-m3 서버(OpenAI 호환 `/embeddings`, 1024차원) — 주소는 `.env` 경유(하드코딩 금지) |
| 벡터 저장 | 백엔드 DB float32 BLOB + 인메모리 코사인 검색(pgvector 불사용 — 수천 청크 규모) |
| 파일 포맷 | PDF·txt·md + docx·xlsx (pypdf·python-docx·openpyxl). HWP·OCR 제외 |
| 오케스트레이션 | 역할 분리 에이전트 + 선택지 병렬 생성 + 백그라운드 병렬 작업. **부하 가드 필수** |
| 재학습 | RAG 축적(완료 인터뷰를 임베딩해 차기 인터뷰가 참조). 파인튜닝 없음 |
| 저장 모델 | 세션 작업본(서버 저장·중단/재개) + 완료 시에만 draft 적용 |
| 구현 순서 | P1 인터뷰 코어 → P2 지식기반 → P3 축적 루프 |
| 브랜치 | main 기준 `worktree-ai-consultant` (워크트리 `.claude/worktrees/ai-consultant`) |

## 1. 아키텍처

```
브라우저
 ├─ /maps/[mapId]                  기존 에디터 (변경 최소 — 진입 버튼만 추가)
 └─ /maps/[mapId]/consult          신규 풀스크린 컨설팅 모드
     ├─ 좌: 인터뷰 패널 (대화·선택지 카드·진행률·체크포인트 내비)
     └─ 우: 읽기전용 React Flow 프리뷰 (작업본 그래프, 변경분 하이라이트)

FastAPI backend
 ├─ routers/interviews.py          세션 CRUD·턴 진행·되돌리기·적용 API
 ├─ interview/engine.py            스테이지 상태머신 (고정 7단계 + 적응 스킵)
 ├─ interview/orchestrator.py      역할 에이전트 조율 + 병렬 호출 + 부하 가드
 ├─ interview/agents.py            인터뷰어·드래프터·톤 검수자 프롬프트/파서
 ├─ interview/parsing.py           첨부 파싱 (pypdf·python-docx·openpyxl)
 └─ (P2) kb/                       embed_client.py·retrieval.py·indexing.py
```

- AI 호출은 전부 기존 `ai_client.call_ai()` 재사용 — 다중 엔드포인트(`AI_ENDPOINTS`) 라우팅 그대로.
- 드래프터 출력은 기존 `AiProposal`의 graph 포맷 재사용 → 검증·적용 경로(graph PUT)를 물려받는다.
- 에디터 6700줄 컴포넌트는 진입 버튼 외 무변경 — 컨설팅 모드는 별도 라우트로 격리.
- 인터뷰 API는 `ai_enabled` 게이트 하위(기존 AI챗과 동일) — 로컬 기본 비활성으로 테스트 그린 유지.

## 2. 데이터 모델 (신규 테이블)

| 테이블 | 핵심 컬럼 | 역할 |
|---|---|---|
| `interview_sessions` | id, map_id, version_id(대상 draft), login_id, status(`active/completed/abandoned`), current_stage, lang(`ko/en` — 세션 생성 시 앱 언어로 고정), facts(JSON), working_graph(JSON), base_graph_updated_at, created_at, updated_at, completed_at | 세션 본체 — 중단/재개의 단일 소스. 맵×사용자당 active 1개 |
| `interview_messages` | id, session_id, seq, role(`consultant/user`), kind(`question/choices/answer/choice/confirm/notice`), content, payload(JSON: 선택지·선택결과·stage), superseded(bool — 되돌리기로 무효화된 턴), created_at | 대화 이력 = P3 RAG 축적의 원재료 |
| `interview_checkpoints` | id, session_id, stage, working_graph 스냅샷(JSON), facts 스냅샷(JSON), created_at | 스테이지 전환 시 자동 생성 — "이전 단계로" = 스냅샷 복원 |
| `interview_attachments` | id, session_id, filename, mime, size, parsed_text, status(`parsed/failed`), error, created_at | 세션 첨부 — P1은 청킹+예산 주입, P2에서 임베딩. 원본 파일은 미보존(parsed_text만) |
| (P2) `kb_documents` | id, title, filename, mime, parsed_text, status, uploaded_by, created_at | 조직 공용 라이브러리 원장 — sysadmin 관리 |
| (P2) `kb_chunks` | id, source_type(`library/map/interview/attachment`), source_id, chunk_index, chunk_text, embedding(float32 BLOB, 1024차원), meta(JSON), created_at | 통합 지식 청크 — 소스 4종을 한 테이블로, 인메모리 코사인 검색 |

- 신규 테이블은 startup `create_all`로 생성(신규 테이블은 `_ADDED_COLUMNS` 불요 — 기존 테이블에 컬럼을 추가할 때만 등록). 운영 DB 리셋 금지 전제 유지.
- facts JSON 구조: 스테이지 키별 수집 항목(`{"scope": {...}, "io": {...}, ...}`) — 스키마는 Pydantic 모델로 검증.

## 3. 인터뷰 플로우 — 스테이지 엔진

고정 7스테이지: **①범위·목적 → ②트리거/인풋/아웃풋 → ③활동 나열 → ④분기·예외 → ⑤역할·시스템 → ⑥파라미터(6필드) → ⑦최종 검토**

- 각 스테이지 = `필요 facts 정의(완료 조건) + 질문 생성 + 스킵 판정`.
- **적응 스킵**: 첨부 문서/기존 맵이 이미 채운 facts는 "이렇게 이해했는데 맞나요?" 확인 카드로 축약. 기존 맵 개선 시나리오는 현 그래프에서 facts를 역추출해 시작.
- **턴 진행(트랜잭션)**: 사용자 입력 저장 → 인터뷰어가 facts 갱신·다음 질문 생성 → (구조 결정 지점이면) 드래프터가 선택지 N안 병렬 생성 → 작업본 그래프 갱신 → 응답 반환. 실패 시 세션 상태 불변.
- **구조 결정 지점(선택지 생성)은 스테이지 정의에 명시**: ③활동 골격(세분도 대안) · ④분기 구조(예외 처리 방식) 2곳이 기본. 그 외 턴은 질문/확인 카드만 — 호출 절감.
- **스테이지 완료 시**: 체크포인트 저장 + 톤 검수자 1회 실행(명명·세분도 표준 체크 — 매 턴이 아닌 스테이지당 1회로 호출 절감). 검수 결과는 드래프터 수정으로 반영.
- **되돌리기**: 체크포인트 복원(작업본·facts 원복). 이후 메시지는 삭제하지 않고 `superseded` 표시로 접어 이력 보존.
- **⑥파라미터**: 회당 6필드(`PARAM_FIELDS` 단일 소스) 계약 준수 — duration H.MM 정규화, 비용 통화 배타. subprocess 노드는 `annual_count`·`fte`만.
- **완료(⑦ 승인)**: 작업본을 대상 draft에 적용 — 기존 graph PUT 검증 경로 + 점유(checkout) 규칙 준수. `base_graph_updated_at`과 현 draft를 비교해 세션 시작 후 draft가 바뀌었으면 경고 후 확인. 적용 후 에디터로 이동.

## 4. 오케스트레이션 + 부하 관리

역할 3종 — 전부 `call_ai()` 경유, 프롬프트/파서만 분리:

| 역할 | 호출 시점 | 부하 |
|---|---|---|
| 인터뷰어 | 매 턴 1회 — facts 갱신·다음 질문/확인 카드 생성 | 경량 |
| 드래프터 | 구조 변경 시만 — facts→그래프 조각(AiProposal graph 포맷). 선택지 지점은 N안 병렬 | 중량 |
| 톤 검수자 | 스테이지 완료당 1회 — 명명·세분도 표준 체크 | 중간 |

부하 가드:

| 장치 | 내용 |
|---|---|
| 전역 동시성 세마포어 | 백엔드 전체 AI 호출 `asyncio.Semaphore(AI_MAX_CONCURRENCY)`(기본 4) — 인터뷰·기존 AI챗 공용. `ai_client.call_ai()` 내부에서 획득해 우회 불가 |
| 선택지 개수 상한 | 병렬 안 생성 `INTERVIEW_CHOICE_COUNT`(기본 2, 최대 3) — 구조 결정 지점에서만, 투기적 프리페치 없음 |
| 프리픽스 안정화 | 시스템 프롬프트를 고정 프리픽스(표준 가이드→문서 발췌→facts 순)로 구성 — vLLM prefix cache 적중 유도 |
| 컨텍스트 예산 | 첨부/지식 주입은 청킹+문자 예산(`INTERVIEW_CONTEXT_BUDGET`, 기본 12000자) — 전문 무제한 주입 금지 |
| 백그라운드 직렬화 | 파싱·(P2)임베딩 인덱싱은 동시 1개 워커 큐 — 대화 응답성 우선. 임베딩은 배치 호출(요청당 ≤32청크) |
| 실패 정책 | 1회 재시도 후 표면화. 턴 트랜잭션이라 실패해도 세션 오염 없음 — "다시 생성" 버튼으로 동일 턴 재실행 |

스트리밍은 도입하지 않는다(기존 AI챗과 동일 단발 JSON) — 프론트는 단계별 로딩 인디케이터("컨설턴트가 안을 그리는 중…")로 대기 체감을 줄인다.

## 5. API

모든 엔드포인트는 인증 + 맵 editor 권한(`require_version_map_role` 패턴) + 세션 소유자 검증(IDOR 가드).

| 메서드·경로 | 역할 |
|---|---|
| `POST /api/maps/{map_id}/interviews` | 세션 생성 `{version_id}` — 동일 맵×사용자 active 존재 시 그 세션 반환(재개) |
| `GET /api/interviews/{id}` | 전체 상태(메시지·스테이지·작업본·체크포인트·첨부) — 재개/새로고침 복원 |
| `POST /api/interviews/{id}/turns` | 턴 진행 `{type: answer/choice/confirm/skip, content?, choice_id?}` → 컨설턴트 응답(질문/선택지/확인 카드 + 작업본 그래프) |
| `POST /api/interviews/{id}/attachments` | 멀티파트 업로드 → 파싱(백그라운드) → 상태 반환. 확장자·MIME·사이즈(≤20MB) 검증 |
| `POST /api/interviews/{id}/revert` | `{stage}` 체크포인트로 복원 |
| `POST /api/interviews/{id}/apply` | 작업본을 대상 draft에 적용(graph PUT 경로·checkout 준수·충돌 경고) |
| `POST /api/interviews/{id}/complete` | 적용 + status=completed + (P3) 기록 인덱싱 훅 |
| `DELETE /api/interviews/{id}` | 세션 포기(abandoned) — 데이터는 보존 |

## 6. 프론트 UX

**라우트** `/maps/[mapId]/consult` — 풀스크린(에디터 크롬 없음). 진입 가드: editor 권한 + 편집 가능 draft. 진입점: 에디터 헤더 "Consultant" 버튼(Lucide, 편집 가능 시 노출). active 세션 존재 시 "이어하기 / 새로 시작" 선택.

**레이아웃**
- 헤더: 맵 이름 · 7스테이지 진행 인디케이터(현재 단계 하이라이트) · Exit(세션은 자동 보존)
- 좌 패널(~440px): 대화 스트림 + 입력창. 메시지 종류별 카드 렌더
- 우 영역: 읽기전용 React Flow 프리뷰(비교 화면 read-only 선례 재사용) — 작업본 그래프, 이번 턴 변경 노드는 `ring-added` 토큰 하이라이트, fitView
- 하단: 체크포인트 칩(완료 스테이지 뱃지) — 클릭 → 복원 확인 모달(ConfirmDialog 컨벤션)

**카드 종류**
- 질문 카드: 일반 서술 질문 + 텍스트 입력
- **선택지 카드**: N안 각각 미니 읽기전용 React Flow 프리뷰(정적·인터랙션 없음) + 제목/설명 + "이 안으로" 버튼. "직접 설명할게요" 텍스트 폴백 항상 제공
- 확인 카드(적응 스킵): 문서/기존 맵에서 추출한 facts 요약 + "맞아요 / 수정할래요"
- (P2) 유사 SP 카드: "유사한 게시 맵이 있습니다 — 서브프로세스 링크로 대체할까요?" + 미니 프리뷰. 수락 시 링크 유일성 규칙(중복 가드) 준수
- 알림 카드: 파싱 실패·지식기반 참조 불가 등 비차단 공지

**디자인**: `rules/frontend/design.md` 준수 — 토큰만, `--shadow-md` 카드, Lucide 16px, 라이트 전용, UI 크롬 영어(인터뷰 대화는 한국어 기본·영어 지원 — 세션 `lang`을 에이전트 프롬프트에 전달), 주요 요소 `data-id` 부여.

## 7. 지식기반 (P2)

- **embed_client.py**: OpenAI 호환 `/embeddings` 호출. `.env`: `AI_EMBED_BASE_URL`·`AI_EMBED_MODEL`(bge-m3)·`AI_EMBED_API_TOKEN`·`AI_EMBED_TIMEOUT_SECONDS`. 1024차원 float32.
- **청킹**: ~500자, 오버랩 80자, 문단 경계 우선.
- **검색**: 전 청크 임베딩을 프로세스 메모리에 로드(수천 규모) → numpy 코사인 top-k + 임계값. 신규 청크 삽입 시 캐시 무효화.
- **소스별 인덱싱**
  - 라이브러리: sysadmin 업로드(ManualDoc 관리 패턴 재사용) → 파싱 → 청킹 → 임베딩(백그라운드 큐)
  - 맵 코퍼스: 게시 시점 이벤트로 게시본 직렬화(이름·노드 라벨·설명·구조 요약) → 인덱싱. 기존 게시본 백필 스크립트 1회
  - 세션 첨부: 파싱 완료 후 세션 스코프로 인덱싱(해당 세션 검색에만 사용)
  - 인터뷰 기록: P3에서
- **인터뷰 주입**: 스테이지 질문 생성 시 facts+맵 주제로 top-k 검색 → 예산 내 프롬프트 주입(출처 표기).
- **유사 SP 제안**: ③활동 나열·⑦검토 스테이지에서 작업본 조각 임베딩 → 게시 맵 코퍼스 코사인 top-k → 임계값 이상이면 제안 카드. 수락 시 해당 구간을 Call Activity 링크 노드로 대체.

## 8. RAG 축적 루프 (P3)

- 세션 complete 시: 인터뷰어가 Q&A·결정사항을 정제 요약 → 청킹 → `source_type=interview`로 인덱싱.
- 차기 인터뷰 검색 대상에 포함 — 유사 프로세스의 과거 결정("이 조직은 승인 단계를 이렇게 나눈다")이 질문·초안 품질로 되먹임.
- (P3+ 옵션, 이번 범위 밖) 주기적으로 기록을 증류해 "조직 프로세스 작성 가이드" 문서 자동 갱신.

## 9. 에러 처리

| 상황 | 처리 |
|---|---|
| AI 호출 실패 | 1회 재시도 → 실패 시 에러 버블 + "다시 생성"(동일 턴 재실행). 세션 상태 불변 |
| 모델 JSON 파싱 실패 | 기존 `_extract_json` 재사용 + 1회 재요청 후 표면화 |
| 첨부 파싱 실패 | 파일 단위 status=failed + 알림 카드, 인터뷰는 계속 |
| 임베딩 서버 다운(P2) | 검색 스킵 + "지식기반 참조 불가" 알림 카드 — 인터뷰 자체는 동작(그레이스풀 디그레이드) |
| draft 충돌 | apply 시 `base_graph_updated_at` 비교 → 변경 감지 시 경고 모달 후 명시적 확인 |
| 점유(checkout) 충돌 | 기존 편집 점유 규칙 그대로 — 점유자가 아니면 apply 차단 |

## 10. 테스트 전략

- **백엔드(pytest, `ai_client`/`embed_client` 모킹)**: 스테이지 엔진 단위(스킵 판정·완료 조건·전이) · 턴 트랜잭션(실패 시 상태 불변) · 체크포인트 revert · apply 권한/충돌/점유 · 첨부 파싱(픽스처 파일) · IDOR 가드 · (P2) 청킹·코사인 검색 단위.
- **프론트(vitest)**: 카드 렌더 분기 · 진행률/체크포인트 상태 로직 · apply 흐름.
- **Playwright**: `page.route` API 모킹으로 consult 페이지 스모크(진입→질문→선택→체크포인트 복원→적용).
- `AI_ENABLED=false` 기본에서 전체 그린 유지(인터뷰 API는 비활성 시 503 — 기존 AI챗과 동일 패턴).

## 11. 설정 추가 (.env.example 병행 갱신)

| 키 | 기본 | 용도 |
|---|---|---|
| `AI_MAX_CONCURRENCY` | 4 | 백엔드 전체 AI 동시 호출 상한 |
| `INTERVIEW_CHOICE_COUNT` | 2 | 선택지 병렬 생성 개수(최대 3) |
| `INTERVIEW_CONTEXT_BUDGET` | 12000 | 문서/지식 주입 문자 예산 |
| (P2) `AI_EMBED_BASE_URL` 등 4종 | — | bge-m3 임베딩 서버(주소 하드코딩 금지) |

## 12. 단계 분해

- **P1 인터뷰 코어**: 테이블 4종 · 스테이지 엔진 · 에이전트 3종 · 턴/체크포인트/apply API · 첨부 파싱+예산 주입(임베딩 없이) · consult 라우트 UI 전체(선택지 카드·프리뷰·체크포인트) · 부하 가드 · 테스트. → 단독으로 "문서 참고 인터뷰로 맵 완성" 가치 전달.
- **P2 지식기반**: embed client · `kb_documents`/`kb_chunks` · 라이브러리 관리(sysadmin) · 맵 코퍼스 인덱싱(게시 이벤트+백필) · 검색 주입 · 유사 SP 제안 카드.
- **P3 축적 루프**: 완료 인터뷰 정제·인덱싱 · 차기 인터뷰 검색 포함.

## 13. 가정 (확인 필요 시 조정)

- 공용 라이브러리 관리 권한 = sysadmin.
- 컨설팅 모드 진입 권한 = 해당 맵 editor 이상 + 편집 가능 draft.
- 첨부 원본 파일 미보존(parsed_text만 저장).
- 스트리밍 미도입(단발 JSON + 로딩 UI).
- 세션은 맵×사용자당 active 1개.
- 인터뷰 진행 언어: **한국어 기본, 영어 지원** — 세션 생성 시 앱 언어 설정(`bpm.lang`)으로 고정, UI 크롬은 영어.
