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

export interface VideoItem {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  channelName: string;
  viewCount: number;
  publishedAt: string;
  description: string;
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
