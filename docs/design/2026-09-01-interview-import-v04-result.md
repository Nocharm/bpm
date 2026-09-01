# 인터뷰 JSON 0.4 임포트 — 최종 결과 · 확장 계획 · 한계

2026-09-01 작업 결과. dev `11288e80` → `63d2257c` (7커밋). **main 미머지.**

- 규칙·결정 근거: [2026-09-01-interview-import-v04-design.md](2026-09-01-interview-import-v04-design.md)
- 필드 전수 대조표: [`docs/qa/interview-import-field-map.md`](../qa/interview-import-field-map.md)

---

## 1. 무엇이 확정됐나

전달 스키마가 `0.3-bpm-interface-draft` → **`0.4-bpm-interface-draft`** 로 올라가며 흐름 그래프가
전달물에 처음 실렸다. 0.3에서는 `actions[].seq` 순서로 흐름을 추측할 수밖에 없어 분기·재수행·건너뜀이
전부 일직선으로 뭉개졌고, L6 사이 흐름은 전달물에 아예 없었다.

### 1.1 수용 계약

| 항목 | 확정 |
|---|---|
| 버전 게이트 | **0.4 전용**. 0.3은 file error로 거부 — 수용하면 흐름이 조용히 일직선이 되고 그 사실이 경고 한 줄에 묻힌다 |
| `actions[].seq` | relations의 참조키 → row 안에서 유일. **중복이면 file error**(0.3의 "중복 seq=병렬" 관례 폐기) |
| 저장소 샘플 | 6종 전부 0.4 (`consultant-interview-sample/` 2 + `framework-linkage-dummy/` 4) |

### 1.2 L7 흐름 (`rows[].relations` → 맵 그래프)

- 엣지 라벨 = `label` + 줄바꿈 + `condition` (엣지 라벨은 다중행 지원)
- **분기 판정은 엣지가 진실** — `kind="branch"`면 src 노드를 `decision`으로 승격.
  `actions[].kind`(action/handoff/decision)는 분기 노드를 알려주지 않는다.
  단 `gateway="parallel"`은 제외 — 병행 팬아웃을 마름모로 그리면 택일로 오독된다
- `loop`은 **Start 배선 판정에서만 제외**, End 판정에는 포함(보완→재작성처럼 loop이 유일 출구인 노드가 있다)
- `quote`가 있는 엣지는 `map_notes` kind=`flow`로 보존(`kind/gateway · condition` 부기) —
  Edge 테이블에는 `label`밖에 없다

### 1.3 L6 흐름 (최상위 `relations` → L5 연계 캔버스)

- 캔버스를 **생성 또는 보강**. 규약은 `open_linkage_map`과 동일 — **추가만, 삭제·이동 없음**.
  draft가 타인 체크아웃 중이면 통째 스킵
- **분기는 분기 노드를 새로 세운다** — src가 subprocess라 타입 승격이 불가능하다:
  `B → ◇(B 결과) → A | C`. 조건 라벨은 분기 노드 출구 엣지가 들고 간다
- 분기 출구는 **오른쪽 위 → 아래 → 옆** 순으로 벌리고 핸들(`s-top`/`s-bottom`/`s-right`)을 기하에 맞춘다
- `relations.entry`는 Start 노드가 **될 수 없다**(`validate_framework_canvas`가 캔버스에
  subprocess/decision/end만 허용) → 진입 L6를 배치 첫 자리로 + L5 스코프 노트로 보존
- **`annual_count`/`fte`의 유일한 착지면** — 캔버스 SP 노드. 종전엔 인바운드 연계가 없어 경고 후 버려졌다.
  빈 값이면 채우고, 값이 있으면 덮지 않고 경고(사용자 직접 편집 필드)

### 1.4 배치 (가로 자동정렬)

노드·엣지를 다 만든 **뒤** 배치를 최종화한다. 에디터 자동 정렬(`flow-layout.ts` `autoLayoutFlow`, LR)의
파이썬 동치본 `backend/scripts/consultant_layout.py`.

- dagre 대체: rank(Kahn 최장경로) + 배리센터 정렬. 이후 단계(`computeSpine`·`alignBackbone`·
  `pickHandleSide`·`isBackEdge`)는 TS 이식
- **랭크 간격은 그 구간을 지나는 엣지 라벨 폭에서 나온다.** 240 고정이던 시절엔 틈이 70px(240−노드 170)뿐이라
  160px 라벨이 양옆 노드를 덮었다(실측 17건 → 0건). 라벨 없는 구간은 240 유지
- **사이클은 배치 전에 걷어낸다.** 하나라도 남으면 Kahn 큐가 비어 전원이 leftover로 떨어지고 랭크가
  **노드 나열 순서**로 매겨진다 — 같은 그래프인데 전달 순서만 바뀌어도 배치가 뒤집힌다.
  제거 대상은 ①전달물의 `kind:"loop"`(확정) ②DFS가 찾은 잔여 back edge(보완, 진입 노드부터 탐색)

### 1.5 IO 자동 연결

- 매칭 단위는 **줄(항목)**, `strip()` 후 완전일치 — 대소문자·공백 정규화 없음(전달물 표기가 진실)
- **흐름 순방향만** — 역방향·무관 분기의 동명 항목을 잇지 않는다
- 원본 후보가 여럿이면 **최근접 상류**(홉 최소), 동률이면 `sort_order` 낮은 쪽
  ("한 항목 = 링크 1개" 불변식상 하나만 고를 수밖에 없다)
- 이미 링크가 있는 항목은 건드리지 않는다(재임포트가 사용자 편집을 덮지 않는다)
- 항목 id는 전달 좌표에서 파생한 **결정적 sha1** — uuid4면 재임포트마다 바뀌어 기존 미러가 끊긴다
- 범위는 **L6 맵 내부만**. L5 SP 노드 간은 미적용(SP IO는 영구 원본 규약)

### 1.6 게시본 위 편집용 draft

- 게시 직후 게시본을 복제한 draft 1건. **`checked_out_by`는 비워 둔다** — 실행자(sysadmin)로 잡으면
  실오너가 강탈 없이는 편집을 못 한다
- 손 안 댄 자동 draft는 재전달이 **새 버전으로 재사용**한다(구 draft가 게시본 사이에 쌓이는 것 방지).
  재사용 조건은 ①점유권자 없음 ②그래프가 직전 게시본과 완전 동일. 편집 흔적이 있으면 보존하고
  새 버전을 따로 게시

---

## 2. 검증 결과

| 게이트 | 결과 |
|---|---|
| BE pytest | **1249 passed** (이번 추가 ~40) |
| BE ruff | clean |
| FE vitest / tsc / lint | 812 passed / 0 / 0 |
| 어댑터 dry-run | 샘플 6종 전부 이슈 0 |
| 실 서버 apply | 경고 0(전달 데이터 기인 폴백 제외) |
| 엣지 라벨 간섭 실측 | `pw-measure-edge-label-overlap.mjs` — 17건 → **0건** |

### 시연 세트 `framework-linkage-dummy/change-control-l5.json` 임포트 실측

0.4 전 기능(분기·병행·루프·건너뛰기·IO 매칭)을 한 파일에 담은 세트.

```
L6 4맵 24노드 25엣지 · 분기 승격 4 · IO 자동 연결 21건 · 자동 draft 4건
L5 연계 캔버스 7노드(SP 4 + 분기 3) 9엣지 · L5 노트 8건
파라미터: duration 1.30 / 5 / 8 / 2.30, touch 0.40 / 3 / 6 / 1.30
```

- 병행(`gateway=parallel`) 팬아웃은 마름모 없이 두 갈래로 — 승격 제외가 의도대로 동작
- 같은 아웃풋 텍스트를 두 노드가 낼 때 최근접 상류(동률이면 낮은 seq)가 원본으로 선택됨
- rows를 역순으로 전달해도 캔버스가 흐름 순으로 배치됨(사이클 제거 검증)

---

## 3. 한계 (알고 남긴 것)

| 한계 | 내용 |
|---|---|
| **무변경 재임포트는 배치를 갱신하지 않는다** | 좌표·엣지 변은 `_graph_signature` 밖(레이아웃은 콘텐츠가 아니다) → `unchanged`로 끝난다. 기존 맵 재정렬은 전달 내용이 바뀌거나 에디터 "자동 정렬"로 |
| **캔버스 보강 시 배치·분기 미적용** | "추가만·이동 없음" 규약상 기존 노드를 못 옮긴다. 자동정렬·분기 팬아웃은 **캔버스를 새로 만들 때만** |
| **복귀 엣지가 정방향과 같은 통로를 지난다** | SP 노드는 핸들이 좌 `in`·우 `__primary__` 둘뿐 — L6 맵처럼 `top`으로 빼낼 수 없다. 분기 노드를 거치면 완화되지만 SP→SP 직접 복귀는 남는다 |
| **레이아웃 이중 구현** | `flow-layout.ts` ↔ `consultant_layout.py` 동치 계약. 한쪽만 고치면 첫 배치가 에디터 자동정렬과 어긋난다(`duration.ts`↔`duration.py` 선례) |
| **L5 gateway 값은 노트에만** | 캔버스에서 exclusive/parallel을 시각적으로 구분하지 않는다(분기 노드 유무로만 간접 표현) |
| **미소비 필드** | `summary`·`labelSource`·`_readme`·`tasks[]`의 evidence/revision/state/doc/seq — 담을 컬럼이 없다(의도적) |
| **분기 노드 제목** | `"{선행 L6 이름} 결과"` 자동 생성. 전달물에 분기 명칭 키가 생기면 그걸 우선하도록 교체 |

---

## 4. 확장 계획

우선순위 순. 전부 **미착수**.

1. **전달물 고유키 기반 IO 연결** (사용자 예고) — 현재는 텍스트 완전일치가 매칭 키다.
   전달물이 IO 항목에 고유키를 싣기 시작하면 매칭부만 교체한다(`link_matching_io`의 색인 구성만 변경).
   텍스트 일치는 폴백으로 남긴다.
2. **복귀/건너뛰기 엣지 시각 구분** — 겹침 자체는 SP 핸들 제약이라 못 없앤다. 선택지 셋:
   ⓐ 정방향 엣지도 장애물로 넣어 우회(에디터 전역 파급) ⓑ 캔버스 노드 지그재그 배치(일반 캔버스도 계단식)
   ⓒ 복귀/건너뛰기만 점선·다른 색(가장 가벼움, 겹침은 남음). **미결 — 사용자 선택 대기**
3. **기존 캔버스 재배치 경로** — 지금은 새로 만들 때만 정렬한다. "연계 캔버스 재정렬" 명시 액션
   (사용자가 누르는)으로 분리하면 "이동 없음" 규약을 깨지 않고 기존 캔버스에도 적용 가능.
4. **L5 SP 간 IO 연결** — SP IO는 영구 원본 규약이라 미러 쪽 취급을 새로 정해야 한다(설계 필요).
5. **대량 전달 경로** — 웹 임포트는 단일 요청이라 수백 파일 규모에서 한계 가능. 필요 시 인터뷰 CLI 신설
   (구 canonical CLI 부활이 아님).

---

## 5. 후속 점검 (해야 할 일)

- [ ] **실파일 0.4 전달본 dry-run 대조** — 최우선. unknown key 리포트가 그대로 어댑터 수정 목록이 된다.
      기준표는 `docs/qa/interview-import-field-map.md`
- [ ] **실 조직 경로로 부서 검증** — 샘플 부서 경로가 로컬 dev.db 조직 트리에 없어 `owning_department`가
      NULL로 남는다. 실 서버에서 실제 경로로 폴백/매칭 동작 확인
- [ ] **실오너·승인자 전달 시 거버넌스 예외 경로 실검증** — `consultant_owner_pending` 맵에 실오너가
      처음 올 때 오너·권한행·승인자가 갱신되는 경로
- [ ] **서버(9900) 배포 후 재확인** — FE/BE 동시 배포 필요. DB 스키마 변경은 없다(새 컬럼 없음)
- [ ] **에디터에서 임포트 결과 편집 왕복** — 자동 draft를 실제로 편집·저장했을 때 재전달이 보존하는지
      (단위 테스트는 있으나 실브라우저 미확인)
- [ ] **main 머지** — 머지 시 `rules/common/git.md`에 따라 PROGRESS 항목을 하나로 압축하고,
      이 문서와 설계 스냅샷의 폐기/흡수 여부를 판단(불변식은 `docs/qa/interview-import-field-map.md`와
      `docs/lessons/canvas-react-flow.md` §6에 이미 흡수돼 있다)

---

## 6. 이번에 기록한 교훈

- [`docs/lessons/canvas-react-flow.md`](../lessons/canvas-react-flow.md) **§6** — 서버가 만드는 엣지에
  핸들이 없으면 React Flow가 **조용히 버린다**(DB엔 행이 있는데 캔버스에만 선이 없다).
  판별은 `.react-flow__edge` count vs DB 엣지 수 대조
- `CLAUDE.md` — 레이아웃 이중 구현 계약(`flow-layout.ts` ↔ `consultant_layout.py`)
