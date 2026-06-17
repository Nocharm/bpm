# Node Handle Side Customization — Design

날짜: 2026-06-17
브랜치: feat/ui-ux-improvements
관련: 엣지/핸들 개선 3건 중 기능 3. (기능 1=분기 색상 완료, 기능 2=엣지 겹침 완화는 **보류**.)

## 목적

노드의 입력(들어오는)·출력(나가는) 엣지가 노드의 **어느 변**에 붙는지를 노드별로 커스텀한다. 현재는 입력=왼쪽, 출력=오른쪽으로 고정되어 있어, 레이아웃에 따라 엣지가 어색하게 꺾이거나 노드 위를 가로지른다. 변을 바꿀 수 있으면 사용자가 흐름을 깔끔하게 정리할 수 있다.

## 동작 모델 (확정)

- 모든 노드에서 **입력 핸들 1개·출력 핸들 1개**를 유지하고, 각 핸들이 붙는 **변만** 바꾼다. (멀티 핸들·슬롯 분산은 기능 2 영역 — 보류.)
- 변은 `left | right | top | bottom` 4방향. 기본값 입력=`left`, 출력=`right` (현재 동작과 동일).
- 변 설정은 **노드에 영속**된다(맵을 다시 열어도 유지).

### 제약 (흐름 역행 방지)

- `start` 노드: 출력 변에서 **`left` 비활성**.
- `end` 노드: 입력 변에서 **`right` 비활성**.
- 제약은 노드 타입(`nodeType`) 기준. 두 서브메뉴(입력 변/출력 변)는 모든 노드에 노출하고, 제약에 걸리는 방향 항목만 비활성화한다. (start의 입력 변, end의 출력 변은 실사용상 의미 없으나 메뉴는 유지 — 단순·균일.)

## 비목표 (Out of Scope)

- **기능 2 (엣지 겹침 완화)**: 한 변에 여러 슬롯 분산, 평행 엣지 오프셋, 엣지별 `sourceHandle`/`targetHandle` 계산 — 전부 보류. 따라서 한 변에 여러 엣지가 모이면 현재처럼 한 점에서 겹친다.
- 핸들 드래그로 변 이동, ELK 등 자동 라우팅.

## 데이터 모델

### 백엔드 (`backend/app/models.py`, `schemas.py`)

`Node`에 컬럼 2개 추가:

| 컬럼 | 타입 | 기본값 |
|------|------|--------|
| `in_side` | `String(10)` | `"left"` |
| `out_side` | `String(10)` | `"right"` |

`NodeIn`/`NodeOut` 스키마에 동일 필드 추가(기본값 포함). graph save/load에서 라운드트립.

### 프론트엔드 (`frontend/src/lib/canvas.ts`)

`NodeData`에 추가:

```ts
inSide: HandleSide;   // "left" | "right" | "top" | "bottom"
outSide: HandleSide;
```

`HandleSide` 타입과 `Position`(xyflow) 변환 헬퍼를 `canvas.ts`에 둔다(순수함수, 단위 테스트 대상):

```ts
export type HandleSide = "left" | "right" | "top" | "bottom";
export function toPosition(side: HandleSide): Position;   // "left" → Position.Left ...
```

제약 판정 헬퍼:

```ts
// 해당 노드 타입에서 그 변이 허용되는가 (start 출력 left 금지, end 입력 right 금지)
export function isSideAllowed(nodeType: ProcessNodeType, io: "in" | "out", side: HandleSide): boolean;
```

## 렌더 (`frontend/src/components/process-node.tsx`)

현재 고정:

```tsx
<Handle type="target" position={Position.Left} />
<Handle type="source" position={Position.Right} />
```

변경: `data.inSide`/`data.outSide`를 `toPosition()`으로 변환해 위치 지정. process/terminal/decision 세 분기 모두 동일하게 적용. 핸들 개수·`id` 변경 없음(타입으로 구분되므로 id 불필요). 변이 바뀌면 xyflow가 엣지 경로를 자동 갱신.

## UI (`frontend/src/components/context-menu.tsx` + `page.tsx`)

- 노드 우클릭 메뉴에 서브메뉴 2개 추가: `입력 변 ▸ {상/하/좌/우}`, `출력 변 ▸ {상/하/좌/우}`. (기존 정렬 날개와 동일한 submenu 패턴 재사용.)
- 현재 선택된 변에 체크 표시. 제약에 걸리는 항목은 `disabled`.
- 항목 클릭 → `page.tsx`의 핸들러:

```ts
const setNodeHandleSide = (nodeId, io: "in" | "out", side: HandleSide) => {
  // readOnly 가드, pushHistory, setNodes로 data.inSide/outSide 갱신, scheduleAutoSave
};
```

- i18n 메시지 추가: 메뉴 라벨(입력 변/출력 변, 상/하/좌/우). UI 영어 기본 규칙에 따라 영어 라벨(예: "Input side"/"Output side", "Top/Bottom/Left/Right").

## 직렬화 (`page.tsx`)

- **로드**: 백엔드 Node → ReactFlow node 변환 시 `in_side`/`out_side` → `data.inSide`/`data.outSide`. 누락(구 데이터)이면 기본값 `left`/`right`.
- **저장**: node.data.inSide/outSide → `in_side`/`out_side`로 직렬화.

## 스키마 반영 (마이그레이션)

Alembic 미도입 + `create_all`은 기존 테이블에 컬럼을 추가하지 않으므로, 이번 변경은 **1회 drop+recreate**로 반영한다(개발 단계, 데이터 손실 수용):

- 로컬(sqlite): DB 파일 삭제 후 재기동(`create_all` 재생성) + 더미 시드 재실행(`backend/scripts/seed_dummy.py`).
- 서버(postgres): 배포 시 테이블 drop 후 재생성(또는 볼륨 초기화) 1회.

**주의**: 매 startup 드롭이 아니라 이 스키마 변경 시 1회만. 코드에 영구 `drop_all`을 넣지 않는다.

## 엣지 케이스

- `inSide === outSide` (예: 둘 다 left): 같은 변에 입력·출력 핸들 공존. xyflow가 type(source/target)으로 구분하므로 허용. 사용자 선택에 맡김.
- 구 맵 데이터(컬럼 없음): 로드 시 기본값으로 폴백.
- decision(마름모): 핸들은 회전 안 한 컨테이너(`h-24 w-24`) 변에 위치 → 기존과 동일하게 변만 반영.

## 테스트

- 백엔드: `in_side`/`out_side` graph save→load 라운드트립 pytest(기본값·명시값). 외부 의존성 없음.
- 프론트: `toPosition`/`isSideAllowed` 순수함수 단위 테스트. 렌더·메뉴는 build+lint+수동 확인(서버/원격 IP에서 핸들 위치·제약 동작).

## 영향 파일

- backend: `app/models.py`, `app/schemas.py`, graph 라우터 매핑, `tests/`
- frontend: `lib/canvas.ts`, `components/process-node.tsx`, `components/context-menu.tsx`, `app/maps/[mapId]/page.tsx`, `lib/i18n-messages.ts`
