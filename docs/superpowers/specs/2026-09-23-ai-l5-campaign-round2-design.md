# AI L5 캠페인 2라운드 + 비교·L5 캔버스 보정 — 설계

> 상태: 설계 확정(2026-09-23). 구현 플랜은 `docs/superpowers/plans/2026-09-23-ai-l5-campaign-round2.md`.
> 선행 스펙: `2026-09-21-ai-consultant-l5-campaign-design.md`(캠페인 1라운드), `2026-09-22-fw-admin-detail-panel-existing-l5-design.md`.

## 0. 범위와 결정

사용자 요청 17건을 4묶음으로 분해한다. 각 묶음은 dev 머지 단위(스프린트)다.

| 묶음 | 항목 | 성격 |
|---|---|---|
| ① 비교·L5 캔버스 | C1 인스펙터 폭 · C2 변경 톤 토큰 · C3 초기 base/target 중복 · D1 L5 드롭존 가시성 | FE만 |
| ② 관리 패널 진입 | A1 레벨별 타일 액션 · A2 임포트 섹션 분리+프롬프트 복사 토스트 | FE + BE 409 1건 |
| ③ 캠페인 UX | B3 마름모 · B6 카드 투명화 · B7 카드 FLIP+좌측 활용 · B10 주관식 AI 제안 · B11 AI 버튼 쉬머 | FE만 |
| ④ 캠페인 엔진 | B8 IO 배열+링크 · B12 질문 지시·섹션 · B13 러너 병렬 · B4 자동 제안+코멘트 · B5 연결 캔버스 · B9 보드 전 행 클릭+피드백 채팅 | BE 계약·러너·컬럼 + FE |

사용자 결정(대화 2026-09-23):
- B5 편집 캔버스는 **에디터 부품 재활용(ReactFlow + ProcessNode) 경량 인스턴스** — 실제 에디터 임베드 아님. compare 페이지가 선례.
- B8 IO 연결은 **L6 안(같은 맵의 action 간)만**. L6 사이 연결은 다음 라운드.
- B12는 **프롬프트 지시 강화 + 섹션 그룹화**. 새 답 형식(kind) 추가 없음.
- 가정 승인: A1 세션 배지 = 서브트리 롤업 · B13 동시성 상한 = 프로세스 전체 · B7 planning 단계 좌측 보드에 brief+첨부.

## 1. 묶음 ① 비교·L5 캔버스 (FE)

### C1 인스펙터 폭 조절
- `compare/page.tsx`의 `compare-inspector` `w-72` 고정을 상태 폭으로. 디바이더는 캠페인 페이지 `handleDividerDown` 패턴(pointer 이벤트, `localStorage` `bpm.compareInspectorWidth`).
- 범위 240~520px, 기본 288(=w-72). `role=separator` + `aria-orientation=vertical`.

### C2 변경 하이라이트 톤 분리
- 문제: `--color-changed #9a6b00`(앰버)가 decision 기본 stroke `#c7a062`(앰버)와 겹친다.
- `globals.css`에 **`--color-diff-changed`** 신설(틸 `#0f766e`, `added` 초록·`removed` 주홍과 3색 구분 유지). Tailwind 토큰 `diff-changed`.
- compare 페이지의 변경 노드 ring · 엣지 stroke · 레전드 칩 · 변경 필드 pill만 교체. 리포트·거버넌스의 경고 톤(`text-changed`)은 의미가 다르므로 그대로.

### C3 초기 base/target 중복
- 현재: base=마지막 게시본(framework는 confirmed), target=마지막 버전 → 게시본이 곧 최신이면 둘이 같다.
- 수정: target 후보 = base를 제외한 버전 중 최신, 없으면(버전 1개) base 그대로. 딥링크 `?base=&target=`는 우선.

### D1 L5 드롭존 가시성
- 드롭존 부채꼴(`page.tsx` `zone-fan`)이 `--color-ink-tertiary` 4~36% 알파라 `.bpm-l5-sky` 위에서 안 보인다.
- 프레임워크 모드(`isFrameworkCanvas`)면 fill/stroke 기반색을 `--color-canvas`(밝음)로 분기: 기본 fill 10%/stroke 45%, 활성 존은 `--color-accent-sky`.

## 2. 묶음 ② 관리 패널 진입

### A1 레벨별 타일 액션 (`components/admin/fw-level-actions.tsx` 신설)
`framework-panel.tsx`의 `framework-admin-ai` 블록을 대체한다. props: `selectedNode`, `children: CategoryNode[]`, `sessions: FwInterviewSession[]`, `busy`, `onPick(id)`, `onCreateL5(name)`, `onStart(l5Id)`, `onResume(sessionId)`.

| 선택 레벨 | 렌더 |
|---|---|
| 없음 | 안내 문구(기존 `framework.adminDetailEmpty`) |
| L1~L3 | 하위 노드를 **2열 타일**(`LEVEL_ICONS` 아이콘 + 이름 + 세션 배지). 클릭 = `onPick` → 패널이 `setSelectedId`+`setOpenIds` 추가로 좌측 트리와 싱크. 컨테이너 `max-h-[176px] overflow-hidden`(타일 2행 반), 넘치면 하단 페이드 + "+N more" 텍스트 |
| L4 | "새 L5 만들기" 타일 1개 → `PromptDialog`(이름). 형제(`children`) 이름과 trim 비교해 중복이면 다이얼로그 인라인 에러, 확인 비활성 |
| L5 | 진행 중 세션 있으면 "이어서 작업"(세션 progress 표시), 없으면 "AI로 작업" |

- 세션 배지: `listFrameworkInterviews` 응답에 `category_path_ids: number[]` 추가(BE, 조상 id 체인). 타일 id가 path에 포함되는 세션 수를 클라이언트가 집계.
- 타일 톤: 기본 `bg-surface` 테두리, AI 액션 타일(새 L5·AI로 작업)은 B11 `AiButton` 스타일.
- BE: `create_category` — 같은 `parent_id` 아래 같은 `name`(trim, 대소문자 구분) 존재 시 409 `name already exists under parent`. 테스트 `test_categories.py`.

### A2 임포트 섹션 분리
- 상세 패널 하단에 독립 카드 `interview-import-section`: 제목 "Interview JSON" + 한 행 `[파일 선택(outline)] [외부 AI 프롬프트 복사(accent tint)]`.
- `InterviewJsonPromptButton`에 `onCopied?: () => void` prop 추가 → 패널이 `onToast(t("fwConsult.promptCopiedToast"))`. 버튼 라벨 tri-state는 유지.

## 3. 묶음 ③ 캠페인 UX (FE)

### B3 분기 노드 마름모
- `scope-preview.tsx`: `normalizeNodeType === "decision"`이면 `<polygon>`(박스 `w×h` 내접 마름모, 꼭짓점 4개), 나머지는 기존 `rect`. 라벨 위치 동일.
- 영향: 피크·요약 모달·임포트 리포트·캠페인 미리보기 전부. 실캔버스와 일치하므로 회귀 아님. `COMPONENTS.md` 사용처 4곳 스모크.

### B6·B7 플랜 카드
- 카드 기본: 테두리 투명(`border-transparent`), 인풋 배경 투명·테두리 없음(값만 텍스트처럼). `hover:` 카드 테두리 hairline. `focus-within:` 현재 편집 모양(인풋 테두리·`bg-surface-pearl`).
- 순서 이동/삭제/추가 FLIP: `usePlanCardMotion()` 훅 — `useLayoutEffect`에서 이전 렌더의 카드 rect를 `Map<key,DOMRect>`로 기록, 다음 렌더에서 `transform: translateY(prev-now)` → 0 으로 350ms `ease-smooth`. 삭제는 높이 0 접힘(`grid-rows-[0fr]` 전환), 추가는 하단 슬라이드인. `prefers-reduced-motion` 즉시.
- 카드 key는 index 대신 안정 id(`clientId: genId()`) — FLIP 추적에 필수. `FwPlanCard`에 FE 전용 `clientId`(전송 시 제거).
- 좌측 활용: `page.tsx`에서 `step === "plan"`일 때 `<aside>`에 `PlanBriefPanel`(brief + 첨부, plan-editor에서 분리)을 넣고 `PlanEditor`는 카드 전폭. 잠금 후엔 `TaskBoard`.

### B10 주관식 입력
- 기본 빈 textarea(플레이스홀더 없음). 문항 옆 `AiButton` 소형 "AI 제안" → 이미 받은 `suggested`를 25ms/char(최대 1.2s 캡) 타이핑 애니로 채움. reduced-motion이면 즉시.
- blur 시 확정 표시(테두리 제거, 텍스트만). 카드 hover 시 연필 아이콘 → 클릭하면 다시 편집.
- 제출 규칙 불변: 빈칸이면 서버가 제안값 적용(`validateAnswers` 무변경).

### B11 AI 버튼 (`components/ai-button.tsx` 신설)
- `variant: "primary" | "tile" | "inline"`. 배경 `linear-gradient(135deg, var(--color-accent), var(--color-accent-focus))`, 텍스트 `text-on-accent`, `Sparkles` 아이콘 기본.
- hover 시 `::after` 쉬머 4s `ease-in-out infinite`(`strip-shimmer` keyframe 재활용, 폭 40%). reduced-motion이면 쉬머 없음. 눌림은 전역 base.
- 적용처: 플랜 생성/재생성 · 제안 채우기 · AI 제안(B10) · 관계 제안/다시 제안 · 피드백 보내기 · A1 AI 타일 · 프롬프트 복사(inline).
- `COMPONENTS.md` 재생성.

## 4. 묶음 ④ 캠페인 엔진

### 4.1 데이터 모델
- `FrameworkInterviewSession.canvas: JSON | null` — 연결 단계의 편집 캔버스. `_ADDED_COLUMNS` 등록.
  ```
  { nodes: [{ id, node_type: "subprocess"|"decision"|"start"|"end", title, task_id?: string, pos_x, pos_y }],
    edges: [{ id, source_node_id, target_node_id, label }] }
  ```
  subprocess 노드는 `task_id`로 L6 카드와 묶인다. start/end는 표시용(저장하되 역산에서 무시).
- `FrameworkInterviewSession.feedback_log: JSON` — `[{ scope, task_pk?, message, at }]` 최근 10건.
- `relations`는 유지 — 등록(0.5 조립)의 진실. canvas는 편집 진실이고 확정 시 relations로 역산한다.

### 4.2 canvas ↔ relations (`backend/app/framework_interview/canvas.py` 신설)
- `expand_relations_to_canvas(relations, tasks) -> canvas`: 기존 `expand_linkage_branches` 규칙(팬아웃≥2이고 전부 parallel이 아니면 분기 노드 삽입)과 동일 + `consultant_layout` LR 배치. 분기 규칙의 진실은 `scripts/import_consultant.expand_linkage_branches`(파이썬 동치본)이고, FE 미리보기와는 start/end 보강 규칙만 같다.
- `collapse_canvas_to_relations(canvas) -> relations`: 분기 노드 D에 대해 들어오는 X마다 D의 나가는 엣지(D→Y, 라벨 L)를 `X→Y kind=branch gateway=exclusive condition=L`로. 분기 노드가 연쇄(D1→D2)면 D2를 D1의 각 진입에 대해 재귀 전개. subprocess→subprocess 직접 엣지는 `seq`, dst.seq < src.seq면 `loop`. entry = start에서 나가는 첫 subprocess(없으면 seq 1). 왕복 `collapse(expand(r)) == r`을 테스트로 고정(분기 노드 이름은 손실 허용).
- 확정 `PUT /relations`는 body를 `{relations} | {canvas}` 둘 다 받고, canvas면 서버가 collapse 후 저장. FE는 항상 canvas를 보낸다.

### 4.3 엔드포인트
| 메서드 | 경로 | 변경 |
|---|---|---|
| POST | `/framework-interviews/{id}/relations` | body `{comment?: string}` 추가. AI 결과 relations → canvas도 expand해 저장. comment가 있으면 프롬프트에 `[직전 제안]` + `[사용자 피드백]` 블록 |
| PUT | `/framework-interviews/{id}/canvas` | 편집 저장(검증: task_id 전부 세션 카드, 노드 id 유일). relations는 건드리지 않음 |
| PUT | `/framework-interviews/{id}/relations` | `{canvas}` 수용 → collapse |
| POST | `/framework-interviews/{id}/feedback` | `{scope:"relations", message}` → 현재 canvas+message로 `CanvasOut` 요청, 결과 canvas 저장·응답. `{scope:"task", task_pk, message}` → 현재 row+message로 `RowOut` 재요청, 검증 후 그 자리에서 task의 row/issues/drawn_at을 갱신(상태는 `drawn` 유지, 검증 오류면 422, 세션이 `ready`였으면 `linking`으로 되돌림). 둘 다 `feedback_log` append |
| GET | `/framework-interviews?active=true` | `category_path_ids` 추가 |

- 프롬프트 계약 추가(`contracts.py`): `CANVAS_FEEDBACK_CONTRACT`(입력: 노드 목록·엣지 목록·피드백 / 출력: 같은 형식 canvas JSON, 노드 id 보존·task_id 변경 금지), `ROW_FEEDBACK_CONTRACT`(입력: row+피드백 / 출력: RowOut). 둘 다 `ai_prompts` 오버라이드 키 등록.

### 4.4 B8 IO 배열 + L6 내부 링크
- `RowAction.input/output: list[str] | str | None`. `normalize_row`에서 str이면 `,`·`/`·`·`·개행으로 분해·trim·빈 값 제거 → 항상 list. 프롬프트 예시 `"input":[],"output":[]` + 규칙 "앞 활동의 output 항목을 다음 활동 input에 같은 표기로 다시 쓴다".
- 어댑터(`scripts/consultant_interview.py`): `_join_multi`는 그대로(list→개행). 링크 생성 추가 — row 안에서 action N의 output[i] 문자열이 action M(M>N, seq 엣지로 도달 가능)의 input[j]와 같으면 `output_ids[i]=genId`, M의 `input_links[j]=그 id`(io-items 개행 인덱스 계약). 첫 일치만 연결.
- 역변환 `existing.py map_to_row`: 링크는 무시, 문자열 배열만 복원. `test_framework_interview_existing.py` 라운드트립 갱신. 4표면(어댑터·조립기·외부 프롬프트·역변환)의 `input/output` 배열 표기를 동시에 옮기고 `docs/samples/interview-json-0.5.md` 갱신.

### 4.5 B12 질문 지시·섹션
- `Question.section: Literal["basic","activities","exceptions","io"] = "basic"`. 정규화에서 미지 값은 basic.
- 프롬프트: 종류 선택 기준(배타 선택=single, 복수 해당=multi, 예/아니오=single 2옵션, 자유 서술=text), 섹션 배정 규칙, 문항 수 가이드(basic 2~3 · activities 1(ordered) · exceptions 1~2 · io 1~2).
- FE 폼: 섹션 헤더로 그룹(빈 섹션은 생략), 순서 basic→activities→exceptions→io. `AnswerReview`도 같은 순서.

### 4.6 B13 러너 병렬
- Settings `fw_consult_concurrency: int = 3`(`.env.example`+compose `environment:` 매핑). 전역 `asyncio.Semaphore`.
- `process_session`: 매 바퀴 `collect_runnable(session) -> list[Job]`(submitted 전부 → 드로잉, pending 전부 → 설문 생성; 우선순위 드로잉 먼저). 세마포어 안에서 `asyncio.gather`. 일시정지·비활성·AI 꺼짐 체크는 잡 시작 직전에 재확인.
- 상태 전이·복구(`recover_stale_tasks`)·`kick`/`_wake` 로직 불변. `PREFETCH_READY` 폐기(BE·FE 둘 다). FE `hasBackgroundWork` = pending/generating/submitted/drawing 중 하나라도 있으면 true.
- 테스트: 동시 3개까지만 AI 호출이 겹치는지(fake `ask_schema`에 게이트), 일시정지 시 진행 중 잡은 완료·새 잡은 시작 안 함.

### 4.7 B4·B5 연결 단계 화면 (`relations-step.tsx` 재작성 + `relations-canvas.tsx` 신설)
- 진입: `session.relations === null`이면 즉시 `POST /relations` 1회. 캔버스 자리에 오버레이 링("AI가 흐름을 제안하는 중") — `Promise.all([call, delay(1500)])`로 최소 1.5s.
- 헤더: "다시 제안" `AiButton` + 코멘트 input(있으면 `comment`로 전송) · "확정".
- **캔버스** `RelationsCanvas`: `ReactFlow` + `nodeTypes={process: ProcessNode}`(compare 선례). subprocess 노드는 `data.linkedMapId` 없이 라벨만(ProcessNode subprocess 렌더 경로 재사용). `nodesConnectable`·`onConnect`(엣지 추가, 라벨 빈값)·`onEdgesDelete`·`onNodeDragStop`(pos 저장). 엣지 클릭 → 라벨 팝오버(분기 노드에서 나가는 엣지만 조건 입력). 노드 우클릭 `ContextMenu`: "피드백에 언급"(채팅 입력에 `@이름` 삽입) · "taskId 복사" · "뒤에 분기 추가"(decision 노드 삽입, 기존 out 엣지를 분기로 이관) · "삭제"(분기 노드만). 툴바: 자동 정렬(`autoLayoutFlow` LR) · 되돌리기 1단계 · 맞춤. 변경은 300ms 디바운스로 `PUT /canvas`.
- 우측 패널(폭 320~560 드래그, `bpm.fwRelationsPanelWidth`): 상단 L6 카드 목록(기존 미리보기·정정 버튼 유지), 하단 **피드백 채팅**(`FeedbackChat` 공용, scope=relations) — 입력+보내기(`AiButton`), 최근 10턴 표시, 전송 중 캔버스에 링 오버레이.
- 확정: `PUT /relations {canvas}` → 등록 단계.

### 4.8 B9 보드 전 행 클릭 (`task-panel.tsx` 신설, `AnswerStep` 흡수)
| 상태 | 우측 패널 |
|---|---|
| pending/generating | 준비 중 링 + "설문을 만드는 중" |
| ready | 설문(현재 AnswerStep) |
| submitted/drawing | `AnswerReview`(제출 답, 읽기전용) + 하단 드로잉 링 |
| drawn | `AnswerReview` + `ImportMapPreview`(scope=map) + `FeedbackChat`(scope=task) |
| failed | 에러 + 재시도/건너뛰기 |
- 보드 `<li>`는 전 상태 `role=button`. `selectedTaskId`는 어떤 상태든 유지; `deriveStep`은 선택이 없을 때만 자동 진행.
- task 피드백 전송 후 행이 즉시 갱신되고(상태는 drawn 유지) 패널의 미리보기가 새 행을 보여준다.

## 5. i18n · 문서 · 카탈로그
- 신규 문구는 ko/en 동시(`i18n-messages`), 긴 대시 금지.
- `frontend/COMPONENTS.md` 재생성(신설: fw-level-actions · ai-button · relations-canvas · task-panel · feedback-chat · plan-brief-panel).
- 매뉴얼(관리자 "AI로 L5 채우기") 갱신은 ④ 완료 시.
- 인터뷰 JSON 0.5 4표면 계약 변경(B8)은 CLAUDE.md Lessons 항목에 "input/output 배열" 한 줄 추가.

## 6. 검증
- BE: `pytest` — 409 이름 중복 · canvas expand/collapse 왕복 · IO 링크 생성 · feedback 두 scope · 러너 세마포어 · 질문 section 정규화.
- FE: `vitest` — collapse 대칭 FE 미러 없음(서버 단일) · `buildL5PreviewGraph`↔서버 expand 형태 동치는 fixture로 · FLIP 훅 순수 계산 · section 그룹화.
- Playwright: `pw-fw-level-actions.mjs`(타일 드릴·새 L5 중복 차단) · `pw-fw-relations-canvas.mjs`(자동 제안 링→캔버스 연결→확정) · `pw-fw-task-panel.mjs`(전 행 클릭) · `pw-compare-inspector.mjs`(폭 드래그·초기 base≠target).
- 각 스프린트 종료 시 스크린샷 공유.
