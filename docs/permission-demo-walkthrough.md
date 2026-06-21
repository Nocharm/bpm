# Permission Workflow Demo — Walkthrough / 권한 워크플로 데모 가이드

This guide tours the full RBAC workflow straight from the screens after a DB reset.
Every entity below is seeded by `seed_permission_demo` (called from `reset_db`), with
self-describing English names so each screen reads like a step in the workflow.

이 가이드는 DB 리셋 직후 화면만으로 RBAC 전 과정을 따라가도록 돕는다. 아래 모든 엔터티는
`reset_db` 가 호출하는 `seed_permission_demo` 가 시드하며, 화면이 곧 워크플로의 한 단계로
읽히도록 영문 자기설명 이름을 쓴다.

## Seeded entities / 시드 엔터티

- Maps: **Public Process — anyone can view** (public), **Private Process — grant required**
  (private), **Roles & Principals Demo** (private), **Version Workflow Demo** (private).
- Groups: **Approved Cross-Team Group** (active), **Proposed Review Group** (pending).
- Approvers on "Roles & Principals Demo": `user.jung` (active) + `user.former` (inactive).
- 2 pending approval requests on "Roles & Principals Demo": a permission downgrade
  (`user.park` editor→viewer) and a visibility change (private→public).
- "Version Workflow Demo": a published `v1` + a pending `v2` (submitted by `user.lee`).

## Step 0 — Regenerate + run with enforcement / 리셋 후 권한 강제 모드 실행

EN: From `backend/`, `python -m scripts.reset_db`. Run the backend on `:8000` with
`DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.kim` and the frontend on `:3000`.
Switch the dev user from the login screen (the switcher persists `bpm.devUser`).

KO: `backend/` 에서 `python -m scripts.reset_db` 실행. 백엔드는 `:8000` 에
`DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.kim` 로, 프런트는 `:3000` 으로 띄운다.
dev 유저는 로그인 화면 스위처로 전환한다(선택값은 `bpm.devUser` 에 저장).

## Step 1 — admin.kim sees everything (sysadmin) / 관리자 전체 열람

EN: Log in as `admin.kim`. The map list shows all four demo maps regardless of grant —
sysadmin resolves to `owner` on every map.

KO: `admin.kim` 으로 로그인하면 grant 와 무관하게 데모 맵 4개가 모두 보인다 — sysadmin 은
모든 맵에서 `owner` 로 판정된다.

## Step 2 — Public vs Private visibility / 공개·비공개 가시성 대비

EN: Log in as `user.park`. "Public Process — anyone can view" is visible (public → viewer
baseline); "Private Process — grant required" is hidden (private, no grant for park).

KO: `user.park` 로 로그인하면 "Public Process — anyone can view" 는 보이고(public →
viewer 기본), "Private Process — grant required" 는 보이지 않는다(park 에게 grant 없음).

## Step 3 — Collaborators: 3 principal types / 협업자 3종 principal

EN: As `user.lee`, open "Roles & Principals Demo" → settings → **Collaborators / 협업자**. The
list spans all three principal types: users (park editor, choi viewer), a department
(Procurement Office editor), and a group (Approved Cross-Team Group editor).

KO: `user.lee` 로 "Roles & Principals Demo" 의 설정 → **협업자(Collaborators)** 를 열면 목록에
세 principal 유형이 모두 보인다 — user(park editor, choi viewer), department(Procurement
Office editor), group(Approved Cross-Team Group editor).

(The default UI language is Korean; tab labels render as 협업자/결재자/공개 범위/버전/결재 대기.)

## Step 4 — Pending approvals + active/inactive approvers / 결재 대기·승인자

EN: Same settings, **Pending Approvals / 결재 대기** shows 2 pending requests (park's downgrade,
the visibility change); the **Approvers / 결재자** tab shows `user.jung` (active) and
`user.former` (inactive) — the active-judgment example. No "0 active approvers" warning since
jung is active.

KO: 같은 설정의 **결재 대기(Pending Approvals)** 탭에 2건의 대기 요청(park 다운그레이드, 가시성
변경)이, **결재자(Approvers)** 탭에 `user.jung`(활성)·`user.former`(비활성)이 보인다 — 활성
판정 예시. jung 이 활성이라 "활성 승인자 0" 경고는 뜨지 않는다.

## Step 5 — Approve a request applies it / 결재 승인 시 즉시 반영

EN: Log in as `user.jung` (an approver), open the same map's **Pending Approvals / 결재 대기**,
and approve the downgrade. The request flips pending→applied and `user.park` becomes viewer in
**Collaborators / 협업자**.

KO: 승인자인 `user.jung` 으로 로그인해 같은 맵의 **결재 대기** 에서 다운그레이드를 승인하면
요청이 pending→applied 로 바뀌고 **협업자** 에서 `user.park` 가 viewer 가 된다.

## Step 6 — Group queue + group inheritance / 그룹 큐·그룹 상속

EN: As `admin.kim`, go to `/admin/permissions` → **Approval Queue / 승인 큐**: "Proposed Review
Group" (pending) awaits approval. The active "Approved Cross-Team Group" is the group editor
grant on the demo map, so `user.choi` and Procurement-Office members inherit editor through it.

KO: `admin.kim` 으로 `/admin/permissions` → **승인 큐(Approval Queue)** 에서 "Proposed Review Group"
(pending)이 승인을 기다린다. 활성 "Approved Cross-Team Group" 은 데모 맵의 group editor grant 라
`user.choi` 와 Procurement Office 멤버가 이 그룹을 통해 editor 를 상속한다.

## Step 7 — Version publish workflow / 버전 게시 워크플로

EN: Open "Version Workflow Demo" settings → **Versions / 버전**: `v1` is published while `v2` is
pending (submitted by `user.lee`), awaiting approval from `user.jung` — the publish workflow
caught mid-flight.

KO: "Version Workflow Demo" 의 설정 → **버전(Versions)** 에서 `v1` 은 published, `v2` 는
pending(제출자 `user.lee`)으로 `user.jung` 의 승인을 기다린다 — 게시 워크플로의 진행 중 단면.
