"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { MappedRepo } from "@/app/api/repos/route";

type SortCol = "totalCount" | "mappedPercent" | "countryCount" | "updatedAt";
type SortDir = "asc" | "desc";

const formatCount = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
};

const SortIcon = ({ active, dir }: { active: boolean; dir: SortDir }) => (
  <span className={`ml-1 transition-opacity ${active ? "opacity-100" : "opacity-30"}`}>
    {active && dir === "asc" ? "↑" : "↓"}
  </span>
);

const ColHeader = ({
  label,
  col,
  active,
  dir,
  align = "right",
  onSort,
}: {
  label: string;
  col: SortCol;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  onSort: (col: SortCol) => void;
}) => (
  <th
    className={`py-2 px-3 text-[10px] uppercase tracking-widest text-[#484f58] font-normal cursor-pointer select-none hover:text-[#8b949e] transition-colors ${align === "right" ? "text-right" : "text-left"}`}
    onClick={() => onSort(col)}
  >
    {label}
    <SortIcon active={active} dir={dir} />
  </th>
);

export const RepoTable = ({ repos }: { repos: MappedRepo[] }) => {
  const [sortCol, setSortCol] = useState<SortCol>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (col: SortCol) => {
    if (col === sortCol) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(() => {
    return [...repos].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [repos, sortCol, sortDir]);

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[#21262d]">
            <th className="py-2 px-3 text-[10px] uppercase tracking-widest text-[#484f58] font-normal text-left">
              Repo
            </th>
            <ColHeader label="Stars" col="totalCount" active={sortCol === "totalCount"} dir={sortDir} onSort={handleSort} />
            <ColHeader label="Mapped" col="mappedPercent" active={sortCol === "mappedPercent"} dir={sortDir} onSort={handleSort} />
            <ColHeader label="Countries" col="countryCount" active={sortCol === "countryCount"} dir={sortDir} onSort={handleSort} />
            <ColHeader label="Last scan" col="updatedAt" active={sortCol === "updatedAt"} dir={sortDir} onSort={handleSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={`${r.owner}/${r.repo}`}
              className="border-b border-[#21262d]/50 hover:bg-[#161b22] transition-colors group"
            >
              <td className="py-2.5 px-3">
                <Link
                  href={`/${r.owner}/${r.repo}`}
                  className="flex flex-col leading-tight"
                >
                  <span className="text-[10px] text-[#484f58]">{r.owner}</span>
                  <span className="text-sm text-[#f0f6fc] group-hover:text-[#58a6ff] transition-colors font-medium">
                    {r.repo}
                  </span>
                </Link>
              </td>
              <td className="py-2.5 px-3 text-right text-[#8b949e] text-xs tabular-nums">
                {formatCount(r.totalCount)}
              </td>
              <td className="py-2.5 px-3 text-right tabular-nums">
                <span
                  className={`text-xs font-semibold ${
                    r.mappedPercent >= 50
                      ? "text-[#3fb950]"
                      : r.mappedPercent >= 25
                      ? "text-[#f0883e]"
                      : "text-[#8b949e]"
                  }`}
                >
                  {r.mappedPercent}%
                </span>
              </td>
              <td className="py-2.5 px-3 text-right text-[#8b949e] text-xs tabular-nums">
                {r.countryCount}
              </td>
              <td className="py-2.5 px-3 text-right text-[#484f58] text-xs whitespace-nowrap">
                {timeAgo(r.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
