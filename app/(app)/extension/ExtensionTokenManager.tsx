"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import { useToast } from "@/hooks/use-toast";

interface ExtensionToken {
  id: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

interface NewTokenResult {
  id: string;
  rawToken: string;
  expiresAt: string;
}

function TokenSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 px-4 py-3"
        >
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded-md bg-slate-200" />
            <div className="h-3 w-48 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="h-8 w-16 animate-pulse rounded-lg bg-slate-200" />
        </div>
      ))}
    </div>
  );
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

function formatExpiryDate(dateStr: string): { text: string; urgent: boolean } {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { text: "Expired", urgent: true };
  if (diffDays === 0) return { text: "Expires today", urgent: true };
  if (diffDays <= 7) return { text: `${diffDays}d left`, urgent: true };
  if (diffDays <= 30) return { text: `${diffDays}d left`, urgent: false };
  return { text: date.toLocaleDateString(), urgent: false };
}

export function ExtensionTokenManager() {
  const [tokens, setTokens] = useState<ExtensionToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [newToken, setNewToken] = useState<NewTokenResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ExtensionToken | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const newTokenRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch("/api/ext/auth/token");
      const json = await res.json();
      if (json.data) setTokens(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/ext/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tokenName.trim() || undefined,
          expiryDays: 90,
        }),
      });
      const json = await res.json();
      if (json.data) {
        setNewToken(json.data);
        setJustCreatedId(json.data.id);
        setTokenName("");
        await fetchTokens();
        // Scroll to the new token reveal after a tick
        requestAnimationFrame(() => {
          newTokenRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
        toast({
          title: "Token created",
          description: "Copy and paste it into the extension to connect.",
        });
        // Clear the "just created" highlight after animation
        setTimeout(() => setJustCreatedId(null), 2000);
      }
    } catch {
      toast({
        title: "Failed to create token",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }, [tokenName, fetchTokens, toast]);

  const handleRevoke = useCallback(
    async (token: ExtensionToken) => {
      setRevoking(token.id);
      try {
        await fetch("/api/ext/auth/token", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenId: token.id }),
        });
        // Animate out before removing from list
        setRemovingId(token.id);
        setTimeout(async () => {
          await fetchTokens();
          setRemovingId(null);
          if (newToken?.id === token.id) {
            setNewToken(null);
          }
          toast({
            title: "Token revoked",
            description: `"${token.name || "Unnamed token"}" has been permanently revoked.`,
          });
        }, 300);
      } catch {
        toast({
          title: "Failed to revoke token",
          description: "Please try again.",
          variant: "destructive",
        });
      } finally {
        setRevoking(null);
        setRevokeTarget(null);
      }
    },
    [fetchTokens, newToken, toast],
  );

  const handleCopy = useCallback(
    async (text: string) => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    },
    [toast],
  );

  return (
    <div className="space-y-6">
      {/* ── Generate Token ── */}
      <div className="ext-card">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-emerald-100">
            <Plus className="h-4 w-4 text-brand-emerald-700" />
          </div>
          <h2 className="text-sm font-semibold text-foreground/90">
            Generate New Token
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
              placeholder="e.g. My Laptop Chrome"
              className="ext-input pl-9"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="ext-btn-primary"
          >
            {creating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Creating...</span>
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                <span>Generate</span>
              </>
            )}
          </button>
        </div>

        {/* ── New token reveal ── */}
        {newToken && (
          <div ref={newTokenRef} className="ext-token-reveal">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-200">
                <AlertTriangle className="h-3 w-3 text-amber-800" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-900">
                  Copy this token now — it won&apos;t be shown again.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="ext-token-code">
                    {newToken.rawToken}
                  </code>
                  <button
                    onClick={() => handleCopy(newToken.rawToken)}
                    className={`ext-btn-copy ${copied ? "ext-btn-copy--done" : ""}`}
                  >
                    <span className="ext-btn-copy-inner">
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span>{copied ? "Copied!" : "Copy"}</span>
                    </span>
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-amber-700/80">
                  Expires {new Date(newToken.expiresAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Token List ── */}
      <div className="ext-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground/90">
              Active Tokens
            </h2>
            {!loading && tokens.length > 0 && (
              <span className="ext-count-badge">{tokens.length}</span>
            )}
          </div>
        </div>

        {loading ? (
          <TokenSkeleton />
        ) : tokens.length === 0 ? (
          <div className="ext-empty-state">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <Key className="h-5 w-5 text-muted-foreground/70" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No active tokens</p>
            <p className="text-xs text-muted-foreground/70">
              Generate one above to connect the extension.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tokens.map((token) => {
              const expiry = formatExpiryDate(token.expiresAt);
              const isRemoving = removingId === token.id;
              const isNew = justCreatedId === token.id;
              return (
                <div
                  key={token.id}
                  className={`ext-token-row ${isRemoving ? "ext-token-row--exit" : ""} ${isNew ? "ext-token-row--enter" : ""}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`ext-token-dot ${token.lastUsedAt ? "ext-token-dot--active" : ""}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground/90 truncate">
                        {token.name || "Unnamed token"}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                        <span>Created {formatRelativeDate(token.createdAt)}</span>
                        <span className="text-slate-300">·</span>
                        <span>
                          {token.lastUsedAt
                            ? `Used ${formatRelativeDate(token.lastUsedAt)}`
                            : "Never used"}
                        </span>
                        <span className="text-slate-300">·</span>
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
                    className="ext-btn-revoke"
                  >
                    {revoking === token.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    <span>Revoke</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Setup Instructions ── */}
      <div className="ext-card">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
            <ShieldCheck className="h-4 w-4 text-blue-600" />
          </div>
          <h2 className="text-sm font-semibold text-foreground/90">
            Setup Instructions
          </h2>
        </div>
        <ol className="ext-instructions">
          <li>
            <span className="ext-step-num">1</span>
            <span>Install the Joblit AutoFill extension from the Chrome Web Store.</span>
          </li>
          <li>
            <span className="ext-step-num">2</span>
            <span>Click the extension icon in your toolbar.</span>
          </li>
          <li>
            <span className="ext-step-num">3</span>
            <span>Paste the generated token and click <strong>Connect</strong>.</span>
          </li>
          <li>
            <span className="ext-step-num">4</span>
            <span>Visit any ATS job application page — the extension will auto-detect form fields.</span>
          </li>
        </ol>
      </div>

      {/* ── Revoke Confirmation Dialog ── */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-4 w-4 text-red-600" />
              </div>
              Revoke Token
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              This will permanently revoke{" "}
              <span className="font-medium text-foreground/85">
                &quot;{revokeTarget?.name || "Unnamed token"}&quot;
              </span>
              . Any extension using this token will be disconnected immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="ext-dialog-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="ext-dialog-destructive"
              onClick={() => revokeTarget && handleRevoke(revokeTarget)}
            >
              {revoking ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
