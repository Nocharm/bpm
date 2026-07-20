# 설계 기록 (Design Specs) — 분야별 인덱스

기능별 설계 스냅샷(날짜별). 각 문서는 당시 결정의 근거·불변식 기록이며, **코드 주석(`// 설계: docs/superpowers/specs/…`)이 정확한 경로로 참조**하므로 파일명을 바꾸거나 옮기지 않는다. 현재 살아있는 명세는 `docs/spec.md`, 진행 로그는 `PROGRESS.md`.

## 에디터 · 캔버스
- [편집 모드 개선 5종](2026-07-17-editor-improvements-design.md) — 노드복사·SP 링크유일성·설명·Shift 축고정 등
- [인라인 펼침 드래그/좌표 버그 핸드오프](2026-07-17-inline-expand-drag-bugs-NEXT-SESSION.md) — 프리즈·축고정·복제 드리프트

## 서브프로세스 (Call Activity)
- [서브프로세스 워크플로 2건 개선](2026-07-16-subprocess-workflow-improvements-design.md)
- [서브프로세스 플레이스홀더](2026-07-19-subprocess-placeholder-design.md) — 미등록 링크·등록요청·즉시생성

## 노드 파라미터 · 내보내기
- [숫자 파라미터 5종 + Excel/CSV 내보내기](2026-07-11-numeric-params-excel-csv-export-design.md)
- [SP 파라미터 + Σ 합산 + duration 표시형(1h30m)](2026-07-11-sp-params-sum-duration-format-design.md)
- [노드 파라미터 재정의 — 회당 단가 + 비용 통화 2필드](2026-07-13-node-params-redefinition-design.md)
- [Excel 출력 1안 — 구조 노드 정리·분기 주석](2026-07-17-excel-export-format-v1-design.md)
- [Excel 출력 2안 — WBS 레벨 컬럼·형식 선택 모달](2026-07-17-excel-export-wbs-v2-design.md)
- [Word 도형 순서도 내보내기](2026-07-11-word-export-design.md)

## CSV
- [CSV로 새 맵 만들기 + 클립보드 복사 수정](2026-07-10-csv-create-flow-design.md)
- [CSV 임포트 — 이름 기준 머지](2026-07-10-csv-import-merge-design.md)

## AI
- [AI 권한 게이트 + 제안 페이로드 저장](2026-07-10-ai-gate-payload-design.md)
- [AI graph 제안 CSV 병합 파이프라인](2026-07-11-ai-graph-merge-design.md)
- [AI 사용량 계측·집계 + 매뉴얼 섹션 선별](2026-07-11-ai-usage-manual-select-design.md)

## 권한 · 워크플로 · 맵
- [맵 필수 필드 '오우닝 부서'](2026-07-10-owning-department-design.md)
- [맵 이름 변경 승인 워크플로](2026-07-18-map-rename-workflow-design.md)
- [알림 통합·삭제(퍼지)·100개 한도](2026-07-16-notification-purge-design.md)
- [새 맵 생성 시 Start·End 자동 시드](2026-07-16-new-map-start-end-seed-design.md)

## 대시보드
- [운영 대시보드 — 실운영 화면 + 접근 권한](2026-07-11-dashboard-design.md)

## UI · 홈 · 디렉터리
- [메인 탭 UX 리프레시](2026-07-17-main-tabs-ux-design.md)
- [멤버 카드 아이콘 톤·조직 레벨 아이콘](2026-07-09-member-card-icons-design.md)
- [UI 개선 배치 2 (7항목)](2026-07-09-ui-batch2-design.md)
- [Hotfix UI 6](2026-07-10-hotfix-ui-6-design.md)
- [매뉴얼 버튼 일관화 + `/manual` 드롭다운](2026-07-16-manual-buttons-rearrange-design.md)
