# Whimsical 선별 + 크롬 적용 — 디자인 스펙

> 작성일 2026-06-13 · 브랜치 `feat/whimsical-design`
> 근거 레퍼런스: 사용자가 공유한 `DESIGN.md` (Whimsical 시각 언어 분석)

## 목표

BPM 프로세스맵 에디터의 **전체적인 디자인 및 가시성**을 Whimsical 시각 언어로 끌어올린다.
핵심은 **노드 파스텔 채움 + 단일 바이올렛 액센트**로 한눈에 들어오는 캔버스를 만드는 것.

## 확정 결정 (브레인스토밍)

| 항목 | 결정 |
|---|---|
| 적용 범위 | **선별 + 크롬** — 노드/캔버스/엣지 + 툴바·사이드바·버튼·패널 재정비 |
| 폰트 | **Pretendard 유지** (한글 데이터 렌더 안정성) |
| 가시성 포인트 | 노드 구분·엣지 방향·텍스트 대비·화면 위계 전부 |
| 엣지 | **움직이는 점선 + 화살표** (방향 상시 표시) |
| 겹침 방지 | **드래그 시 밀어내기** (드롭 순간 가장 가까운 빈 자리로 스냅) + 8px 그리드 스냅 |

> `rules/frontend/design.md`의 "flat only"(#2) 원칙은 본 작업으로 개정 — 노드/엣지/플로팅 크롬에 한해 soft shadow·파스텔 fill·dot-grid 허용.

## 변경 대상

| 파일 | 변경 |
|---|---|
| `frontend/src/app/globals.css` | `@theme` 토큰: accent 스왑, canvas/tint/border-strong/shadow 토큰 추가, ink/hairline 재조정 |
| `frontend/src/components/process-node.tsx` | 파스텔 fill(color-mix) + 채도 stroke, hover shadow, `DEFAULT_COLORS` Whimsical 톤 |
| `frontend/src/lib/canvas.ts` | 신규 순수 함수 `resolveCollision(nodes, draggedId)` |
| `frontend/src/app/maps/[mapId]/page.tsx` | `defaultEdgeOptions`(animated 점선+화살표+smoothstep), `<Background>` dot-grid, `bg-canvas`, `snapToGrid`, `onNodeDragStop` 겹침 해소, 크롬 토큰 교체 |
| `frontend/src/app/maps/[mapId]/compare/page.tsx` | 엣지·캔버스 동일 적용 (겹침 방지 제외 — 읽기 전용) |
| `rules/frontend/design.md` | 액센트=바이올렛, 팔레트 예외, flat 규칙 개정 |

## 토큰 명세 (`globals.css @theme`)

```
--color-accent:           #6A41FF   (was #0066cc)
--color-accent-focus:     #5733E0   (hover)
--color-accent-elevated:  #4A29C2   (pressed)
--color-accent-tint:      #EFEBFF   (신규 — 선택 행/활성 툴 배경)
--color-accent-tint-border:#D7CCFF  (신규)
--color-canvas:           #F6F6F8   (신규)
--color-canvas-dot:       #DDDDE3   (신규)
--color-ink:              #16161D   (was #1d1d1f)
--color-hairline:         #E6E6EA   (was #e0e0e0)
--color-border-strong:    #C9C9D1   (신규 — 엣지 기본선)
--shadow-sm: 0 1px 2px rgba(22,22,29,.06)
--shadow-md: 0 4px 12px rgba(22,22,29,.08)
--shadow-lg: 0 8px 28px rgba(22,22,29,.12)
```

타입스케일·radius·easing·Pretendard·surface-pearl 은 유지.

### 오브젝트 팔레트 (COLOR_PRESETS / DEFAULT_COLORS — 데이터/출력 예외)

stroke(저장되는 `color`) 기준 8톤. fill 은 `color-mix(in srgb, {color} 18%, white)`로 런타임 파생 → **데이터 모델 무변경**.

| 이름 | stroke |
|---|---|
| Purple | `#6A41FF` |
| Blue | `#3D7EFF` |
| Teal | `#14B8A6` |
| Green | `#2BC56F` |
| Yellow | `#E0A800` |
| Orange | `#FF8A33` |
| Pink | `#FF5C9A` |
| Gray | `#9A9AA6` |

`DEFAULT_COLORS` 매핑(타입별 기본 stroke): process→Gray, decision→Yellow, start→Green, end→Pink/Danger.

## 노드 렌더 (`process-node.tsx`)

- 배경: `color-mix(in srgb, {color} 18%, white)` (inline style)
- 테두리: `{color}` 1.5px
- 텍스트: `text-ink` 유지 (파스텔 위 대비 OK)
- hover: `shadow-sm`, selected: `ring-2 ring-accent`(바이올렛)
- 모양 유지: process=둥근 사각, decision=마름모, start/end=알약
- diff 링(added/removed/changed)은 유지하되 Whimsical 톤으로 자연 정렬

## 엣지 (`page.tsx`, `compare/page.tsx`)

`<ReactFlow defaultEdgeOptions={{ animated: true, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } }}>`
- 기본선 `var(--color-border-strong)`, 선택 시 `var(--color-accent)`
- 상시 애니메이션 점선이 큰 맵에서 분주하면 후속으로 "선택 시만" 전환 가능 (열린 후조정 포인트)

## 캔버스

`<Background variant="dots" gap={20} size={1.2} color="var(--color-canvas-dot)" />` + 컨테이너 `bg-canvas`.

## 겹침 방지 (`canvas.ts` + `page.tsx`)

```ts
// 박스 겹침 감지 후 가장 가까운 빈 자리로 스냅. 타입별 크기(decision 96², 기타 170×52) 고려.
export function resolveCollision(nodes: AppNode[], draggedId: string): AppNode[]
```
- `snapToGrid={[8, 8]}` 활성
- `onNodeDragStop`에서 호출 → 겹치면 나선/격자 탐색으로 최근접 빈 위치 반환
- 읽기 전용 compare 화면에는 미적용

## 크롬 (`page.tsx`)

기존 구조 유지, 토큰만 외과적 교체:
- 패널/툴바: surface + radius 12px(`rounded-md/lg`) + `shadow-md`, hairline 보더
- 버튼: primary(accent fill, white) / secondary(surface+border) / ghost(accent text, tint hover)
- 활성 툴: `bg-accent-tint` + `text-accent` 아이콘

## 검증

1. `npm run build` 통과
2. `npm run lint` 클린
3. 수동 시각 확인: 에디터(노드 파스텔·엣지 점선·드래그 겹침·크롬), 비교 화면, 홈, 한글 라벨 가독성

## 비범위 (YAGNI)

- 폰트 교체(Rubik/Inter) — Pretendard 유지
- 좌측 shape rail / 우측 inspector 신규 레이아웃 — 기존 레이아웃 유지
- 반응형 bottom-sheet / FAB — 데스크톱 라이트 전용 유지
- 백엔드/데이터 모델 변경 없음
