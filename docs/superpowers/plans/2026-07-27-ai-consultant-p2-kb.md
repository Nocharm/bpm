# AI Consultant P2 — 지식기반(KB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bge-m3 임베딩 기반 지식기반 — 조직 라이브러리·게시 맵 코퍼스·세션 첨부를 청킹/임베딩해 인터뷰 질문 생성에 top-k 검색 주입 + 유사 서브프로세스 제안 (design 2026-07-23 §7).

**Architecture:** `backend/app/kb/` 신설 — `embed_client.py`(OpenAI 호환 `/embeddings`) · `chunking.py`(~500자/오버랩 80/문단 경계) · `retrieval.py`(인메모리 numpy 코사인 top-k+임계값, 삽입 시 캐시 무효화) · `indexing.py`(동시 1개 직렬 워커). 테이블 2종 `kb_documents`/`kb_chunks`(신규 — create_all 자동, `_ADDED_COLUMNS` 불요). 임베딩 서버 다운 시 검색 스킵+알림 카드(그레이스풀 디그레이드) — 인터뷰 자체는 P1 그대로 동작.

**Spec:** `docs/design/2026-07-23-ai-consultant-interview-design.md` §5(테이블)·§7(지식기반)·§9(에러) — P2 범위 = §12 P2.

## Global Constraints (P1 플랜과 동일 + 추가)

- P1 플랜(`2026-07-23-ai-consultant-interview-p1.md`)의 Global Constraints 전부 유지 — httpx2·KST·AI 모킹 패턴·React Compiler·토큰·LF·워크트리 고정(`/Users/hyeonjin/Documents/bpm/.claude/worktrees/ai-consultant`).
- **임베딩 모킹 패턴**: `monkeypatch.setattr(embed_client, "embed_texts", fake)` — fake는 `(texts: list[str]) -> list[list[float]]`(1024차원). 전체 테스트는 임베딩 서버 없이 그린.
- **`AI_EMBED_*` 4종은 Environment 카테고리** — `.env.example` + Settings + **docker-compose backend `environment:` 블록** 3곳 동시(env_file 없음 — `rules/backend/config.md`).
- KB 활성 판정: `settings.ai_enabled and settings.ai_embed_base_url` — 비활성이면 인덱싱·검색 전부 no-op(P1 동작 불변).
- numpy는 requirements.txt(프로덕션) 추가 — 코사인 검색용, 버전 고정.
- top-k=5·임계값 0.5·청크 500자/오버랩 80·배치 ≤32는 비즈니스 상수(모듈 상수) — .env 미노출.

## Tasks

### Task 1 — 설정 + embed 클라이언트 ✅
- [x] Settings 4종: `ai_embed_base_url`(""), `ai_embed_model`("bge-m3"), `ai_embed_api_token`(""), `ai_embed_timeout_seconds`(30) + `.env.example` + docker-compose `environment:` 매핑.
- [x] `app/kb/embed_client.py`: `embed_texts(texts) -> list[list[float]]` — POST `{base}/embeddings` `{"model", "input"}`, 배치 ≤32 분할, Bearer 토큰, httpx2, 실패는 `EmbedError`로 정규화(재시도 1회).
- [x] tests: 배치 분할·응답 매핑·에러 정규화 (httpx2 모킹).

### Task 2 — KB 테이블 + 청킹 ✅
- [x] `models.py`: `KbDocument`(id/title/filename/mime/parsed_text/status/uploaded_by/created_at), `KbChunk`(id/source_type[library|map|attachment]/source_id/chunk_index/chunk_text/embedding BLOB/meta JSON/created_at).
- [x] `app/kb/chunking.py`: `chunk_text(text, size=500, overlap=80)` — 문단 경계 우선, 빈/공백 청크 제거.
- [x] tests: 경계 우선 분할·오버랩·짧은 문서 1청크·빈 문서 0청크.

### Task 3 — 검색(retrieval) ✅
- [x] `app/kb/retrieval.py`: float32 1024 패킹/언패킹(`pack_embedding`/`unpack_embedding`), `search(session, query, top_k=5, session_id=None)` — 전 청크 로드→numpy 코사인→임계값 0.5 이상 top-k. `source_type=attachment`는 `meta.session_id` 일치분만(세션 스코프), library/map은 전역.
- [x] 인메모리 캐시(모듈 전역: 행렬+행 메타) + `invalidate_cache()` — 인덱싱 삽입/삭제 시 호출.
- [x] tests: 코사인 순위·임계값 컷·세션 스코프 격리·캐시 무효화.

### Task 4 — 인덱싱 파이프라인(직렬 워커)
- [ ] `app/kb/indexing.py`: 전역 `asyncio.Semaphore(1)` 직렬화 — `index_library_doc(doc_id)` · `index_map_version(version_id)`(게시본 직렬화: 맵 이름·노드 라벨·설명·구조 요약, 기존 `map` 청크 교체) · `index_attachment(attachment_id, session_id)`(세션 스코프 meta). 임베딩 배치 ≤32, 실패는 로깅 후 무해(그레이스풀).
- [ ] 훅 2곳: `routers/versions.py` publish 성공 후 fire-and-forget + `routers/interviews.py` 첨부 파싱 성공 후.
- [ ] `scripts/backfill_kb_maps.py`: 기존 게시본 1회 백필(서버에서 수동 실행).
- [ ] tests: 소스별 인덱싱 청크 생성·map 재게시 시 구청크 교체·비활성 시 no-op·훅 발화(모킹).

### Task 5 — 라이브러리 관리 API (sysadmin)
- [ ] `routers/kb.py`: `GET /api/kb/documents`(목록) · `POST /api/kb/documents`(업로드 — interview parsing 재사용, 파싱→인덱싱 큐) · `DELETE /api/kb/documents/{id}`(문서+청크 삭제, 캐시 무효화). 전부 sysadmin 가드.
- [ ] tests: 권한(403)·업로드→파싱→청크·삭제 연쇄.

### Task 6 — 인터뷰 검색 주입 + 디그레이드 노티스
- [ ] `routers/interviews.py` 턴 경로: KB 활성 시 `search(맵 이름+스테이지 목표+최근 사용자 입력)` top-k → `[지식기반 참조]` 블록(출처: 문서 제목/맵 이름 표기)을 context_text에 예산 내 추가. agents 프롬프트에 "참조는 근거로만, 사실 날조 금지" 1줄.
- [ ] 임베딩 호출 실패 시: 검색 스킵 + 세션당 1회 notice 메시지("지식기반 참조를 사용할 수 없습니다 — 인터뷰는 계속 진행됩니다").
- [ ] tests: 주입 블록 포함·실패 시 스킵+노티스 1회·비활성 시 무주입(P1 회귀 가드).

### Task 7 — 유사 서브프로세스 제안 (백엔드)
- [ ] activities/review 스테이지 턴에서 작업본 조각(연속 process 3+개 시퀀스) 임베딩 → `source_type=map` 코퍼스 top-1(임계값 상향 0.65) → 턴 응답에 `sp_suggestion` payload(대상 맵 id/이름/구간 노드 키). 수락은 프론트가 기존 서브프로세스 링크 규칙(중복 가드·grandfather)으로 처리.
- [ ] tests: 후보 검출·임계 미달 무제안·중복 가드 존중.

### Task 8 — 프론트 (라이브러리 관리 UI + 유사 SP 카드)
- [ ] sysadmin 설정 화면에 KB 라이브러리 섹션(업로드/목록/삭제 — ManualDoc 관리 패턴 재사용) + `data-id`.
- [ ] 인터뷰 캔버스에 유사 SP 제안 카드(미니 프리뷰+수락/무시) — 수락 시 해당 구간을 Call Activity 링크 노드로 대체(`buildGraphFromAiProposal` 경로 재사용).
- [ ] vitest + pw-smoke(카드 표시·수락 배선은 모킹).

### Task 9 — 게이트 + 문서
- [ ] 전체 게이트: BE pytest+ruff / FE vitest+tsc+lint+build+smoke 그린.
- [ ] README/deploy 문서에 `AI_EMBED_*`·백필 절차 추가, PROGRESS 갱신, 메모리 갱신.

## 검증 시나리오 (실서버)
1. `.env`에 `AI_EMBED_BASE_URL`(bge-m3 서버)·토큰 설정 → 재배포.
2. sysadmin으로 라이브러리 문서 1개 업로드 → 인터뷰에서 해당 내용 질문 시 참조 반영 확인.
3. 게시 맵 1개 백필 → 유사 프로세스 인터뷰에서 SP 제안 카드 확인.
4. 임베딩 서버 중단 → 인터뷰 정상 진행 + 노티스 1회 확인.
