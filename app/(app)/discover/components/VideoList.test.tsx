import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VideoItem } from "../types";
import { VideoList } from "./VideoList";

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

const videos: VideoItem[] = [
  {
    id: "a",
    title: "Alpha",
    url: "https://example.com/a",
    thumbnailUrl: "",
    channelName: "Channel",
    channelId: "channel",
    channelSubscriberCount: 1,
    isTrusted: false,
    trustTier: 0,
    expertiseTags: [],
    viewCount: 1,
    likeCount: 1,
    publishedAt: "2026-01-01T00:00:00.000Z",
    description: "",
    durationSeconds: 60,
    relevanceScore: 0.5,
  },
  {
    id: "b",
    title: "Beta",
    url: "https://example.com/b",
    thumbnailUrl: "",
    channelName: "Channel",
    channelId: "channel",
    channelSubscriberCount: 1,
    isTrusted: false,
    trustTier: 0,
    expertiseTags: [],
    viewCount: 1,
    likeCount: 1,
    publishedAt: "2026-01-01T00:00:00.000Z",
    description: "",
    durationSeconds: 60,
    relevanceScore: 0.5,
  },
  {
    id: "c",
    title: "Gamma",
    url: "https://example.com/c",
    thumbnailUrl: "",
    channelName: "Channel",
    channelId: "channel",
    channelSubscriberCount: 1,
    isTrusted: false,
    trustTier: 0,
    expertiseTags: [],
    viewCount: 1,
    likeCount: 1,
    publishedAt: "2026-01-01T00:00:00.000Z",
    description: "",
    durationSeconds: 60,
    relevanceScore: 0.5,
  },
];

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigationMocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("../hooks/useDiscoverData", () => ({
  useVideos: () => ({
    data: { items: videos, cached: false, fetchedAt: "2026-01-01T00:00:00.000Z" },
    isLoading: false,
    isPlaceholderData: false,
    error: null,
  }),
}));

vi.mock("./VideoCard", () => ({
  VideoCard: ({
    item,
    isWatched,
    onMarkWatched,
  }: {
    item: VideoItem;
    isWatched: boolean;
    onMarkWatched: (id: string) => void;
  }) => (
    <button
      type="button"
      data-testid="video-card"
      data-watched={isWatched ? "true" : "false"}
      onClick={() => onMarkWatched(item.id)}
    >
      {item.title}
    </button>
  ),
}));

function renderedTitles() {
  return screen.getAllByTestId("video-card").map((card) => card.textContent);
}

describe("VideoList watched ranking", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "joblit_discover_video_watched",
      JSON.stringify(["b"]),
    );
  });

  afterEach(() => {
    cleanup();
    navigationMocks.replace.mockClear();
  });

  it("keeps the current order after a click and refreshes the snapshot for a new category", async () => {
    render(<VideoList />);

    expect(renderedTitles()).toEqual(["Alpha", "Gamma", "Beta"]);

    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(renderedTitles()).toEqual(["Alpha", "Gamma", "Beta"]);
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute(
      "data-watched",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
    await waitFor(() => {
      expect(renderedTitles()).toEqual(["Gamma", "Alpha", "Beta"]);
    });
  });
});
