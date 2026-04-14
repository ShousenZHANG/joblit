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
  viewCount: number;
  likeCount: number;
  publishedAt: string;
  description: string;
  durationSeconds: number;
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
