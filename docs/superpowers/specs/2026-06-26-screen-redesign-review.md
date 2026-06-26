# 화면 리디자인 — 검토 문서 (시나리오 · 상태)

> 단위별 재현 시나리오 + 검토 상태. 사용자가 검토 결과를 공유하면 "검토 결과" 열을 갱신한다.
> 작업 단위·커밋 분리·시현 데이터 세팅 원칙은 작업 메모리(`frontend-review-workflow`) 참조.

## 검토 환경

| 로컬 | 브랜치 | URL | 용도 |
|------|--------|-----|------|
| NEW | `feat/frontend-ui-improvements` | http://localhost:3000 | 작업본 |
| OLD | `main` (워크트리 `bpm-baseline`) | http://localhost:3100 | 베이스라인 비교 |
| backend | 공유 | :8000 | 양쪽 `/api` |

### 시현용 데이터 세팅 (권한 시뮬레이션)
로컬 기본은 **전원 sysadmin → 전원 owner**라 viewer 상태가 없다. viewer/뷰어 시현을 위해 백엔드를 권한 시뮬레이션 모드로 기동:

```bash
# backend/ 에서
AUTH_ENABLED=false DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.kim \
  .venv/bin/uvicorn app.main:app --port 8000
```

→ `admin.kim`만 sysadmin(=모든 맵 owner), 나머지(`user.lee` 등)는 실제 역할 적용. **공개맵(map 2, 13노드)** 을 `user.lee`로 열면 `my_role=viewer`. (현재 이 모드로 기동돼 있음.)

| 시현 유저 | map 2(공개) 역할 | 용도 |
|-----------|------------------|------|
| `admin.kim` (Junho Kim) | owner | 편집자/소유자 화면 |
| `user.lee` (Minjae Lee) | **viewer** | 뷰어 읽기전용 화면 |

---

## 검토 단위 · 시나리오 · 상태

범례: 검증 = tsc/lint/build · 시현 = 브라우저 확인 · 검토결과 = 사용자 피드백(미정/OK/수정요청).

### S1 — 로그인 (commit `95f2da5`)
| 단위 | 변경 | 시나리오 (유저/URL → 기대) | 검증 | 시현 | 검토결과 |
|---|---|---|---|---|---|
| L1 | 로그인 카드 풀 레이아웃(브랜드 마크 중앙·안내문·이중 버튼·구분선·저작권 푸터) | 누구나 / `/login` → 카드 안 상단 중앙 로고 + "Sign in to Business Process Map" + 안내문 1줄 + primary/secondary + "COPYRIGHT SAMSUNG BIOLOGICS…" | ✅ | ✅ | 미정 |
| L2 | dev 로그인 모달 멤버-로우(아이콘·이름(아이디)·부서 2줄·역할 배지·hover) | `/login` → "Sign in with a test account" → 모달 행 디자인 | ✅ | ✅ | 미정 |

### S2 — 맵 설정 (commit `0a98350`)
| 단위 | 변경 | 시나리오 | 검증 | 시현 | 검토결과 |
|---|---|---|---|---|---|
| MS1 | 우측 콘텐츠 폭 768→680px(중앙) | `admin.kim` / `/maps/2/settings` → 콘텐츠 폭 680 중앙 | ✅ | ✅ | 미정 |
| MS2 | 뷰어 읽기전용 안내 옐로우 박스(`Info`+`bg-notice`) | **`user.lee`** / `/maps/2/settings` → 상단 노란 안내 스트립 | ✅ | ✅ | 미정 |

### S3 — 삭제 확인 모달 (commit `be364a3`)
| 단위 | 변경 | 시나리오 | 검증 | 시현 | 검토결과 |
|---|---|---|---|---|---|
| DM1 | 휴지통 아이콘 원 56→64px(나머지는 기존이 이미 디자인 일치) | `admin.kim` / 홈 또는 맵 설정 Danger Zone → 맵 삭제 → 모달 | ✅ | ⏳ 미오픈 | 미정 |

### S4 — 에디터 뷰어 읽기전용 모드 (commit `be364a3`)
토대: `getMap`의 `my_role` 저장 → `isViewer` → `readOnly` 통합(뷰어 편집 차단).
| 단위 | 변경 | 시나리오 (`user.lee` / `/maps/2`) | 검증 | 시현 | 검토결과 |
|---|---|---|---|---|---|
| V1 | 헤더 "View only" 배지(`Lock`) | 헤더 좌측 맵명 옆 배지 | ✅ | ✅ | 미정 |
| V2 | 헤더 아래 옐로우 안내 스트립(`Info`+`bg-notice`) | 헤더 바로 아래 노란 띠 | ✅ | ✅ | 미정 |
| V3 | 워터마크 보라 accent 14% + `Lock` + "READ ONLY"(-18°) | 캔버스 중앙 대각 워터마크(점격자 제거) | ✅ | ✅ | 미정 |
| V4 | Save→"Clone to my maps" primary(`copyMap`) | 헤더 우측 버튼. *클릭 시 승인본 없으면 토스트(409)* | ✅ | ✅(버튼) | 미정 |
| V5 | 보기전용 버전 pill | **보류** — 기존 버전 컨트롤로 열람 | — | — | 보류 |
| (회귀) | 비뷰어 에디터 무변경 | `admin.kim` / `/maps/2` → 편집 UI 정상(배지/스트립 없음, Save) | ✅ | ✅ | 미정 |

---

## 다음 단위 (예정)
S5 홈(H1 상태필터·H2 멤버 2번째줄 소속·H3 버전호버·H4 허용인원툴팁·H5 카드메타[H5b 백엔드게이트]·H6 폭) → S6 관리자 → S7 캔버스 → S8 인스펙터 탭. 각 단위 개별 커밋 + 시현 데이터 세팅 + 본 문서 갱신.
