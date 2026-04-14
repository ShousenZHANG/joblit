export interface TrendingRepo {
  id: number;
  fullName: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  language: string | null;
  topics: string[];
  ownerAvatar: string;
  pushedAt: string;
}

export type VideoCategory =
  | "all"
  | "claude"
  | "anthropic"
  | "rag"
  | "agents"
  | "mcp"
  | "harness";

export type VideoSort = "trending" | "latest" | "most_viewed";

export interface VideoItem {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  channelName: string;
  channelId: string;
  channelSubscriberCount: number;
  isTrusted: boolean;
  /** 0 = not trusted, 1/2/3 = tier (1 = highest authority) */
  trustTier: 0 | 1 | 2 | 3;
  /** Channel's declared expertise tags (matches VideoCategory values). */
  expertiseTags: string[];
  viewCount: number;
  likeCount: number;
  publishedAt: string;
  description: string;
  durationSeconds: number;
  /** 0-1 content relevance from title+description keyword overlap vs category. */
  relevanceScore: number;
}

export interface TrendingResponse {
  repos: TrendingRepo[];
  cached: boolean;
  fetchedAt: string;
}

export interface VideosResponse {
  items: VideoItem[];
  cached: boolean;
  fetchedAt: string;
  noApiKey?: boolean;
}
