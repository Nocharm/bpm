# Handoff — `feat/frontend-ui-improvements` (UI 리디자인 S6: 유저 그룹·승인큐·휴지통·피커 모달)

> 세션 정리용 핸드오프. 진행 상세는 `SCREEN-REDESIGN.md`(마스터 트래커)·`PROGRESS.md`(커밋 로그) 참조.
> 작성: 2026-06-28. 브랜치 `feat/frontend-ui-improvements` (메인 미머지).

## 1. 한 줄 요약
S6 관리자/유저그룹 화면 리디자인을 다수 단위로 진행·검증 완료. **유저 그룹 라이프사이클(L1~L6)·승인 큐(A10/A13)·휴지통(L5)·피커 모달 UX**가 핵심. 마지막 남은 **D1(Departments 고아조직 재연결)은 보류**.

## 2. 이번 작업으로 완료된 것 (브랜치 커밋, 전부 브라우저 검증)
- **유저 그룹 라이프사이클** 생성→신청(철회)→승인/거절→활성/재신청→비활성→삭제(휴지통 7일):
  - 백엔드: `withdraw`·`deactivate`·`reactivate`·`rename`(active·주1회 `name_changed_at`·전역 중복금지)·`delete` 게이트(active→비활성먼저)·`GET /groups/deleted`·`POST /groups/{id}/restore`. **비활성 시 그 그룹의 `map_permissions` 삭제**(잔존 방지). 스키마 추가 2개(`user_groups.deleted_at`, `name_changed_at`) — 사용자 승인됨. **backend 340 passed**.
  - 프론트: 상태별 액션 버튼(`GroupActions` 컴포넌트, 카드 헤더 우측), 확인 모달(삭제/비활성/재활성/복구/매니저변경 — 아이콘+간결 줄), 재신청=생성 모달 프리필, 멤버 카드 호버 컨트롤(Remove·매니저 토글, ★배지 항상), 정렬(매니저→유저→팀), add member=피커 다중선택+일괄.
- **승인 큐**: 간소 카드+클릭 펼침(A10), 가시성 before→after `Private→Public`(A13, payload `from_visibility` 추가)·버튼 아이콘화, 요청자=유저 카드(이름 우선·아이디·소속)·날짜 별도 행.
- **휴지통(Scheduled deletion)**: 맵+유저그룹 두 섹션, Restore 확인 모달.
- **유저그룹 가이드(L3)**: 라이프사이클 5상태 SVG + 되돌리기·매니저 권한 아이콘/키워드 칩(PPT식).
- **피커 모달 UX**: 빈 포커스 시 전체 옵션 노출·이름 중복 검사·**Esc로 드롭다운 닫기**·명단 영역 **높이 미리 확보**(맵 협업자 3.5행/결재자 1.5행·그룹 add-member 칩)+자동숨김 스크롤(`.scroll-soft`).
- **공용 컴포넌트**: `ConfirmDialog`(리치 폼), `IconActionButton`(아이콘 전용·호버 라벨 펼침+hint 보고), `GroupActions`.
- 그 외 머지 전 단위: A1~A9·A11·H4·MS1·V2~V4·B1·B2·H1·H5b 등(트래커 ✅).

## 3. 현재 상태 / 검증
- 로컬 검증: `frontend` `npx tsc --noEmit` 0, `npx eslint` 0. `backend` `pytest tests/ -q` **340 passed**.
- 브라우저: 시스템 Chrome으로 settings/유저그룹·맵 생성 모달 실구동 검증(스크린샷). **호버는 자동 트리거 불가** → JS로 hover state 강제해 시각 확인.
- 서버(원격 IP)·docker 검증은 **미수행**(로컬 네이티브만). 머지 전 서버 배포 검증 필요.

## 4. 검토용 데모 데이터 (이번 세션 생성, dev.db)
유저 그룹 전 상태를 덮는 세트 — settings → User Groups:
| 그룹명 | 상태 | 검토 포인트 |
|---|---|---|
| 운영 활성 그룹 | active | 유저+부서 멤버·복수 매니저, rename/deactivate, add member, 매니저 토글, 정렬 |
| 신청 대기 그룹 | pending | Pending 배지·Withdraw·**승인 큐**에 노출 |
| 비활성 그룹 | inactive | Reactivate/Delete |
| 반려 그룹 예시 | rejected | 자동삭제 카운트다운·Re-request(프리필)/Delete |
| 휴지통 복구 예시 외 | trash | **Scheduled deletion** 탭에서 Restore(확인 모달) |
| 구매 검토 위원회 v2 외 | active | 추가 활성 예시 |

> dev.db 한정. `python -m scripts.reset_db` 하면 사라짐 → 재시드 필요(아래 §7 프롬프트에 시드 지시 포함하거나 API로 재생성).

## 5. 남은 일
- **D1 (보류)**: Departments 고아조직 재연결. 고아 정의 = **노드 어트리뷰트(부서 중 선택)인데 AD갱신 부서와 매칭 안 됨**. 착수 전 **노드의 부서 어트리뷰트 규칙을 코드 조사**(어떤 필드·어떻게 부서 선택) → 고아 탐지/재매핑 백엔드 + Departments 서브탭 UI([Departments | Orphan orgs], Show org columns 우측 이동).
- 편집기 화면 **E1~E4**(줌 pill 우하단·미니맵·노드 테두리색·셀렉션 링), 인스펙터 **I1~I6**(탭 시스템) — 트래커 ⏳.
- **V5 보류**(보기전용 버전 pill).
- **머지 전**: 서버 docker-compose 배포 검증(원격 IP·평문 HTTP 컨텍스트 — `genId()`/PKCE 비활성 전제).

## 6. 운영 메모(중요 제약)
- 백엔드/DB **스키마 변경은 사용자 확인 필수**(이번에 deleted_at·name_changed_at·from_visibility는 승인받음). from_visibility는 JSON payload라 무스키마.
- LF 고정·`genId()`(crypto.randomUUID 금지)·디자인 토큰만(raw hex 금지)·UI 영어/데이터 한글.
- 백엔드 라우트 순서: `/groups/deleted`·`/groups/name-available`는 `/groups/{group_id}`보다 **먼저** 등록(경로 충돌).
