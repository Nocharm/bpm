# OS형 자유 창 (드릴인 윈도우) 설계

작성일: 2026-06-12
대상: `frontend/` (순수 프론트엔드 — 백엔드 변경 0)

## 배경 / 목표

현재 드릴인은 "활성 ReactFlow 캔버스 1개 + 조상은 고정 위치 장식 프레임"이고, 창 위치가 계층 깊이를 고정 인코딩한다. 사용자는 뜨는 창들이 **실제 OS 창처럼 자유롭게 이동·리사이즈·포커스**되는 경험을 원한다. 단일 라이브 캔버스 모델은 유지하되, 각 계층 창에 OS 윈도우 크롬(이동·리사이즈·최소/최대/닫기·z-order)과 위치 영속을 부여한다.

## 확정 결정 (브레인스토밍)
- **창 모델**: 활성 1개만 라이브 편집(ReactFlow), 나머지는 이동가능한 비활성 창. 창 클릭 → 포커스 → 그 계층 로드(활성 전환). (동시 편집 MDI 아님.)
- **OS 동작**: 이동(타이틀바 드래그) · 리사이즈 · 포커스 z-order(클릭=맨앞) · 최소화/최대화/닫기 버튼 — 전부.
- **영속**: 창 위치·크기를 `localStorage`에 기억(스코프별).
- **기본 배치**: 진입 시 계단식 자동 배치, 그 후 자유 이동.

## 비범위
- 백엔드/DB/API 변경 없음.
- 동시 다중 라이브 편집(MDI) 없음 — 활성 창 1개.
- 비활성 창의 라이브 그래프 스냅샷 렌더 없음(v1 제외).
- 기능 로직(저장·자동저장·체크아웃·undo/redo·검색·PNG·코멘트) 변경 없음 — 전부 활성 창 기준 그대로.

---

## 데이터 / 상태 모델

기존 `scopes: Scope[]`(root→최하위 체인)을 창 존재의 source of truth로 유지한다. 추가 상태:
- `activeIndex: number` — 포커스(라이브)된 창의 scopes 인덱스. 기본 = `scopes.length - 1`(최하위).
- 라이브 캔버스는 `scopes[activeIndex]`를 로드한다. (기존 `currentParentId`를 `scopes[activeIndex].parentId`로 재정의.)
- `windowGeom: Record<string, WindowGeom>` — 스코프키별 기하/상태.
  ```ts
  type WindowGeom = { x: number; y: number; w: number; h: number; minimized: boolean; maximized: boolean };
  ```
  스코프키 = `scope.parentId ?? "root"`.
- z-order: 세션 내 포커스 순서 배열(또는 스코프키→zIndex 맵). 영속하지 않음(로드 시 활성=최상위로 재계산).

**스코프키 주의**: parentId는 맵 내에서 유일(노드 id), root는 "root". 같은 맵 안에서 충돌 없음.

### 네비게이션 의미 (기존 로직 재사용)
- **드릴인**(활성 창 캔버스에서 노드 더블클릭): `scopes`를 `[0..activeIndex] + 새 자식`으로 truncate(현재 `navigateTo`/드릴인과 동일), `activeIndex = 새 last`. → 더 깊었던 창은 닫힘(전진 시 forward-stack 정리와 동일).
- **포커스**(다른 창 클릭): `activeIndex = i`로 설정 → 그 스코프 로드. 더 깊은 창들은 화면에 남아있되 비활성.
- **닫기(X)**: `i === 0`(root)면 무시. 아니면 `scopes`를 `[0..i-1]`로 truncate, `activeIndex = min(activeIndex, i-1)`. (닫으면 그 창 + 하위 모두 닫힘 — 체인 의미.)
- 헤더 브레드크럼은 그대로 동작(클릭 = 포커스/네비).

### 저장 정합성
스코프 전환(포커스/드릴/닫기) 시 기존 `navigateTo`처럼 **현재 활성 스코프를 먼저 저장**한 뒤 active 전환한다. 자동저장/dirty/undo 히스토리는 활성 스코프 기준(현 동작 유지) — 비활성 창은 편집 불가라 충돌 없음.

---

## 컴포넌트 — `frontend/src/components/scope-window.tsx` (신규)

창 크롬 한 단위. 기하·상태는 부모(MapEditor)가 소유, ScopeWindow는 표현 + 포인터 인터랙션만.

**Props (인터페이스):**
```ts
interface ScopeWindowProps {
  title: string;
  geom: WindowGeom;
  active: boolean;
  zIndex: number;
  canClose: boolean;          // root는 false
  bounds: { w: number; h: number }; // 컨테이너 크기(클램프용)
  onFocus: () => void;
  onGeomChange: (geom: WindowGeom) => void;  // 이동/리사이즈/min/max 결과
  onClose: () => void;
  children: React.ReactNode;  // active=라이브 캔버스, 비활성=흐린 본문
}
```

**구성:**
- 루트 `div` absolute, `style={{ left:x, top:y, width:w, height:h, zIndex }}`, `flex flex-col`, hairline border + 미세 shadow(떠있는 오버레이 — 디자인 룰 §2 허용), `bg-surface`, rounded. `pointerDown` → `onFocus()`.
- 타이틀바: `bg-surface-alt`, 드래그 핸들. 좌측 제목(truncate), 우측 버튼 3개(Lucide `Minus`/`Square`/`X`, 16px/1.5). 더블클릭 = 최대화 토글(선택).
- 본문: `flex-1 relative` → `children`. 비활성이면 본문 위에 흐린 오버레이(`bg-surface/60`)+"클릭해 편집" 힌트.
- 리사이즈 핸들: 우하단 코너(+우/하 가장자리) 작은 핸들, `cursor-se-resize`. 최대화 중이면 숨김.

**포인터 드래그/리사이즈 (의존성 없이 직접):**
- 타이틀바 `onPointerDown` → `setPointerCapture`, 시작 좌표·시작 geom 저장. `pointermove` → 새 x/y 계산(컨테이너 bounds로 클램프). `pointerup` → release. 결과를 `onGeomChange`로 보고.
- 리사이즈 핸들 동일 패턴으로 w/h 조절(최소 크기 예: 240×160).
- 드래그 중에는 `onGeomChange`를 throttle 없이 호출(React 상태 업데이트로 충분, 60fps 부드러움). 외부 라이브러리(react-rnd 등) 미사용 — React19/Next16 호환 리스크 + 미니멀 룰.

**최소화/최대화:**
- minimized: 본문 숨기고 타이틀바만. 최소화 창들은 컨테이너 하단에 가로로 정렬(부모가 minimized 창 위치를 하단 슬롯으로 재배치) — 또는 제자리에서 본문만 접기. **결정: 제자리 접기**(타이틀바만 그 위치에 남김) — 단순·예측가능. (하단 도크 정렬은 v2.)
- maximized: geom 무시하고 컨테이너 가득(`inset-0`). 토글 시 이전 geom 복원.

---

## 기하 영속 — `frontend/src/lib/window-store.ts` (신규)

```ts
// 맵별 창 기하 영속 — localStorage. 스코프키 → WindowGeom.
export function loadWindowGeoms(mapId: number): Record<string, WindowGeom>;
export function saveWindowGeoms(mapId: number, geoms: Record<string, WindowGeom>): void;
```
- 키: `bpm.windows.<mapId>`. JSON 직렬화. 파싱 실패/없음 → `{}`.
- MapEditor는 마운트 시 로드, `windowGeom` 변경 시 디바운스(예: 300ms) 저장.
- SSR 안전: localStorage 접근은 effect/이벤트에서만.

### 기본(계단식) 배치
저장된 geom이 없는 새 창: 부모 창 기준 우하향 오프셋(레벨당 ~32px), 기본 크기(예: 컨테이너의 70% 또는 720×480 중 작은 값). 루트 창은 기본적으로 컨테이너 가득에 가깝게(약간 여백). 한 번 사용자가 옮기면 그 값이 저장돼 다음부터 우선.

---

## page.tsx 변경

- 현재 드릴인 블록(`scopes.map(...)` 고정 프레임 + 활성 래퍼)을 **`ScopeWindow` 렌더 루프**로 교체.
- 상태 추가: `activeIndex`, `windowGeom`(+ z-order). `currentParentId = scopes[activeIndex].parentId`로.
- 활성 창의 children = 기존 `<ReactFlow ...>`(모든 props/핸들러 그대로). 비활성 창 children = 흐린 placeholder(노드 수 등 가벼운 힌트, API 호출 없이 — 노드 수는 모르면 생략).
- 드릴인/포커스/닫기 핸들러를 위 네비 의미대로 연결(기존 `navigateTo`/`handleBreadcrumb` 재사용·확장).
- 컨테이너 크기(bounds)는 ref + ResizeObserver(또는 부모 `relative flex-1`의 clientWidth/Height)로 취득해 클램프·기본배치에 사용.
- 드릴인 entrance 애니메이션(`drill-canvas`)은 새로 열리는 창에 유지(선택).

---

## 영향 파일 요약
신규:
- `frontend/src/components/scope-window.tsx`
- `frontend/src/lib/window-store.ts`

수정:
- `frontend/src/app/maps/[mapId]/page.tsx` (드릴인 블록 → ScopeWindow 루프, activeIndex/windowGeom 상태, 로드 effect 기준 변경)
- (필요 시) `frontend/src/app/globals.css` (창 entrance/transition 토큰)

## 검증
- 태스크별 `tsc`/`lint`/`build`.
- 수동(원격 사용자 확인): 타이틀바 드래그 이동, 코너 리사이즈, 창 클릭 포커스(맨앞 + 라이브 전환), 최소/최대/닫기, 위치 새로고침 후 유지, 드릴인 시 새 창 계단 배치.

## 구현 주의
- `frontend/AGENTS.md`(Next 버전) — layout 무관, 표준 React.
- 포인터 캡처/cleanup 누수 주의(언마운트·release). 드래그 중 텍스트 선택 방지(`user-select: none`).
- ReactFlow는 활성 창 본문에만. 창 드래그는 타이틀바로 한정해 캔버스 팬/노드드래그와 충돌 차단.
- 디자인 룰: 떠있는 창은 미세 shadow 허용(§2 오버레이 예외). 색·타입·아이콘 토큰 준수.
