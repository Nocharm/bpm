# 설계 기록 (Design Specs)

기능별 설계 스냅샷(날짜별). **main에 머지된 기능의 스냅샷은 폐기한다** — git history가 보존하므로 저장소에는 아직 소비될 문서만 남긴다(2026-08-12 정리, `rules/common/documentation.md`). 살아있는 명세는 `docs/spec.md`, 진행 로그는 `PROGRESS.md`.

남은 문서가 코드 주석(`// 설계: docs/design/…`)에서 참조되는 동안은 옮기거나 삭제할 때 `git grep "docs/design/"`으로 참조를 함께 정리한다. 폐기된 스냅샷의 주석 참조는 경로 없이 파일명만 남겨뒀다(git history에서 조회).

## 유지 중 (아직 소비될 문서)

- [컨설턴트 전사 프로세스 체계(7단계) 수용](2026-08-08-consultant-hierarchy-design.md) — 스키마·엔진(§5) 설계 원본(`models.py`·임포트 엔진이 주석으로 참조). canonical(§4)은 외부 전달 양식에서 **내부 IR로 강등**(2026-08-18) — 파일 로더·CLI·웹 canonical 임포트는 제거됨.
- [컨설턴트 인터뷰 결과 JSON 임포트(Phase 3 어댑터)](2026-08-18-interview-import-design.md) — 인터뷰 JSON→canonical 어댑터·다중 파일 웹 임포트·키 검증 dry-run·`map_notes` 테이블. 어댑터 계약의 원설계(`consultant_interview.py`·테스트가 주석으로 참조). 현행 계약은 `docs/samples/interview-json-0.5.md`.
- [데이터 표면 패리티 — CSV 왕복·Excel·JSON 임포트 점검](2026-08-24-data-surface-parity-design.md) — 검토값(gmp·항목별 폼) CSV 왕복 확장·Excel 컬럼 확장. **미구현 이관 트랙**(system_fallback 처리 미결). §3 임포트 점검은 완료 — 실파일 dry-run만 잔여.
- [거버넌스 UX 확장 A/B/C](2026-08-08-governance-ux-design.md) — 설계 승인·**미구현** 트랙. 이양 후 오너 대량 발생 전 구현 목표.
- [엣지 팬아웃 — 같은 핸들 수렴 엣지의 나선 펼침](2026-09-30-edge-fanout-design.md) — 렌더 전용 레인 배정(`lib/edge-fanout.ts`)·게이트 포인트+원호·세 선 모양·에디터/비교/SVG 역행. 결정 4건 확정, `feat/edge-fanout`에서 **구현 완료**(불변식은 CLAUDE.md Lessons에 흡수). main 머지 시 폐기.

폐기(2026-09-24, main 머지 완료): `2026-09-11-assignee-role-catalog-design.md` · `2026-09-12-catalog-alias-node-swap-design.md`(계약은 CLAUDE.md 카탈로그 커밋 규칙으로 흡수) · `2026-09-01-interview-import-v04-design.md`(0.5 계약 3표면으로 흡수). 폐기(2026-09-30): 0.4 결과 핸드오프 `2026-09-01-interview-import-v04-result.md`(불변식은 `docs/qa/interview-import-field-map.md`·`docs/lessons/canvas-react-flow.md` §6에 흡수, 실서버 점검 항목은 git history) · AI L5 캠페인 스펙 3종 `docs/superpowers/specs/2026-09-2*`(코드 주석은 파일명만 유지).
