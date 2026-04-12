import { Play, Eye } from "lucide-react";
import type { VideoItem } from "../types";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function VideoCard({ item }: { item: VideoItem }) {
  return (
    <article className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white transition-all duration-150 hover:border-slate-300 hover:shadow-md">
      {/* Thumbnail with play overlay */}
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block aspect-video overflow-hidden bg-slate-100"
      >
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Play className="h-8 w-8 text-slate-300" />
          </div>
        )}
        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-200 group-hover:bg-black/20">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 shadow-lg transition-transform duration-200 group-hover:scale-110">
            <Play className="h-4 w-4 fill-white text-white" />
          </div>
        </div>
      </a>

      <div className="p-3">
        {/* Title */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-900 transition-colors hover:text-emerald-700"
        >
          {item.title}
        </a>

        {/* Channel + meta */}
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="truncate font-medium text-slate-500">
            {item.channelName}
          </span>
          <span className="shrink-0">{relativeTime(item.publishedAt)}</span>
          {item.viewCount > 0 && (
            <span className="ml-auto flex shrink-0 items-center gap-0.5 font-medium text-slate-500">
              <Eye className="h-3 w-3" />
              {item.viewCount >= 1000
                ? `${(item.viewCount / 1000).toFixed(1)}K`
                : item.viewCount}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
