# Lessons — 시행착오 방지

이 프로젝트의 캔버스 에디터(React Flow) 작업에서 실측으로 얻은 교훈. **캔버스/에디터(`frontend/src/app/maps/[mapId]/page.tsx`)를 건드리기 전에 해당 문서를 먼저 읽을 것.**

> ⚠️ 인라인 계층 *편집*(자식 노드 직접 편집·자식 스코프 저장)은 **하위프로세스 참조 모델**에서 제거됐다 — 임베드 자식은 읽기전용. 자식-편집/스코프-저장 항목은 주로 역사적 기록이나, React Flow 렌더/좌표/드롭존/검증 함정은 읽기전용 임베드에도 유효.

| 문서 | 언제 읽나 |
|------|-----------|
| [canvas-react-flow.md](canvas-react-flow.md) | 인라인 펼침 자식 노드, React Flow 이벤트/렌더/드롭존을 건드릴 때 |
| [scope-save-and-coordinates.md](scope-save-and-coordinates.md) | 자식 스코프 저장, 좌표(스코프상대↔표시) 변환, buildScope를 건드릴 때 |
| [browser-verification.md](browser-verification.md) | Playwright로 캔버스 동작을 검증할 때 (dev.db 오염 함정 필독) |
| [react-ts-patterns.md](react-ts-patterns.md) | useCallback deps/TDZ, ref 미러, 큰 상태 모델 변경 시 |
| [settings-and-forms.md](settings-and-forms.md) | 설정/관리자 화면·모달/피커/카드 헤더·소프트삭제 백엔드를 건드릴 때 (비캔버스) |

> 설계 기록은 `docs/design/`(날짜별 스냅샷, 분야별 인덱스 `docs/design/README.md`), 진행 현황은 `PROGRESS.md` 참조.
