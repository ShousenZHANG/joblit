"use client";

import { useRef } from "react";
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
  isPlaying: boolean;
  onPlay: (id: string) => void;
  onClose: () => void;
  onToggleFavorite: (id: string) => void;
  onMarkWatched: (id: string) => void;
}

export function VideoCard({
  item,
  isWatched,
  isFavorited,
  isPlaying,
  onPlay,
  onClose,
  onToggleFavorite,
  onMarkWatched,
}: VideoCardProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handlePlayClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onPlay(item.id);
    // Auto-mark as watched when user opens player
    if (!isWatched) onMarkWatched(item.id);
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleFavorite(item.id);
  };

  return (
    <article
      className={`group relative overflow-hidden rounded-xl border border-slate-200 bg-white transition-all duration-150 hover:border-slate-300 hover:shadow-md ${
        isWatched && !isPlaying ? "opacity-70" : "opacity-100"
      }`}
    >
      {/* Thumbnail / inline player */}
      <div className="relative aspect-video overflow-hidden bg-slate-100">
        {isPlaying ? (
          <>
            <iframe
              ref={iframeRef}
              src={`https://www.youtube-nocookie.com/embed/${item.id}?autoplay=1&rel=0&modestbranding=1`}
              title={item.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              className="h-full w-full"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close player"
              className="absolute right-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-black/85"
            >
              Close
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handlePlayClick}
            aria-label={`Play: ${item.title}`}
            className="group/thumb relative block h-full w-full"
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
                    ? "bg-emerald-600/95"
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

            {/* Play overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-200 group-hover/thumb:bg-black/20">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 shadow-lg transition-transform duration-200 group-hover/thumb:scale-110">
                <Play className="h-4 w-4 fill-white text-white" />
              </div>
            </div>
          </button>
        )}
      </div>

      {/* Body */}
      <div className="p-2.5 sm:p-3">
        <div className="flex items-start justify-between gap-2">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              if (!isWatched) onMarkWatched(item.id);
            }}
            className="mb-1 line-clamp-2 flex-1 text-sm font-semibold leading-snug text-slate-900 transition-colors hover:text-emerald-700"
          >
            {item.title}
          </a>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={handleFavoriteClick}
              aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={isFavorited}
              className={`rounded-md p-1 transition-colors ${
                isFavorited
                  ? "text-amber-500 hover:bg-amber-50"
                  : "text-slate-300 hover:bg-slate-100 hover:text-amber-500"
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
              aria-label="Open on YouTube"
              className="rounded-md p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400 sm:text-[11px]">
          <span className="truncate font-medium text-slate-500">
            {item.channelName}
          </span>
          <span className="shrink-0">{relativeTime(item.publishedAt)}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {item.viewCount > 0 && (
              <span className="flex items-center gap-0.5 font-medium text-slate-500">
                <Eye className="h-3 w-3" />
                {formatCount(item.viewCount)}
              </span>
            )}
            {item.likeCount > 0 && (
              <span className="flex items-center gap-0.5 font-medium text-slate-500">
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
