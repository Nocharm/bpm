<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## This repo — gotchas

- **Editor lives in `src/app/maps/[mapId]/page.tsx`** — one ~3800-line client component (canvas, context menu, node/edge/group creation, undo, autosave). Most editor work happens here, not in small components.
- **Generate ids with `genId()` from `@/lib/id`, never `crypto.randomUUID()`** — the server runs over plain HTTP (insecure context) where Web Crypto is undefined. Same reason `crypto.subtle`/PKCE is disabled.
- **`grep` is ugrep here and silently skips bracket dirs** (Next.js dynamic routes like `[mapId]`, `[id]`). Recursive `grep -r` can miss files under them — verify with `find`+per-file grep, Python, or Read directly.
