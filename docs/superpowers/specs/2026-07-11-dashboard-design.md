# 운영 대시보드 — 스텁 → 실운영 화면 + 접근 권한 — 설계

- 브랜치: `worktree-dashboard-design` (base `origin/main` b502df0)
- 대상: `frontend/src/components/settings/dashboard-panel.tsx`(185줄 스텁) 재작성 + `backend/app/routers/dashboard.py` 확장

## 목적

설정 › 분석 › Dashboard 탭은 현재 진입 카드 → 로그인 지표 3개 + AI 사용량만 보여주는 스텁이다. 진입 카드가 광고하는 범위(맵/버전 현황 · 승인 파이프라인 · 조직 · 로그인 추이)는 미구현이고 차트가 하나도 없다.

이를 **리더·경영진 보고용 대시보드**로 완성한다. 프로세스맵 도입 현황을 한눈에 보여주는 것이 목적이며, sysadmin 외에 지정된 인원·부서·유저그룹도 열람할 수 있어야 한다.

## 확정된 사용자 결정

1. 범위 — 스텁을 실운영 대시보드로 완성(백엔드 집계 확장 포함).
2. 대상 — 리더·경영진 보고용. **접근 권한을 인원/부서/유저그룹에 부여**할 수 있게 한다.
3. 권한 뷰 — 권한을 받은 비-sysadmin은 sysadmin과 **동일한 전사 대시보드**를 읽기 전용으로 본다(부서 스코프 분할 없음).
4. 섹션 — 도입 커버리지(부서별) · 누적 성장 추이 · 승인/운영 상태 · 로그인·활동 추이.
5. 기간 필터(7일/1개월/3개월/달력 지정) — **시계열 섹션에만** 적용. 스냅샷 섹션은 필터 영향권 밖.
6. 진입 구조 — 진입 카드 제거. 탭 클릭이 곧 대시보드이며, 시안대로 좌측 레일까지 대시보드화해 화면을 최대 활용한다.
7. 권한 관리 UI — 대시보드 우측에 에디터 인스펙터 같은 사이드바. sysadmin만 접근(추후 일반 유저용 탭 확장 여지를 남긴 구조).
8. 커버리지 분모 — 우측 사이드바에서 sysadmin이 **부서 목록을 선택**해 지정하고 전원에게 동일 적용.
9. 차트 — 라이브러리 도입 없이 자체 SVG/CSS 구현.

**미결 → 설계 판단으로 확정한 항목:** 기존 **AI 사용량 섹션**은 선택된 섹션 목록에도 시안에도 없지만 이미 배포된 기능이다(e1e8a81). 삭제하지 않고 **중앙 그리드 맨 아래에 sysadmin에게만 렌더**한다 — `GET /api/dashboard/ai-usage`가 sysadmin 전용 게이트를 유지하므로, 권한만 받은 비-sysadmin 뷰어에게 렌더하면 403이 난다. 리더 시연 화면에는 AI 토큰·비용이 노출되지 않는 편이 자연스럽다는 판단도 겸한다.

## ① 데이터 모델 (backend)

신규 테이블 2개. 둘 다 신규 테이블이므로 startup `create_all`이 생성한다 — `db.py _ADDED_COLUMNS` 등록은 기존 테이블에 컬럼을 더할 때만 필요하므로 **불요**. 배포 시 수동 DDL 없음.

```python
class DashboardPermission(Base):
    """대시보드 열람 권한 행 — principal(사용자/부서/그룹)에게 부여. 역할 구분 없음."""
    __tablename__ = "dashboard_permissions"
    id: int (pk)
    principal_type: str(20)   # 'user' | 'department' | 'group'
    principal_id: str(200)    # user→login_id, department→org_path, group→user_groups.id 문자열
    granted_by: str(100)
    granted_at: datetime

class DashboardCoverageDept(Base):
    """커버리지 % 분모가 되는 부서 목록 — sysadmin이 지정, 전원 동일 적용."""
    __tablename__ = "dashboard_coverage_depts"
    org_path: str(200) (pk)
    added_by: str(100)
    added_at: datetime
```

`app_settings`(key-value)를 쓰지 않는 이유: `value`가 `String(500)`이라 org_path 다수를 담은 JSON이 넘칠 수 있다.

**principal 해석 규약은 `map_permissions`와 동일하게 재사용한다** — department는 `belongs_to_department`로 하위 부서까지 포함, group은 `status='active'`인 그룹만 유효.

## ② 권한 판정 (backend)

`app/permissions/logic.py`에 순수 함수 추가:

```python
def can_view_dashboard(
    login_id: str, emp_org_path: str, user_group_ids: set[int],
    perms: list[tuple[str, str]],   # (principal_type, principal_id)
) -> bool:
    """sysadmin이면 무조건 True. 아니면 principal 매칭 1건 이상."""
```

`app/auth.py`에 `require_dashboard_viewer` 의존성을 추가하고, 대시보드 지표 라우터의 `require_sysadmin`을 이것으로 교체한다. 권한/커버리지 **설정** 엔드포인트는 `require_sysadmin`을 유지한다.

`MeOut`에 `can_view_dashboard: bool` 추가 → 프론트 `CurrentUser.canViewDashboard` → 설정 탭 레일의 `Access` 타입에 `"dashboard"` 케이스를 추가해 Analytics 카테고리 노출을 건다. (현재는 `access: "sysadmin"` 하드코딩)

## ③ 지표 API (backend)

스냅샷과 시계열을 분리한다 — 기간 필터를 움직여도 스냅샷은 재조회하지 않는다.

**`GET /api/dashboard/summary`** (기간 무관, `require_dashboard_viewer`)

| 블록 | 내용 | 출처 |
|------|------|------|
| maps | total · published · draft(편집 중) · trashed(휴지통) | `process_maps` + `map_versions.status` |
| version_status | published / draft / approved / pending / rejected 건수 | `map_versions.status` |
| coverage | `depts_total`(지정 부서 수) · `depts_with_map` · `coverage_pct` · 부서별 행 `[{org_path, korean_name, maps, published}]` · `missing[]`(맵 0개 부서) | `dashboard_coverage_depts` × `process_maps.owning_department` (하위 부서 포함 매칭) · 한글명은 `dept_info` |
| ops | `unresolved_comments` · `unread_notifications`(본인 기준) · `checkout_requests`(pending) | `comments` · `notifications` · `checkout_requests` |
| recent_events | 최근 버전 이벤트 N=10건 `[{kind, map_name, version_label, actor_name, occurred_at}]` | `version_events` |

**`GET /api/dashboard/timeseries?from=&to=`** (`require_dashboard_viewer`)

- `logins: [{date, count}]` — `login_records.occurred_at` 일별 집계
- `growth: [{date, maps_created, versions_created}]` — `process_maps.created_at` · `map_versions.created_at` 일별 집계

`from`/`to`는 KST 날짜(YYYY-MM-DD). 프리셋(7일/1개월/3개월)도 프론트가 날짜로 환산해 같은 파라미터로 보낸다 — 서버는 프리셋 개념을 모른다. 기간 상한은 366일(초과 시 422).

**`GET /api/dashboard/ai-usage`** — 기존 그대로, `require_sysadmin` 유지.

**설정 API** (모두 `require_sysadmin`)
- `GET /api/dashboard/permissions` → 권한 행 목록(이름 해석 포함)
- `POST /api/dashboard/permissions` → 행 추가(중복이면 409)
- `DELETE /api/dashboard/permissions/{id}` → 행 삭제
- `GET /api/dashboard/coverage-depts` → 지정 부서 목록
- `PUT /api/dashboard/coverage-depts` → 목록 통째 교체(멱등)

## ④ 화면 (frontend)

Dashboard 탭 선택 시 **설정의 좌측 탭 레일을 대시보드 전용 풀블리드 레이아웃으로 교체**한다(`settings/page.tsx`에서 `current === "dashboard"`이면 별도 렌더 분기). 진입 카드 단계는 제거하고, 좌상단 '설정으로 돌아가기'가 복귀 경로가 된다.

3열 구성:

- **좌측 요약 레일** — "운영 현황" 헤더 + 기준 시각. 스탯 카드(전체 맵 · 게시본 · 편집 중 · 휴지통). 하단에 미니 지표 리스트(미해결 코멘트 · 미읽음 알림 · 점유 이전 요청).
- **중앙 지표 그리드** — ① 로그인·활동 추이(세로 막대 + 기간 필터) ② 누적 성장 추이(라인, 같은 기간 필터) ③ 버전 상태 분포(가로 막대) ④ 부서별 도입 현황(가로 막대 + 커버리지% + 미작성 부서) ⑤ 최근 버전 이벤트(리스트). ①②만 기간 필터 영향권이며, 나머지 카드에는 '현재 기준' 표기를 둔다.
- **우측 사이드바** — 에디터 인스펙터형. 탭 2개: **Access**(권한 행 추가/삭제 — 인원·부서·그룹 피커) · **Coverage**(커버리지 분모 부서 선택). sysadmin에게만 보이며, 탭 배열 구조라 추후 일반 유저용 탭을 더할 수 있다.
- **AI 사용량** — 중앙 그리드 맨 아래, sysadmin에게만 렌더(위 결정 참조). 비-sysadmin 뷰어에게는 섹션 자체가 없다.

**신규 파일** — `frontend/src/components/dashboard/`
- `stat-card.tsx` · `bar-chart.tsx`(세로 막대) · `line-chart.tsx` · `hbar-list.tsx`(가로 막대 리스트 — 버전 상태·부서 커버리지 공용) · `period-filter.tsx`(7일/1개월/3개월/달력) · `access-sidebar.tsx`(우측 사이드바)
- `dashboard-panel.tsx`는 조립 역할로 재작성

**순수 함수** — `frontend/src/lib/dashboard-chart.ts`: 축 스케일·틱 계산, 프리셋→날짜범위 환산. vitest 대상.

**피커 재사용** — 인원/부서/그룹 선택은 맵 권한 패널의 기존 피커 컴포넌트를 재사용한다(드롭다운은 body portal + fixed — `search-select` 규약).

## 검증

- **pytest** — `can_view_dashboard` 판정 4케이스(sysadmin · user 행 · department 하위 소속 · group active/비active), summary 집계(커버리지 분모·미작성 부서), timeseries 경계(from>to → 422, 366일 초과 → 422), 설정 API 403(비-sysadmin), 열람 API 403(권한 없는 유저) / 200(권한 부여된 유저).
- **vitest** — `dashboard-chart.ts` 스케일·틱·프리셋 환산.
- **tsc --noEmit · ruff · eslint · next build** 전 게이트 초록.
- **Playwright** — 대시보드 렌더(좌 레일 스탯 · 차트 · 우 사이드바), 기간 필터 전환 시 시계열만 갱신되고 스냅샷 카드는 불변임을 확인.

## 비범위

- 프로세스 규모·업무량 지표(총 노드 수, duration/headcount/cost 합계) — 이번 섹션 선택에서 제외.
- 부서 스코프 대시보드(부서장이 자기 부서만 보는 뷰) — 전사 동일 뷰로 확정.
- 대시보드 데이터 export(CSV/PNG).
- 최상위 `/dashboard` 페이지 승격 — 설정 탭 안에 유지.

## 함정 메모

- **KST** — 모든 일자 버킷은 `app/clock.now()`(UTC+9) 기준. 프론트 표시는 `lib/datetime.formatKst` 계열만 사용(브라우저 tz 금지).
- **신규 테이블은 `_ADDED_COLUMNS` 불요** — `create_all`이 생성. 반대로 `MeOut`은 스키마이므로 DDL과 무관.
- **커버리지 매칭** — `owning_department`가 지정 부서의 **하위 경로**일 수 있다(`belongs_to_department` 규약). 정확 일치로만 세면 수치가 과소 집계된다.
- **미읽음 알림은 본인 기준** — 전사 합계가 아니다. 라벨에 명시한다.
- **React Compiler** — 핸들러는 평범한 함수로 두고 수동 memo를 남발하지 않는다(`preserve-manual-memoization` 빌드 실패).
