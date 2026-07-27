# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷) + git history로 아카이브한다.

## 2026-07-27 — P2 지식기반 Tasks 7~9 완료: 유사 SP 제안·프론트·문서 (worktree-ai-consultant)
- **Task 7 유사 SP 제안(백엔드)**: `kb/sp_suggest.py` — 분기 없는 연속 process 체인(3+) 추출 → map 코퍼스 top-1(임계 0.65, 자기 맵·기링크 맵·비가시 맵 제외) → activities/review 턴에 `sp_suggestion` 메시지(맵당 1회). 수락은 `POST /interviews/{id}/sp-accept`가 결정적 치환(subprocess 링크 노드+엣지 재배선+노티스, 제안 메시지 superseded).
- **AI 계약 확장**: AI_NODE_TYPES에 subprocess 추가 + orchestrator `_sanitize_subprocess`(이전 작업본에 실존하는 링크만 제목 매칭 유지, 환각은 process 강등 — word 앵커 사니타이즈와 동형). 세션 시드도 링크 있는 subprocess 유지.
- **Task 8 프론트**: AiNode.linked_map_id 스레딩(AI 변환 2곳 — buildGraphFromAiProposal candidate/mergeNode·page aiNodeToGraphNode: 링크 있는 subprocess만 실제 Call Activity로, 무링크는 기존 강등 유지) · 캔버스 SP 제안 카드(iv-sp-card, Replace/Dismiss/새 탭 링크) · 설정 Knowledge base 탭(`kb-manage-panel` — 업로드/목록/Indexed 뱃지/삭제, sysadmin) + i18n 2키.
- **Task 9**: `docs/deploy/kb-embedding.md`(EMBED_* 설정·백필·그레이스풀) + docs 인덱스. 게이트: BE 805·ruff 0 / vitest 566·tsc 0·lint 0에러·build·스모크 3종(consult SP 카드 단언 포함) 그린. **P2 전체 Tasks 1~9 완료 — 실서버 검증 시나리오는 플랜 문서 하단.**

## 2026-07-27 — P2 지식기반 Tasks 4~6: 인덱싱 워커·라이브러리 API·검색 주입 (worktree-ai-consultant)
- **Task 4 인덱싱**: `kb/indexing.py` — 루프별 Semaphore(1) 직렬 워커 + `spawn()`(fire-and-forget), 소스별 인덱서 3종(library 문서·map 게시본 직렬화(이름/설명/활동/흐름, 맵 단위 교체)·attachment 세션 스코프), publish 훅(versions.py 커밋 후)·첨부 업로드 훅·첨부 삭제 시 청크 동반 삭제, `scripts/backfill_kb_maps.py`(기존 게시본 1회 백필).
- **Task 5 라이브러리 API**: `routers/kb.py` — sysadmin 전용 GET/POST/DELETE `/api/kb/documents`(인터뷰 파싱 계약 재사용·chunk_count 동봉·삭제 시 청크+캐시 정리), `KbDocumentOut` 스키마, main 등록.
- **Task 6 검색 주입**: post_turn에서 맵 이름+스테이지 목표+사용자 입력으로 top-k 검색 → `[지식기반 참조]` 블록(출처 표기·4000자 예산·날조 금지 헤더)을 컨텍스트에 추가. 임베딩 실패는 검색만 스킵+세션당 1회 디그레이드 노티스(인터뷰 계속). 비활성 시 완전 no-op(P1 회귀 가드 테스트).
- 테스트 10종 신규(`test_kb_pipeline.py`). 함정: 노드/엣지 id는 전역 PK — 테스트 픽스처 id에 접두 필수(kbm-*). 게이트: BE 801·ruff 0. 남은 Tasks 7~9(유사 SP 제안·프론트 UI·문서). **dev 머지는 사용자 확인 후 진행 예정(미머지)**.

## 2026-07-27 — 인터뷰 시작 시 기존 맵 데이터 파악 오프닝 (worktree-ai-consultant)
- **매번 같은 백지 인사 개선**: 세션 생성 시 draft 그래프를 작업본으로 시드(`_seed_working_graph` — note 제외·AI 계약 밖 타입 process 강등·엣지/그룹/attributes 동반) → 프리뷰가 처음부터 현재 맵을 표시, 드래프터도 기존 구조 위에서 시작.
- start/end 자동 시드 외 실제 내용이 있으면 **데이터 인지형 오프닝**: 파악한 활동 요약(마크다운, 6개 캡) + "기존 맵 보완/처음부터 재정리" quick reply 2개(question payload — 프론트 픽커 자동 렌더). word 모드는 기존 인사에 노드 파악 한 줄 추가.
- 에이전트 계약 보강: 인터뷰어 룰12(기존 맵 우선 — 백지 질문 금지)·드래프터 룰5(기존 작업본 보존 — 백지 재생성 금지, word 애든덤 6~9 재번호). 테스트 2종 추가, BE 791·ruff 0.

## 2026-07-27 — 임베딩 env를 사내 표준 변수명으로 정렬 (worktree-ai-consultant)
- `AI_EMBED_*` 4종 → **`EMBED_URL`/`EMBED_MODEL`/`EMBED_DIM`/`EMBED_TIMEOUT_SECONDS`** 개명(사내 타 임베딩 사용 서비스와 동일 — 그쪽 .env 값 그대로 복사 가능). 인증 없음 확인 → 토큰 필드·Bearer 헤더 제거.
- `EMBED_URL`은 /v1 루트·/embeddings 전체 경로 모두 수용(끝이 /embeddings면 그대로, 아니면 부착). `EMBED_DIM` 설정화(기본 1024). Settings+.env.example+compose 3곳 동시 갱신. BE 789·ruff 0.

## 2026-07-27 — AI 컨설턴트 P2 지식기반 착수: 플랜 + KB 코어 Tasks 1~3 (worktree-ai-consultant)
- 플랜 신설 `docs/superpowers/plans/2026-07-27-ai-consultant-p2-kb.md`(Tasks 1~9, 설계 §7 구체화).
- Task 1: `AI_EMBED_*` 설정 4종(Settings+.env.example+compose environment 3곳 동시) + `app/kb/embed_client.py`(OpenAI 호환 /embeddings, 배치 ≤32, 재시도 1회, EmbedError 정규화).
- Task 2: `kb_documents`/`kb_chunks` 테이블(create_all 자동) + `kb/chunking.py`(500자/오버랩 80/문단 경계 우선).
- Task 3: `kb/retrieval.py` — float32 패킹, numpy 코사인 top-5+임계 0.5, attachment는 세션 스코프, 인메모리 캐시+무효화. numpy==2.3.1 프로덕션 의존성 추가.
- 테스트 12종 신규(`test_kb_core.py`, 임베딩·httpx2 모킹). 게이트: BE 788·ruff 0. 남은 작업 Tasks 4~9(인덱싱 워커·라이브러리 API·검색 주입·유사 SP·프론트).

## 2026-07-27 — 인터뷰 GPU 실검증 2차 피드백 4종 (worktree-ai-consultant)
- **체크포인트 클릭 = 맵 프리뷰 먼저**: 좌상단 체크포인트를 누르면 즉시 revert하지 않고 캔버스만 스냅샷으로 되돌려 보여줌(신규 하이라이트 억제·인스펙터도 스냅샷 기준) + 상단 프리뷰 바(Keep current/Go back here)로 확정 시에만 실제 revert. `InterviewCheckpointOut.working_graph` 노출 추가(백엔드).
- **언어 미러링**: 세션 언어가 영어라도 사용자가 한글로 답하면 한글로 응답하도록 `_LANG_LINE` 계약 확장(ko/en 대칭).
- **선택지 무변화·중복 필터**: `_graph_signature`(제목 기준 구조 정규화 — 임시키·설명·attributes 무시)로 현재 작업본과 동일한 안·서로 중복인 안 제거, 전부 걸러지면 선택지 없이 일반 턴 폴백(TurnError 아님). 테스트 2종 추가.
- **선택지 레이아웃 재설계**: 3안=좌측 큰 창 1+우측 작은 창 2(탭·작은 창 헤더 클릭으로 큰 창 교체), 2안=1:1, 1안=큰 창 하나 — `ChoiceOverlay` 신설(`iv-choice-tab`·`data-focused`). 드래프터 summary는 "이 안만의 차별점 한 줄"로 유도(공통 설명 금지).
- 게이트: BE 776(+2)·ruff 0 / vitest 562·tsc 0·lint 0에러·build·pw-smoke-consult(+word) 그린.

## 2026-07-27 — 개발(dev) 스택 브리지 서브넷 172.42→172.44 (worktree-ai-consultant)
- 서버 지정값 반영: `docker-compose.dev.yml` subnet/gateway를 172.44.0.0/16·172.44.0.1로 변경(172.42는 기존 스택 점유).

## 2026-07-27 — 인터뷰 턴 504 픽스: nginx 프록시 타임아웃·업로드 한도 (worktree-ai-consultant)
- **GPU 실검증 1차 피드백**: 서버 경유(:3333) 인터뷰 턴이 자주 504 — 턴 1회가 순차 AI 호출 3~4회(인터뷰어→선택지→드래프터→톤 검수)로 nginx 기본 `proxy_read_timeout` 60s를 초과, 프록시가 먼저 끊음(백엔드는 계속 처리해 턴은 커밋됨 — 새로고침 시 답변 존재).
- `nginx/default.conf` `/api/`에 `proxy_read_timeout/send_timeout 600s` + `client_max_body_size 25m`(첨부 20MB — 기본 1MB면 413 잠복) 추가. `.env.example`에 느린 GPU는 `AI_TIMEOUT_SECONDS` 120~180 권장 주석.

## 2026-07-27 — Word 임포트 섹션 번호 불일치 픽스 (dev, 실물 문서 이슈)
- 실물 SOP 임포트에서 번호가 문서와 어긋나는 버그(사용자 진단 정확): 번호가 자동넘버가 아니라 **본문 제목 텍스트에 직접 타이핑**된 문서 + 영어/한글 짝이 **Enter(별도 문단)**로 이어지는 구조 — 한글 줄이 같은 레벨 제목으로 집계돼 카운터를 +1씩 밀어 이후 번호 전부 드리프트(3.2→4.2). Shift+Enter 쌍은 한 문단이라 무영향.
- 픽스 2종(`word-import.ts` collectHeadings): ① **텍스트 리터럴 번호 최우선 권위** — 제목 선두 `^(\d+(\.\d+)*)[.)]?\s+` 매치 시 그 번호 채택·제목에서 분리(라벨 "번호 제목" 중복 방지)·카운터 동기화(제목마다 자가 교정 → 드리프트 누적 불가) ② **무번호 언어 짝 번호 상속** — 텍스트 번호 제목 **바로 다음 문단**의 같은 레벨 무번호 제목은 같은 섹션의 언어 짝으로 보고 번호 상속+카운터 불변. 상속은 직전이 텍스트 번호일 때만(fromText 가드) — 자동넘버 문서의 무번호 연속 형제(1.1.1→1.1.2)는 기존 카운터 유지(기존 테스트가 회귀로 적발해 가드 추가). word-import 15/15·vitest 564/564·tsc0·lint0.
- 기존 임포트된 맵은 **재임포트**하면 번호가 교정됨(카탈로그 전체 교체 + 앵커 불변이라 노드 링크 유지).

## 2026-07-26 — Word 맵 AI 컨설턴트 변환 모드 설계 (dev)
- 브레인스토밍 확정·설계 문서: word 맵의 컨설턴트 = **문서→순서도 변환 컨설턴트**(제안 우선) — word 전용 3스테이지(scope/draft/review, 기존 엔진 재사용)·드래프터 섹션 계약(카탈로그 앵커만 허용·무효 강등 노티스·라벨 서버 재구성)·카탈로그 기본+원본 업로드 권장·AI 변환 2곳 section_anchor 스레딩·기존 섹션 노드 보존. `docs/design/2026-07-26-word-map-ai-consultant-design.md`.
- 구현: word 전용 3스테이지 엔진(WORD_STAGES·mode 파라미터) (Task 1). 761개 테스트 통과, ruff 0.
- 구현: 세션 mode 컬럼 + 생성 분기 + state 노출 + skip 가드 mode 인자 (Task 2). 763개 테스트 통과, ruff 0.
- 구현: 에이전트 word 계약·카탈로그 주입 + AiNodeAttributes.section_anchor (Task 3). format_section_catalog·word 애든덤·mode/section_catalog 파라미터 추가 + 4개 신규 테스트. 767개 테스트 통과, ruff 0.
- 수정(Task 3): AI_NODE_TYPES에 section 추가(word 드래프터 파싱 게이트) — AI_NODE_TYPES 검증 + 회귀 테스트 추가. 768개 테스트 통과, ruff 0.
- 구현: 오케스트레이터 word 앵커 검증(`_sanitize_word_graph` — 무효 앵커 강등·카탈로그 라벨 재구성) + 강등 노티스 + `doc_sections` 라우터→턴 파이프라인 스레딩(`_redraft`/`_generate_choices`/`run_turn`/`_run_skip_turn`, engine 호출 전부 mode 인자) (Task 4). 3개 신규 테스트, 771개 테스트 통과, ruff 0.
- 수정(Task 4): skip-turn 재드래프트 강등 노티스(`_run_skip_turn`·`_redraft` 반환 unpacking) + 정합 로킹 테스트 3개(`test_sanitize_promotes_valid_anchor_on_plain_node`, `test_skip_turn_word_redraft_demote_notice`, `test_stage_complete_with_word_redraft_demote_notice`). 774개 테스트 통과, ruff 0.
- 구현: FE `mode` 노출 + word 3단계 칩(`WORD_INTERVIEW_STAGES`·`stagesForMode`·`stageIndex(key, mode?)`) — consult 페이지 진행 닷·인터뷰 패널 스테이지 칩/디바이더 라벨·프리뷰 체크포인트 라벨 전부 mode 인지(Task 5). `InterviewState.mode` 노출(api.ts). 560개 vitest 통과, tsc 0, lint 0.
- 수정: FE `aiNodeToGraphNode` `section_anchor` 스레딩(Task 6 — AI 변환 2곳 대칭 완성: csv-import buildGraphFromAiProposal 기존·page.tsx aiNodeToGraphNode 신규). 회귀 테스트 추가(buildGraphFromAiProposal 기존 코드로 통과), 561개 vitest·tsc 0·lint 0.
- 검증: word 모드 pw 스모크(`pw-smoke-consult-word.mjs` — 3단계 닷/칩·섹션 노드 프리뷰 렌더) + 원본 `pw-smoke-consult.mjs` 회귀 둘 다 통과, 전체 게이트 실행(Task 7 — 최종). backend pytest 774 passed·ruff 0. frontend vitest 561 passed·tsc 0·lint 0(무관 기존 경고 1)·build OK.
- 리뷰 픽스(최종): `mergeNode`(csv-import.ts)가 제목 매칭된 section 노드를 AI가 process로 에코해도 병합 후 section_anchor가 살아있으면 node_type을 section으로 승격(서버 `_sanitize_word_graph` 규칙의 FE 미러) — 안 그러면 word-export.ts의 "section && anchor" 조건이 깨져 문서 링크가 조용히 사라짐. `agents.py` 카탈로그 삽입이 없앤 일반 모드 프롬프트 개행 1줄 복원 + 개행 스펙 고정 테스트 추가. frontend vitest 562 passed·tsc 0. backend pytest 774 passed·ruff 0.

## 2026-07-26 — 첨부 칩 접기 + 복수/폴더 첨부 리뷰·업로드 진행 (worktree-ai-consultant)
- **칩 목록 접기**: 첨부 칩 5개(약 두 줄)까지만 노출, 초과분은 `+N more` 토글로 펼침/접힘.
- **복수/폴더 선택**: 안내 모달을 Cancel·Choose folder·Choose files 3버튼으로 재구성(폴더는 webkitdirectory — @types/react 미타이핑이라 ref 콜백 부여), 숨김 파일(.DS_Store 등) 자동 제외.
- **리뷰 모달**: 선택 파일을 가능/불가 섹션으로 나눠 표시(확장자 아이콘·크기·불가 사유 뱃지, 섹션당 8행 초과분 +N 요약) — 컨펌 후 순차 업로드. 판정 기준은 백엔드 계약 미러(5종 확장자·20MB).
- **업로드 진행 애니메이션**: 모달 행별 스피너→체크(Done)/실패(Failed) + 버튼 `Uploading n/m…`, 전부 성공 시 자동 닫힘·실패 시 실패 행 유지. 유효 단일 파일은 모달 생략 즉시 업로드(칩 줄 인라인 Uploading 스피너). onAttach는 성공 여부 반환으로 변경(page handleAttach).

## 2026-07-26 — 첨부 칩 확장자 아이콘 (worktree-ai-consultant)
- **파일타입 아이콘**: 첨부 칩에 확장자별 Lucide 아이콘+토큰색 — 시트(xlsx/xlsm/xls/csv)=FileSpreadsheet·added, 프레젠테이션(ppt/pptx)=FileChartPie·changed, 문서(doc/docx)=FileText·accent, pdf=FileType·error, md=FileCode, txt=FileText(뮤트), 그 외 File 폴백. 파싱 실패 칩은 아이콘도 error로 통일. 현재 업로드 포맷(5종) 외 확장자는 표시용 선매핑(백엔드 무변경).

## 2026-07-26 — 채팅 글자 크기 Aa 팝오버 (worktree-ai-consultant)
- **A−/A+ 트리오 → Aa 팝오버**: 액션 줄엔 Aa 버튼 하나만, 클릭 시 플로팅 팝오버(shadow-lg)에서 실크기 A 글리프 4단계(12/13/14/16px)를 직접 선택 — 현재 단계 accent 하이라이트, 바깥 클릭(capture)·Escape 닫힘, 선택 후 입력창 재포커스. 스모크는 팝오버 열기→선택→닫힘 플로우로 갱신(iv-font/iv-font-pop/iv-font-opt-*).

## 2026-07-26 — 인터뷰 채팅 패널 리디자인 7종 (worktree-ai-consultant)
- **컴포저 카드 통합**: 흩어져 있던 툴바·첨부 칩·입력·카운터를 rounded-lg + shadow-md 카드 하나로 — textarea는 borderless, 포커스는 카드 focus-within 테두리, 액션(첨부·A±·Skip·카운터·Send)은 카드 하단 줄.
- **메시지 그룹핑 + 스테이지 디바이더**: 연속 컨설턴트 런의 첫 메시지에만 "Consultant" 헤더(아바타 반복 제거), `message.stage` 전환 지점에 중앙 헤어라인 디바이더 삽입(기존 데이터만 사용, 백엔드 0줄).
- **sticky 스테이지 칩**: 채팅 상단에 현재 스테이지 라벨 + `Stage n of 7`(비활성 시 status) 고정 표시.
- **typing dots**: 스피너+문구 → 점 3개 바운스(기존 `lp-dot` keyframe 재사용), 팁은 ink-muted 캡션으로 톤 다운.
- **보기 픽커 핀 고정**: QuestionOptions를 스크롤 영역 밖 컴포저 바로 위로 이동 — 긴 대화에서도 항상 노출, 키보드 내비·autofocus 유지.
- **스크롤 다운 버튼**: 바닥에서 160px 이상 올라가면 중앙 하단 플로팅 ↓ 버튼(shadow-lg).
- 기존 data-id 전부 유지(pw-smoke-consult 무수정 통과) + 스모크에 iv-stage-chip/iv-composer 단언 추가. lint 0에러·vitest 518·build·스모크 그린, 목업 스크린샷 육안 확인.

## 2026-07-24 — Word 맵 라이프사이클 설계 (dev)
- 브레인스토밍 확정·설계 문서: word 맵=문서 부속 산출물 정체성 → 홈 Maps 탭 내 섹션 분리(조직도·집계 제외)·생성 진입 이동+자동값 축소·워크플로 UI 간소화(셀프 게시)·개정 타임스탬프 2종+stale 배지(N2)·일반 맵 승격 복사(copy 확장, 섹션→process 일괄 변환). `docs/design/2026-07-24-word-map-lifecycle-design.md`.
- 구현: 개정 타임스탬프 2종(doc_imported_at/doc_generated_at) 컬럼·재임포트 스탐프 (Task 1). pytest 24/24 그린.
- 구현: 완결문서 생성시각 기록 엔드포인트 POST /word-doc/generated (Task 2). pytest 703/703 그린.
- 구현: copy convert_to_normal 승격 복사(mode/doc 소거·섹션 노드→process 일괄 변환) (Task 3). pytest 704/704 그린.
- 구현: api 필드/copyMap opts/markWordDocGenerated + word-map-home 파생 헬퍼·vitest (Task 4). vitest 548/548 그린.
- 구현: 홈 분리 — `WordDocsSection`(조직도 밖 문서 평면 목록) + 조직도/즐겨찾기/대시보드는 processMaps만(검색은 word 맵 포함 유지) + 생성 진입은 섹션 "New" 버튼으로 이동, create 드롭다운 Word 항목 삭제. `mode`/`doc_name`/`doc_sections`를 MapDetail 전용에서 MapSummary로 이동(목록 응답 MapOut에 이미 포함 — 홈 분리에 필요) (Task 5). vitest 549/549·tsc0·lint0 그린.
- 구현: `WordQuickCreateDialog` — org_path 보유 유저는 이름만 확인하는 빠른 생성(오우닝 부서=내 org_path·승인자=본인 자동), org_path 없는 유저는 기존 CreateMapDialog 폴백 (Task 6). vitest 549/549·tsc0·lint0 그린.
- 구현: 홈 재임포트 액션 — WordDocsSection onReimport 핸들러 배선 + setWordDoc + 재임포트 모달 (Task 7). vitest 549/549·tsc0·lint0 그린.
- 구현: `MapDetailCard`에 word 맵 문서 메타 블록(문서명·섹션 수·타임스탬프 2종·재생성 힌트)+승격 진입 버튼("Convert to process map", `onPromote` prop) 추가. `latest_version_status` 배지는 이 카드에 애초 없어 숨김 작업 불필요(§4 계약은 카드 밖 대시보드/리스트에서 이미 processMaps만 소비). page.tsx `onPromote` 배선은 Task 9로 이연(다이얼로그 상태 미존재) (Task 8). vitest 549/549·tsc0·lint0 그린.
- 구현: 승격 관문 — `CreateMapDialog`에 `promote` 모드 추가(생성 호출을 `copyMap(mapId, name, {convertToNormal, owningDepartment})`로 교체, visibility 섹션 숨김, 제목 전환) + `page.tsx` `promoteTarget` 상태로 `MapDetailCard`(양쪽 사이트)·`WordDocsSection` `onPromote` 배선 (Task 9). vitest 549/549·tsc0·lint0 그린.
- 구현: 에디터 완결문서 생성 성공 시 `markWordDocGenerated(mapId)` 스탐프(다운로드 비차단, console.warn만) + 재임포트로 사라진 앵커 참조 섹션 노드에 stale 배지(`NodeData.staleAnchor`·`process-node` AlertTriangle) + 섹션 패널 헤더 경고(`staleCount`) — `staleAnchorIds` memo가 `getStaleSectionNodeIds`로 파생, `displayNodes`에 주입 (Task 10). vitest 549/549·tsc0·lint0 그린.
- 검증: 홈 분리 Playwright 스모크(`frontend/scripts/pw-smoke-word-home.mjs`) — 행 노출·생성 진입·조직도 미노출 + 상세카드 단언(`word-doc-meta`·`map-detail-promote` "Convert to process map") 추가. 스모크가 실버그 적발: `WordDocsSection` 행 `onClick`에 `stopPropagation` 누락 → 페이지 배경 클릭 핸들러로 버블링돼 선택이 즉시 해제됨(`map-card.tsx`와 동일 패턴으로 수정) (Task 11, 전체 계획 마지막). 전체 게이트 그린: 백엔드 pytest 704/704·ruff 0 / 프론트 vitest 549/549·tsc 0·lint 0(무관 파일 pre-existing warning 1)·build 성공.
- 전체 브랜치 최종 리뷰 픽스: `copy_map` `owning_department` override가 `create_map`/`set_owning_department`와 달리 `_assert_known_department` 검증을 우회하던 버그 수정(422 가드 추가 + 회귀 테스트) + 홈 재임포트 후 열린 상세카드가 갱신 안 되던 문제를 `detailReloadKey`로 강제 리마운트해 수정. pytest 27/27(test_maps.py)·ruff 0 / vitest 549/549·tsc 0·lint 0(무관 pre-existing warning 1) 그린.
- 홈 좌측 UX 후속(사용자 피드백): ① Word documents 섹션을 조직도 **위**(즐겨찾기 아래)로 이동 — 트리 아래에선 스크롤 밖으로 묻혀 생성 진입을 못 찾음 ② 좌측 접힘 상태(조직도·즐겨찾기·Word·미지정)를 `bpm.home.filters`에 실어 SPA 복귀 시 복원(새로고침은 초기화, 기존 정책 동일 — 복원 시 내 부서 시드 스킵) ③ 조직도 수동 펼침 시 하위 부서가 1개뿐인 구간 연쇄 자동 펼침(`collectSingleChildChain`, org-tree vitest 3종). vitest 552/552·tsc 0·lint 0·pw-smoke-word-home pass.

## 2026-07-24 — 인터뷰 채팅 UX 5종 (worktree-ai-consultant, 실사용 5차 피드백)
- **입력 포커스 유지 + `/` 단축키**: 전송/보기 선택 후 busy 해제 시 입력창 자동 재포커스(보기 픽커가 떠 있으면 픽커 키보드 포커스 양보), `/` 키로 어디서든 입력창 포커스(플레이스홀더에 표기).
- **입력창 반응형**: 1행 min~128px max 자동 확장, maxLength 4000(백엔드 계약 동일) + 3600자부터 카운터 노출. 보내기 버튼은 빈 입력/busy 시 비활성(기존 유지).
- **대기 팁**: 답변 대기 스피너 아래 기능 팁 표시 — AI 챗과 동일 소스(getAiTips 서버 팁, 미설정 시 i18n 폴백) 턴 수 기반 로테이션.
- **첨부 안내 모달**: 첨부 버튼 클릭 시 ConfirmDialog로 제한조건(포맷 5종·20MB) 안내 후 파일 선택.
- **채팅 글자 크기 조절**: A−/A+ 4단계(12/13/14/16px, 기본 13 — 기존 14보다 축소), localStorage(`bpm.consultChatFont`) 브라우저별 저장. `.md` 폰트는 패널 스코프에서 상속 개방.

## 2026-07-24 — 인터뷰 반복 루프 탈출구 (worktree-ai-consultant, 실사용 4차 피드백)
- **결정적 스테이지 스킵**: 미확정 필수 facts를 '미정'으로 채우고 체크포인트 후 다음 단계로 전진하는 skip 턴 구현(기존 스키마의 미사용 "skip" 타입 활용) + 패널 "Skip to next stage" 버튼(review 이전 스테이지 노출) — 모델이 미정 항목을 놓지 못해 같은 질문을 무한 반복하는 루프의 탈출구. review 스테이지 skip은 400.
- **반복 교정 재질의**: 인터뷰어 응답이 직전 컨설턴트 메시지와 거의 동일(유사도≥0.9)하면 1회 교정 재질의 — 실패 시 원 응답 유지(턴 비파괴). 프롬프트에도 "미정도 확정"·"요약 재출력 금지" 룰 추가.
- **redraw 플래그**: 사용자가 "맵 그려줘/갱신해줘"를 요청하면 facts 변화가 없어도 드래프터 실행(InterviewerOut.redraw) — "그림 그리라고 그림" 회귀 대응. 연속 드래프트 블록은 `_redraft` 헬퍼로 통합.

## 2026-07-23 — AI 컨설턴트 인터뷰 모드 설계 + P1 구현 (worktree-ai-consultant)
- **설계 문서**: 전문 컨설턴트가 인터뷰하며 맵을 그려주는 풀스크린 모드 — 고정 7스테이지+적응 스킵·역할 3에이전트(인터뷰어/드래프터/톤 검수자)·선택지 병렬 생성·세션 작업본+체크포인트·bge-m3 지식기반(P2)·RAG 축적(P3)·부하 가드(전역 세마포어 등). `docs/design/2026-07-23-ai-consultant-interview-design.md`.
- **P1 구현 계획**: 백엔드 7태스크(세마포어·모델·엔진·파싱·에이전트·오케스트레이터·API) + 프론트 5태스크(API 클라이언트·consult 라우트·프리뷰/선택지·진입 버튼·pw 스모크) — 태스크별 TDD 코드 포함. `docs/superpowers/plans/2026-07-23-ai-consultant-interview-p1.md`.
- **Task 1 구현**: 전역 `asyncio.Semaphore`로 `call_ai` 동시 호출 상한 강제(ai_max_concurrency, 기본 4) + 설정 3종(interview_choice_count, interview_context_budget) 추가 + .env.example 갱신 + TDD 테스트(동시성 제한 peak≤2 검증) + 기존 49개 테스트 통과.
- **Task 1 수정**: 루프별 세마포어 캐시로 변경(세마포어는 첫 경합 루프에 바인딩되므로 test asyncio.run() 반복 시 런타임 에러 방지).
- **Task 2 구현**: InterviewSession/Message/Checkpoint/Attachment 모델 4종(KST 타임스탐프·FK 무결성·관계 캐스케이드) + InterviewCreateIn/TurnIn/RevertIn/MessageOut/CheckpointOut/AttachmentOut/StateOut 스키마 7종 + TDD 테스트 4개 모두 통과 + 기존 702개 테스트 통과.
- **Task 3 구현**: 스테이지 엔진 — StageDef 데이터클래스 + 고정 7스테이지(scope/io/activities/branches/roles/params/review) + 전이 함수 5종(get_stage, next_stage_key, stage_index, is_stage_complete, first_incomplete_stage) + TDD 테스트 6개 모두 통과 + lint 통과.
- **Task 4 구현**: 첨부 파싱 + 예산 클리핑 — `app.interview.parsing` 신규(PDF/DOCX/XLSX/TXT/MD + cp949 인코딩 폴백) · `clip_to_budget()` 예산 초과 시 섹션별 균등 절단 · 의존성 3종(pypdf·python-docx·openpyxl) 추가 · 테스트 8/8 그린.
- **Task 5 구현**: 에이전트 프롬프트 빌더 + 출력 계약 — `app.interview.agents` 신규(extract_json·InterviewerOut/ToneReviewOut 모델·build_interviewer/drafter/tone_messages 3종 + CHOICE_VARIANT_HINTS) · vLLM 프리픽스 캐시 최적화(고정 프리픽스→문서→facts→히스토리) · TDD 테스트 8/8 그린 + lint 통과.
- **Task 6 구현**: 오케스트레이터 턴 파이프라인 — `app.interview.orchestrator` 신규(run_turn 함수·TurnError·병렬 선택지·스테이지 체크포인트·톤 검수) · 드래프터 병렬 생성(asyncio.gather) · facts 병합·체크포인트·stage 전이 · TDD 테스트 6/6 그린 + lint 통과 + 기존 724개 테스트 통과(총 730개).
- **Task 7 구현**: 인터뷰 API 라우터 — `app/routers/interviews.py` 신규(8 엔드포인트: create/resume·get·turn·attachment·revert·complete·delete + get_active_interview) · 편집자 권한 검증 · AI 활성화 체크(503) · 소유자만 접근(IDOR 404) · 턴 AI 실패 원자성(롤백 + 502) · TDD 테스트 8/8(+ 스키마 4) 그린 + main.py import 등록 + python-multipart 의존성 추가 + lint 통과 + 기존 738개 테스트 통과(총 738개).
- **Task 7 리뷰 픽스**: rollback 후 만료 접근 회귀 — map_id/version_id 선캡처 + 로깅 추가 + 실패 계량 테스트 확장 + python-multipart CVE-2024-53981 핀 상향(0.0.7→0.0.20) + 전체 테스트 738개 그린.
- **Task 8 구현**: 프론트 API 클라이언트 + 순수 헬퍼 — `interview.ts` 신규(INTERVIEW_STAGES 고정 7단계·stageIndex·choiceOptionsOf·addedNodeKeys·layoutWorkingGraph 함수 5종) · `api.ts`에 인터뷰 인터페이스 9종(WorkingGraph/ChoiceOption/InterviewMessage 등) + API 함수 8종(createOrResumeInterview/getInterview 등) 추가 · TDD 테스트 4/4 그린 + npm test 516/516 + tsc 0 에러(interview 범위).
- **Task 9 구현**: 컨설트 라우트 + 인터뷰 패널 — `frontend/src/app/maps/[mapId]/consult/page.tsx` 신규(부트스트랩 효과·상태관리·세션 진입) · `interview-panel.tsx` 신규(메시지 스트림·입력 필드·첨부·스크롤) · `interview-preview.tsx`/`choice-card.tsx` 스텁(Task 10에서 구현 예정) · tsc 0 신규 에러 + npm test 516/516 + npm run lint 통과.
- **Task 9 리뷰 픽스**: 중첩 버튼 + 첨부 stale closure — choice-card 외부 `<button>`을 `<div>`로(내부 버튼 유지·disabled 전파) · handleAttach 스프레드를 함수형 업데이트로(진행 중 턴 응답 낙관적 갱신 방지) · tsc 4 기존 에러만 유지 + npm test 516/516 + npm run lint 0 에러.
- **Task 10 구현**: 우측 읽기전용 프리뷰 + 선택지 미니 프리뷰 — `interview-preview.tsx` 실구현(ReactFlow read-only 캔버스·EDGE_DEFAULTS로 화살표 스타일 적용·체크포인트 되돌리기+적용 바+충돌 경고) · `choice-card.tsx` 실구현(dagre 좌표 정적 SVG 미니 프리뷰) · 브리프 드래프트 3건 수정(`n.data.title`→`n.data.label`, `outcome.errors.join`→`.map(e=>e.message).join`, ref-in-useMemo를 렌더중 상태조정 패턴으로 대체해 `react-hooks/refs` lint 에러 해소) · tsc 4 기존 에러만 유지 + npm test 516/516 + npm run lint 0 에러(스텁 경고 3건 해소) + npm run build 통과.
- **Task 11 구현**: 에디터 진입 버튼 — `page.tsx` 헤더 undo 버튼 앞에 `Headset` 아이콘 버튼 삽입(`data-id="open-consultant"`, `readOnly`일 때 비활성, 클릭 시 `/maps/${mapId}/consult?version=${versionId}` 이동) · lucide-react import에 `Headset` 추가 · tsc 4 기존 에러만 유지 + npm test 516/516 + npm run lint 0 에러(기존 경고 1건만 잔존).
- **Task 12 구현(최종)**: `pw-smoke-consult.mjs` 신규(인사→답변→선택지 2안→선택→체크포인트+프리뷰 3노드, `page.route` 전 API 모킹) 그린 · 전체 게이트 그린(백엔드 pytest 738 · npm test 516 · lint 0 에러 · tsc 기존 4건만 · build 성공) · 설계 문서 P1 단순화 3건 반영(§5 `/apply` 삭제 표기→프론트 `buildGraphFromAiProposal`+graph PUT 재사용·`/complete`는 상태 전이만, §6 `ring-added`→`diffStatus("added")`/`--color-added` 실메커니즘, 확인 카드는 P1 질문 문구 대체 명시).
- **Task 12 리뷰 픽스**: NotificationBell 폴링 ECONNREFUSED 소음 제거 — `pw-smoke-consult.mjs`에 `GET /api/notifications` 모킹 추가(`page.route(**/api/notifications*, r => r.fulfill({ json: [] }))`), 스모크 그린 + eslint 통과.
- **최종 리뷰 픽스 5건**: graph PUT이 `version.updated_at`을 갱신해 인터뷰 충돌 경고 신호 정상화(C1) · consult 페이지 인터뷰 언어를 `useI18n().lang`으로 연동(I1) · docker-compose backend env에 `AI_MAX_CONCURRENCY`/`INTERVIEW_CHOICE_COUNT`/`INTERVIEW_CONTEXT_BUDGET` 3종 추가(I2) · `_get_owned_interview`에서 매 접근마다 `assert_map_role(editor)` 재검증(I3, 권한 회수 시 차단) · Retry가 이미 성공한 턴을 재전송하지 않도록 `lastTurnRef` 성공 시 초기화(M1). 회귀 테스트 2건 추가(pytest 740개 그린 + npm test 516개 + ruff/tsc/lint 통과).

- **실사용 피드백 반영(대화 UX)**: 채팅 마크다운 렌더(공용 MarkdownView 재사용)+테마 정비(아바타·버블·노티스) · 인터뷰어 계약을 행동 원칙 중심으로 재작성(제안 우선·되물음 즉답·문서 요청 수행·반복 금지) · review 스테이지 체크포인트/톤 검수 스팸 차단(전이 시에만 실행) · 톤 노티스에 적용 개명 명시("A → B") · 선택 턴 이력에 옵션 id 대신 제목 저장 · 첨부 업로드 시 읽음 확인 노티스. 백엔드 741·vitest 516·스모크 그린.
- **실사용 피드백 2차(레이아웃·인터랙션)**: 채팅 우측 이동+드래그 폭 조절(320~640, localStorage) · 선택지를 채팅 밖 캔버스 플로팅 창 복수개로(안마다 팬/줌 ReactFlow, 선택 시 일괄 닫힘) · 명확화 질문 보기(quick-reply 칩, InterviewerOut.options) · 첨부 삭제 API+칩 × · 캔버스 워터마크+핸들 숨김(비교화면 패턴) · 체크포인트 좌상단 스택(최근 위, max-height 진입 애니) · 노드 호버 "Ask about this" 멘션 버튼(CustomEvent→입력창). 백엔드 743·vitest 516·스모크 그린.
- **질문 툴박스**: 보기(quick reply)를 클로드코드식 선택 UI로 — 화살표 ↑↓ 이동·Enter 선택·숫자 1~9 즉선택·클릭·일반 문자 입력 시 자유답변 입력창 자동 포커스(`question-options.tsx`). 프롬프트에 "보기는 options 배열에만, message 본문 중복 나열 금지" 규칙 추가. 전 게이트 그린.
- **질문 툴박스 Other 행**: 픽커 마지막에 "Other — type my own answer" 명시 행 추가(화살표·Enter·클릭으로 자유답변 입력창 포커스) — 주관식 답변 경로를 가시화.
- **대화 반응성·프리뷰 미세조정**: 보낸 메시지 낙관적 즉시 표시(실패 시 유지→Retry 대상 가시화) · 점 격자 제거(프리뷰+선택지 창 민무늬 캔버스) · 복수 제안 간 차이 노드 하이라이트(`distinctiveNodeKeys` — 전 안 공통 아닌 제목만 diff 표시, vitest 2건). vitest 518·스모크 그린.
- **연속 드래프팅 + 파라미터 컨설팅**: facts 갱신 턴마다 드래프터가 작업본 재생성(맵 라이브 갱신 — 선택지 시점에만 그리던 회귀 해소, 실패는 턴 비파괴) · 톤 검수는 그래프가 실제 바뀐 턴만 + '~하기' 개악 금지(플립플롭 차단) · params 스테이지를 체계 설명+활동별 확인 방식으로 강화, 드래프터 attributes 임의 추정 금지 · 프리뷰 노드 클릭 인스펙터(담당·시스템·6파라미터 카드). 백엔드 745·vitest 518·스모크 그린.
## 2026-07-22 — Word 맵 섹션 링크 (구현 완료, worktree-word-map-sections)
- Word(.docx) 맵 전용 모드: 순서도 도형이 문서 내부 앵커(`w:anchor`)로 링크 — 산출물 복사→원본 SOP 붙여넣기 시 섹션 점프 활성. 설계 `docs/design/2026-07-18-word-map-section-linking-design.md`.
- 백엔드: 노드 `section_anchor` 컬럼·맵 `mode`/`doc_name`/`doc_sections`+생성/복사·`PUT /maps/{id}/word-doc` 재임포트.
- 파서(`word-import.ts`, read-only): TOC 하이퍼링크 활성앵커+번호(1~2단계 권위) + `styles.xml` `outlineLvl` 본문 제목 워크 + 3단계+는 TOC 부모 씨앗·로컬카운터로 번호 재구성. 실물 SOP 구조 반영(커스텀 제목 스타일·자동 다단계 넘버·`_Toc` 잔재 중복·5단계+). 문서 0 수정.
- 프론트: `section` 노드타입·섹션 패널(라이브러리 미러)·5개 접근포인트 word맵 게이팅·섹션 드롭 노드생성(`section_anchor` 그래프 라운드트립 저장)·홈 "Word 문서로 만들기" 진입·재임포트.
- 내보내기: 섹션 노드 도형 두 링크 공존 — 1행 라벨 첫 공백토큰만 `w:anchor` 내부링크(+나머지 plain), 2행 url 라벨 외부링크. 도형 1.5cm×3cm 통일(튜닝 상수). Word 버튼은 word맵 전용 노출.
- 게이트 그린: 백엔드 701 pytest·ruff / 프론트 527 vitest·tsc0·lint0·build.
- **미검증(배포 전 수동 필수)**: ① Windows Word 실물 — 산출물 열기→그룹 복사→원본 SOP 붙여넣기→섹션 도형 클릭 시 해당 섹션 점프 + url 라벨 클릭 시 외부 링크. ② **실물 .docx 임포트 파싱 육안 검증**(literal XML 미확보 — 픽스처는 표준 Word TOC 구조 기준). ③ 도형 1.5×3cm·엣지 라우팅 시각 튜닝(design §7). 맵 탭 표현은 다음 세션 보류.
- 후속(dev): 섹션 드롭 노드 라벨을 `번호 제목`으로(제목 텍스트 기본 포함) — 내보내기 첫토큰 분할과 호환(번호만 앵커 링크).
- 후속(dev): **실물 진단** — 문서 제목 스타일(SBL_Text N_Kor/Eng)이 `outlineLvl` 감지 실패(level=0) + 제목 문단에 책갈피 없음(withBookmark=0). 그래서 현재 파서는 TOC 책갈피 달린 소수만 잡아 3단계+ 누락. → ① **스타일 이름 숫자로 레벨 감지**(levelFromStyleName, "SBLText3Kor"→3) ② **책갈피 없는 제목도 합성 앵커(`_bpmsec<n>`)로 노출**. 이제 전 레벨이 목록에 뜸(링크 성립은 다음: 출력 시 사본에 그 앵커명으로 책갈피 주입 = 완결 문서 생성). word-import 8/8.
- 후속(dev): 실물 눈검증 픽스 3종 — ① **빈 제목 문단(블랭크) 제외**(유령 항목·번호 오염) ② **TOC 제목 매칭**으로 책갈피 없는 1~2단계 제목이 권위 번호를 받아 언어별 카운터 리셋(번호 9→14 초과 해소) ③ **어펜딕스 무번호**. word-import 11/11. 다음: 완결 문서 생성(책갈피 주입+그래프 페이지).
- 후속(dev): **언어 필터** — 이중언어 SOP(영문/국문 두 트리)에서 스타일명 접미사(Kor/Eng)로 각 섹션에 `language`(ko/en) 태그(SectionEntry·SectionEntryIn), 섹션 패널에 All/KO/EN 토글(2개 이상일 때만). 영문 쪽 빈 제목은 이미 blank-skip으로 제거돼 국문 트리가 정확. word-import 12/12·백엔드 그린.
- 후속(dev): **완결 문서 생성기**(`word-doc-generator.ts`) — 원본 SOP 사본에 합성 앵커(`_bpmsecN`) 책갈피 주입(제목 걷기 `collectHeadings` 공유로 순번 동일 보장) + 순서도 새 페이지 append(마지막 sectPr 앞, 네임스페이스 보강·docPr/relId 충돌 재부여·rels 병합). opus 리뷰 READY(4대 불변식·리팩터 바이트동일 확인). vitest 541·tsc0·lint0·build 그린.
- 후속(dev): 완결문서 생성 **UI 배선** — 인스펙터 "Generate complete document" 버튼(원본 .docx 선택 → `generateCompleteWordDoc` → 다운로드, word맵 전용) + Word 내보내기와 export 모델 헬퍼 공유. 임시 진단 로그 제거. **미검증(수동)**: Windows Word에서 생성된 .docx 열어 도형 클릭 시 섹션 점프 실물 확인.
- 후속(dev): 내보내기 미세조정 3종 — ① **도형 정확히 1.5×3cm**(word맵은 `computeLayout` fit-to-page 끔=scale1, 상수도 1,080,000/540,000 EMU 정확값; 스프레드 시 페이지 초과 가능) ② **엣지가 도형 변 중점에 붙게** — 커넥터 `stCxn/endCxn`(미검증 프리셋 idx) 제거, off/ext(getSideAnchor)가 선 끝점 직결 ③ **도형 텍스트 8pt 통일**(FONT_HALF_PT 22→16). word-export 21/21·전체 그린. **실물 육안 튜닝 필요**.
- 후속(dev): 실물 임포트 픽스 — ① **섹션 필드 클램프**(파서가 title 500·anchor 200·number 50자로, 백엔드 SectionEntryIn 한도 초과 시 422 방지; 과도 title은 대개 오검지) ② **도형 텍스트 볼드 제거**(사용자 요청). word-import/export 42/42.
- 후속(dev): ① **캔버스 1페이지 경계**(word맵 전용, ViewportPortal flow좌표 점선 박스 ~565×894px = A4 가용−패딩) — 크기 감각·1페이지 안착 가이드 ② **엣지 커넥터 straightConnector1**(bentConnector3가 정렬 노드서 폭0 박스로 붕괴해 화살표가 노드에 안 붙던 문제 → 직선, 끝점이 변 중점에 확실). word-export 21/21.
- 후속(dev): 엣지 커넥터 재설계 — ① **stCxn/endCxn 복원**(도형에 실제 연결 → Word에서 노드 이동 시 선 따라옴; 이전 제거로 "화살표만 덩그러니" 남던 문제 해결) ② **cxn idx 정정** left0/top1/right2/bottom3(ECMA flowChartProcess cxnLst 순서; 기존 top0/left1/… 뒤바뀜) ③ **정렬이면 straightConnector1, 어긋나면 bentConnector3**(접점 정렬 여부로). word-export 22/22. **실물 검증 필요**(idx가 특정 프리셋서 다르면 매핑만 조정).
- 후속(dev): 한글 기본 폰트 바탕체 → **돋움**(word-export rFonts w:eastAsia).
- 후속(dev): **엣지 연결 변을 노드 상대 위치로 유도**(word맵) — 캔버스 핸들이 폴백(right/left)으로 어긋나 출력이 실제 연결과 안 맞던 문제(예: Start 위→아래인데 출력 right→left). 노드 중심 dx/dy로 위/아래·좌/우 변 결정 → 레이아웃 일치. 일반맵은 기존 핸들 유지.
- 후속(dev): 엣지 커넥터 — 여러 차례 실물 반복 끝에 **cxn 최우선**으로 확정: ① stCxn/endCxn 복원(도형 연결 → 노드 이동 시 선 따라옴) ② 변은 **노드 위치로 유도**(폴백 right/left 문제 해소 — 이전 "우측→아래"의 근본 원인이 폴백 변) ③ idx=SIDE_TO_CXN_IDX(left0/top1/right2/bottom3, flowChartProcess 기준) ④ 정렬=직선/어긋남=꺾은선. 잔여: 디시전/터미네이터 cxnLst 순서가 다르면 그 타입만 idx 조정 필요(실물 확인). word-export 22/22.

## 2026-07-20 — 문서 카테고리 폴더 재구성 + CLAUDE/rules 점검 + PROGRESS 아카이브 (main)
- **폴더 재구성(git mv, 이력 보존)**: docs/ 최상위 loose 문서를 카테고리 폴더로 이동 — `docs/deploy/`(deploy·db-seed·db-migration-9910) · `docs/qa/`(alarm-audit·ai-connectivity-test·ai-real-model-smoke) · `docs/design/`(구 `superpowers/specs` 25개 + version-lifecycle-summary). `spec.md`는 코드 15+곳이 참조해 루트 유지.
- **배포 문서 통합**: 과거 1차 `db-migration-9800` 삭제, `9910`을 `docs/deploy/`로. 내부 참조(9800·deploy.md 상대경로) 정리.
- **참조 전수 갱신**: 코드 주석 13파일(`docs/superpowers/specs/`→`docs/design/`, 서브에이전트)·문서/설정 ~20곳. stale 경로·broken 링크 0 검증. `docs/README.md`·`docs/design/README.md` 인덱스 갱신.
- **CLAUDE.md·rules 점검**: `page.tsx` 줄수 6700→9400 갱신(CLAUDE·frontend/AGENTS). `rules/common/documentation.md`에 docs 구조·유지관리 룰 추가(카테고리·설계 문서 경로 참조 불변식·PROGRESS 아카이브 관례).
- **PROGRESS 아카이브**: 전체 이력을 `docs/history/PROGRESS-archive.md`로 스냅샷 보존, 루트는 요약으로 축소.

## 2026-07-20 이전 (요약)
아래 항목들의 상세는 아카이브 참고 — 이번 세션(2026-07-20) 주요 작업:
- **홈/새맵 UX**: 빈 부서 숨김(내 부서 유지)·문서 상태 도넛 재디자인(호버 경계 잘림 방지)·최근맵 삽입 시 전체 밀림 애니·뒤로가기 선택해제·부서미지정 접기·오우닝 선택 시 승인자 피커 반짝·인스펙터 Subprocess 탭 맨끝 이동.
- **서브프로세스 노드 이름 라이브화**: 링크맵 개명이 참조 노드 라벨에 즉시 반영(`SubprocessRefOut.name` 추가, injectSubEnds/outline 라이브 렌더).
- **일괄편집 모달 폭**: 속성 3열 버튼 라벨 오버플로 해소(`w-96`→`w-[29rem]`).
- **완료 기능 문서 정리**: `docs/superpowers/plans/`·`DEV-SERVER-TEST-PLAN.md` 삭제(specs 유지).

> 2026-07-19 이하 및 위 항목의 커밋 단위 상세: [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md) · git history.
