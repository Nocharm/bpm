# 스코프 분할 저장 + 좌표 모델

인라인 펼침에서 자식(하위 스코프) 노드를 편집·저장할 때의 패턴. 각 캔버스는 `(version, parent_node_id)` 스코프이고 저장은 해당 스코프만 교체한다.

## 1. 자식 스코프 저장 = getGraph → 변형 → PUT (그룹 보존)
- 자식 스코프를 저장할 땐 **`getGraph(versionId, scopeId)`로 권위 그래프(노드+엣지+`groups`)를 받아 변형 후 `saveGraph(versionId, graph, scopeId)`** 한다.
- 이유: `VersionGraph`(`/graph/all`)에는 **그룹이 없어** 거기서 스코프 그래프를 재구성하면 그룹이 유실된다. 반드시 getGraph로 받아서 노드/엣지만 손대고 PUT.
- 백엔드 PUT은 payload에 없는 노드를 **하위 서브트리까지 재귀 삭제**(스코프 교체) → 삭제 시 남길 노드만 보내면 됨.

## 2. fullGraph 낙관적 갱신으로 즉시 렌더
- 추가/삭제/연결은 저장 응답을 기다리지 말고 **`setFullGraph`로 먼저 수정** → materialize effect(노드)·`buildScope.childEdges`(엣지)가 즉시 반영.
- **삭제는 fullGraph에서도 낙관적으로 제거**하지 않으면, materialize effect가 fullGraph(아직 삭제 노드 보유)에서 자식을 즉시 되살린다.
- 저장 후 `refreshFullGraph()`로 권위 상태 재동기화.

## 3. 좌표 2계 — 스코프상대 vs 표시(절대)
- 저장 좌표 = **스코프상대**(`pos_x/pos_y`, 그 스코프 자체 캔버스 기준). 화면 좌표 = **표시/절대**(펼침 영역 오프셋 적용).
- **buildScope가 자식을 dagre로 재배치하면 안 됨 → 저장된 pos 사용.** dagre면 드래그로 옮겨 저장해도 다음 렌더에서 재배치돼 되돌아간다. 저장 pos를 쓰면 드래그가 영속되고 인라인=드릴인 레이아웃이 일치.
- `inlineComposition`이 `childOffsets`(자식별)·`scopeOffsets`(스코프별, 같은 스코프 동일) = (표시절대 − 저장상대)를 노출. **드래그 종료/노드 추가 시 절대↔스코프상대 변환**에 사용.
- `childTop`은 영역을 앵커에 세로중심정렬했었으나 → **상단정렬**로 변경. 자식 세로 드래그 시 영역 재중심화로 위치가 튀는 문제 제거(단일행 초기 표시는 동일).

## 4. ⚠️ 검증 중 dev.db readonly 함정
- **백엔드 실행 중에 `git checkout backend/dev.db`를 하면 DB가 readonly가 된다**(SQLite 파일 핸들이 깨짐) → 이후 모든 저장이 `attempt to write a readonly database`로 실패. 반드시 **백엔드 재시작**. 자세히는 `browser-verification.md`.
