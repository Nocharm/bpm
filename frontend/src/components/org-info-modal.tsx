"use client";

// 조직 정보 모달 — 경로 브레드크럼(클릭 이동)·직속 구성인원(조직장 우선, 6.5행 클램프 스크롤)·
// 하위 조직 아코디언(재귀). 데이터는 디렉터리 캐시(useDirectory)만 사용 — 서버 호출 없음.
// 등장·닫힘은 코멘트 모달과 동일 규칙: 클릭점→중앙 확대(comment-modal-in)·바깥 mousedown/Escape.

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Building2, ChevronRight, Users } from "lucide-react";

import { type DirectoryUser } from "@/lib/api";
import { PersonHoverCard } from "@/components/person-hover-card";
import { buildOrgPathChain, formatDeptName } from "@/lib/korean-dept";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import { ModalBackdrop } from "@/components/modal-backdrop";

// 디렉터리에서 파생한 조직 조회 구조 — 직속 인원 맵 + (중간 조직 포함) 전체 경로 집합.
interface OrgData {
  usersByPath: Map<string, DirectoryUser[]>;
  pathSet: Set<string>;
  koreanDeptByPath: Map<string, string>;
}

function getDisplayName(user: DirectoryUser, lang: "en" | "ko"): string {
  const english = user.name || user.id;
  return lang === "ko" ? user.korean_name || english : english;
}

// path 바로 아래 1단계 하위 조직 경로들.
function getSubPaths(pathSet: Set<string>, path: string): string[] {
  const prefix = `${path}/`;
  return [...pathSet]
    .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
    .sort();
}

// path 소속 전체 인원(하위 조직 포함).
function countUnder(usersByPath: Map<string, DirectoryUser[]>, path: string): number {
  let total = 0;
  const prefix = `${path}/`;
  for (const [p, list] of usersByPath) {
    if (p === path || p.startsWith(prefix)) total += list.length;
  }
  return total;
}

function MemberList({ path, ctx }: { path: string; ctx: OrgData }) {
  const { t, lang } = useI18n();
  // 조직장(노출 직책 보유) 우선 → 표시명 정렬
  const members = [...(ctx.usersByPath.get(path) ?? [])].sort((a, b) => {
    const lead = (b.position ? 1 : 0) - (a.position ? 1 : 0);
    if (lead !== 0) return lead;
    return getDisplayName(a, lang).localeCompare(getDisplayName(b, lang), lang);
  });
  if (members.length === 0) {
    return <p className="px-1 text-fine text-ink-tertiary">{t("org.noMembers")}</p>;
  }
  return (
    // 6.5행 클램프(행 32px × 6.5 = 208px) — 반 행이 스크롤 가능함을 암시
    <ul className="max-h-52 overflow-y-auto overflow-x-hidden">
      {members.map((user) => (
        <li key={user.id} className="flex h-8 items-center gap-1.5 px-1">
          <span className="min-w-0 truncate text-caption text-ink">{getDisplayName(user, lang)}</span>
          {user.position && (
            <span className="shrink-0 rounded-xs border border-accent-tint-border px-1 py-0.5 text-fine text-accent">
              {user.position}
            </span>
          )}
          <PersonHoverCard userId={user.id} className="ml-auto shrink-0 truncate text-fine text-ink-tertiary">
            {user.id}
          </PersonHoverCard>
        </li>
      ))}
    </ul>
  );
}

function OrgUnitBody({ path, ctx }: { path: string; ctx: OrgData }) {
  const { t } = useI18n();
  const subPaths = getSubPaths(ctx.pathSet, path);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-fine text-ink-tertiary">{t("org.members")}</p>
      <MemberList path={path} ctx={ctx} />
      {subPaths.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-fine text-ink-tertiary">{t("org.subOrgs")}</p>
          {subPaths.map((subPath) => (
            <OrgUnitSection key={subPath} path={subPath} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

// 하위 조직 1건 — 헤더(이름·인원수·쉐브론) + 아코디언으로 자기 구성인원·하위 조직 재귀.
function OrgUnitSection({ path, ctx }: { path: string; ctx: OrgData }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-sm border border-hairline">
      <button
        type="button"
        data-id={`org-info-sub-${path}`}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-surface-alt"
        onClick={() => setOpen((v) => !v)}
      >
        <Building2 size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        <span className="min-w-0 flex-1 truncate text-caption text-ink">
          {formatDeptName(path, lang, ctx.koreanDeptByPath)}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-fine text-ink-tertiary">
          <Users size={11} strokeWidth={1.5} />
          {countUnder(ctx.usersByPath, path)}
        </span>
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className={`shrink-0 text-ink-tertiary transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
      </button>
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-hairline px-2 py-1.5">
            <OrgUnitBody path={path} ctx={ctx} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface OrgInfoModalProps {
  orgPath: string;
  koreanDeptByPath: Map<string, string>;
  /** 클릭 지점 — 등장 애니메이션 시작 오프셋 계산용. */
  origin: { x: number; y: number };
  onClose: () => void;
}

export function OrgInfoModal({ orgPath, koreanDeptByPath, origin, onClose }: OrgInfoModalProps) {
  const { lang } = useI18n();
  const users = useDirectory();
  const [path, setPath] = useState(orgPath);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const ctx = useMemo<OrgData>(() => {
    const usersByPath = new Map<string, DirectoryUser[]>();
    const pathSet = new Set<string>();
    for (const user of users.values()) {
      const p = user.org_path ?? "";
      if (!p) continue;
      const list = usersByPath.get(p) ?? [];
      list.push(user);
      usersByPath.set(p, list);
      // 직속 인원이 없는 중간 조직도 경로 집합에 포함 — 하위 조직 트리가 끊기지 않게
      for (const prefix of buildOrgPathChain(p)) pathSet.add(prefix);
    }
    return { usersByPath, pathSet, koreanDeptByPath };
  }, [users, koreanDeptByPath]);

  const parents = buildOrgPathChain(path).slice(0, -1);
  // 클릭점 − 뷰포트 중앙 = 시작 오프셋 (카드는 flex 중앙 정렬)
  const originVars = {
    "--from-dx": `${origin.x - window.innerWidth / 2}px`,
    "--from-dy": `${origin.y - window.innerHeight / 2}px`,
  } as CSSProperties;

  return createPortal(
    <ModalBackdrop
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
      onClose={onClose}
    >
      <div
        data-id="org-info-modal"
        className="comment-modal-in flex w-full max-w-md flex-col gap-3 rounded-md bg-surface p-5 shadow-lg"
        style={originVars}
      >
        <div className="flex items-center gap-1.5">
          <Building2 size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
          <h2 className="min-w-0 truncate text-body-strong text-ink">
            {formatDeptName(path, lang, koreanDeptByPath)}
          </h2>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-fine text-ink-tertiary">
            <Users size={12} strokeWidth={1.5} />
            {countUnder(ctx.usersByPath, path)}
          </span>
        </div>
        {/* 상위 경로 브레드크럼 — 클릭 시 그 조직으로 이동 */}
        {parents.length > 0 && (
          <p className="flex flex-wrap items-center gap-1 text-fine text-ink-tertiary">
            {parents.map((parentPath) => (
              <Fragment key={parentPath}>
                <button
                  type="button"
                  data-id={`org-info-crumb-${parentPath}`}
                  className="rounded-xs px-0.5 hover:bg-surface-alt hover:text-ink-secondary"
                  onClick={() => setPath(parentPath)}
                >
                  {formatDeptName(parentPath, lang, koreanDeptByPath)}
                </button>
                <ChevronRight size={10} strokeWidth={1.5} className="shrink-0" />
              </Fragment>
            ))}
            <span className="text-ink-secondary">{formatDeptName(path, lang, koreanDeptByPath)}</span>
          </p>
        )}
        <div className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto">
          <OrgUnitBody path={path} ctx={ctx} />
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
