# UI 개선 3종 설계 (드릴인 계단식 창 · 전역 네비바/i18n · 단축키)

작성일: 2026-06-12
대상: `frontend/` (순수 프론트엔드, 백엔드 변경 없음)

## 배경 / 목표

프로세스맵 에디터의 UX를 3가지로 개선한다.

1. **드릴인 연출** — 노드 더블클릭 시 하위 스코프가 "새로고침되는 느낌"으로 즉시 교체되는 문제를 없애고, Windows 새 폴더 열기처럼 창이 확장되며 열리는 애니메이션 + 계단식 창 스택으로 현재 깊이/하위임을 시각적으로 명확히 한다.
2. **전역 네비바 + i18n** — UI 기본 언어를 영어로 하고, 우측 상단 전역 네비게이션 바에 유저 정보와 한/영 토글을 둔다. 번역 범위는 앱 전체.
3. **단축키** — 좌-드래그 박스 다중선택, 스페이스+드래그 화면 팬, Undo=Ctrl+Z / Redo=Ctrl+Shift+Z(기존 구현 검증·보강).

## 확정된 결정 (브레인스토밍)

- 드릴인: **계단식 창 스택** — 라이브 캔버스는 활성 스코프 1개만, 조상은 장식 프레임.
- i18n 범위: **앱 전체**.
- i18n 방식: **경량 자체 컨텍스트** (외부 라이브러리 미사용, 새 의존성 0).
- 로컬(AUTH 비활성) 유저 표시: **Guest**.
- 단축키 의미: Ctrl+Z/Ctrl+Shift+Z는 **편집 undo/redo** (이미 구현). "강제 새로고침 중복" 우려 = 브라우저 기본동작 충돌 방지(preventDefault) 보강으로 해석.

## 비범위 (이번에 하지 않음)

- 실제 Keycloak 로그인 플로우 변경 (유저 칩 표시만 추가).
- 백엔드/DB/API 변경.
- 검색·버전·코멘트 등 기존 기능 로직 변경.

---

## ① 계단식 창 드릴인

### 현재 상태
- `MapEditor`는 단일 `<ReactFlow>`를 `relative flex-1` 컨테이너에 렌더.
- `handleDrillIn` → `navigateTo` → `setScopes` → `currentParentId` 변경 → `useEffect`가 캔버스 전체를 즉시 교체(애니메이션 없음).
- 깊이 표시는 `depth > 0`일 때 뒤에 정적 2겹 카드(`page.tsx:1189-1196`)뿐.

### 변경
- 활성 캔버스를 **프레임 래퍼**로 감싼다. `scopes` 배열의 각 조상 스코프(마지막=활성 제외)마다 뒤에 **장식용 프레임**을 우하향 오프셋(레벨당 약 14px)으로 렌더. 프레임 좌상단에 스코프 제목 탭이 삐져나와 계단처럼 보인다.
- 조상 프레임/제목 탭 클릭 = 해당 인덱스로 `handleBreadcrumb` 호출(기존 브레드크럼과 동일 동작).
- 라이브 `<ReactFlow>`는 활성 스코프 1개만 유지(조상 프레임은 빈 div + 틴트, 캔버스 아님) → 성능 안전.
- 기존 정적 2겹 카드 블록은 이 동적 프레임 스택으로 대체.

### 애니메이션
- 활성 캔버스 래퍼에 `key={String(currentParentId)}` 부여 → 스코프 변경 시 remount되며 entrance 키프레임 재생.
- entrance: 좌상단 `transform-origin`에서 `scale(0.9) + translate + opacity 0 → 1`, 약 180ms ease-out. "창이 확장되며 열리는" 느낌.
- `@media (prefers-reduced-motion: reduce)`이면 애니메이션 생략.
- 정확히 클릭한 노드 위치에서 펼쳐지는 origin 추적은 선택적 폴리시 — 코어 아님(좌상단 origin으로 충분).

### 영향 파일
- `frontend/src/app/maps/[mapId]/page.tsx` (프레임 스택 렌더 + key)
- `frontend/src/app/globals.css` (entrance 키프레임, reduced-motion 가드)

---

## ② 전역 네비바 + i18n

### i18n 인프라 (신규 `frontend/src/lib/i18n.tsx`)
- `LangProvider` 컨텍스트: `lang: "en" | "ko"`, `setLang`, `t(key)`.
- 사전: `messages = { en: {...}, ko: {...} }`, 키는 평면 점표기(`"editor.save"` 등).
- 저장: `localStorage["bpm.lang"]`, 기본 `"en"`.
- SSR 안전: 서버/초기 렌더는 `"en"`, 마운트 후 localStorage에서 복원(기존 `useMounted` 패턴 재사용 또는 마운트 후 setLang). `<html lang>`은 effect로 `document.documentElement.lang` 갱신.
- `t`는 키 미존재 시 키 문자열을 그대로 반환(누락 가시화).

### 전역 네비바 (신규 `frontend/src/components/top-nav.tsx`)
- 얇은 바(h-10): 좌측 브랜드 `BPM`(→ `/` Link), 우측 **유저 칩 + EN/KO 토글 버튼**.
- 유저 정보: `AuthGate`가 로그인 후 프로필(`name`/`email`/`preferred_username`)을 **모듈 스토어**에 발행 → TopNav가 `useSyncExternalStore`로 구독. AuthProvider 밖에서 `useAuth` 직접 호출을 피한다.
  - 신규 모듈: `frontend/src/lib/current-user.ts` — `setCurrentUser(user)` / `subscribe` / `getSnapshot`, `authToken` 패턴과 동형.
  - AUTH 비활성(로컬) → 스토어 null → **Guest** 표시.
- 토글 버튼은 `LangProvider.setLang`으로 en↔ko 전환.

### 레이아웃 조정 (`frontend/src/app/layout.tsx`)
- `LangProvider`로 앱 래핑(Providers 안/밖 위치는 구현 시 결정 — 인증보다 바깥이 자연스러움).
- `body`를 flex column으로, `<TopNav>`는 `shrink-0`, 페이지 본문은 `flex-1 min-h-0`.
- 에디터 루트 `h-screen` → `h-full`로 변경(네비바 높이만큼 줄어든 영역에 맞춤).

### 문자열 교체 범위 (앱 전체)
- `frontend/src/app/maps/[mapId]/page.tsx` (에디터: 헤더 버튼/툴팁/사이드바/상태 메시지)
- `frontend/src/app/page.tsx` (홈/맵 목록)
- `frontend/src/app/maps/[mapId]/compare/page.tsx` (버전 비교)
- `frontend/src/components/*` (context-menu, comment-section, process-node 등 사용자 노출 문자열)
- `AuthGate`의 "로그인 중…"/"인증 오류" 등도 포함.
- 동적/사용자 데이터(맵 이름, 노드 제목 등)는 번역 대상 아님.

---

## ③ 단축키

### ReactFlow props (`page.tsx`)
- `selectionOnDrag` — 좌-드래그로 박스 다중선택(노드 + 그 사이 엣지).
- `panActivationKeyCode="Space"` — 스페이스 누른 채 드래그 시 화면 팬.
- `panOnDrag={[1]}` — 휠(가운데) 클릭 드래그 팬 폴백(좌-드래그는 선택에 양보).
- 기존 `onSelectionDragStart/Stop`(히스토리/자동저장)과 호환 — 박스선택 후 벌크 이동/삭제 정상 동작.
- 읽기전용(`readOnly`)에서 `nodesDraggable`은 이미 차단됨 — 선택 자체는 허용(조회 목적).

### Undo/Redo (이미 구현, 검증·보강)
- `page.tsx:319-350` keydown 핸들러 유지. Ctrl+Z=undo, Ctrl+Shift+Z=redo, Ctrl+Y=redo.
- 보강: redo 경로에서 `event.preventDefault()` 확실히 적용(이미 있음) — 브라우저 기본동작/중복 트리거 차단 검증.
- 입력 필드 포커스 시 기본동작 유지(이미 처리됨).

---

## 검증

- `npm run lint`, `npx tsc --noEmit`(또는 build의 타입체크), `npm run build` 통과.
- UI 상호작용 자동검증 불가(원격) → 빌드/타입 통과로 1차 확인 후, 수동 확인 체크리스트 전달:
  1. 노드 더블클릭 → 자식 캔버스가 좌상단에서 확장되며 열리고, 뒤에 부모 프레임이 계단식으로 보임.
  2. 조상 프레임/브레드크럼 클릭 → 상위로 복귀.
  3. 우측 상단 토글 → 전 화면 영/한 즉시 전환, 새로고침 후 선택 유지(localStorage).
  4. 로컬에서 유저 칩 "Guest" 표시.
  5. 빈 캔버스 좌-드래그 → 박스 선택(여러 노드/엣지). 스페이스+드래그 → 화면 이동.
  6. Ctrl+Z/Ctrl+Shift+Z → undo/redo, 브라우저 새로고침/중복 없음.

## 영향 파일 요약

신규:
- `frontend/src/lib/i18n.tsx`
- `frontend/src/lib/current-user.ts`
- `frontend/src/components/top-nav.tsx`

수정:
- `frontend/src/app/layout.tsx`
- `frontend/src/app/globals.css`
- `frontend/src/app/page.tsx`
- `frontend/src/app/maps/[mapId]/page.tsx`
- `frontend/src/app/maps/[mapId]/compare/page.tsx`
- `frontend/src/components/providers.tsx` (AuthGate가 current-user 발행)
- 사용자 노출 문자열 있는 `frontend/src/components/*`

## 구현 시 주의 (Next 버전)

`frontend/AGENTS.md`: "This is NOT the Next.js you know" — 코드 작성 전 `node_modules/next/dist/docs/`의 관련 가이드 확인. 본 설계는 클라이언트 컨텍스트 기반 i18n이라 Next 라우팅 i18n에 의존하지 않음(버전 리스크 최소화).
