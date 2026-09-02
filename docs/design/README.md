# 설계 기록 (Design Specs)

기능별 설계 스냅샷(날짜별). **main에 머지된 기능의 스냅샷은 폐기한다** — git history가 보존하므로 저장소에는 아직 소비될 문서만 남긴다(2026-08-12 정리, `rules/common/documentation.md`). 살아있는 명세는 `docs/spec.md`, 진행 로그는 `PROGRESS.md`.

남은 문서가 코드 주석(`// 설계: docs/design/…`)에서 참조되는 동안은 옮기거나 삭제할 때 `git grep "docs/design/"`으로 참조를 함께 정리한다. 폐기된 스냅샷의 주석 참조는 경로 없이 파일명만 남겨뒀다(git history에서 조회).

## 유지 중 (아직 소비될 문서)

- [컨설턴트 전사 프로세스 체계(7단계) 수용](2026-08-08-consultant-hierarchy-design.md) — 스키마·엔진(§5) 설계 원본. canonical(§4)은 외부 전달 양식에서 **내부 IR로 강등**(2026-08-18) — 파일 로더·CLI·웹 canonical 임포트는 제거됨.
- [인터뷰 JSON 0.4 임포트 — 최종 결과·확장 계획·한계](2026-09-01-interview-import-v04-result.md) — 이번 트랙의 **핸드오프 문서**(확정 계약·검증 수치·한계·후속 점검). 규칙 근거는 아래 설계 스냅샷.
- [인터뷰 JSON 0.4 임포트 설계](2026-09-01-interview-import-v04-design.md) — 흐름 그래프(relations) 수용·L5 연계 캔버스 시드/분기 노드·가로 자동정렬·IO 자동 연결·편집용 draft. **dev 구현 완료, main 미머지.**
- [컨설턴트 인터뷰 결과 JSON 임포트(Phase 3 어댑터)](2026-08-18-interview-import-design.md) — 인터뷰 JSON→canonical 어댑터·다중 파일 웹 임포트·키 검증 dry-run·`map_notes` 테이블. **1차 구현 dev 머지 완료** — 실파일 dry-run 대조 대기.
- [데이터 표면 패리티 — CSV 왕복·Excel·JSON 임포트 점검](2026-08-24-data-surface-parity-design.md) — 검토값(gmp·항목별 폼) CSV 왕복 확장·Excel 컬럼 확장. **미구현 이관 트랙**(system_fallback 처리 미결). §3 임포트 점검은 완료 — 실파일 dry-run만 잔여.
- [거버넌스 UX 확장 A/B/C](2026-08-08-governance-ux-design.md) — 설계 승인·**미구현** 트랙. 이양 후 오너 대량 발생 전 구현 목표.
- [인라인 펼침 드래그/좌표 버그 핸드오프](2026-07-17-inline-expand-drag-bugs-NEXT-SESSION.md) — 미해결 버그 핸드오프(보류 중).
