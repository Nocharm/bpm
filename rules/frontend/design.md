# Frontend Design Rules

BPM 프론트엔드 시각 언어 — Whimsical 파생 토큰 시스템(`frontend/src/app/globals.css` `@theme`). 단일 바이올렛 액센트(`--color-accent` `#6A41FF`) + 파스텔 오브젝트 + dot-grid 캔버스가 핵심. 새 컴포넌트·리스타일 시 준수.

## 1. Raw hex 금지 — 토큰만
- 컴포넌트(JSX/TSX/CSS)에 `#xxxxxx` 직접 사용 금지. 색은 토큰 클래스(`bg-surface`, `text-ink`, `text-accent`, `bg-accent-tint`, `border-hairline`, `text-error`, `ring-added` 등) 또는 inline style의 `var(--color-*)`로만.
- **예외(데이터/출력)**: 사용자가 노드에 지정하는 `color`와 색 팔레트 `COLOR_PRESETS`(세련된 무채도 8톤 stroke — slate/teal/sage/amber/clay/rose/violet/stone), PNG export 배경색은 데이터/출력이며 chrome이 아니다 — 유지. 노드 fill은 stroke에서 `color-mix(in srgb, {color} 18%, white)`로 파생.
- **악센트 테마(개인화)** — 사용자가 화면 설정 플라이아웃에서 프리셋을 고르면 `<html>`의 `--color-accent` 하나만 바뀐다(`lib/accent-theme.ts`, localStorage `bpm.accent`, 첫 페인트 전 적용). 그래서 **악센트 계열 톤은 절대 고정 hex로 두지 않는다**: tint·tint-border·focus·elevated·sky·선택 엣지·차트 승인/초안·서브프로세스 stroke(`--color-subprocess`) 모두 `@theme`에서 `color-mix(… var(--color-accent) …)`로 파생한다. 새 보라 톤이 필요하면 같은 방식으로 토큰을 추가한다. 프리셋은 대비 검증본만(흰 바탕·흰 글씨·선택 틴트 위 글씨 4.5:1 — `accent-theme.test.ts`), 현재 바이올렛·블루·오션·플럼 4종 — 의미색과 겹치는 초록·빨강·주황·앰버·틸, 그리고 워스트 케이스에서 떨어진 로즈(서브프로세스≈End 노드·No 분기)·그래파이트(선택 상태≈중립 칩)는 제외. **어두운 면**: 새벽 하늘 위 악센트는 `--color-accent-sky`(oklch 명도 0.95 고정, 색상만 테마)이고, 캔버스 강조(노드 선택 링·드롭 영역·펼침 영역·포커스)는 `--color-accent-canvas`를 쓴다 — `.bpm-l5-sky` 안에서 자동으로 sky 톤이 된다. 하늘 프레임 밖에 그려지는 캔버스 오버레이는 `l5Charcoal`로 직접 분기. 사용자가 직접 고르는 노드 색 팔레트의 보라는 데이터라 테마를 따르지 않는다. Excel 출력처럼 CSS 변수를 못 쓰는 곳은 `getAccentHex()`.

## 2. Elevation — soft shadow 허용
- 토큰 `--shadow-sm`(노드 hover) / `--shadow-md`(카드·패널·툴바) / `--shadow-lg`(플로팅 오버레이: 컨텍스트 메뉴·다이얼로그·토스트). 쿨톤 저확산만 — 글로우·이중 그림자 금지.
- 노드·엣지·플로팅 크롬에 한해 elevation 사용. 그 외 정적 영역의 깊이는 `border-hairline`/`border-divider` 또는 surface 색단계(`bg-surface` ↔ `bg-surface-alt` ↔ `bg-surface-pearl`)로.
- **유리 레이어(`glass` 유틸리티, `globals.css`)** — 반투명 채움(`--glass-fill`) + `backdrop-filter` 블러 + `--shadow-glass`(윗변 내부 하이라이트는 유리 두께 표현으로 허용, 위 이중 그림자 금지의 유일한 예외). **모든 떠 있는 오버레이의 기본 표면**: 캔버스 크롬·칩(줌 필·미니맵·코너 칩·범례), 드롭다운·피커·메뉴, 팝오버·툴팁·호버 카드, 다이얼로그. 글자가 많은 면(피커·다이얼로그·긴 팝오버)은 `glass glass-dense`(채움 90/82% — 기본은 뒤 노드 색이 번진다). `bg-surface`/`shadow-*`와 같이 쓰지 않는다(유틸리티가 소유). **비적용**: 정적 패널·사이드바·스티키 헤더(블러 비용), 캔버스 인라인 편집기(엣지 라벨 입력), 유리 요소 안에 DOM으로 중첩된 플라이아웃(부모가 backdrop root라 부모 밖을 블러 못 함 — 불투명 `bg-surface shadow-lg` 유지, 포털로 뜨는 것은 무관). 새벽 하늘(`.bpm-l5-sky`) 위에선 `--glass-fill`이 92/84%로 올라가 크롬이 라이트로 유지된다(하늘 프레임 밖에 렌더되는 L5 크롬은 `glass-dense`로 맞춘다). 대시보드 다크 유리 카드(`bg-surface/10`)는 별개 — 이 유틸리티를 쓰지 않는다. **사용자 끄기**: 사용자 메뉴의 "Glass effect"(`lib/glass-pref.ts`, localStorage `bpm.glass`, 기본 켜짐)가 `<html data-glass="off">`를 붙이면 `.glass`가 불투명 `bg-surface`+`shadow-lg`로 돌아간다. 그래서 유틸리티는 `--glass-*` 변수로만 표면을 그린다 — 새 유리 표면도 `glass` 클래스(또는 `--glass-fill`/`--glass-bg` 변수)만 쓰면 토글이 자동으로 따라온다.
- 캔버스 배경은 `bg-canvas`(`#F6F6F8`) + dot-grid(`<Background variant="dots">`, `--color-canvas-dot`). 노드는 파스텔 fill + 1.5px 채도 stroke, 둥근 기하(`rounded-sm`/알약/마름모) 일관.

## 3. 타입
- Pretendard. 본문 17px(`text-body`), 굵기 사다리 **300/400/600**(500 금지). 유일한 예외: 홈 트리 조상 강조 이름(`globals.css` `[data-tree-name]` 호버 경로)은 500 — 600은 12px 행에서 과하다는 사용자 결정(2026-09-10).
- 시맨틱 스케일: `text-tagline`/`text-body-strong`/`text-body`/`text-caption`/`text-caption-strong`/`text-caption-title`/`text-fine`.
- **제목용 폰트 Paperlogy(400·600 두 종, `--font-display`)** — `text-body-strong`·`text-tagline`에 전역으로 붙는다(`globals.css`). **600은 화면의 머리에만**: 21px 제목·큰 숫자(`text-tagline`), 페이지 제목(`h1`), 서비스 이름·로그인 제목(`display-strong`). 나머지 17px 강조(카드 이름·구역 제목·창 제목·프로필 이름)는 400이고 크기와 폰트로 구분한다(사용자 결정 2026-11-12: 600은 꼭 필요할 때만). 본문·캡션·버튼·표·캔버스 노드는 Pretendard 그대로, 워터마크(120px)도 폭이 좁은 Pretendard. 새 강조 글자는 이 클래스로 쓰고 `font-family`를 직접 지정하지 않는다.
- **굵기 600은 두 역할에만** (사용자 결정 2026-11-12: 600은 꼭 필요할 때만) — ① 화면의 머리(위 Paperlogy 600 자리), ② 상태·강조 신호(선택된 탭, 안 읽음, 건수, 배지, 버튼 — Pretendard 600). 상태를 굵기로 알리는 글자를 본문보다 가늘게(300) 만들면 선택된 쪽이 약해 보이고, 색 바탕 위 흰 글자는 획이 묻힌다(미리보기로 확인하고 기각).
- **작은 제목(카드 제목·패널 머리글, 14px)은 `text-caption-title`(Paperlogy 400)** — 무언가를 묶는 머리(카드·패널·창·팝오버 제목, 구역 머리글, 호버 카드 이름)에 쓴다. `text-caption-strong`(Pretendard 600)은 상태·강조 신호(선택 탭, 안 읽음, 건수, 배지, 버튼)와 값에만 남긴다. 제목인지는 자리마다 사람이 정한다(자동 판정은 Draft 칩·언어 전환 글자까지 잡는다). 새 작은 제목은 600으로 쓰지 않는다.
- **폰트 후보는 실제 화면에 입혀서 고른다** — Paperlogy는 Pretendard보다 영문이 약 9% 넓고 한글은 거의 같다. 같은 600이어도 획이 굵어 보여 반복되는 글자(카드 이름)는 한 단계 낮춰야 했다. 120px 워터마크처럼 큰 글자에는 폭이 넓어 맞지 않는다.

- **설정 탭(`/settings`) 머리는 `SettingsTabHeader` 한 벌, 폭은 두 가지** — 제목·한 줄 설명·오른쪽 동작. 표와 목록은 전체 폭, 입력 폼은 576px(`max-w-xl`). 새 탭은 패널 안에서 제목을 따로 그리지 않는다(고아 참조·대시보드는 자체 구성). 목록 행 이름과 입력 라벨은 제목이 아니라 Pretendard 600 유지, 12px 소제목(인스펙터 "소유·승인자" 등)도 600 유지(12px에서 400은 아래 본문과 굵기가 같아 머리로 읽히지 않는다. 사용자 결정 2026-11-12).

## 4. 모션
- 이징 `ease-spring`/`ease-overshoot`/`ease-smooth`/`ease-glide`(처음·끝이 느린 대칭 곡선 — 되튐 없이 늘고 주는 형태 변화), duration은 `duration-150/350/450/700`. 인터랙션(hover/entrance)에만.
- **버튼 인터랙션은 전역 base(`globals.css`)에서 처리** — 모든 `<button>`은 포인터 커서 + 클릭 시 `scale(0.97)` 눌림이 자동 적용된다(`prefers-reduced-motion` 가드 포함). 컴포넌트엔 호버 배경(`hover:bg-*` 토큰)만 추가하고, 커서·클릭 눌림을 중복 정의하지 않는다.

## 5. 언어 · 아이콘
- UI 영어 기본(동적 데이터·주석만 한글). 이모지 금지 → **Lucide 16px / strokeWidth 1.5**.

## 6. 밀도
- 생산성 화면(에디터)의 컨트롤은 컴팩트 유지(작은 패딩, `text-caption`/`text-fine`). 마케팅형 대형 여백 미적용.

## 7. 라이트 전용
- 다크모드 미지원(데스크톱 라이트). `prefers-color-scheme: dark` 스타일 추가 금지.
- **L5 캔버스는 "새벽 조감도" 작업면, 예외 아님** — L5 연계 캔버스는 남색→차콜 그라데이션 하늘(`.bpm-l5-sky`, `--color-canvas-l5-sky`→`--color-canvas-l5`)을 흰 거터 위 라운드 프레임으로 띄운다. 장식(별·비네트·그리드) 없이 플랫 유지(임원 보고 톤). 크롬은 항상 라이트 — 크롬 다크 분기·토큰 플립 금지(다크 셸은 2026-09-01 폐기).
- **운영 대시보드도 같은 하늘 프레임** (2026-09-01) — 설정 > Dashboard는 상단 네브바(라이트 크롬)만 남기고 그 아래 전체(지표+사이드바)가 `.bpm-l5-sky` 라운드 프레임 하나. 워터마크·스포트라이트 없음. 카드·차트까지 전부 다크 — 유리면 `bg-surface/10`류 + 밝은 텍스트 `text-canvas`(+불투명도), 액센트는 밝힌 파생 토큰 `--color-accent-sky`(차트 막대·라인 포함), 스크롤바 `.bpm-sky-scroll`. 예외: 폼 입력(SearchSelect·date input)은 라이트 필드 유지.

## 8. 긴 글·많은 데이터 (2026-11-12 전 화면 검토)
워스트 케이스(200자 이름, 띄어쓰기 없는 110자 식별자, 노드 86개, 목록 수십 건)로 전 화면을 돌려 얻은 규칙. 새 화면은 짧은 데모 데이터만 보고 끝내지 않는다.
- **사용자가 쓴 글에는 `[overflow-wrap:anywhere]`** — `whitespace-pre-wrap`만으로는 URL·식별자처럼 끊을 곳 없는 문자열이 상자 밖으로 잘린다. 본문·답글·노트·설명 모두 해당.
- **한 줄 말줄임(`truncate`)에는 전체 글을 볼 길을 같이 둔다** — `title` 또는 툴팁. 목록에서 앞부분이 같은 이름은 말줄임 뒤에 구분이 안 된다. 높이가 흔들리면 안 되는 목록은 고른 행만 두 줄(`line-clamp-2`)로 편다(에디터 아웃라인).
- **읽기 전용으로 보여 주는 긴 글은 접는다** — 5줄에서 접고 "더 보기"(`ClampedBlock`). 펼친 채면 아래 입력 묶음이 화면 밖으로 밀린다.
- **목록 카드는 정보가 없는 줄을 만들지 않는다** — 시간·삭제만 있는 줄은 머리 줄로 올리고, 제목에 두 줄을 준다. 자주 쓰지 않는 동작(삭제)은 올리거나 포커스했을 때만 보인다.
- **고정 폭 열은 실제 값으로 잰다** — 열을 px로 고정하면 값이 잘리고 옆 열은 남는다. 값 길이가 일정한 열은 `fit-content(상한)`.
- **스크롤 위치로 "지금 구역"을 정할 때는 맨 아래를 따로 다룬다** — 아래쪽 짧은 구역은 판정 선까지 올라오지 못한다(`lib/section-spy`). 클릭으로 시작한 스크롤 동안은 판정을 잠가 누른 항목이 강조되게 한다.
- **캔버스 첫 화면은 읽을 수 있는 배율로** — 전체 맞춤이 60% 아래로 떨어지면 시작 노드 쪽을 70~100%로 연다(`lib/initial-view`). 전체를 한눈에 보는 화면(L5 캔버스·비교)은 전체 맞춤 유지.
- **큰 장식 글자는 실제 영역 폭에 맞춘다** — 워터마크는 양쪽 패널이 열린 캔버스 폭 기준으로 크기를 정하고, 긴 이름은 앞 20자만 싣는다.
- **빈 상태 문구는 지금 할 수 있는 일만 말한다** — 읽기 전용·Run 화면에서 편집이나 추가를 안내하지 않는다. 건수가 0인 항목은 한 줄로 묶어 빈 패널처럼 보이지 않게 한다.
- **ko 모드에서 영어로만 나오는 문구는 번역 키 누락이다** — 영어 고정으로 정한 용어(Draft, Check out, Run 등)만 예외. 효과 안에서 고정 문구를 상태에 넣을 때는 번역된 글이 아니라 키를 넣는다(효과가 언어에 묶이지 않게).
