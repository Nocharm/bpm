# Lessons — 시행착오 방지

이 프로젝트(특히 **캔버스 에디터 / React Flow 계층형 인라인 편집**) 작업에서 실측으로 얻은 교훈. 같은 시행착오를 반복하지 않도록 카테고리별로 정리한다. **캔버스/에디터(`frontend/src/app/maps/[mapId]/page.tsx`)나 인라인 하위프로세스를 건드리기 전에 해당 문서를 먼저 읽을 것.**

| 문서 | 언제 읽나 |
|------|-----------|
| [canvas-react-flow.md](canvas-react-flow.md) | 인라인 펼침 자식 노드, React Flow 이벤트/렌더/드롭존을 건드릴 때 |
| [scope-save-and-coordinates.md](scope-save-and-coordinates.md) | 자식 스코프 저장, 좌표(스코프상대↔표시) 변환, buildScope를 건드릴 때 |
| [browser-verification.md](browser-verification.md) | Playwright로 캔버스 동작을 검증할 때 (dev.db 오염 함정 필독) |
| [react-ts-patterns.md](react-ts-patterns.md) | useCallback deps/TDZ, ref 미러, 큰 상태 모델 변경 시 |

> 진행 중 설계/계획은 `docs/superpowers/plans/` 참조 (예: 포커스 모드 `2026-06-19-active-scope-focus-mode.md`).
