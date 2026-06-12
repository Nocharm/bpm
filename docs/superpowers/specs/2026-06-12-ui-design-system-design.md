# BPM UI 디자인 시스템 도입 설계 (Apple 파생 토큰 + 전 화면 리스타일)

작성일: 2026-06-12
대상: `frontend/` (순수 프론트엔드 — 백엔드/기능 로직 변경 0)
참고: `Nocharm/claude_design_template`의 디자인 부분(`.claude/design/styling-rules.md`, `reference/ai-portal-design-system/colors_and_type.css`) — Apple 파생 "AI Portal" 토큰 시스템.

## 배경 / 목표

BPM 프론트엔드의 시각 언어를 참고 템플릿의 Apple 파생 디자인 시스템으로 통일한다. 현재는 Geist 폰트 + zinc 팔레트 + raw hex 산재 + chrome에도 그림자 + 이모지 다수로, 참고 시스템과 정반대 지점이 많다. 디자인 룰을 먼저 확정하고(룰 문서 + 토큰 인프라), 그 토큰으로 전 화면을 리스타일한다.

**핵심 원칙(브레인스토밍 확정):**
- 룰 + 토큰 인프라 + 전체 리스타일을 한 번에 일관되게.
- 토큰·flat elevation·모션은 채택하되 **에디터 밀도는 유지**(마케팅형 여백 미적용).
- 이모지 → **Lucide 아이콘**(16px / strokeWidth 1.5).
- **Pretendard 번들**(Windows/Linux/Mac 동일 렌더, 한글 가독성).
- 라이트 전용(참고는 데스크톱 라이트) — 현재의 어중간한 `prefers-color-scheme: dark` 블록 제거.

## 비범위
- 백엔드/DB/API 변경 없음.
- 기능 로직 변경 없음(드릴인 구조·초성 검색·PNG·버전·코멘트·체크아웃 로직 불변). 순수 스타일/토큰/아이콘 교체.
- 노드 색 데이터·사용자 선택 색 팔레트는 데이터로 유지(아래 예외 조항).

---

## ① 디자인 룰 문서 — `rules/frontend/design.md`

참고 `styling-rules.md`를 BPM용으로 축약·이식한 신규 룰 문서. `CLAUDE.md`의 Language-Specific Rules 블록에 `@rules/frontend/design.md` import를 추가해 이후 프론트 작업이 이 룰을 따르게 한다.

문서 조항(요지):
1. **Raw hex 금지** — 컴포넌트/CSS에 `#xxxxxx` 직접 사용 금지. 색은 토큰 클래스(`bg-surface`, `text-ink`, `text-accent`, `border-hairline`, `text-error` 등)로만.
   - **예외(데이터)**: 사용자가 노드에 지정하는 `color`, 사이드바 색 팔레트 `COLOR_PRESETS`(선택지로서의 색 값)는 *데이터*이며 inline style/상수로 유지. 이는 chrome이 아니다.
2. **Flat elevation** — `shadow`는 떠있는 오버레이(컨텍스트 메뉴, 다이얼로그/모달, 토스트)에만. 툴바·사이드바·카드·노드·헤더·계단창은 flat. 깊이는 `border-hairline`/`border-divider` 또는 surface 색단계(`bg-surface` ↔ `bg-surface-alt` ↔ `bg-surface-pearl`)로.
3. **타입** — Pretendard. body 17px(16 아님), 굵기 사다리 **300/400/600**(500 금지). 시맨틱 스케일 사용(`text-body`, `text-caption`, `text-tagline` 등).
4. **모션** — 이징은 `ease-spring`/`ease-overshoot`/`ease-smooth`, duration은 토큰(`duration-150/350/450/700`). 인터랙션(hover/entrance)에만.
5. **UI 언어** — 영어 기본(완료). 동적 데이터·코드 주석만 한글 허용.
6. **아이콘** — 이모지 금지. 글리프는 **Lucide 16px / strokeWidth 1.5**.
7. **밀도** — 에디터 등 생산성 화면의 컨트롤은 컴팩트 유지(작은 패딩, `text-caption`/`text-fine`). 80px 섹션 간격 같은 마케팅 여백은 적용하지 않는다.

## ② 토큰 인프라 — `frontend/src/app/globals.css` (`@theme`)

참고 `colors_and_type.css` 값을 **Tailwind 4 `@theme` 블록**으로 이식 → `bg-*`/`text-*`/`border-*`/`rounded-*`/`font-*`/`ease-*` 유틸리티 자동 생성. (Tailwind 4는 config 파일 없이 CSS `@theme`로 토큰 정의 — 구현 시 Tailwind 4 문법 확인.)

### 색 토큰 (`--color-*`)
```
accent:           #0066cc   accent-focus:     #0071e3   accent-elevated:  #2997ff   on-accent: #ffffff
surface:          #ffffff   surface-alt:      #f5f5f7   surface-pearl:    #fafafc
ink:              #1d1d1f   ink-secondary:    #333333   ink-tertiary:     #7a7a7a
divider:          #f0f0f0   hairline:         #e0e0e0
error:            #cc3300   error-soft:       rgba(204,51,0,0.10)
```
### diff 토큰 (BPM 비교 화면용 신규 — 참고에 없으므로 추가)
```
added:    #16794f   added-soft:   rgba(22,121,79,0.10)
removed:  #cc3300   removed-soft: rgba(204,51,0,0.10)     /* error 재사용 가능 */
changed:  #9a6b00   changed-soft: rgba(154,107,0,0.10)
```
(현재 compare는 초록/빨강/노랑 링을 쓰며 raw hex. 위 토큰으로 매핑.)

### 폰트 토큰
```
--font-text:    "Pretendard Variable", Pretendard, -apple-system, "SF Pro Text", system-ui, sans-serif
--font-display: 동일 스택(또는 "SF Pro Display" 우선)
```
### 타입 스케일 (Tailwind 4 `--text-*` + line-height/weight)
참고 시맨틱 스케일을 이식: `tagline`(21/600), `body-strong`(17/600), `body`(17/400), `caption`(14/400), `caption-strong`(14/600), `fine`(12/400), `nav`(12/400). (hero/display/lead 등 대형은 BPM에 불필요 — 생략 가능, 필요 시 추가.)
### radius (`--radius-*`)
```
xs:5px  sm:8px  md:11px  lg:18px  pill:9999px
```
### easing / duration
```
--ease-spring:    cubic-bezier(0.16,1,0.30,1)
--ease-overshoot: cubic-bezier(0.34,1.56,0.64,1)
--ease-smooth:    cubic-bezier(0.25,1,0.50,1)
duration: 150 / 350 / 450 / 700 ms
```
### 정리
- 현재 `globals.css`의 `--background/--foreground` 임시 토큰과 `prefers-color-scheme: dark` 블록 제거.
- 기존 `drill-in-open` 키프레임/`.drill-canvas`는 유지(단 이징을 `--ease-spring`/`overshoot`로 교체 검토).
- `body`는 `bg-surface text-ink font-text antialiased`로.

## ③ Pretendard 번들

- 참고 레포에 있는 `public/fonts/PretendardVariable.woff2`를 `frontend/public/fonts/PretendardVariable.woff2`로 복사.
- `globals.css`(또는 `src/styles/fonts.css` 신규)에 `@font-face`(`font-family: "Pretendard Variable"`, `font-display: swap`, woff2 src, `font-weight: 300 600`).
- `src/app/layout.tsx`: Geist 임포트/변수 제거, `<html>`/`<body>`에서 Geist 클래스 제거, 폰트는 토큰 스택으로. `metadata`는 유지.

## ④ 전 화면 리스타일

토큰으로 교체(레이아웃·로직 불변, className·아이콘만). chrome shadow 제거, hairline/surface 단계로.

- **`layout.tsx`**: surface 배경, 라이트 전용.
- **`top-nav.tsx`**: `border-b border-hairline bg-surface`, 브랜드 `text-ink`, 유저칩 `text-ink-secondary`, 토글 버튼 flat(hairline border, hover `bg-surface-alt`).
- **`app/page.tsx`(home)**: 카드 `border-hairline bg-surface`(shadow 제거), 제목 `text-tagline`/`text-body-strong`, 생성 버튼 `bg-accent text-on-accent`, 삭제 `text-error`. 필요 글리프 Lucide.
- **`maps/[mapId]/page.tsx`(editor)**:
  - `toolButton` 공통 클래스를 flat 토큰으로(`border-hairline`, `text-ink-secondary`, hover `bg-surface-alt`, disabled opacity). 저장(primary) `bg-accent text-on-accent`.
  - 헤더/사이드바 경계 `border-hairline`, 사이드바 배경 `bg-surface`(또는 `surface-alt`).
  - **이모지 → Lucide**: 🔒→`Lock`, 📝→`PencilLine`, ⚡→`Zap`, 👤→`User`, 💬→`MessageSquare`, ↶→`Undo2`, ↷→`Redo2`, ▾(하위)→`CornerDownRight`(또는 `ChevronDown`), ←(목록)→`ArrowLeft`, 검색→`Search`, PNG→`Download`, ✓(저장됨)→`Check`, +노드→`Plus`, 브레드크럼 `›`→`ChevronRight`. 모두 16px / strokeWidth 1.5, 라벨과 함께 `inline-flex items-center gap-1`.
  - **계단창**: 활성/조상 창의 `shadow` 제거 → `border-hairline`(활성) / `border-divider`(조상) + `bg-surface`/`bg-surface-alt` 색단계로 깊이. 타이틀바 `bg-surface-alt text-ink-secondary`.
  - 상태색: 저장중 `text-ink-tertiary`, 저장됨 `text-accent`(또는 added), 실패 `text-error`. 읽기전용 배너 `bg-error-soft text-error`(또는 amber 토큰 추가).
- **`maps/[mapId]/compare/page.tsx`**: diff 색을 `added/removed/changed` 토큰으로(링·범례·요약). 카드 hairline, shadow 제거. 글리프 Lucide.
- **`components/process-node.tsx`**: 타입별 기본 테두리색(`NODE_BORDER`)을 토큰 기반으로(또는 토큰 hex를 상수에 정의하되 룰 예외로 문서화 — 권장: 토큰 CSS 변수 참조). 사용자 `color`는 데이터로 inline style 유지. 코멘트/하위변경 뱃지 Lucide. diff 하이라이트 링 토큰화.
- **`components/comment-section.tsx`**: 버튼 flat 토큰, 해결/삭제 글리프 Lucide(`Check`/`Trash2`), placeholder/empty `text-ink-tertiary`.
- **`components/context-menu.tsx`**: 오버레이이므로 **shadow 유지**(규칙상 허용), 배경 `bg-surface`, hairline, danger 항목 `text-error`.

### 노드 타입 색 처리(주의)
`process-node.tsx`의 타입별 테두리색은 chrome이므로 토큰화 대상. 다만 React Flow 노드는 inline `style={{ borderColor }}`를 쓰는 곳이 있어, CSS 변수(`var(--color-...)`)를 inline style로 참조하거나 Tailwind 클래스로 치환한다. 사용자 지정 `color`(빈 값이면 타입 기본)는 데이터 — 빈 값일 때만 타입 토큰색 적용.

## 의존성
- `lucide-react`(dependencies 추가). 이유: 이모지 대체 아이콘 시스템(참고 규칙). tree-shakeable named import.
- Pretendard woff2 자산(참고 레포에서 복사).

## 검증
- 태스크별 `npx tsc --noEmit` + `npm run lint` + (마일스톤) `npm run build`.
- **no-raw-hex 점검**: `grep -rnE '#[0-9a-fA-F]{6}' frontend/src` 결과가 (데이터 예외 — COLOR_PRESETS, 노드 color 관련, globals.css 토큰 정의부, diff/node 토큰 정의부)만 남는지 확인.
- 시각 동작은 원격이라 빌드 통과로 1차 확인 후 사용자 수동 검증(폰트 렌더, 아이콘, flat 룩, 계단창 색단계).

## 영향 파일 요약
신규:
- `rules/frontend/design.md`
- `frontend/public/fonts/PretendardVariable.woff2`
- (선택) `frontend/src/styles/fonts.css`

수정:
- `CLAUDE.md` (`@rules/frontend/design.md` import 추가)
- `frontend/package.json` (lucide-react)
- `frontend/src/app/globals.css` (토큰 @theme, font-face, dark 제거)
- `frontend/src/app/layout.tsx` (Geist 제거, 폰트 토큰)
- `frontend/src/app/page.tsx`
- `frontend/src/app/maps/[mapId]/page.tsx`
- `frontend/src/app/maps/[mapId]/compare/page.tsx`
- `frontend/src/components/top-nav.tsx`
- `frontend/src/components/process-node.tsx`
- `frontend/src/components/comment-section.tsx`
- `frontend/src/components/context-menu.tsx`

## 구현 시 주의
- `frontend/AGENTS.md`("This is NOT the Next.js you know") — layout/폰트 관련은 `node_modules/next/dist/docs/` 확인.
- Tailwind 4 `@theme` 토큰 → 유틸리티 생성 문법은 구현 시 Tailwind 4 공식 문법으로 검증(색 `--color-*`→`bg-/text-/border-`, 폰트 `--font-*`, radius `--radius-*`, 타입 `--text-*` + `--text-*--line-height`/`--font-weight-*`, 이징 `--ease-*`).
- lucide-react가 현재 Next 16/React 19와 호환되는지 설치 후 빌드로 확인.
