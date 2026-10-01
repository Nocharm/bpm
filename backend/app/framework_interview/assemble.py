"""캠페인 → 인터뷰 JSON 0.5 조립 — 어댑터(scripts/consultant_interview.py)가 계약의 단일 진실 (spec §7).

어댑터 키 집합이 바뀌면 여기와 프롬프트(contracts.py)·FE 외부 프롬프트(interview-json-prompt.ts)를 같이 옮긴다.
"""

import re
from dataclasses import asdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now as now_kst
from app.framework_interview.contracts import RowOut
from app.framework_interview.existing import load_existing_l6
from app.models import FrameworkInterviewSession, FrameworkInterviewTask, ProcessCategory, ProcessMap

SCHEMA_VERSION = "0.5-bpm-interface-draft"
LABEL_SOURCE = "ai-assisted"
# 유지 태스크의 맵이 사라졌을 때 붙는 이슈 — 재조립해도 한 건만 남도록 문구로 식별한다
KEEP_GONE_MESSAGE = (
    "existing map is gone or no longer convertible - row dropped from the document"
    " (기존 맵이 사라졌거나 변환 불가라 문서에서 제외)"
)


def allocate_task_ids(category_code: str, existing_codes: list[str], count: int) -> list[str]:
    """'{L5 code}-{NN}' 채번 — 기존 consultant_code의 최대 NN 다음부터 (spec §3)."""
    pattern = re.compile(rf"^{re.escape(category_code)}-(\d+)$")
    top = 0
    for code in existing_codes:
        match = pattern.match(code or "")
        if match:
            top = max(top, int(match.group(1)))
    return [f"{category_code}-{top + i:02d}" for i in range(1, count + 1)]


async def load_existing_codes(db: AsyncSession, category_id: int) -> list[str]:
    # 휴지통 맵도 포함 — 임포터는 소프트삭제된 맵의 코드도 이미 쓰인 것으로 보고 거절한다.
    rows = await db.scalars(
        select(ProcessMap.consultant_code).where(ProcessMap.category_id == category_id)
    )
    return [code for code in rows.all() if code]


async def load_category_chain(db: AsyncSession, category_id: int) -> list[dict]:
    """root→self 체인을 framework.categories[] 모양으로 (routers/categories.get_category_chain과 같은 걷기)."""
    rows = (await db.scalars(select(ProcessCategory))).all()
    by_id = {row.id: row for row in rows}
    chain: list[ProcessCategory] = []
    current = by_id.get(category_id)
    while current is not None:
        chain.append(current)
        current = by_id.get(current.parent_id) if current.parent_id else None
    chain.reverse()
    return [
        {"code": c.code, "name": c.name, "level": c.level,
         "parent": by_id[c.parent_id].code if c.parent_id else None}
        for c in chain
    ]


def build_document(
    chain: list[dict], l5: dict, rows: list[dict], relations: dict | None,
    *, label: str, session_id: int, external_tasks: list[dict] | None = None,
) -> dict:
    doc: dict = {
        "_readme": [f"AI campaign session {session_id} · {now_kst():%Y-%m-%d %H:%M} · {label}"],
        "schema_version": SCHEMA_VERSION,
        "labelSource": LABEL_SOURCE,
        "framework": {"categories": chain},
        "l5": l5,
        "rows": rows,
    }
    if relations:
        doc["relations"] = relations
    if external_tasks:
        doc["externalTasks"] = external_tasks
    return doc


def external_tasks_of(plan: list[dict] | None) -> list[dict]:
    """계획의 외부 참조 카드 → 0.5 externalTasks[] (refId·l5.nodeCode/label·l6). 어댑터가 같은 L5의 이름 일치 맵에
    자동 연결하거나 출처 L5 배지가 붙은 플레이스홀더로 세운다 (docs/samples/interview-json-0.5.md §2)."""
    out: list[dict] = []
    for card in plan or []:
        ext = card.get("external") if card.get("mode") == "external" else None
        if not isinstance(ext, dict) or not card.get("task_id"):
            continue
        out.append({
            "refId": str(card["task_id"]),
            "l5": {"nodeCode": str(ext.get("l5_code") or ""), "label": str(ext.get("l5_label") or "")},
            "l6": ext.get("l6") or None,
        })
    return out


# AI 스키마(RowAction)에 없는 기록성 키 — 노드 설명 KV 줄(Screen:/Quote:)로만 착지한다.
# AI에게 되돌려 받지 않고 이전 행에서 서버가 잇는다(창작 여지를 열지 않는다)
_INHERITED_ACTION_KEYS = ("screen", "quote")


def _labels_by_seq(actions: list[dict]) -> dict[object, str]:
    return {a.get("seq"): str(a.get("label") or "").strip() for a in actions}


def _inherit_from_previous(row: dict, previous: dict) -> None:
    """정정·피드백 응답에 이전 행의 screen/quote와 병행 갈래 표시를 잇는다 (label 일치 기준).

    seq는 활동이 끼어들면 밀리므로 쓰지 않는다. gateway는 같은 두 활동 사이의 branch 엣지가
    모델 응답에서 표시만 빠졌을 때만 잇는다 — 빠지면 어댑터가 병렬 출구를 택일 분기(◇)로 바꾼다.
    """
    prev_actions = [a for a in previous.get("actions") or [] if isinstance(a, dict)]
    prev_by_label: dict[str, dict] = {}
    for action in prev_actions:
        prev_by_label.setdefault(str(action.get("label") or "").strip(), action)
    for action in row.get("actions") or []:
        origin = prev_by_label.get(str(action.get("label") or "").strip())
        if origin is None:
            continue
        for key in _INHERITED_ACTION_KEYS:
            if not action.get(key) and origin.get(key):
                action[key] = origin[key]

    prev_labels = _labels_by_seq(prev_actions)
    prev_gateway: dict[tuple[str, str], str] = {}
    for edge in (previous.get("relations") or {}).get("edges") or []:
        if edge.get("kind") == "branch" and edge.get("gateway"):
            pair = (prev_labels.get(edge.get("src"), ""), prev_labels.get(edge.get("dst"), ""))
            prev_gateway.setdefault(pair, edge["gateway"])
    new_labels = _labels_by_seq(row.get("actions") or [])
    for edge in (row.get("relations") or {}).get("edges") or []:
        if edge.get("kind") != "branch" or edge.get("gateway"):
            continue
        gateway = prev_gateway.get((new_labels.get(edge.get("src"), ""), new_labels.get(edge.get("dst"), "")))
        if gateway:
            edge["gateway"] = gateway


def finalize_row_output(out: RowOut, card: dict, previous_row: dict | None = None) -> dict:
    """RowOut → 저장용 rows[] 원소. 드로잉(runner)과 피드백 라우트가 같이 쓰는 마감 규칙.

    한쪽만 부서를 메우면 피드백 한 번에 부서가 조용히 지워진다(어댑터는 부서를 요구하지 않는다).
    previous_row(정정의 현재 등록된 행·피드백 직전 행)가 있으면 AI가 되돌려 주지 못하는 키를 잇는다.
    """
    row = out.model_dump(by_alias=True, exclude_none=True)
    row.pop("owner", None)  # 담당자 실명은 AI가 짓지 않는다 — 역할(ownerRole)만 받는다
    row["department"] = row.get("department") or str(card.get("department") or "")
    if previous_row:
        _inherit_from_previous(row, previous_row)
    return row


def validate_row(chain: list[dict], l5: dict, row: dict) -> list[dict]:
    """row 1건짜리 문서를 어댑터에 넣어 그 행의 이슈만 dict로 (severity/path/message)."""
    from scripts.consultant_interview import convert_interview  # 지연 import — 스크립트 패키지

    doc = build_document(chain, l5, [row], None, label="validate", session_id=0)
    result = convert_interview(doc)
    return [asdict(issue) for issue in result.issues if issue.path.startswith("rows[") or issue.path == "$"]


async def _refresh_keep_rows(
    db: AsyncSession, session: FrameworkInterviewSession, chain: list[dict], l5: dict,
) -> set[int]:
    """유지 태스크의 행을 조립 직전 현재 맵에서 다시 읽는다 — 잠금 시점 스냅샷은 그 사이 낡는다.

    반환: 맵이 사라져 문서에서 빼야 할 태스크 pk 집합(행은 미리보기용으로 남겨 둔다).
    """
    keep = [t for t in session.tasks if t.mode == "keep" and t.status == "drawn"]
    if not keep:
        return set()
    current = {item["code"]: item for item in await load_existing_l6(db, session.category_id)}
    dropped: set[int] = set()
    for task in keep:
        row = (current.get(task.task_id) or {}).get("row")
        if not row:
            dropped.add(task.id)
            # 재조립해도 경고가 겹쳐 쌓이지 않게 같은 문구를 먼저 걷어낸다
            kept = [i for i in (task.issues or []) if i.get("message") != KEEP_GONE_MESSAGE]
            task.issues = [*kept, {
                "severity": "warning", "path": f"rows[{task.seq - 1}]", "message": KEEP_GONE_MESSAGE,
            }]
            continue
        task.row = row
        task.issues = validate_row(chain, l5, {"taskId": task.task_id, **row})
    return dropped


def _document_rows(tasks: list[FrameworkInterviewTask], dropped: set[int]) -> list[dict]:
    return [
        {"taskId": task.task_id, **task.row}
        for task in sorted(tasks, key=lambda t: t.seq)
        if task.status == "drawn" and task.row and task.id not in dropped
    ]


async def assemble_document(db: AsyncSession, session: FrameworkInterviewSession) -> dict:
    chain = await load_category_chain(db, session.category_id)
    l5 = {"label": chain[-1]["name"], "nodeCode": chain[-1]["code"]}
    dropped = await _refresh_keep_rows(db, session, chain, l5)
    rows = _document_rows(list(session.tasks), dropped)
    doc = build_document(chain, l5, rows, session.relations, label=session.label, session_id=session.id,
                         external_tasks=external_tasks_of(session.plan))
    session.assembled = doc
    return doc
