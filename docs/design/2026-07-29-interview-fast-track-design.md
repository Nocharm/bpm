# AI 컨설턴트 패스트트랙 — 문서 첨부만으로 범위 확인 후 바로 그리기 (2026-07-29)

브랜치 `worktree-ai-consultant`(AI 독립 라인). 6단계 인터뷰를 거치지 않고, **첨부 문서 → 범위 제안
→ 확인 → 즉시 draw**로 압축하는 지름길. 새 세션 모드가 아니라 기존 부품(첨부 컨텍스트·skip의
'미정' 채움·체크포인트·draw multi·Apply 상시)의 오케스트레이션이다.

## 1. 배경·목표

- 문서(SOP·업무 매뉴얼 등)가 이미 있는 사용자는 6단계 문답이 과하다 — "파일 주고 바로 받아보고
  다듬기"가 자연스러운 경로.
- 목표: 첨부 → **AI 1콜(범위 제안)** → 클릭 1번 → **AI 0콜(fast-forward)** → draw(기존 multi)
  → 카드 수락 → Apply. 프롬프트 순종성에 의존하는 단계 생략은 금지(코드베이스 교훈) —
  전진은 서버가 결정적으로 수행한다.
- 부수 목표(전역): 인터뷰어 어체 개선 — 과한 정중함·인사치레 제거, 간결한 문장.

## 2. 사용자 흐름

1. consult 진입 → 첫 인사말 quick reply에 **"문서로 바로 그리기"** 추가(신규 맵·기존맵 인지형
   인사 공통, word 모드 제외).
2. 클릭 → FE가 파일 선택창 오픈 + **패스트트랙 상태 arm**(FE 로컬 state — DB 컬럼 없음).
   파일 선택 취소 시 armed 잔류 — 취소 감지가 불안정해 단순화. 자유 발화 시 해제되고,
   잔류 중 첨부하면 범위 제안이 이어져 무해.
3. 업로드 성공(파싱은 업로드 요청에서 동기 완료) → FE가 자동으로 **범위 제안 턴** 전송.
   인터뷰어는 첨부 본문을 이미 컨텍스트로 받으므로 백그라운드 추출을 기다리지 않는다
   (추출 facts는 도착하는 대로 기존 딥머지로 합류).
4. 인터뷰어가 범위(프로세스명·목적·경계) 제안 + 보기
   ["이대로 그리기", "수정할래요", "일반 인터뷰로 진행"].
5. **"이대로 그리기"는 FE가 인터셉트** — AI 턴 대신 `POST /interviews/{id}/fast-forward` 호출.
   나머지 두 보기는 일반 answer 턴:
   - "수정할래요" → 수정 의견 입력 → 인터뷰어가 범위만 재제안(패스트트랙 유지, 보기 재노출).
   - "일반 인터뷰로 진행" → FE disarm, 6단계 문답 합류.
6. fast-forward 응답의 `draw_due="multi"` → FE 자동 draw → 기존 복수안 모달(표준/세밀/간결 —
   activities 체크포인트가 힌트 세트를 결정) → 수락 → Apply & finish(기존 상시 노출).

새로고침 시 FE arm 상태는 소실 → 일반 인터뷰로 자연 폴백(수집 facts는 서버에 있어 손실 없음).

## 3. 컴포넌트별 변경

### 백엔드

- **`routers/interviews.py`**
  - 인사말: `_GREETING`/`_EXISTING_GREETING`의 payload options에 패스트트랙 보기 추가
    (`_FAST_TRACK_OPTION` ko/en — normal 모드만).
  - **신규 `POST /interviews/{interview_id}/fast-forward`** (`_locked_by_interview` 적용):
    - 가드: status active 아님 409 · word 모드 400 · 이미 review면 400.
    - 동작(AI 0콜): 현재 스테이지부터 review 직전까지 각 스테이지의 미확정 required_facts를
      `_UNKNOWN_VALUE`("미정"/"TBD")로 채우고 스테이지별 체크포인트 생성(skip 턴과 동일 시맨틱,
      단 인터뷰어 후속 콜 없음) → `current_stage="review"` → 사용자 메시지
      (kind="fast_forward", 고정 문구 "이대로 그려주세요.") 1건 + 컨설턴트 노티스
      ("문서 기준으로 바로 그립니다…") 1건 append → `InterviewStateOut.draw_due="multi"` 반환.
    - `pending_choices` 초기화, `updated_at` bump. 계측 이벤트 없음 — apply-params와 동일한
      AI 0콜 관례.
- **`interview/agents.py`**
  - 인터뷰어 계약에 어체 룰(전역): "문장은 짧게, 인사치레·사족·과한 격식('~해 주시면
    감사하겠습니다'류) 금지 — 정중하되 담백하게."
  - 범위 제안 턴의 user_input은 FE가 보내는 **자연어 고정 문장**(채팅에 사용자 메시지로 표시됨):
    "이 문서로 프로세스 맵을 그리고 싶어요. 이름·목적·범위를 먼저 제안해 주세요." + 계약에
    패스트트랙 보조 룰 1개: 이런 요청엔 범위 제안과 함께 보기
    ['이대로 그리기', '수정할래요', '일반 인터뷰로 진행']을 줄 것. 계약 수정 외 신규 메커니즘 없음.
  - **인터셉트 판정은 FE 문구 매칭**(FE 상수가 단일 소스): arm 상태에서 사용자가 클릭한
    quick reply 텍스트가 '이대로 그리기' 상수와 일치하면 fast-forward 호출. 인터뷰어가 다른
    문구의 보기를 내면 클릭은 일반 턴으로 흘러간다 — 최악이 "일반 인터뷰 합류"라 무해.
- **`interview/orchestrator.py`** — `_recent_choice_stage`: 마지막 live 사용자 메시지가
  `kind="fast_forward"`면 "activities" 반환 — fast-forward가 만든 체크포인트 순서상 branches
  힌트(분기 변형)가 잡히는데, 문서 기반 첫 draw의 결정 축은 세분도(표준/세밀/간결)여야 한다.
- **`interview/engine.py`** — 변경 없음(required_facts·`_UNKNOWN_VALUE` 재사용).

### 프론트

- **`consult/page.tsx`**
  - `fastTrack` 상태머신: `"idle" | "armed" | "awaiting-scope"`.
    - greeting 보기 "문서로 바로 그리기" 클릭 인터셉트 → 파일 선택창(기존 첨부 플로우) → arm.
    - 업로드 성공 && armed → 범위 제안 턴 자동 전송 → awaiting-scope.
    - awaiting-scope에서 quick reply 클릭 인터셉트: "이대로 그리기" → `fastForwardInterview()`
      호출 → 응답 draw_due로 자동 draw / "일반 인터뷰로 진행" → idle + 일반 턴.
  - `lib/api.ts`: `fastForwardInterview(id)` 추가.
- **문구 상수**: `lib/interview.ts`에 패스트트랙 보기 문구(ko/en) 상수 — 인터셉트 판정과
  전송 문구의 단일 소스.

### 어체(전역)

- 인터뷰어 계약 스타일 룰 1개 추가로 처리 — 별도 사니타이저 없음(표시 품질 문제라 톤 린트
  (T19)와 달리 강제 장치 불요, 실사용에서 부족하면 후속).

## 4. 엣지·에러

- 패스트트랙 중 draw 실패 → 기존 오버레이 Retry/Cancel 그대로.
- 전멸 필터(동일안뿐) → 기존 노티스 경로 — review 스테이지라 사용자는 대화로 다듬거나
  Draw map 재시도.
- 첨부 파싱 실패 → 기존 실패 노티스, FE는 arm 유지(다른 파일 재첨부 허용).
- fast-forward 후 "수정하고 싶다" → review 스테이지의 일반 대화 + redraw(기존 동작).
- 기존 콘텐츠 있는 맵에서 패스트트랙 → 드래프터 규칙 5(기존 작업본 보존)가 그대로 적용.

## 5. 테스트

- BE: fast-forward 전이(미정 채움·스테이지별 체크포인트·review 도달·draw_due="multi") ·
  word 모드 400 · review에서 400 · 비활성 세션 409 · 인사말 보기 포함 · 어체 룰 프롬프트 존재 ·
  fast_forward 직후 draw 힌트가 activities 세트인지.
- FE: 스모크에 패스트트랙 시나리오(보기 클릭 → 파일 주입 → 범위 제안 목 → 이대로 그리기 →
  fast-forward 목 → draw 모달) 추가. vitest는 문구 상수·상태머신 파생 로직 있으면 최소.

## 6. 비스코프

- 세션 모드 신설(FAST_STAGES) — 기각(접점 과다).
- 프롬프트 지시만으로 단계 생략 — 기각(순종성).
- word 맵 패스트트랙 — word는 이미 문서 기반 3단계라 대상 아님.
