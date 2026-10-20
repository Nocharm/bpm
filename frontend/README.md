# BPM frontend

프로세스맵 에디터 UI — Next.js(App Router) + TypeScript + @xyflow/react. 설치·실행·테스트 명령과 저장소 구조는 루트 [`README.md`](../README.md), 작업 규칙은 루트 [`CLAUDE.md`](../CLAUDE.md).

- 에디터 본체: `src/app/maps/[mapId]/page.tsx`(단일 클라이언트 컴포넌트). 손대기 전 [`docs/lessons/`](../docs/lessons/README.md).
- 공용 컴포넌트 목록: [`COMPONENTS.md`](COMPONENTS.md)(생성 파일 — `node scripts/build-component-catalog.mjs`, 검사는 `--check`).
- 프런트 함정 모음: [`AGENTS.md`](AGENTS.md)(맨 위 Next.js 안내 블록은 `next dev`가 다시 쓴다).
- 브라우저 검증: `scripts/pw-*.mjs` — `BASE_URL=http://localhost:3000 node scripts/pw-<name>.mjs`(PowerShell: `$env:BASE_URL="http://localhost:3000"; node scripts\pw-<name>.mjs`), 캡처는 저장소 루트 `.shots/`.
