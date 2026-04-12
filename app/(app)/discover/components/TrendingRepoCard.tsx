import { Star, GitFork, ExternalLink } from "lucide-react";
import type { TrendingRepo } from "../types";

/** Language → dot color mapping */
const LANG_COLORS: Record<string, string> = {
  Python: "bg-blue-500",
  TypeScript: "bg-sky-500",
  JavaScript: "bg-yellow-400",
  Rust: "bg-orange-600",
  Go: "bg-cyan-500",
  Java: "bg-red-500",
  "C++": "bg-pink-500",
  C: "bg-slate-600",
  Swift: "bg-orange-400",
  Kotlin: "bg-violet-500",
  Ruby: "bg-red-600",
  PHP: "bg-indigo-400",
};

function formatStars(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TrendingRepoCard({ repo }: { repo: TrendingRepo }) {
  const langColor = repo.language
    ? LANG_COLORS[repo.language] ?? "bg-slate-400"
    : null;

  return (
    <article className="group relative rounded-xl border border-slate-200 bg-white p-4 transition-all duration-150 hover:border-slate-300 hover:shadow-md">
      {/* Header: avatar + name + language */}
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            src={repo.ownerAvatar}
            alt=""
            className="h-6 w-6 shrink-0 rounded-md"
            loading="lazy"
          />
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sm font-semibold text-slate-900 transition-colors hover:text-emerald-700"
          >
            {repo.fullName}
          </a>
        </div>
        {repo.language && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {langColor && (
              <span
                className={`inline-block h-2 w-2 rounded-full ${langColor}`}
              />
            )}
            {repo.language}
          </span>
        )}
      </div>

      {/* Description */}
      {repo.description && (
        <p className="mb-3 line-clamp-2 text-[13px] leading-relaxed text-slate-600">
          {repo.description}
        </p>
      )}

      {/* Topics */}
      {repo.topics.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {repo.topics.slice(0, 3).map((topic) => (
            <span
              key={topic}
              className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      {/* Stats footer */}
      <div className="flex items-center justify-between text-[12px] text-slate-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 font-semibold text-amber-600">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            {formatStars(repo.stars)}
          </span>
          <span className="flex items-center gap-1">
            <GitFork className="h-3 w-3" />
            {formatStars(repo.forks)}
          </span>
          <span>Updated {relativeTime(repo.pushedAt)}</span>
        </div>
        <a
          href={repo.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-emerald-600"
          aria-label={`View ${repo.fullName} on GitHub`}
        >
          View
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </article>
  );
}
