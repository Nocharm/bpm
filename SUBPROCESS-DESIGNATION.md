# 서브프로세스 지정(Designation) — 검토 트래커

스펙: `docs/superpowers/specs/2026-07-06-subprocess-designation-design.md` · 플랜: `docs/superpowers/plans/2026-07-06-subprocess-designation.md` · 브랜치: `worktree-feat+subprocess-detail`

상태 규칙: `대기` → `구현중` → `검토 대기` → `✅ 완료`. **✅는 사용자가 완료를 선언했을 때만 기록** (Claude 자체검증 후엔 "검토 대기"까지).

## 단위 현황

| 단위 | 내용 | 상태 | 커밋 |
|---|---|---|---|
| U1 | 백엔드 지정 기반 — `ProcessMap` sp_* 컬럼 7개 + PUT/DELETE `/api/maps/{id}/subprocess-designation` + pytest | 구현중 | |
| U2 | 설정 페이지 지정 UI — Subprocess 섹션(오너 전용) + 지정/수정 모달 + 해제 확인 | 대기 | |
| U3 | 라이브러리 피커 — 지정 맵만 노출(백) + 부서 칩·빈 상태(프론트) | 대기 | |
| U4 | `subprocess_refs` 동봉 + 미지정 resolved 잠금(백) + 캔버스 경고 배지·펼침 잠금(프론트) | 대기 | |
| U5 | 노드 카드 어트리뷰트 4종 표시 + 인스펙터 읽기전용 | 대기 | |
| U6 | 서브프로세스 노드 단일색 고정(색 UI 숨김 + 렌더 강제) | 대기 | |
| U7 | 데모 시드 지정 심기 + Playwright 통합 스모크 | 대기 | |

## 시현 시나리오

로컬 실행 (backend `:8000` + frontend `:3000`):

```bash
# === bash (macOS/Linux) ===
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

```powershell
# === PowerShell (Windows) ===
cd backend; .venv\Scripts\uvicorn app.main:app --reload --port 8000
cd frontend; npm run dev
```

> 권한 시현이 필요한 단위(U1·U2 오너 게이팅)는 `backend/.env`의 `DEV_ENFORCE_PERMISSIONS=true` + `BPM_SYSADMINS=admin.sys` 상태에서 로그인 피커로 계정 전환 (`docs/db-seed.md`).

### U1 — 백엔드 (화면 없음)
- 검토물: pytest 결과 + 신규 테스트 `backend/tests/test_subprocess_designation.py` 목록.
- 직접 확인(선택): 백엔드 기동 후 오너 계정으로
  `PUT /api/maps/{id}/subprocess-designation` body `{"department":"Sales"}` → 200 / 게시 버전 없는 맵 → 409 / 비오너 → 403.

### U2 — 설정 페이지
1. 오너 계정 → 게시 버전 있는 맵 → `설정(/maps/{id}/settings)` → 좌측 내비에 **Subprocess** 섹션.
2. Designate 버튼 → 모달: Department(필수)·Assignee·System·Duration 입력 → 저장 → 요약 카드 + "Last changed by …".
3. Edit → 값 수정 반영. Un-designate → 확인 다이얼로그(경고 문구) → 해제 → 재지정 시 이전 값 프리필.
4. 게시 버전 없는 맵: Designate 비활성 + 사유 문구. 비오너 계정: 섹션 자체가 안 보임.

### U3 — 라이브러리 피커
1. 에디터 → 라이브러리 패널: **지정된 맵만** 목록에 + 부서 칩 표시.
2. 전부 해제 상태면 빈 상태 문구("No designated subprocesses yet …").

### U4 — 캔버스 경고·잠금
1. 미지정 맵을 가리키는 기존 subprocess 노드: 경고 배지(삼각형) + 펼침 불가(잠금).
2. 해당 맵을 설정에서 지정 → 소비 맵 새로고침 → 경고 해소·펼침 가능.
3. 다시 해제 → 경고+잠금 복귀. 낮은 권한 계정은 지정 맵이어도 기존 잠금 배지 유지.

### U5 — 어트리뷰트 표시
1. 지정 맵을 가리키는 노드 카드에 부서·담당자·시스템·소요시간 행 표시.
2. 인스펙터: 같은 값 읽기전용(수정 불가). 오너가 설정에서 값 변경 → 소비 맵 새로고침 시 반영(라이브).

### U6 — 단일색
1. subprocess 노드 선택 → 인스펙터에 색 선택 UI 없음.
2. 과거 다른 색으로 저장된 subprocess 노드도 기본 바이올렛으로 강제 표시. 다른 타입 색 변경은 정상.

### U7 — 통합
1. `python -m scripts.reset_db` (bash: `backend/.venv/bin/python -m scripts.reset_db` / PowerShell: `backend\.venv\Scripts\python -m scripts.reset_db`) 후 데모 로그인.
2. 피커 노출 → 드래그 링크 → 어트리뷰트 표시 → 펼침 → 설정 해제 → 경고+잠금 전체 플로우.

## 변경 로그 (작업목록 추가/수정 사항)

- 2026-07-06: 트래커 생성 (U1~U7 초기 구성).
