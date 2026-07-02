# 프론트 before/after 비교 검증 — 프론트 2 + 백 1

현재브랜치의 프론트 변경을 **분기지점과 나란히** 띄워 육안 비교하는 방법(사내 로컬/Windows 기준).

**기준점**
- A (분기지점) = `291f6d9` — "R5 cutover", 버전 라이프사이클 작업 직전
- B (현재브랜치) = `HEAD`

**원리**: 프론트 2개가 백엔드 1개(=DB 1개)를 `/api` 프록시로 공유 → 같은 데이터, UI만 다름.
프론트는 DB를 직접 안 건드리고 API로만 통신하므로 **DB(로컬 sqlite)는 비교에 영향 없다.**

---

## 0) 사전 — 좀비 dev 서버 정리

포트 3000/3001/8000에 옛 `next`/`uvicorn`가 남아 있으면 새 서버가 다른 포트로 튀거나 옛 번들에 붙어 **거짓 오류**가 난다. 먼저 정리.

```powershell
# === PowerShell (Windows) ===
Get-NetTCPConnection -LocalPort 3000,3001,8000 -State Listen -EA SilentlyContinue |
  Select-Object -Expand OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```
```bash
# === bash (macOS/Linux) ===
lsof -ti tcp:3000 -ti tcp:3001 -ti tcp:8000 | xargs -r kill -9
```

## 1) 백엔드 1개 (:8000) — 현재브랜치(HEAD) 트리에서

```powershell
# === PowerShell — backend\ 에서 ===
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```
```bash
# === bash — backend/ 에서 ===
.venv/bin/uvicorn app.main:app --reload --port 8000
```
- 반드시 **현재브랜치(HEAD) 트리의 백엔드**를 쓴다(신규 API/스키마 포함, 구 프론트와도 하위호환).
- 역할 게이트 UI(승인탭 매트릭스 등)까지 보려면 기동 전에 `DEV_ENFORCE_PERMISSIONS=true` + `BPM_SYSADMINS=admin.kim`.
  PowerShell: `$env:DEV_ENFORCE_PERMISSIONS="true"; $env:BPM_SYSADMINS="admin.kim"`

**데이터**: 로컬 sqlite(`dev.db`). 라이프사이클 신규 UI(expired/draft+점유/pending-요청 상태)를 보려면 데모시드가 필요 — `python -m scripts.reset_db`로 시드하면 데모 유저(user.park·choi·jung)와 전 케이스가 채워진다.

## 2) 프론트 A — 분기지점 `291f6d9` → :3000 (worktree)

현재 트리는 HEAD로 두고, 분기지점을 별도 worktree로 체크아웃. node_modules는 공유 안 되니 install.

```powershell
# === PowerShell — 저장소 루트에서 ===
git worktree add ..\bpm-base 291f6d9
cd ..\bpm-base\frontend
npm install
npm run dev -- -p 3000      # /api → localhost:8000 자동 프록시
```
```bash
# === bash ===
git worktree add ../bpm-base 291f6d9
cd ../bpm-base/frontend && npm install && npm run dev -- -p 3000
```

## 3) 프론트 B — 현재브랜치(HEAD) → :3001 (원래 트리)

```powershell
# === PowerShell — frontend\ 에서 ===
npm run dev -- -p 3001
```
```bash
# === bash — frontend/ 에서 ===
npm run dev -- -p 3001
```

→ 브라우저에서 `http://localhost:3000`(before) ↔ `http://localhost:3001`(after) 탭 전환하며 비교. 둘 다 같은 `:8000` 백엔드/DB를 본다.

## 4) 정리 (검증 종료 후)

```powershell
# === PowerShell — dev 서버 다 끈 뒤 저장소 루트에서 ===
git worktree remove ..\bpm-base
```
```bash
git worktree remove ../bpm-base
```

---

- 백엔드 포트를 바꾸면 프론트 기동 전에 프록시 대상 지정: PowerShell `$env:BACKEND_URL="http://localhost:8000"` (기본값이라 보통 불필요).
- worktree A는 detached HEAD(`291f6d9`)로 뜬다 — 정상. 커밋하지 말 것(비교 전용).
