# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷) + git history로 아카이브한다.

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
