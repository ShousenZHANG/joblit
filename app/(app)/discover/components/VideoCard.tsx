"use client";

import {
  Play,
  Eye,
  ThumbsUp,
  BadgeCheck,
  Star,
  Check,
  ExternalLink,
} from "lucide-react";
import type { VideoItem } from "../types";
import { relativeTime, formatCount } from "../utils";

interface VideoCardProps {
  item: VideoItem;
  isWatched: boolean;
  isFavorited: boolean;
  onToggleFavorite: (id: string) => void;
  onMarkWatched: (id: string) => void;
}

export function VideoCard({
  item,
  isWatched,
  isFavorited,
  onToggleFavorite,
  onMarkWatched,
}: VideoCardProps) {
  const handleOpen = () => {
    // Mark watched when user opens the video on YouTube.
    if (!isWatched) onMarkWatched(item.id);
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleFavorite(item.id);
  };

  return (
    <article
      className={`group relative overflow-hidden rounded-xl border border-border bg-white transition-all duration-150 hover:border-border hover:shadow-md ${
        isWatched ? "opacity-70" : "opacity-100"
      }`}
    >
      {/* Thumbnail — click-through to YouTube in new tab */}
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleOpen}
        aria-label={`Play on YouTube: ${item.title}`}
        className="group/thumb relative block aspect-video overflow-hidden bg-muted"
      >
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover/thumb:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Play className="h-8 w-8 text-slate-300" />
          </div>
        )}

        {/* Watched check */}
        {isWatched && (
          <div
            className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-slate-900/85 px-2 py-0.5 text-[10px] font-semibold text-white shadow-md backdrop-blur"
            title="Watched"
          >
            <Check className="h-3 w-3" />
            <span>Watched</span>
          </div>
        )}

        {/* Trusted badge */}
        {item.isTrusted && (
          <div
            className={`absolute right-2 top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow-md backdrop-blur ${
              item.trustTier === 1
                ? "bg-brand-emerald-600/95"
                : item.trustTier === 2
                  ? "bg-teal-600/90"
                  : "bg-slate-600/90"
            }`}
            title={
              item.trustTier === 1
                ? "Official / Foundational creator"
                : item.trustTier === 2
                  ? "Top independent voice"
                  : "Niche expert"
            }
          >
            <BadgeCheck className="h-3 w-3" />
            <span>
              {item.trustTier === 1
                ? "Official"
                : item.trustTier === 2
                  ? "Trusted"
                  : "Expert"}
            </span>
          </div>
        )}

        {/* Play overlay — purely visual affordance */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-200 group-hover/thumb:bg-black/20">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 shadow-lg transition-transform duration-200 group-hover/thumb:scale-110">
            <Play className="h-4 w-4 fill-white text-white" />
          </div>
        </div>
      </a>

      {/* Body */}
      <div className="p-2.5 sm:p-3">
        <div className="flex items-start justify-between gap-2">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleOpen}
            className="mb-1 line-clamp-2 flex-1 text-sm font-semibold leading-snug text-foreground transition-colors hover:text-brand-emerald-700"
          >
            {item.title}
          </a>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={handleFavoriteClick}
              aria-label={
                isFavorited ? "Remove from favorites" : "Add to favorites"
              }
              aria-pressed={isFavorited}
              className={`rounded-md p-1 transition-colors ${
                isFavorited
                  ? "text-amber-500 hover:bg-amber-50"
                  : "text-slate-300 hover:bg-muted hover:text-amber-500"
              }`}
            >
              <Star
                className={`h-3.5 w-3.5 ${isFavorited ? "fill-amber-400" : ""}`}
              />
            </button>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleOpen}
              aria-label="Open on YouTube"
              className="rounded-md p-1 text-slate-300 transition-colors hover:bg-muted hover:text-muted-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground/70 sm:text-[11px]">
          <span className="truncate font-medium text-muted-foreground">
            {item.channelName}
          </span>
          <span className="shrink-0">{relativeTime(item.publishedAt)}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {item.viewCount > 0 && (
              <span className="flex items-center gap-0.5 font-medium text-muted-foreground">
                <Eye className="h-3 w-3" />
                {formatCount(item.viewCount)}
              </span>
            )}
            {item.likeCount > 0 && (
              <span className="flex items-center gap-0.5 font-medium text-muted-foreground">
                <ThumbsUp className="h-3 w-3" />
                {formatCount(item.likeCount)}
              </span>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
