# AI 컨설턴트 인터뷰 속도·타이밍 재설계 (2026-07-27)

GPU 실서버 검증 피드백 반영 — 정보는 빠르게 수집하고, 그리기는 명시적 이벤트로 응축하며, 느린 순간엔 진행 상태를 보이고, 채팅과 맵의 기준 시점을 항상 명확히 한다.

## 1. 문제 (실측)

- 턴 1회 = 순차 AI 호출 최대 4종(인터뷰어 → 재드래프트 → 선택지 병렬 → 톤 검수) — 느린 온프레미스 GPU에서 턴이 1~4분.
- 응답이 HTTP 한 방에 오는 동기 구조라 그동안 typing dots 외 진행 표시가 없음(그리는 중인지, 모달이 오는 중인지 불명).
- 맵 갱신 시점이 대화 흐름과 어긋나 "지금 맵이 어느 대화 기준인지" 매칭이 어려움.

## 2. 목표 / 비목표

**목표**: ① 일반 턴 = AI 1콜(빠른 Q&A) ② 그리기는 인터뷰당 2~3회의 명시적 이벤트로 응축 ③ 느린 이벤트는 진행 오버레이로 가시화 ④ "맵 = 마지막으로 수락한 안" 규칙으로 어긋남 구조적 제거 ⑤ 매 턴 즉시 반응(facts 아웃라인, AI 0콜).

**비목표**: 스트리밍 렌더링(후속 후보), 비동기 잡 큐(동기+오버레이로 충분), 스테이지 구조 변경(7단계·word 3단계 유지), 체크포인트/revert·KB 주입·기존 맵 시드 동작 변경.

## 3. 턴 파이프라인 경량화 (backend/app/interview/orchestrator.py)

- **일반 answer/skip/choice 턴 = 인터뷰어 1콜만.** 턴 내 `_redraft`(연속 재드래프트)·`_generate_choices`·`_tone_review` 호출 전부 제거.
- **톤 검수 폐지**: 명명 표준('명사+동사', '~하기' 금지)을 드래프터 계약 규칙으로 통합. `_tone_review`·`ToneReviewOut`·관련 노티스 삭제.
- **프롬프트 다이어트**: `_HISTORY_TAIL` 12→8. 드래프터의 [현재 작업본]은 전체 JSON 대신 컴팩트 목록(`키 | 타입 | 제목` 행)으로 전달.
- choice 턴: 선택 그래프를 작업본에 반영(기존 로직) + 인터뷰어 1콜로 다음 질문. **SP 제안 훅은 이 지점으로 이동**(작업본이 갱신된 유일한 시점 — 매 턴 훅 제거).
- 스테이지 완료 전이·체크포인트·미정 채움(skip)·반복 교정 재질의·언어 미러링은 유지.

## 4. 그리기 이벤트 — `POST /api/interviews/{id}/draw` (신규)

**트리거 3종** (프론트가 호출):
1. **자동(복수안)**: 턴 응답의 `draw_due=true` — 구조 스테이지(normal: activities·branches / word: draft, `stage.choice_stage`) 완료 전이가 발생한 턴.
2. **자동(단일 최종안)**: review 스테이지 진입 턴.
3. **수동(단일안)**: 캔버스 "Draw map" 버튼. 채팅 "그려줘"(InterviewerOut.redraw / needs_choices)도 `draw_due`로 신호만 주고 실제 호출은 프론트.

**요청**: `{"variants": "multi" | "single"}`. multi는 `CHOICE_VARIANT_HINTS`(가장 최근 완료된 choice 스테이지 기준 — 체크포인트에서 역산, 없으면 activities) 수만큼(설정 `interview_choice_count`) 병렬, single은 표준 힌트 1안.

**응답**: 생성된 안을 `pending_choices` 저장 + `choices` 메시지 append(기존 계약 그대로 → 프론트 ChoiceOverlay 재사용, 1안이면 큰 창 하나). 무변화·중복 필터(`_graph_signature`)·word/subprocess 사니타이저 기존 적용. 전부 걸러지면 204 성격의 노티스 메시지("현재 맵과 같은 안뿐입니다") append.

**수락**: 기존 choice 턴 그대로(작업본 반영 + 인터뷰어 1콜). **작업본은 오직 이 수락 시점에만 바뀐다.**

**대기 UX(동기)**: 프론트는 draw 호출 즉시 모달 자리에 스켈레톤 오버레이("Drawing proposals… 경과 N초") 표시, 채팅 입력 잠금. 실패 시 오버레이에 Retry.

## 5. 델타 드래프팅 (생성 자체 단축)

- 드래프터 계약: **최종 그래프의 노드 전체 목록을 출력하되, 기존 노드는 `{"key":"<키>"}`만 에코**(다른 필드 생략), 수정·신규 노드만 풀 스펙. 목록에서 빠진 키 = 삭제. → 출력 토큰이 변경분 수준으로 축소(생성 시간 ∝ 출력 길이).
- 스키마: `AiNode.title` 필수 해제(default ""). 서버 `_expand_delta(proposal, prev)`가 `model_dump(exclude_unset=True)` 기준으로 **미제공 필드를 이전 작업본(키 조인)에서 결정적 복원**. 키가 이전에 없고 제목도 없는 노드는 드롭. 결과 노드 0개면 실패(기존 안 유지, 오버레이 에러).
- 빈 캔버스 첫 생성은 자연스럽게 전 노드 풀 스펙(동일 계약).

## 6. 즉시 아웃라인 + 맵 기준 배지 (frontend, AI 0콜)

- **아웃라인 패널**(`interview-outline.tsx`, 캔버스 좌하단·접기 가능): 매 턴 facts에서 결정적 렌더 — 스테이지 순서대로 확정 항목 체크리스트(값 1줄 요약) + activities facts가 배열/열거형이면 `Start → A → B → …` 시퀀스 미리보기. 베스트 에포트(자유 문자열은 요약만).
- **맵 기준 배지**(액션바): "Map reflects the last accepted proposal — N turns ago"(수락 이후 라이브 사용자 턴 수). 수락 직후엔 "up to date".

## 7. 에러 처리

- draw 실패(TurnError/502): 작업본 불변, 오버레이에 에러+Retry. 인터뷰는 계속 가능.
- 델타 복원 실패(결과 0노드·참조 깨짐): 해당 안만 제외, 전멸이면 draw 실패 처리.
- `draw_due`는 상태 저장 없는 응답 플래그 — 프론트가 놓쳐도(새로고침) Draw map 버튼으로 복구.

## 8. 테스트

- 오케스트레이터: 일반/skip/choice 턴이 AI 1콜만 소비(스크립트 큐 길이 단언), 톤 검수 제거 회귀, choice 턴 SP 훅.
- draw 엔드포인트: multi/single 생성, 델타 복원(키 에코·필드 복원·삭제·신규), 무변화 필터 노티스, 실패 시 작업본 불변, `draw_due` 신호(구조 스테이지 완료·review 진입·redraw).
- `_expand_delta` 단위: exclude_unset 복원·무제목 신규 드롭.
- FE: 아웃라인 파생 vitest, pw 스모크(Draw 버튼→오버레이→모달→수락, draw_due 자동 호출).

## 9. 마이그레이션 노트

- DB 변경 없음(메시지 kind·pending_choices 기존 구조 재사용). InterviewStateOut에 `draw_due: bool` 추가(비영속).
- 제거되는 계약: 턴 내 자동 재드래프트·톤 노티스. 기존 세션도 새 파이프라인으로 자연 전환(상태 호환).
