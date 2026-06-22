# React Flow + 인라인 계층 편집 함정

`frontend/src/app/maps/[mapId]/page.tsx`의 인라인 펼침(하위프로세스를 레인으로 펼쳐 보는 뷰) + React Flow(@xyflow/react v12) 작업에서 실측한 것들.

> ⚠️ 하위프로세스 참조 모델에서 임베드 자식은 **읽기전용**이 됐다 — 자식 *편집* 관련(2번 in-node 입력 커밋 등)은 역사적 기록. 렌더/측정/이벤트/드롭존 함정은 읽기전용 임베드에도 유효.

## 1. 자식 노드는 메인 `nodes`에 합치지 말 것 → 별도 `childNodes` state
- 펼친 자식을 **메인 `nodes` state에 합치면 안 됨.** `nodes` = 현재 스코프라는 가정이 코드 전반(아웃라인, 모달 편집 라우팅 `handleSummaryPatch/LabelCommit`, `renameNode`, 인스펙터, 자식 스코프 flush 저장 등)에 깔려 있어 광범위하게 깨진다(blast radius). 1차로 이 방식을 시도했다가 flush 저장이 깨지는 등 회귀가 너무 넓어 전부 reset했다.
- **정답: 별도 `childNodes` state.** 메인 `nodes`는 현재 스코프 그대로(=기존 가정 유지, 회귀 0). 자식은 `childNodes`에 두고:
  - `displayNodes`에서 파생 자식을 `childNodes` 객체로 치환(RF가 측정·이벤트 라우팅하도록).
  - 커스텀 `onNodesChange`(`handleNodesChange`)로 변경분을 id 기준 `nodes`/`childNodes`로 분배.

## 2. prop-only 자식은 2급 시민
- `nodes` state에 없고 `displayNodes` **prop**에만 합성돼 들어간 자식은:
  - RF가 측정(measure)을 못 해 **`visibility:hidden`으로 숨김** → 펼침 영역이 빈칸으로 보임.
  - 노드 이벤트(onNodeClick/DoubleClick·드래그·선택)·in-node React 이벤트(onChange/onBlur)가 **발화 안 함**(루트는 정상).
- 근본 해결은 state화(1번). `measured` 직접 주입은 가시화만 되는 임시방편. **in-node 입력(인라인 이름편집) 커밋은 자식에서 불안정 → 편집은 모달 사용.**

## 3. 드롭존/겹침 탐지 — 자식엔 RF API가 안 먹음
- `screenRectOf`는 **`reactFlow.getNode(id)`**(표시 위치, 현재+자식 모든 렌더 노드) 사용. `nodesRef.find`는 자식이 없어 null → 링 위치 못 잡음.
- **`reactFlow.getIntersectingNodes(node)`는 자식 드래그에 항상 빈 결과**(RF 내부 positionAbsolute 누락 추정). 드롭존을 자식에 적용하려면 **수동 형제 겹침 판정**(dragged child rect vs 같은 scopeId 형제들의 getNode rect) 필요.

## 4. 펼침 중 인터랙션 게이팅
- per-node `draggable`/`connectable`/`deletable`/`selectable`이 전역 `nodesDraggable`/`nodesConnectable`를 **override**한다. 펼침 중엔 전역을 켜고(`!readOnly`) **현재 스코프(프레임) 노드는 per-node false**, 자식만 true로 → 자식만 편집.
- `onNodeDrag`(continuous)도 자식에 정상 발화한다. **"발화 0"으로 보이면 코드가 아니라 dev.db 오염을 의심**(드래그 자체가 안 된 것) → `browser-verification.md`.

## 5. Turbopack
- dev에서 `globals.css`의 `.react-flow__node` 대상 규칙을 purge한다 → 인라인 애니메이션 등은 JSX 내 raw `<style>` 태그로 주입.

관련 메모리: 인라인 자식 React Flow 함정 / 브라우저 검증 하네스.
