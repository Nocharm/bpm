# Frontend Design Rules

BPM 프론트엔드 시각 언어 — Whimsical 파생 토큰 시스템(`frontend/src/app/globals.css` `@theme`). 단일 바이올렛 액센트(`--color-accent` `#6A41FF`) + 파스텔 오브젝트 + dot-grid 캔버스가 핵심. 새 컴포넌트·리스타일 시 준수.

## 1. Raw hex 금지 — 토큰만
- 컴포넌트(JSX/TSX/CSS)에 `#xxxxxx` 직접 사용 금지. 색은 토큰 클래스(`bg-surface`, `text-ink`, `text-accent`, `bg-accent-tint`, `border-hairline`, `text-error`, `ring-added` 등) 또는 inline style의 `var(--color-*)`로만.
- **예외(데이터/출력)**: 사용자가 노드에 지정하는 `color`와 색 팔레트 `COLOR_PRESETS`(세련된 무채도 8톤 stroke — slate/teal/sage/amber/clay/rose/violet/stone), PNG export 배경색은 데이터/출력이며 chrome이 아니다 — 유지. 노드 fill은 stroke에서 `color-mix(in srgb, {color} 18%, white)`로 파생.

## 2. Elevation — soft shadow 허용
- 토큰 `--shadow-sm`(노드 hover) / `--shadow-md`(카드·패널·툴바) / `--shadow-lg`(플로팅 오버레이: 컨텍스트 메뉴·다이얼로그·토스트). 쿨톤 저확산만 — 글로우·이중 그림자 금지.
- 노드·엣지·플로팅 크롬에 한해 elevation 사용. 그 외 정적 영역의 깊이는 `border-hairline`/`border-divider` 또는 surface 색단계(`bg-surface` ↔ `bg-surface-alt` ↔ `bg-surface-pearl`)로.
- 캔버스 배경은 `bg-canvas`(`#F6F6F8`) + dot-grid(`<Background variant="dots">`, `--color-canvas-dot`). 노드는 파스텔 fill + 1.5px 채도 stroke, 둥근 기하(`rounded-sm`/알약/마름모) 일관.

## 3. 타입
- Pretendard. 본문 17px(`text-body`), 굵기 사다리 **300/400/600**(500 금지).
- 시맨틱 스케일: `text-tagline`/`text-body-strong`/`text-body`/`text-caption`/`text-caption-strong`/`text-fine`.

## 4. 모션
- 이징 `ease-spring`/`ease-overshoot`/`ease-smooth`, duration은 `duration-150/350/450/700`. 인터랙션(hover/entrance)에만.

## 5. 언어 · 아이콘
- UI 영어 기본(동적 데이터·주석만 한글). 이모지 금지 → **Lucide 16px / strokeWidth 1.5**.

## 6. 밀도
- 생산성 화면(에디터)의 컨트롤은 컴팩트 유지(작은 패딩, `text-caption`/`text-fine`). 마케팅형 대형 여백 미적용.

## 7. 라이트 전용
- 다크모드 미지원(데스크톱 라이트). `prefers-color-scheme: dark` 스타일 추가 금지.
