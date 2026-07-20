import { prisma } from "@/lib/server/prisma";
import { createAtsAdapters } from "./adapters/ats";
import {
  parseAtsBoardRegistry,
  type AtsBoardConfig,
  type AtsBoardRegistryIssue,
} from "./atsBoards";
import type { SourceAdapter } from "./types";

export interface LoadedAtsBoards {
  boards: AtsBoardConfig[];
  adapters: SourceAdapter[];
  issues: AtsBoardRegistryIssue[];
}

/** Read enabled public board identifiers. No credentials are stored or read. */
export async function loadEnabledAtsBoardAdapters(): Promise<LoadedAtsBoards> {
  const delegate = prisma.atsBoardSource;
  const rows = await delegate.findMany({
    where: { enabled: true },
    orderBy: [{ provider: "asc" }, { company: "asc" }],
    select: {
      sourceId: true,
      provider: true,
      boardToken: true,
      company: true,
      region: true,
      careersUrl: true,
      enabled: true,
    },
  });
  const parsed = parseAtsBoardRegistry(rows);
  return {
    boards: parsed.boards,
    adapters: createAtsAdapters(parsed.boards),
    issues: parsed.issues,
  };
}
