# Edge Handle Side Customization — Design

날짜: 2026-06-17
브랜치: feat/ui-ux-improvements
관련: 엣지/핸들 개선 3건 중 기능 3. (기능 1=분기 색상 완료, 기능 2=엣지 겹침 완화는 **보류**.)

## 목적

각 **엣지**가 노드의 어느 변에서 출발하고 어느 변으로 도착하는지를 엣지별로 커스텀한다. 현재는 출발=오른쪽(source), 도착=왼쪽(target)으로 고정이라 레이아웃에 따라 엣지가 노드를 가로지르거나 어색하게 꺾인다. 변을 엣지별로 바꾸면 사용자가 흐름을 깔끔하게 정리할 수 있다.

## 동작 모델 (확정)

- 핸들 변은 **엣지의 속성**이다(노드 속성 아님). 엣지마다 **시작 변(source side)**·**끝 변(target side)**을 각각 저장한다.
- 각 변은 `left | right | top | bottom` 4방향. 기본값 시작=`right`, 끝=`left`(현재 동작과 동일).
- 양끝 모두 **4방향 전부 허용** — 노드 타입에 따른 제약 없음(이전 안의 start/end 제약은 폐기).
- 변 설정은 **엣지에 영속**된다.

## 비목표 (Out of Scope)

- **기능 2 (엣지 겹침 완화)**: 한 변에 여러 슬롯 분산, 평행 엣지 오프셋 — 보류. 같은 변에 여러 엣지가 모이면 현재처럼 한 점에서 겹친다.
- 핸들 드래그로 변 이동, ELK 등 자동 라우팅.

## 데이터 모델

### 백엔드 (`backend/app/models.py`, `schemas.py`)

`Edge`에 컬럼 2개 추가:

| 컬럼 | 타입 | 기본값 |
|------|------|--------|
| `source_side` | `String(10)` | `"right"` |
| `target_side` | `String(10)` | `"left"` |

`EdgeIn`/`EdgeOut` 스키마에 동일 필드 추가(기본값 포함). graph save/load에서 라운드트립. (노드 컬럼은 추가하지 않음.)

### 프론트엔드 (`frontend/src/lib/canvas.ts`)

`HandleSide` 타입과 핸들 id 규약, `Position` 변환 헬퍼(순수함수, 단위 테스트 대상):

```ts
export type HandleSide = "left" | "right" | "top" | "bottom";
export function toPosition(side: HandleSide): Position;          // "left" → Position.Left
export function sourceHandleId(side: HandleSide): string;        // "right" → "s-right"
export function targetHandleId(side: HandleSide): string;        // "left"  → "t-left"
export function sideFromHandleId(id: string | null | undefined, fallback: HandleSide): HandleSide;
```

엣지의 변은 ReactFlow `Edge`의 네이티브 `sourceHandle`/`targetHandle`(예: `s-right`/`t-left`)로 표현한다. 별도 edge.data 불필요.

## 핸들 렌더 (`frontend/src/components/process-node.tsx`)

현재: target(Left) 1개 + source(Right) 1개.

변경: 모든 노드가 **4변 각각에 source·target 핸들**을 렌더한다(총 8개, id `s-left/s-right/s-top/s-bottom`, `t-left/...`). 엣지가 어느 변에든 붙을 수 있게 함. process/terminal/decision 세 분기 모두 동일.

- **시각 처리**: 8개 핸들이 산만하지 않도록 작게·저대비로, 노드 hover(`group-hover`)·연결 중에 강조. (xyflow `.react-flow__handle` 오버라이드. 시각 디테일은 구현 시 조정.)
- 같은 변에 source·target 핸들이 겹쳐 위치 — 재구성(패드) 용도에선 무해. 새 엣지 드래그 시 약간의 모호함은 허용(트레이드오프).

## UI — 십자 방향 패드 (`context-menu.tsx` + `page.tsx`)

엣지 우클릭 메뉴(`MenuState.kind === "edge"`, `onEdgeContextMenu` 이미 배선됨)에 **십자 패드 2개**를 렌더한다. 평면 8필보다 버튼 위치가 실제 노드 변에 매핑되어 직관적이다.

```
   Start              End
    [ ↑ ]              [ ↑ ]
 [ ← ] [ → ]        [ ← ] [ → ]
    [ ↓ ]              [ ↓ ]
```

- 각 방향 버튼 = 그 끝의 변을 즉시 설정. 현재 변 버튼은 accent로 강조.
- 버튼 클릭 시 **메뉴를 닫지 않는다**(연속으로 양끝 조정). 메뉴는 바깥 클릭(기존 mousedown 가드)·Esc로만 닫힘.
- 클릭 → `page.tsx` 핸들러: `setEdgeSide(edgeId, "source" | "target", side)` — readOnly 가드, pushHistory, `setEdges`로 `sourceHandle`/`targetHandle` 갱신, scheduleAutoSave.
- i18n: 패드 라벨(Start/End) 등 영어 기본(UI 영어 규칙).

## 직렬화 (`page.tsx`)

- **로드**: 백엔드 Edge → ReactFlow edge 변환 시 `source_side`/`target_side` → `sourceHandle`/`targetHandle`(`s-{side}`/`t-{side}`). 누락(구 데이터)이면 기본 `right`/`left`.
- **저장**: `sourceHandle`/`targetHandle`에서 변 추출(`sideFromHandleId`) → `source_side`/`target_side`.

## 버전 비교 (diff) — 변경 불필요

`lib/diff.ts`는 엣지를 **`lineage(source)→lineage(target)` 키로만** 비교한다(label·스타일·변 미비교, added/removed만 판정). 따라서 변만 바꾼 엣지는 변경으로 잡히지 않는다 — **요구사항이 이미 충족**. 엣지 키에 변을 추가하지 않는 것만 지키면 됨(diff.ts 무변경).

## 스키마 반영 (마이그레이션)

Alembic 미도입 + `create_all`은 기존 테이블에 컬럼을 추가하지 않으므로 **1회 drop+recreate**로 반영(개발 단계, 데이터 손실 수용):

- 로컬(sqlite): DB 파일 삭제 후 재기동 + 시드 재실행(`backend/scripts/seed_dummy.py`).
- 서버(postgres): 배포 시 테이블 drop 후 재생성(또는 볼륨 초기화) 1회.

**주의**: 매 startup 드롭이 아니라 이 변경 시 1회만. 코드에 영구 `drop_all` 금지.

## 엣지 케이스

- 구 엣지 데이터(컬럼/handle 없음): 로드 시 기본 `right`/`left` 폴백.
- 새 엣지(onConnect): 사용자가 잡은 핸들의 id가 그대로 들어옴(없으면 기본값). 이후 패드로 조정 가능.
- `source_side`/`target_side`가 같은 변을 가리켜도 허용(사용자 선택).
- decision 분기(Yes/No) 엣지도 동일하게 변 조정 가능.

## 테스트

- 백엔드: `source_side`/`target_side` graph save→load 라운드트립 pytest(기본값·명시값). 외부 의존성 없음.
- 프론트: `toPosition`/`sourceHandleId`/`targetHandleId`/`sideFromHandleId` 순수함수 단위 테스트. 렌더·패드·diff 무영향은 build+lint+수동 확인(서버/원격 IP에서 변 변경·재로드 영속·비교 화면 무변경 확인).

## 영향 파일

- backend: `app/models.py`, `app/schemas.py`, graph 라우터(매핑), `tests/`
- frontend: `lib/canvas.ts`, `components/process-node.tsx`, `components/context-menu.tsx`, `app/maps/[mapId]/page.tsx`, `lib/i18n-messages.ts`
- diff.ts: **무변경**(확인용)
