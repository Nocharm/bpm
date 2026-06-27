# 화면 리디자인 — 계획 · 검토 트래커 (단일)

핸드오프(`design_handoff_bpm_screens`) hifi 디자인을 기존 컴포넌트·토큰으로 재현. 브랜치 `feat/frontend-ui-improvements`(프론트 전용; 백엔드 변경은 사용자 승인 시).
**작업 표준**: 프론트 검토 가능한 작은 단위로 분할 · 단위별 커밋 · 검토 직전 시현 데이터 세팅 · 이 표를 계속 갱신. 검토 결과는 사용자 피드백을 받아 반영.

## 검토 환경
| 로컬 | 브랜치 | URL |
|------|--------|-----|
| NEW | feat | http://localhost:3000 |
| OLD | main(워크트리 bpm-baseline) | http://localhost:3100 |
| backend | 공유 | :8000 |

**시현용 권한 시뮬레이션**(viewer 화면 시현 필수 — 기본은 전원 owner):
```bash
# backend/ 에서
AUTH_ENABLED=false DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.kim .venv/bin/uvicorn app.main:app --port 8000
```
→ `admin.kim`=owner(편집 화면), `user.lee`=공개맵 map 2에서 viewer(뷰어 화면).

검증=tsc/lint/build · 시현=브라우저 · 검토결과: ✅OK / 🔧수정→반영 / ⏳미정 / ⏸보류.

## 마스터 표

| ID | 화면 | 단위 / 내용 | 검증 | 시현 | 검토결과 | 커밋 |
|----|------|-------------|------|------|---------|------|
| L1 | 로그인 | 카드 풀 레이아웃(브랜드 마크 중앙·안내문·이중 버튼·구분선·저작권 푸터) | ✅ | ✅ | ✅ OK | `95f2da5` |
| L2 | 로그인 | dev 모달 멤버-로우(아이콘·이름(아이디)·부서 2줄·역할 배지) | ✅ | ✅ | ✅ OK | `95f2da5` |
| MS1 | 맵 설정 | 콘텐츠 폭/정렬 | ✅ | ✅ | 🔧 중앙→**좌측 정렬+좌측 패딩 확대**(680 반응형) 반영 | `0a98350`·`baba689`·`9fb4701` |
| MS2 | 맵 설정 | 뷰어 읽기전용 옐로우 안내 스트립 | ✅ | ✅ | ✅ OK | `0a98350` |
| DM1 | 삭제 모달 | 휴지통 아이콘 원 56→64px(나머지는 기존이 디자인 일치) | ✅ | — | ✅ OK | `be364a3` |
| V1 | 뷰어 | 헤더 "Read only" 배지(Lock) | ✅ | ✅ | ✅ OK | `be364a3` |
| V2 | 뷰어 | 읽기전용 안내 스트립 → **사유별 일반화**(뷰어/체크아웃/비-draft) | ✅ | ✅ | ✅ OK(일반화 반영) | `be364a3`·`9f30ead` |
| V3 | 뷰어 | 워터마크 "READ ONLY" | ✅ | ✅ | 🔧 **자물쇠 제거** 반영 | `be364a3`·`9f30ead` |
| V4 | 뷰어 | 헤더 액션 | ✅ | ✅ | 🔧 클론 버튼 제거 → **Save 비활성+잠금**(copyMap은 api 유지) 반영 | `be364a3`·`9f30ead` |
| V5 | 뷰어 | 보기전용 버전 pill | — | — | ⏸ 보류(기존 버전 컨트롤로 열람) | — |
| B1 | 버그 | viewer가 허용 멤버 목록 못 봄 → **GET /permissions 게이팅 editor→viewer**(백엔드) + **프론트 게이트 완화**(map-card·map-detail-card `my_role!==null`) | backend 316✅·tsc/lint✅ | ✅ | 🔧 (a) 반영 — 백엔드+프론트 게이트 모두 완결 | `9bbfe06`·(프론트) |
| B2 | 버그 | 맵 설정 토스트 폭주 → showToast가 권한거부(403/401) 무음 + 뷰어 체크아웃 배지 `!isViewer` | ✅ | ✅ | 🔧 반영 | `9fb4701` |
| H1 | 홈 | 필터: **상태·권한 멀티셀렉트 드롭다운**(가시성 탭과 AND) + Clear 우측끝. (검토 2: 필→드롭다운, 권한 필터 추가) | ✅ | ✅ | 🔧 드롭다운·권한필터·Clear우측 반영 | `5b54887`+(검토2) |
| H2 | 홈 | 멤버 2번째 줄 유형별 — 유저=직급·말단org · 부서=구성원수·루트org1 · 그룹=구성원수·상태. (검토4: 디렉터리에 title·org_path 추가=백엔드 승인) | backend316✅·tsc/lint✅ | ✅ | ✅ OK (H2완료) | (검토4) |
| H3 | 홈 | 버전 히스토리 — 클릭 토글 상세 행(단계필·이름·아이디·**날짜/시각 필**, 같은 날짜=rowspan 박스 1개 행 높이만큼). 최신순·풀 타임스탬프·다중 펼침·모두접기 (검토6~16) | ✅ | ✅ | ✅ OK (H3완료) | (검토6~16) |
| H2b | 홈 | 멤버 카운트=아이콘+숫자 · 상세 버전:인원=2:1 · 사이 세로선(검토6: `border-hairline`로 진하게) | ✅ | ✅ | ✅ OK (H2b완료) | (검토5·6) |
| H2c | 홈 | 팀=평소 멤버수만→호버 상위소속+상위/하위 하이라이트. **유저=평소 [이름/말단부서]→호버 [이름/(아이디)/타이틀/부서레벨 작은→큰] 다행 펼침**(필=각 행·투명·롤배지 고정·클릭토글·테두리 ink-tertiary/40) (확정 사양) | ✅ | ✅ | ✅ OK (H2c완료) | (검토6~16) |
| H4 | 홈 | 카드 호버 모달 — 숫자 우측 pill·오너 카드·업데이트 맨 아래·허용인원 목록 삭제 | ✅ | ✅ | ✅ OK (완료) | (검토14·M4) |
| H5a | 홈 | 카드 3번째 줄 메타 **소유자(id)·수정시각**(프론트 가능분) | ✅ | ✅ | ✅ OK (완료) | (검토14) |
| H5b | 홈 | 카드 메타 **노드수(라이브 published)·버전수(전체)·소유자명** — 백엔드 목록 집계 + 카드 표시 | backend322✅·tsc/lint✅ | ✅ | 🔧 집계 반영 | (검토14) |
| H6 | 홈 | 좌:우 = **1:2**(flex-1 : flex-[2], 동일 max-w 캡 제거) + 컨테이너 1280. (검토 2: 폭만 됐던 것 비율 보완) | ✅ | ✅ | ✅ OK (H6완료) | `5b54887`+(검토2) |
| A1 | 관리자 | DB 테이블 **무한 스크롤** — 페이지 버튼→스크롤 append(50행/회·420ms 스피너), sticky 헤더, "N/total rows" 카운트, 끝 "All rows loaded". `admin/table-viewer.tsx` | ✅ | ✅ | ✅ OK (완료) | `9afbf64` |
| A2 | 관리자 | 유저 그룹 **카드 그리드(2열)** — 세로 리스트→`grid sm:grid-cols-2`. 카드=이름·상태·설명·멤버수. `groups/groups-panel.tsx` | ✅ | ✅ | ✅ OK (완료) | `74cb55f` |
| A3 | 관리자 | 승인 큐 권한하향·공개범위변경 **실데이터** — mock→실 API. 교차맵 목록 `GET /api/approval-requests`(sysadmin) **신규 라우트만, 스키마 무변경**. `admin/approval-queue.tsx` | backend 324✅·tsc/lint✅ | ✅ | ✅ OK (완료) | `0a98b1e` |
| A4 | 관리자 | 그룹/승인큐 **max-width**(`max-w-4xl`) + 승인 큐 **nav 배지**(대기 건수, sysadmin 선조회+`onCountChange` 갱신). `groups-panel`·`approval-queue`·`settings/page` | ✅ | ✅ | ✅ OK (완료) | (S6) |
| A5 | 관리자 | **관리자 테이블 일괄 디자인**([Image #1]) — Employees/Departments/Users 공통 셸(`admin-table.tsx`: `TableCard`·헤더 bg·divider·`RolePill`). 서브타이틀 stats는 Employees 동기화 msg 기존 유지. | ✅ | ✅ | ✅ OK (완료) | `0ddaba7` |
| A6 | 관리자 | **DB 뷰어 디자인**([Image #2]) — pill 테이블 선택(아이콘+이름+행수)·카드 헤더(`{table}` + `{total} rows · {loaded} shown`)·visibility 배지·로딩/끝. 백엔드 `/admin/tables`→`[{name,count}]`(스키마 무변경). | backend 7✅·tsc/lint✅ | ✅ | ✅ OK (완료) | `4b3f4f5` |
| A7 | 관리자 | Scheduled deletion **삭제 예정 카운트다운** — `N일/N시간 뒤 삭제`/`곧 삭제`(`deleted_at`+7일−now), **빨간 강조**(`text-error`). 절대시각 hover. `admin/deleted-maps-panel` | ✅ | ✅ | ✅ OK (완료) | `2feda2f` |
| A11 | 관리자 | **유저그룹 개선 4건**(Message 3): ①매니저=멤버 카드에서 토글(피커 삭제) ②멤버 박스=홈 상세 카드 재활용 ③**가시성 필터**(sysadmin 전체·일반 유저는 해당 그룹만) ④상단 SVG 안내 가이드(목적·신청/관리/사용). `groups-panel`·`group-detail`·`groups-guide`·`routers/groups` | ✅ backend 325 | ✅ | 🔧 ①②③④ 전부 반영 | (S6) |
| A10 | 관리자 | **승인 큐 — 전 항목 카드 + 아이콘/필 한눈**(피드백: 필=필터 아님). 종류 아이콘/필·🗺Map·역할전환(`editor→removed` 화살표)·가시성·👥멤버·★매니저·요청자 + Approve/Reject. `admin/approval-queue` | ✅ | ✅ | 🔧 카드+아이콘/필 재설계 | (S6) |
| A9 | 관리자 | **Departments 인원수 열** — org 보기 OFF(기본) 시 "Members" 열 추가(org_levels 경로 일치 집계). org ON이면 기존 orgLevels 열. `admin/department-table` | ✅ | ✅ | ✅ OK (완료) | `2feda2f` |
| A8 | 관리자 | **그룹 카드 인라인 상세**(새 페이지 X→카드 아래 펼침, 공용 `group-detail.tsx`·보기+편집) + **매니저=멤버(user) 제한**(피커 후보 제한·캐스케이드·백엔드 422). `groups-panel`·`group-detail`·`groups/[groupId]`·`routers/groups` | backend 325✅·tsc/lint✅ | ✅ | 🔧 인라인+매니저제한 반영 | (S6) |
| E1 | 편집기 | 줌 pill 좌하단(`left-3`)→**우하단**. `canvas-zoom-scale.tsx` | — | — | ⏳ | — |
| E2 | 편집기 | **미니맵** 추가 — React Flow `<MiniMap>` 좌하단(현재 부재). `page.tsx` | — | — | ⏳ | — |
| E3 | 편집기 | 프로세스 노드 테두리색 `#909098`→`#6e84a3`(fill은 `color-mix 18%` 유지). `process-node.tsx` DEFAULT_COLORS | — | — | ⏳ | — |
| E4 | 편집기 | 셀렉션 링 정확값 — `2px accent` + `0 0 0 4px color-mix(accent 12%)`(현재 Tailwind `ring-2`와 대조 보정). (E5 8방향 드롭존=스펙상 4방향 유지, 변경 없음) | — | — | ⏳ | — |
| I1 | 편집기 | 인스펙터 **탭 바**(속성/맵/승인/활동) + `inspectorTab` 상태 + 닫힘 시 우측 가장자리 "속성" 재오픈 탭, 폭 330. **현재 탭 부재**(단일 패널+하단탭) | — | — | ⏳ | — |
| I2 | 편집기 | **속성 탭** — 노드/엣지/빈상태 콘텐츠 재배치 + 엣지 선택 시 연결면 선택·엣지 삭제(현재 컨텍스트 메뉴만) | — | — | ⏳ | — |
| I3 | 편집기 | **맵 탭(신규)** — 가시성 컨트롤 + 협업자 멤버-로우(2번째줄 소속) + 엣지 스타일(하단 design 탭에서 이동, 맵 전체 통일) + 설명 | — | — | ⏳ | — |
| I4 | 편집기 | **승인 탭** — `WorkflowDashboard`를 하단 탭→상단 탭 승격 | — | — | ⏳ | — |
| I5 | 편집기 | **활동 탭(신규)** — 코멘트(속성 `<details>`에서 이동) + 버전 타임라인 통합 | — | — | ⏳ | — |
| I6 | 편집기 | 좌측 사이드바 — 단축키 가이드 카드 **선택 맥락 반응형**(노드/분기/엣지/무선택) + 검색창 위치 정렬 | — | — | ⏳ | — |

## 비고
- **S5 진행 순서**(권장): H6 → H5a → H2 → H1 → H3 → H4 → (H5b 확인 후). 각 단위 개별 커밋 + 시현 + 이 표 갱신.
- 신규 토큰: `--color-ink-muted`(#a0a0a8), `--color-notice`/`--color-notice-border`(옐로우 스트립).
- i18n: `editor.readonly.*`(사유별), `login.subtitle/or/terms`, `action.close` 등 영/한 양쪽.
- (검토11 #2, 백엔드) `create_version` 게이트 강화 — 진행중(draft/pending/rejected) 버전 1개 제한(사용자 승인). 데모 맵="Version History Demo"(approved 이력 + published 라이브 + draft 1).
