"use client";

import { useState, useCallback, useRef } from "react";
import { useTranslations, useFormatter } from "next-intl";
import {
  Key,
  Tag,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  ShieldCheck,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import type { AgentToken, AgentTokensApi } from "./useAgentTokens";

function TokenSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 px-4 py-3"
        >
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded-md bg-muted" />
            <div className="h-3 w-48 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="h-8 w-16 animate-pulse rounded-lg bg-muted" />
        </div>
      ))}
    </div>
  );
}

type TokenTranslate = ReturnType<typeof useTranslations>;
type AppFormatter = ReturnType<typeof useFormatter>;

function formatRelativeDate(
  dateStr: string,
  t: TokenTranslate,
  format: AppFormatter,
): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t("relative.today");
  if (diffDays === 1) return t("relative.yesterday");
  if (diffDays < 7) return t("relative.daysAgo", { days: diffDays });
  if (diffDays < 30) return t("relative.weeksAgo", { weeks: Math.floor(diffDays / 7) });
  return format.dateTime(date, { dateStyle: "medium" });
}

function formatExpiryDate(
  dateStr: string,
  t: TokenTranslate,
  format: AppFormatter,
): { text: string; urgent: boolean } {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { text: t("expiry.expired"), urgent: true };
  if (diffDays === 0) return { text: t("expiry.expiresToday"), urgent: true };
  if (diffDays <= 7) return { text: t("expiry.daysLeft", { days: diffDays }), urgent: true };
  if (diffDays <= 30)
    return { text: t("expiry.daysLeft", { days: diffDays }), urgent: false };
  return { text: format.dateTime(date, { dateStyle: "medium" }), urgent: false };
}

export function AgentTokenManager({
  tokensApi,
}: {
  tokensApi: AgentTokensApi;
}) {
  const { tokens, loading, loadError, newToken, creating } = tokensApi;
  const [tokenName, setTokenName] = useState("");
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AgentToken | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const newTokenRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const t = useTranslations("agent.tokens");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  // Data lives in useAgentTokens (shared with the onboarding stepper); this
  // component owns only presentation choreography — the reveal scroll, the
  // two-second highlight, the exit animation.
  const handleCreate = useCallback(async () => {
    const created = await tokensApi.create(tokenName);
    if (!created) return;
    setJustCreatedId(created.id);
    setTokenName("");
    requestAnimationFrame(() => {
      newTokenRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    setTimeout(() => setJustCreatedId(null), 2000);
  }, [tokensApi, tokenName]);

  const handleRevoke = useCallback(
    async (token: AgentToken) => {
      setRevoking(token.id);
      setRemovingId(token.id);
      const revoked = await tokensApi.revoke(token);
      if (!revoked) setRemovingId(null);
      setRevoking(null);
      setRevokeTarget(null);
    },
    [tokensApi],
  );

  const handleCopy = useCallback(
    async (text: string) => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: t("toast.copied") });
      setTimeout(() => setCopied(false), 2000);
    },
    [toast, t],
  );

  return (
    <div className="space-y-6">
      {/* ── Generate Token ── */}
      <div className="agent-card">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-emerald-100">
            <Plus className="h-4 w-4 text-brand-emerald-text" />
          </div>
          <h2 className="text-sm font-semibold text-foreground/90">
            {t("generateTitle")}
          </h2>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Tag className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <input
              ref={inputRef}
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !creating) handleCreate();
              }}
              placeholder={t("namePlaceholder")}
              className="agent-input pl-9"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="agent-btn-primary"
          >
            {creating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                <span>{t("creating")}</span>
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                <span>{t("generate")}</span>
              </>
            )}
          </button>
        </div>

        {/* ── New token reveal ── */}
        {newToken && (
          <div ref={newTokenRef} className="agent-token-reveal">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-200">
                <AlertTriangle className="h-3 w-3 text-amber-800" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-900">
                  {t("revealWarning")}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="agent-token-code">
                    {newToken.rawToken}
                  </code>
                  <button
                    onClick={() => handleCopy(newToken.rawToken)}
                    className={`agent-btn-copy ${copied ? "agent-btn-copy--done" : ""}`}
                  >
                    <span className="agent-btn-copy-inner">
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span>{copied ? t("copiedShort") : t("copy")}</span>
                    </span>
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-amber-700/80">
                  {t("expiresOn", {
                    date: format.dateTime(new Date(newToken.expiresAt), {
                      dateStyle: "medium",
                    }),
                  })}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Token List ── */}
      <div className="agent-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground/90">
              {t("activeTitle")}
            </h2>
            {!loading && tokens.length > 0 && (
              <span className="agent-count-badge">{tokens.length}</span>
            )}
          </div>
        </div>

        {loading ? (
          <TokenSkeleton />
        ) : loadError ? (
          <div className="agent-empty-state">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10">
              <Key className="h-5 w-5 text-destructive/70" />
            </div>
            <p className="text-sm font-medium text-foreground">{t("loadErrorTitle")}</p>
            <p className="text-xs text-muted-foreground/70">
              {t("loadErrorDescription")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => void tokensApi.refresh()}
            >
              {t("retry")}
            </Button>
          </div>
        ) : tokens.length === 0 ? (
          <div className="agent-empty-state">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <Key className="h-5 w-5 text-muted-foreground/70" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">{t("emptyTitle")}</p>
            <p className="text-xs text-muted-foreground/70">
              {t("emptyDescription")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tokens.map((token) => {
              const expiry = formatExpiryDate(token.expiresAt, t, format);
              const isRemoving = removingId === token.id;
              const isNew = justCreatedId === token.id;
              return (
                <div
                  key={token.id}
                  className={`agent-token-row ${isRemoving ? "agent-token-row--exit" : ""} ${isNew ? "agent-token-row--enter" : ""}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`agent-token-dot ${token.lastUsedAt ? "agent-token-dot--active" : ""}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground/90 truncate">
                        {token.name || t("unnamed")}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                        <span>
                          {t("createdAt", {
                            when: formatRelativeDate(token.createdAt, t, format),
                          })}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span>
                          {token.lastUsedAt
                            ? t("usedAt", {
                                when: formatRelativeDate(token.lastUsedAt, t, format),
                              })
                            : t("neverUsed")}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className={`flex items-center gap-0.5 ${expiry.urgent ? "text-amber-600 font-medium" : ""}`}>
                          {expiry.urgent && <Clock className="h-2.5 w-2.5" />}
                          {expiry.text}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setRevokeTarget(token)}
                    disabled={revoking === token.id}
                    className="agent-btn-revoke"
                  >
                    {revoking === token.id ? (
                      <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    <span>{t("revoke")}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Revoke Confirmation Dialog ── */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-4 w-4 text-red-600" />
              </div>
              {t("revokeDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              {t.rich("revokeDialogDescription", {
                name: revokeTarget?.name || t("unnamed"),
                strong: (chunks) => (
                  <span className="font-medium text-foreground/85">{chunks}</span>
                ),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="agent-dialog-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="agent-dialog-destructive"
              onClick={() => revokeTarget && handleRevoke(revokeTarget)}
            >
              {revoking ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
