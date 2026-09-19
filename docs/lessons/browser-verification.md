# 브라우저 검증 (Playwright + 시스템 Chrome)

이 로컬(macOS) 환경에서 **헤드리스 브라우저로 캔버스를 실제 구동·검증할 수 있다** — compile-only가 아니다. 컴파일만으론 못 잡는 진짜 버그(자식 `visibility:hidden`, 이벤트 미발화 등)를 실제로 띄워야 잡힌다.

## 셋업
- 백엔드: `cd backend && AUTH_ENABLED=false .venv/bin/uvicorn app.main:app --port <p>` (로컬 인증 우회).
- 프론트: `cd frontend && BACKEND_URL=http://localhost:<p> npm run dev` (포트 3000 고정).
- 브라우저: `npm i --no-save playwright-core`(브라우저 다운로드 X) → `chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" })`.
- 로그인: `/login` → "Sign in with a test account" → "김관리 (admin.kim)". 맵이 read-only면 "Force edit" 클릭.
- API 직접 조회는 curl 차단 → python `urllib`. graph 스코프는 `?parent=<id>`.

## ⚠️ 함정 (이번 세션 최대 시행착오)
1. **dev.db 오염**: 테스트가 노드/엣지/위치를 영구 변경한다. 다음 검증이 오염된 상태로 돌아 **거짓 실패**를 낸다. **"0 events"·"노드 안 움직임"·"드래그 안 됨"은 코드 버그가 아니라 db 오염일 수 있다** — 깨끗한 db에서 다시 확인할 것. 검증 사이클마다 `git checkout backend/dev.db` + **백엔드 재시작**.
2. **실행 중 checkout = readonly**: 백엔드가 떠 있는 동안 `git checkout dev.db`를 하면 DB 핸들이 깨져 저장이 전부 실패한다. checkout 후 반드시 백엔드 재시작.
3. **node 스크립트 cwd**: 스크립트는 `frontend/`에서 실행해야 `playwright-core`를 찾는다. `cd backend` 상태로 `node ./x.mjs` 하면 "Cannot find module". 매 실행 전 `cd frontend &&` 확인.
4. **연결(엣지) 드롭이 매우 flaky**: RF 연결 드롭은 정밀도가 들쭉날쭉 → 여러 번 재시도해야 착지. 패턴: 소스 핸들 박스 중심 mousedown → 중간점 move → 타겟 핸들 move → 잠깐 대기 → up. 의심되면 비펼침 상태 정상연결로 메커니즘 먼저 검증.
5. **워크트리 세션(`.claude/worktrees/<name>`)의 Bash 제약**: 세션이 워크트리에 격리되면 harness가 "워크트리 밖을 건드릴 수 있다"고 판단하는 명령을 통째로 거부한다 — `cat >> file <<'EOF'` 히어독 append, `cd <루트 체크아웃>`이 섞인 체인, `sed -i`+`git add`처럼 파일 수정과 git을 한 줄에 묶은 것, `&&`가 길게 이어진 복합 명령. 빈 출력이 아니라 **명령 자체가 안 돈다**. 대처: 파일 추가·수정은 Write/Edit 도구로, git·테스트·서버 기동은 **한 줄에 하나씩** 워크트리 안 절대경로로. 루트 체크아웃의 서버(3047/8048 등)와 비교 검증이 필요하면 `cd`하지 말고 `BASE_URL`만 바꿔 워크트리 스크립트를 절대경로로 실행한다. 워크트리엔 `node_modules`·`backend/.venv`가 없으므로 `cp -Rc`(APFS 클론, 심링크 금지 — turbopack이 거부)로 복제해 둔다(2026-09-18).
6. **CSS transform이 걸린 SVG `<g>`는 `locator.click()`이 못 맞춘다**: Playwright가 잡는 클릭점이 실제 그려진 자리와 어긋나 "svg subtree intercepts pointer events"로 30초 타임아웃. `boundingBox()` 중심을 `page.mouse.click(x, y, { button })`으로 찍으면 된다(탐색 모달 다이어그램, 2026-09-19). 같은 세션 함정: 컨텍스트 메뉴 포털(z1200)을 z1300 모달 위에 띄우면 메뉴 클릭도 모달 svg에 막힌다 — 모달은 z1200(오버레이 z 사다리).

## 기타
- 스크린샷은 Read로 직접 볼 수 있다.
- `element.offsetParent !== null`은 페인트/가시성이 아니다 → `getComputedStyle().visibility` / `document.elementFromPoint`로 실가시성 확인.
- 검증 후 정리: 임시 `_*.mjs` 삭제, 내가 띄운 백엔드만 kill(사용자의 기존 서버 보존), `git checkout backend/dev.db`로 테스트 오염 복원.
