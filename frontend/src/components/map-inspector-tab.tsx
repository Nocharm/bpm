"use client";

// NEW 인스펙터 맵 탭(좁은 폭 전용) — 가시성·소유자·협업자·설명. 목업 inspector-map-tab 순서.
// getMap(가시성/설명/소유자)+listMapPermissions(협업자)+getDirectory(이름·소속) 1회 로드(active 가드).
// 가시성 변경은 승인 플로(설정 화면)라 여기선 현재값 표시. 설명은 updateMap으로 편집.
import { useEffect, useRef, useState } from "react";
import { Building2, Globe, Lock } from "lucide-react";

import { getDirectory, getMap, listMapPermissions, updateMap, type MapPermission } from "@/lib/api";
import { RoleBadge } from "@/components/permissions/role-badge";
import { type MapRole } from "@/lib/mock/permissions";
import { useI18n } from "@/lib/i18n";

interface MapInspectorTabProps {
  mapId: number;
  currentLoginId: string | null;
  readOnly: boolean;
}

interface Person {
  name: string;
  org: string;
}

function leaf(orgPath: string | undefined): string {
  if (!orgPath) return "";
  const parts = orgPath.split("/");
  return parts[parts.length - 1] ?? "";
}

export function MapInspectorTab({ mapId, currentLoginId, readOnly }: MapInspectorTabProps) {
  const { t } = useI18n();
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [owner, setOwner] = useState<string | null>(null);
  const [perms, setPerms] = useState<MapPermission[]>([]);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [description, setDescription] = useState("");
  const loadedFor = useRef<number | null>(null);

  useEffect(() => {
    if (loadedFor.current === mapId) return;
    let active = true;
    void (async () => {
      try {
        const [detail, mapPerms, dir] = await Promise.all([
          getMap(mapId),
          listMapPermissions(mapId),
          getDirectory(),
        ]);
        if (!active) return;
        setVisibility(detail.visibility);
        setOwner(detail.created_by);
        setDescription(detail.description);
        setPerms(mapPerms);
        setPeople(new Map(dir.users.map((user) => [user.id, { name: user.name, org: leaf(user.org_path) }])));
        loadedFor.current = mapId;
      } catch {
        // 조회 실패는 섹션만 비표시
      }
    })();
    return () => {
      active = false;
    };
  }, [mapId]);

  const resolve = (id: string): Person => people.get(id) ?? { name: id, org: "" };
  const ownerPerson = owner ? resolve(owner) : null;
  const collaborators = perms.filter((perm) => perm.role !== "owner");

  return (
    <div className="flex flex-col gap-4">
      {/* 가시성 — 현재값 표시(변경은 설정 화면 승인 플로) */}
      <section>
        <div className="mb-1 text-fine text-ink-tertiary">{t("inspector.visibility")}</div>
        <div className="grid grid-cols-2 gap-1.5">
          {(["public", "private"] as const).map((value) => {
            const active = visibility === value;
            const Icon = value === "public" ? Globe : Lock;
            return (
              <div
                key={value}
                className={`flex items-center justify-center gap-1.5 rounded-sm border px-2 py-1.5 text-caption ${
                  active ? "border-accent bg-accent-tint font-medium text-accent" : "border-hairline text-ink-tertiary"
                }`}
              >
                <Icon size={14} strokeWidth={1.5} />
                {t(value === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
              </div>
            );
          })}
        </div>
      </section>

      {/* 소유자 */}
      {ownerPerson && (
        <section>
          <div className="mb-1 text-fine text-ink-tertiary">{t("inspector.owner")}</div>
          <PersonRow
            id={owner ?? ""}
            person={ownerPerson}
            role="owner"
            isMe={owner === currentLoginId}
          />
        </section>
      )}

      {/* 협업자 */}
      {collaborators.length > 0 && (
        <section>
          <div className="mb-1 text-fine text-ink-tertiary">
            {t("inspector.collaborators")} {collaborators.length}
          </div>
          <div className="flex flex-col gap-1.5">
            {collaborators.map((perm) => (
              <PersonRow
                key={perm.id}
                id={perm.principal_id}
                person={perm.principal_type === "group" ? { name: perm.principal_id, org: "" } : resolve(perm.principal_id)}
                role={perm.role}
                isGroup={perm.principal_type === "group"}
                isMe={perm.principal_id === currentLoginId}
              />
            ))}
          </div>
        </section>
      )}

      {/* 설명 */}
      <section>
        <div className="mb-1 text-fine text-ink-tertiary">{t("field.description")}</div>
        <textarea
          className="h-20 w-full resize-none rounded-sm border border-hairline px-2 py-1.5 text-caption"
          value={description}
          disabled={readOnly}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => void updateMap(mapId, { description })}
        />
      </section>
    </div>
  );
}

// 멤버/팀 카드 — 메인>상세 멤버 디자인 재사용(RoleBadge·ME·클릭 펼침으로 아이디 노출).
function PersonRow({
  id,
  person,
  role,
  isGroup,
  isMe,
}: {
  id: string;
  person: Person;
  role: string;
  isGroup?: boolean;
  isMe?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={`rounded-sm border ${isMe ? "border-accent/40 bg-accent-tint/40" : "border-hairline"}`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-surface-alt/60"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface-alt text-fine font-semibold text-ink-secondary">
          {isGroup ? <Building2 size={14} strokeWidth={1.5} /> : person.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-caption font-medium text-ink">
            {person.name}
            {isMe && <span className="ml-1 text-fine text-accent">· ME</span>}
          </span>
          {person.org && <span className="block truncate text-fine text-ink-tertiary">{person.org}</span>}
        </span>
        <RoleBadge role={role as MapRole} />
      </button>
      {expanded && (
        <div className="border-t border-divider px-2.5 py-1.5 text-fine text-ink-tertiary">{id}</div>
      )}
    </div>
  );
}
