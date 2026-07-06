# 서브프로세스 지정(Designation) — 검토 트래커

스펙: `docs/superpowers/specs/2026-07-06-subprocess-designation-design.md` · 플랜: `docs/superpowers/plans/2026-07-06-subprocess-designation.md` · 브랜치: `worktree-feat+subprocess-detail`

상태 규칙: `대기` → `구현중` → `검토 대기` → `✅ 완료`. **✅는 사용자가 완료를 선언했을 때만 기록** (Claude 자체검증 후엔 "검토 대기"까지).

## 단위 현황

| 단위 | 내용 | 상태 | 커밋 |
|---|---|---|---|
| U1 | 백엔드 지정 기반 — `ProcessMap` sp_* 컬럼 7개 + PUT/DELETE `/api/maps/{id}/subprocess-designation` + pytest | 검토 대기 | `60a7c8f` |
| U2 | 설정 페이지 지정 UI — Subprocess 섹션(오너 전용) + 지정/수정 모달 + 해제 확인 | 검토 대기 | |
| U3 | 라이브러리 피커 — 지정 맵만 노출(백) + 부서 칩·빈 상태(프론트) | 검토 대기 | `df202f3` + 프론트 |
| U4 | `subprocess_refs` 동봉 + 미지정 resolved 잠금(백) + 캔버스 경고 배지·펼침 잠금(프론트) | 검토 대기 | `d45c63a` + 프론트 |
| U5 | 노드 카드 어트리뷰트 4종 표시 + 인스펙터 읽기전용 | 검토 대기 | `a6eb74c` |
| U6 | 서브프로세스 노드 단일색 고정(색 UI 숨김 + 렌더 강제) | 검토 대기 | `2b16e1e` |
| U7 | 데모 시드 지정 심기 + 통합 스모크 | 검토 대기 | |

## 검토 피드백 수정 (2026-07-06 1차 검증 — main 머지 `2190e54` 후)

| 항목 | 내용 | 상태 | 커밋 |
|---|---|---|---|
| F1 | 비교화면에서 subprocess 노드와 연결된 엣지 미표시 | 검토 대기 | |
| F2 | subprocess 2개 연쇄 시 앞 노드 펼치면 대표엔드→다음 subprocess 엣지 소실(접으면 정상) | 검토 대기 | |
| F3 | 임베드 스타트/엔드 핸들 엣지 끌기 차단 + 접었을 때 대표엔드 포함 모든 엔드가 다음 노드로 연결 | 검토 대기 | |
| F4 | subprocess 더블클릭 → 편집 모달로 맵핑 변경(현행 프레임 변동 제거), 내부→외부 연결도 차단 | 검토 대기 | |
| F5 | subprocess 타이틀 편집 차단 — 링크된 맵 이름 그대로 사용(캔버스 인라인·인스펙터·편집 모달·컨텍스트 메뉴) | 검토 대기 | |
| F6 | 펼침 레인 헤더 — 맵 이름 호버 강화(액센트+밑줄) + "링크맵 열기" 소형 아이콘 버튼 + 이탈 확인 모달(미저장 경고) 후 이동 | 검토 대기 | `229401f` |
| F7 | 아이콘 모달 텍스트 말줄임(…) → 줄바꿈(break-keep) 전문 표시 — ConfirmDialog 공통(전 아이콘 확인 모달) + 맵 삭제 모달 맵 이름 + 노드 편집/요약 모달 헤더 제목 | 검토 대기 | `620a2cd` `df2c8e0` |
| F8 | 좌측 사이드바 노드 검색 — 플레이스홀더 축약("노드 검색 (/)") + 단축키 Ctrl+K → `/` (레전드·매뉴얼 문서 동기 갱신) | 검토 대기 | |

### F1~F5 원인·수정 요약 (2026-07-06)
- **F1** 원인: 비교 엣지는 전부 4변 핸들(t-/s-)로 재매핑되는데 **unchanged** subprocess만 diff 마커가 없어 전용 핸들(SubprocessHandles)을 렌더 → 엣지 앵커 실패. 수정: compare가 노드에 `sideHandles` 주입, subprocess 렌더가 diff 또는 sideHandles면 4변 핸들.
- **F2** 원인: 펼침 게이트웨이(진출→후속)가 targetHandle을 `t-left`로 하드코딩 — 후속이 subprocess면 그 핸들이 없음. 수정: 게이트웨이를 `withSubprocessHandles`로 보정(subprocess target→`in`, source→`__primary__`).
- **F3** 원인: 노드 레벨 `connectable:false`는 있었으나 Handle 컴포넌트가 `isConnectable`을 forward하지 않아 무효. 수정: ProcessNode가 isConnectable을 전 핸들에 전달(임베드 자식 전체 — 시작/끝 포함 — 끌기 차단). 접힘 시 전체 엔드 연결: 명시 엣지 없는 끝 핸들에 표시 전용 엣지(`sp-ends:*`)를 파생해 대표끝의 다음 노드로 수렴(저장·선택 불가).
- **F4** 수정: 노드 더블클릭 = 편집 모달(subprocess 포함, 드릴인 제거 — 딥뷰는 임베드 자식 더블클릭 경로 유지). 내부→외부 연결 차단은 F3와 동일 메커니즘.
- **F5** 수정: 타이틀 편집 4개 진입점 차단 — 캔버스 인라인(NodeTitle editable=false + startRename 가드), 인스펙터 제목 disabled, 편집 모달 제목 disabled, 컨텍스트 메뉴 "이름 변경" 숨김.
- 검증: 브라우저(:3001) — 비교화면 unchanged subprocess 엣지 표시, 펼침 시 End·End B→다음 subprocess 게이트웨이 유지, 임베드 핸들 connectable 클래스 제거(루트는 유지), `sp-ends:` 합성 엣지 DOM 확인, 더블클릭 모달+제목 비활성(모달·인스펙터). lint 0·build 성공. (시연 보강 데이터: 맵1 v5에 End B, 맵2 v11/v12에 연쇄·lineage — 로컬 dev.db 전용.)
- 관찰(범위 외): 인스펙터 노드 타입 라벨이 subprocess에서 "프로세스"로 표시(NODE_TYPE_OPTIONS에 subprocess 부재 → 폴백). 별건으로 처리 가능.

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
2. **시드 기본 상태**: 지정 4종 = Order Fulfillment·Incident Response·Customer Support·Release Pipeline (부서=오너 소속, 시스템/소요시간 세팅). `taeyang.oh`로 `/maps/2`(Employee Onboarding) draft(Release 6) 열기 → 하단에 subprocess 노드 2개: **Order Fulfillment**(지정 — 펼침·어트리뷰트) / **Procurement Flow**(미지정 — 경고+잠금).
3. 라이브러리 피커 → 지정 4종만 + 부서 칩. 이후 설정에서 해제/지정 토글하며 경고·피커 변화 확인.

## 변경 로그 (작업목록 추가/수정 사항)

- 2026-07-06: 트래커 생성 (U1~U7 초기 구성).
- 2026-07-06: U1 구현 — 신규 테스트 6종(지정 성공·게시버전 409·비오너 403·부서 422·수정 시 지정시각 유지·해제 멱등/프리필). 전체 회귀 411 passed, ruff 클린. 상태 → 검토 대기.
- 2026-07-06: U2 구현 — 설정 Subprocess 섹션(오너 전용)·지정/수정 모달(부서 필수, BPM 피커 재사용)·해제 ConfirmDialog·최근 변경 이름 우선 표기. 브라우저 검증(오너 sion.seo3 지정→해제→프리필 재지정, 에디터 daehyun.seo 섹션 숨김). lint 0 errors. 상태 → 검토 대기.
- 2026-07-06: 로컬 시현 환경 — 워크트리 서버는 backend :8001 / frontend :3001 (메인 체크아웃 서버와 포트 분리). dev.db는 reset_db로 신규 시드.
- 2026-07-06: U3 구현 — 라이브러리 목록 지정+미삭제 필터·어트리뷰트 동봉(백, `df202f3`), 피커 부서 칩·빈 상태 안내(프론트). 기존 테스트 2건 게시+지정 플로우로 갱신(정책 변화 의도 주석). 브라우저: 지정 맵 1건+Fulfillment Part 1 칩, 전체 해제 시 안내 문구. 상태 → 검토 대기.
- 2026-07-06: 시현 데이터 — 맵 1(Order Fulfillment) 지정 상태(부서 Fulfillment Part 1·SAP ERP·3 days), 나머지 11개 미지정 → U4 경고·잠금 시연에 활용 예정.
- 2026-07-06: U4 구현 — refs가 `/graph/all`에 빠져 있던 것 보강(에디터 실제 로드 경로). 캔버스: 미지정 경고 삼각형 배지(`subprocess-undesignated-badge`)+펼침 봉인, 지정 노드는 기존 임베드 펼침 정상. 시연 노드 2개(맵2 draft, DB 로컬 전용 — 커밋 안 됨): `demo-sp-undesig`(→맵3 미지정)·`demo-sp-desig`(→맵1 지정). 지정↔해제 라이브 전환 검증. 상태 → 검토 대기.
- 2026-07-06: U5 관찰 — 노드 표시 필드 localStorage 영속이 리로드 시 기본값(담당자만)으로 복귀하는 기존 현상(복원 effect 있음에도). 본 작업 범위 외 — 필요 시 별도 수정.
- 2026-07-06: U7 구현 — 시드에 지정 4종(`DESIGNATED_SPECS`) + Employee Onboarding draft에 소비 노드 2개(`m2-sp-designated`/`m2-sp-undesignated`) 정식 반영(U4의 임시 수동 노드 대체). 계획의 `test_seed_invariants` 확장은 해당 파일이 normalize 스크립트 전용이라 **reset_db 실행 검증으로 대체**(지정 4행·노드 2행 확인). 통합 스모크: 피커 4종+칩 → 경고 1·펼침 1 → 임베드 자식 3(`m2-sp-designated/m1v5-*`) → 인스펙터 카드. 최종 회귀: pytest 415·ruff(scripts 포함)·lint 0·build 성공. 상태 → 검토 대기.
