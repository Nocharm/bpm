<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## This repo — gotchas

- **Editor lives in `src/app/maps/[mapId]/page.tsx`** — one ~9400-line client component (canvas, context menu, node/edge/group creation, undo, autosave). Most editor work happens here, not in small components.
- **React Compiler breaks the build on mismatched manual memoization** — a `useCallback`/`useMemo` whose inferred deps differ from the declared array fails `npm run lint`/`build` with `react-hooks/preserve-manual-memoization` (esp. handlers that only call setState — the compiler infers the setter as the dep). Fix: make trivial handlers **plain functions** (let the compiler memoize) or align deps. Also avoid synchronous setState in effects (`react-hooks/set-state-in-effect`) — use a `reloadKey` bump or anchor-derived state.
- **Timestamps are KST.** Backend `app/clock.now()` (UTC+9) is the canonical "now" (`models._now` + routers). Display via `lib/datetime.formatKst`/`formatKstShort` (Asia/Seoul) — never raw `toLocaleString()`/`getHours()` (browser tz).
- **Generate ids with `genId()` from `@/lib/id`, never `crypto.randomUUID()`** — the server runs over plain HTTP (insecure context) where Web Crypto is undefined. Same reason `crypto.subtle`/PKCE is disabled.
- **`grep` is ugrep here and silently skips bracket dirs** (Next.js dynamic routes like `[mapId]`, `[id]`). Recursive `grep -r` can miss files under them — verify with `find`+per-file grep, Python, or Read directly.
- **Numeric param inputs use shared `ParamInput`** (`components/param-input.tsx` — typing filter, blur normalize, duration 1h30m display swap). Any new duration display site must apply `formatDurationHm` (group-bulk-modal miss precedent). Collapse state key: `bpm.paramsCollapsed`.
- **Heavy export libs (exceljs, fflate) are dynamic-import only** — a static import pollutes the editor bundle (exceljs alone is 912K; keep it in its own chunk).
