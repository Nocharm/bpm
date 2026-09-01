# 인터뷰 결과 JSON 0.4 임포트 — 설계

2026-09-01 브레인스토밍 확정본. 전달 스키마가 `0.3-bpm-interface-draft` → `0.4-bpm-interface-draft`로
올라가며 **흐름 그래프(relations)가 전달물에 처음 실린다**. `2026-08-18-interview-import-design.md`가
"협의 확장 포인트"로 남겨둔 앵커(분기 시작/합류) 키가 바로 이것이다 — 그 문서의 §3 매핑을 이 문서가 개정한다.

## 0. 0.4 델타

| 변경 | 내용 |
|---|---|
| **최상위 `relations`** | L6(=rows) 사이 흐름 그래프. `entry{taskId,triggerType,label,quote}` + `edges[]`(src/dst=`rows[].taskId`) |
| **`rows[].relations`** | 그 L6 내부 L7(=actions) 흐름 그래프. `edges[]`(src/dst=`actions[].seq`) |
| **`edge.kind` 4종** | `seq`(순차) · `branch`(조건분기) · `loop`(재수행) · `bypass`(건너뜀) |
| **`edge.gateway`** | branch에만: `exclusive`(택일) / `parallel`(병행) |
| **`edge.condition`·`quote`** | 분기 조건 문장 + 근거 발화 원문 |
| `labelSource` | `human-confirmed`(확정 표 검수본) |
| 수치 병기 필드 | `total_time_min`·`touch_time_min`·`annual_count`·`headcount`·`fte`가 **JSON 숫자로 채워짐** |
| 거버넌스 필드 | `owner`·`approvers`·`department`가 실값으로 채워짐 |
| `summary` | `l6_edge_total`·`l7_edge_total` 추가 |

**seq는 참조키가 됐다** — `rows[].relations.edges[].src/dst`가 `actions[].seq`를 가리키므로 row 안에서
유일해야 한다. 0.3의 "중복 seq = 병렬 분기/합류" 관례는 폐기된다.

## 1. 버전 게이트 — 0.4 전용

`schema_version`이 `0.4`로 시작하지 않으면 **file error**(파일 통째 스킵). 0.3 하위호환은 두지 않는다
(사용자 결정 2026-09-01) — 0.3 파일은 흐름 정보가 없어 수용해도 조용히 일직선 맵이 되고, 그 사실이
경고 한 줄에 묻힌다. 저장소 샘플 5종은 전부 0.4로 변환한다(기존 seq 체인을 `kind:"seq"` 엣지로 명시화).

## 2. L7 흐름 — `rows[].relations.edges` → 맵 그래프

| 입력 | 처리 |
|---|---|
| `src`/`dst`(seq 정수) | 노드코드 `a{seq:02d}`로 해석. **중복 seq = file error**(참조 대상 모호). 미존재 seq 참조 = warning + 그 엣지만 드롭 |
| `label` + `condition` | `Edge.label`에 줄바꿈으로 합쳐 적재(엣지 라벨은 Alt/Shift+Enter 다중행 지원). 200자 초과 시 절단+경고 |
| `kind: "branch"` | **src 노드를 `decision`으로 승격.** `actions[].kind`(action/handoff/decision)는 분기 여부를 신뢰할 수 없다 — 엣지가 진실이다. 승격 시 리포트 행 |
| `kind: "loop"` | 엣지로 그린다. **Start 배선 판정(`has_in`)에서만 제외** — 안 그러면 루프 대상 노드가 in-edge를 갖게 돼 Start가 붕 뜬다. End 판정(`has_out`)에는 포함(보완→재작성처럼 loop가 유일 출구인 노드가 있다) |
| `kind: "seq"` / `"bypass"` | 일반 엣지. 미지 kind는 warning 후 seq 취급 |
| `gateway` | 노드 타입 승격 판단엔 `branch`만 쓴다. `exclusive`는 decision 승격으로, `parallel`은 다중 out-edge로 이미 시각 표현된다 — 값 자체는 아래 노트에 부기 |
| `quote` | quote가 있는 엣지만 **map_notes 1건**(kind=`flow`, title=`"작업지시 확인 → 표준기 선정"`, text=quote + `kind/gateway · condition` 부기) |
| `relations` 누락 | warning + seq 순서 체인 폴백 |

## 3. L6 흐름 — 최상위 `relations` → L5 연계 캔버스

`import_delivery` 직후 L5 카테고리의 연계 캔버스를 **생성 또는 보강**한다. 규약은 기존
`open_linkage_map`(design 2026-08-28 §5)과 동일 — **추가만, 삭제·이동 없음**.

- 캔버스 없음 → 생성(`mode="framework"`, draft `Linkage`) + 이번 전달분 L6 맵 SP 노드 + `relations.edges` 엣지
- 캔버스 있음 → 없는 SP 노드·없는 엣지만 추가. 기존 노드 좌표·라벨·기존 엣지 불변.
  draft가 **타인 체크아웃 중이면 보강 스킵** + 리포트 경고(체크아웃 규약)
- SP 노드 `annual_count`/`fte` — **비어 있으면 채우고, 값이 있으면 안 덮고 경고**. 사용자 직접 편집
  필드라 `gmp`와 같은 관례(design 2026-08-19 §1.3). 0.4에서 처음 값이 실리는 두 필드의 유일한 착지면이다
- 게시하지 않고 draft 유지. dry-run은 세션 롤백으로 자동 미저장

**`relations.entry`는 Start 노드가 될 수 없다** — `validate_framework_canvas`(`app/subprocess.py`)가
연계 캔버스에 `subprocess`/`decision`/`end`만 허용하고 `start`를 막는다. 대신:
- entry의 taskId가 가리키는 SP 노드를 **첫 자리(sort_order 0, 그리드 좌상단)** 에 놓고
- entry 자체는 **L5 스코프 map_notes 1건**(kind=`entry`, title=`Entry (timer)`, text=label+quote)으로 보존

**L6 레벨 분기는 분기 노드를 새로 세운다** — src가 subprocess(=L6 맵)라 L6 맵처럼 타입을 decision으로
**승격할 수는 없다**. 대신 팬아웃 앞에 분기 노드를 끼운다(`expand_linkage_branches`, 사용자 결정 2026-09-01):

```
A → B, B → A(loop), B → C      ⇒      A → B → ◇(B 결과) → A
                                                        └→ C
```

- 끼우는 기준: 나가는 엣지 **2개 이상** && 전부 `gateway="parallel"`은 아님. 병행 팬아웃은 택일이
  아니므로 마름모를 세우면 오독된다(L6 승격 제외 규칙과 같은 판단)
- 조건 라벨(`label`+`condition`)은 **분기 노드에서 나가는 엣지**가 들고 간다. B→◇ 엣지는 무라벨
- 분기 노드는 `decision` — `validate_framework_canvas`가 캔버스에 subprocess/decision/end를 허용한다
  (에디터에서도 프레임워크 맵에 추가할 수 있는 정식 타입)
- 재임포트 재사용 키는 계보(`source_node_id = make_node_id(l5_code, "__branch__{src}")`) —
  SP 노드처럼 `linked_map_id`로 식별할 수 없다
- **핸들은 끝점 타입별로** — SP는 `in`/`__primary__`, 분기는 변별 핸들 `t-left`/`s-right`.
  SP 전용 핸들을 분기 노드에 쓰면 React Flow가 또 엣지를 조용히 버린다
- 되돌아가는 쌍(loop)은 재작성 좌표계(`◇ → target`)로 옮겨 랭크 계산에서 뺀다 — 안 그러면 사이클 부활

## 4. 값 정규화 2건 (0.4에서 처음 값이 차며 새로 문제되는 지점)

- **JSON 숫자 → 파라미터 문자열**: `str(1e-05)` = `"1e-05"`는 `NUMERIC_RE`(`^\d+(\.\d+)?$`)에 걸려
  엔진이 조용히 소거한다. 고정소수 포맷터로 변환한다(`0.03` → `"0.03"`, `52` → `"52"`).
- **department 세그먼트 공백**: 전달 예시의 `"Quality Center/ QC Department/…"`처럼 `/` 뒤 공백이 있으면
  조직경로 known 집합과 안 맞아 **오너 org로 조용히 폴백**된다. 세그먼트별 strip 후 재결합한다.

## 5. 미소비 유지 (의도적)

`summary` · `labelSource` · `_readme` · `tasks[]`의 `evidence`/`revision`/`state`/`doc`/`seq` —
2026-08-18 설계의 "리포트 카운트만" 방침 그대로. 미지 키는 dry-run warning으로 표면화된다.

## 6. 가로 자동정렬 (2026-09-01 추가)

노드·엣지를 다 만든 **뒤** 배치를 최종화한다. 에디터 "자동 정렬"(`frontend/src/lib/flow-layout.ts`
`autoLayoutFlow`, LR)과 **동형 목표**의 파이썬 구현 `backend/scripts/consultant_layout.py`.

- dagre는 파이썬에 없다 → 레이어 배치를 **rank(Kahn 최장경로) + 배리센터 정렬**(교차 감소)로 대체
- 그 뒤 단계는 TS를 그대로 이식 — `computeSpine` · `alignBackbone`(주 흐름을 공통 Y로 스냅, 곁가지는
  `BRANCH_PUSH=60` 이격) · `pickHandleSide` · `isBackEdge`(역행 loop은 top 핸들)
- **`duration.ts`↔`duration.py`와 같은 동치 이중 구현** — 한쪽을 고치면 다른 쪽과 테스트를 같이 옮긴다
- 적용 범위: L6 맵은 매 빌드, **L5 연계 캔버스는 새로 만들 때만**(보강은 "추가만·이동 없음" 규약상
  기존 노드를 못 옮긴다 → 신규분만 격자로 아래에 붙임)
- **사이클은 배치 전에 걷어낸다** — 되돌아가는 엣지를 랭크 계산에서 빼야 선행→분기 순서가 잡히고,
  그 위에 복귀 엣지를 그린다(사용자 결정 2026-09-01). 안 빼면 Kahn 큐가 비어 **전원이 leftover로
  떨어지고 랭크가 노드 나열 순서로 매겨진다** — 같은 그래프인데 전달 순서만 바뀌어도 배치가 뒤집힌다.
  L5 연계 캔버스가 실제로 이 모양이었다(SP 노드끼리 `kind:"loop"`으로 사이클이 생긴다).
  제거 대상은 ① 전달물이 `kind:"loop"`으로 표시한 엣지 ② DFS가 찾은 잔여 back edge
  (`split_forward_edges`). ②만으로는 전원이 사이클에 묶였을 때 시작점에 결과가 좌우되므로
  ①이 확정 역할을 한다 — 그래서 `InterviewLinkageEdge.kind`를 엔진까지 넘긴다(저장은 안 됨).
- **랭크 간격은 그 구간을 지나는 엣지 라벨 폭에서 나온다** — 라벨은 경로 중앙(랭크 사이)에 놓이므로
  그만큼은 노드가 비켜 줘야 한다. 240 고정이던 시절엔 틈이 70px(240−노드 170)뿐이라 160px 라벨이
  양옆 노드를 덮었다(2026-09-01 실측 17건). 라벨 없는 구간은 240 그대로 — 안 그러면 맵이 쓸데없이
  넓어진다. 폭 추정은 `estimate_label_width`(한글 1em·그 외 0.55em 근사, 최대폭에서 클램프).
  최대폭 상수는 FE `canvas.ts EDGE_LABEL_MAX_WIDTH`와 수동 동기 — **한쪽만 바꾸면 첫 배치에서 다시 덮는다**
- **한계**: 좌표·엣지 변(side)은 `_graph_signature`에 없다(레이아웃은 콘텐츠가 아님) → 내용이 같은
  재임포트는 `unchanged`로 끝나 **기존 맵의 배치가 갱신되지 않는다**. 기존 맵을 다시 정렬하려면
  전달 내용이 바뀌거나 에디터에서 "자동 정렬"을 누른다.

## 7. IO 자동 연결 (2026-09-01 추가)

아웃풋 항목과 인풋 항목의 텍스트가 완전일치하면 IO 링크로 잇는다(`link_matching_io`).
링크 그룹 불변식은 `docs/superpowers/specs/2026-08-21-io-linking-design.md` §2 그대로.

- 매칭 단위는 **줄(항목)**, `strip()` 후 완전일치 — 대소문자·공백 정규화 없음(전달물 표기가 진실)
- **흐름 순방향만** — 아웃풋 노드에서 인풋 노드로 엣지 도달 가능할 때만. 역방향·무관 분기의
  동명 항목을 잇지 않는다
- 원본 후보가 여럿이면 **최근접 상류**(홉 수 최소), 동률이면 `sort_order` 낮은 쪽 —
  "한 항목 = 링크 1개" 불변식상 하나만 고를 수밖에 없다
- **이미 링크가 있는 항목은 건드리지 않는다** — 재임포트가 사용자 편집을 덮지 않는다
- 항목 id는 `make_item_id(map_code, node_code, index)` **결정적 sha1** — uuid4로 뽑으면 재임포트마다
  id가 바뀌어 기존 미러가 끊긴다. 형식은 FE `genId()` 폴백(32자 hex)과 동일
- 범위는 **L6 맵 내부만**(사용자 결정) — L5 연계 캔버스 SP 노드 간은 미적용(SP IO는 영구 원본 규약)
- 전달물이 고유키를 싣기 시작하면 텍스트 일치 대신 그 키로 잇는다(확장 포인트)

## 8. 게시본 위 편집용 draft (2026-09-01 추가)

임포트로 들어온 L6는 게시본이 읽기전용이라, 오너가 "새 버전 만들기"를 눌러야 편집을 시작할 수 있었다.
게시 직후 게시본을 복제한 draft를 자동으로 깔아준다(`_ensure_trailing_draft`).

- **`checked_out_by`는 비워 둔다** — 실행자(sysadmin)로 잡으면 실오너가 강탈(force) 없이는 편집을
  못 한다. `routers/versions.create_version`이 생성자를 점유권자로 두는 것과 의도적 차이
- 이미 draft가 있으면 만들지 않는다(사용자 작업본 보존)
- **재전달 시 손 안 댄 자동 draft는 새 버전으로 재사용**(`_take_reusable_draft`) — 안 그러면 구 draft가
  게시본들 사이에 끼어 재전달마다 1건씩 쌓인다. 재사용 조건은 ①점유권자 없음 ②그래프가 직전 게시본과
  완전 동일(편집 흔적 0). 하나라도 어긋나면 건드리지 않고 새 버전을 따로 게시한다
- draft 수는 맵 단위 집계(created/updated/…)가 아니라 `ImportReport.drafts` 부가 카운트

## 9. 결정 로그

| 결정 | 내용 |
|---|---|
| 하위호환 | 0.3 거부(file error). 저장소 샘플 5종은 0.4로 변환 |
| 중복 seq | file error — relations의 참조 대상이 모호해진다 |
| 분기 판정 | `actions[].kind`가 아니라 **엣지 kind=branch**가 진실 → src 노드 decision 승격 |
| 엣지 라벨 | `label` + `condition`을 줄바꿈으로 한 칸에(캔버스 2줄). quote는 노트로 |
| loop 배선 | `has_in`에서만 제외, `has_out`에는 포함 |
| entry | Start 노드 불가(framework 캔버스 검증) → SP 노드 첫 자리 + L5 노트 |
| annual_count/fte | 연계 캔버스 SP 노드가 착지면. 빈 값이면 채우고 기존값은 안 덮음 |
| 자동정렬 | FE autoLayoutFlow 동형 파이썬 구현(dagre 대신 rank+배리센터). 이중 구현 계약 |
| IO 자동 연결 | 줄 단위 완전일치 + 흐름 순방향 + 최근접 상류. L6 내부만. 기존 링크 불변 |
| 자동 draft | 게시 직후 1건, 점유권자 없음. 손 안 댄 것은 재전달이 재사용 |
| 사이클 | 되돌아가는 엣지를 랭크에서 빼고 선행 순서를 먼저 확정. 표시(kind=loop)가 확정, DFS가 보완 |
| L5 분기 | SP는 타입 승격 불가 → 팬아웃 앞에 decision 노드를 끼운다. 조건 라벨은 분기 노드 출구 엣지가 보유 |
