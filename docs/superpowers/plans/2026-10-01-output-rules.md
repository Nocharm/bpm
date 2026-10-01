# 출력 규칙 통일 — 끝당 1개 · 병렬 출구 · SP 핸들 (feat/output-rules)

> 상태: P1~P7 구현 완료(2026-10-01, feat/output-rules). 사용자 결정은 아래 "결정"이 단일 출처. P5 시각 강조는 흐름 펄스로 확정(PROGRESS 참조).

## 목표

노드 연결 규칙을 일반 맵·L5 연계 캔버스에 같은 하나로 만든다 — "출구(출력 그룹)마다 엣지 1개, 병렬 출구는 2개 이상".
분기(decision)는 다중 출력이되 **하나만 따라간다**(택일)를 UI로 강조한다.

## 결정 (사용자 2026-10-01)

1. SP 들어오는 핸들(`in`·`in:*`)은 드래그 시작 불가. 평소 호버는 우측 끝 핸들만 보이고, 연결 드래그 중에만 네 변 in 핸들이 드러난다.
2. SP 노드 라벨 우측에 끝 개수 배지 — 끝 ≥2일 때만 `사용/전체`. 초과는 끝 1개여도 에러 틴트 `+N`.
3. 규칙 단위 = **출구별 1개**. 출구 키: 일반 노드 = `__primary__` 하나, SP = `endKeyOfEdge`(끝 키, 레거시 변 id는 대표 끝).
4. **병렬은 노드 속성, 출구별**: 신규 컬럼 `nodes.parallel_outputs`(JSON 리스트, 출구 키). 병렬 출구는 엣지 ≥2 필수, 비병렬 출구는 ≤1.
   decision은 이 규칙 밖(다중 출력 정상).
5. 레거시 도출: 출구의 엣지가 ≥2이고 전부 `gateway="parallel"`이면 병렬로 읽는다(마이그레이션 없음). 그 외 기존 위반은 게이트가 안내.
6. L5·L6 임포트는 병렬 팬아웃 출발 노드에 `parallel_outputs`를 켠다(엣지 gateway는 계속 기록).
7. 백엔드 확정 게이트 6 `plain_fanout`을 같은 출구별 판정으로 맞춘다.
8. 병렬/택일 시각 강조는 **시안 스크린샷 비교 후 결정**.

## 단계

### P1 — SP 핸들 (FE, 독립)
- `process-node.tsx` `SubprocessHandles`: in 핸들 `isConnectableStart={false}`, `useConnection(c => c.inProgress)`가 false면 숨김+`pointer-events:none`(노드 드래그 통과).
- verify: pw 스모크 — 좌/상/하 드래그 무반응, 우측 드래그 정상, 다른 노드에서 끌어와 SP 상단 in에 드롭 시 연결.

### P2 — 출력 규칙 순수 함수 + 저장/제출 게이트 (FE)
- `lib/output-rules.ts`(신규): `getOutputViolations(nodes, edges)` — 출구별 그룹, 병렬(속성 ∪ 레거시 도출) 판정, 위반 노드 id·초과 수.
- `save-checklist.tsx` `getMultiOutputNodeIds`/`getSaveCheckStates`가 위 함수를 쓰게(SP 면제 제거). 호출부 2곳(`saveCheckItems`·`getSaveBlockers`)에 `sourceHandle`·`gateway`·노드 `parallelOutputs` 전달.
- verify: vitest(일반·SP 다중 끝·병렬·레거시 gateway·decision 면제·레거시 변 id).

### P3 — 끝 개수 배지 (FE)
- SP 라벨 우측 배지: P2 함수의 출구별 집계 재사용. 초과 `+N` 에러 틴트.
- verify: 캡처(끝1·끝2 1/2·2/2·초과).

### P4 — `parallel_outputs` 컬럼 (BE+FE 표면)
노드 속성 추가 체크리스트(CLAUDE.md) 전부: `models.py` · `db.py _ADDED_COLUMNS`(`JSON`) · `schemas.NodeIn`/Out(+검증: 문자열·중복 제거) · `graph.py` upsert · `versions.py` clone_graph ·
`csv-import.ts`(NODE_DEFAULTS·mergeNode pick 보존) · AI 변환 2곳(보존만, AI가 쓰지 않음) · 비교/확정 시그니처 3곳 · `node-clipboard.ts` · `buildGraph`/`toAppNodes`.
- verify: pytest 왕복(PUT→GET·clone), vitest 왕복.

### P5 — 병렬 토글 UI + 시각 강조 (FE)
- 토글 위치: 노드 우클릭 메뉴 "Parallel output"(SP는 끝별 하위 항목). 새 엣지는 노드 속성으로 판정되므로 gateway 상속 불필요.
- 시각 강조 시안 2~3종 캡처 → **사용자 선택 후** 구현.

### P6 — 백엔드 게이트 6 + 임포트
- `subprocess.py` plain_fanout(단건·배치 2곳): 출구별 그룹(source_handle 정규화, FE `endKeyOfEdge` 동치) + 병렬 = 속성 ∪ 레거시 도출.
- 임포트: `import_consultant.py`(L5 all_parallel 그룹 → 출발 노드 parallel_outputs), `consultant_interview.py`(L6 parallel 팬아웃 출발 노드),
  `framework_interview/canvas.py`·`existing.py map_to_row`(역변환: 속성 → gateway 유지) — 0.5 계약 표면 테스트 동반.
- verify: pytest(게이트 6 출구별·병렬·레거시, 임포트 결과 노드 속성), 전체 스위트.

### P7 — 문서·마무리
- CLAUDE.md Lessons(출력 규칙 계약 한 줄), 매뉴얼 게이트 6 문구, PROGRESS, COMPONENTS.md 재생성, 전체 게이트(tsc·lint·vitest·pytest·ruff).

## 열린 점
- 끝이 사라진(링크맵 끝 삭제) 엣지의 출구 키는 그대로 별도 그룹으로 센다(고아 감사 트랙이 처리).
