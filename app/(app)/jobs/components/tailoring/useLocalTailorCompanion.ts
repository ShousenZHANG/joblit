"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  accountFingerprint, authResponseSchema, CompanionError, companionRequest,
  companionStatusSchema, isTaskRunning, launchCompanion, newChallenge,
  pairingSchema, pairingToken, parseTask, taskPacketSchema, unwrapTask,
  type CompanionStatus, type CompanionTask,
} from "@/lib/client/localTailoring/companionClient";
import type { TailorTarget } from "./tailorActions";

type Connection = "disconnected" | "checking" | "connecting" | "ready" | "auth-required" | "authenticating" | "unavailable" | "error";
type Issue = { code: CompanionError["code"]; message: string };
const issueFrom = (error: unknown): Issue => error instanceof CompanionError
  ? { code: error.code, message: error.message }
  : { code: "protocol", message: "The companion response is not compatible with this version of Joblit." };
const taskQuery = (jobId: string, target: TailorTarget) => new URLSearchParams({ jobId, target }).toString();

/** Browser lifetimes only affect observation; tasks belong to the installed companion. */
export function useLocalTailorCompanion({ jobId, target }: { jobId: string; target: TailorTarget }) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [identity, setIdentity] = useState<{ userId: string; account: string; token: string | null } | null>(null);
  const identityRef = useRef(identity);
  useLayoutEffect(() => { identityRef.current = identity; }, [identity]);
  const [connection, setConnection] = useState<Connection>("disconnected");
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [connectionError, setConnectionError] = useState<Issue | null>(null);
  const [task, setTask] = useState<CompanionTask | null>(null);
  const [taskError, setTaskError] = useState<Issue | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [dispatchPending, setDispatchPending] = useState(false);
  const [submittedTaskId, setSubmittedTaskId] = useState<string | null>(null);
  const scope = `${userId ?? ""}:${jobId}:${target}`;
  const scopeRef = useRef(scope);
  useLayoutEffect(() => { scopeRef.current = scope; }, [scope]);
  const mounted = useRef(true);
  const pairingController = useRef<AbortController | null>(null);
  const operationController = useRef<AbortController | null>(null);
  const activeOperation = useRef(false);
  const operationVersion = useRef(0);
  const token = identity && identity.userId === userId ? identity.token : null;
  const [identityUser, setIdentityUser] = useState(userId);
  const [taskScope, setTaskScope] = useState(scope);
  // Reset owned state before a different account or document can render it.
  if (identityUser !== userId) {
    setIdentityUser(userId);
    setIdentity(null);
    setStatus(null);
    setConnection("disconnected");
    setConnectionError(null);
  }
  if (taskScope !== scope) {
    setTaskScope(scope);
    setTask(null);
    setTaskError(null);
    setRestoring(true);
    setStarting(false);
    setCancelling(false);
    setRecoveryRequired(false);
    setDispatchPending(false);
    setSubmittedTaskId(null);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pairingController.current?.abort();
      operationController.current?.abort();
    };
  }, []);

  useEffect(() => {
    let current = true;
    pairingController.current?.abort();
    pairingController.current = null;
    if (userId) {
      void accountFingerprint(userId).then((account) => {
        if (current) {
          const storedToken = pairingToken(account);
          setIdentity({ userId, account, token: storedToken });
          setConnection(storedToken ? "checking" : "disconnected");
        }
      }).catch(() => {
        if (current) { setConnection("error"); setConnectionError({ code: "protocol", message: "A secure browser context is required to connect this computer." }); }
      });
    }
    return () => { current = false; };
  }, [userId]);

  const acceptStatus = useCallback((value: unknown) => {
    const parsed = companionStatusSchema.safeParse(value);
    if (!parsed.success) throw new CompanionError("protocol", "Update the companion to connect this version of Joblit.");
    setStatus(parsed.data);
    setConnectionError(null);
    setConnection(parsed.data.runtime.state !== "ready" || parsed.data.auth.state === "unavailable" ? "unavailable"
      : parsed.data.auth.state === "ready" ? "ready"
        : parsed.data.auth.state === "authenticating" ? "authenticating" : "auth-required");
  }, []);

  const checkConnection = useCallback(async (signal?: AbortSignal) => {
    const current = identityRef.current;
    if (!current?.token || (pairingController.current && !pairingController.current.signal.aborted)) return;
    try {
      const result = await companionRequest("/status", { token: current.token, signal });
      if (!signal?.aborted && mounted.current && identityRef.current?.account === current.account && !pairingController.current) acceptStatus(result);
    } catch (error) {
      if (signal?.aborted || !mounted.current || identityRef.current?.account !== current.account) return;
      const issue = issueFrom(error);
      if (issue.code === "aborted") return;
      if (issue.code === "permission") {
        pairingToken(current.account, null);
        setIdentity({ ...current, token: null });
      }
      setConnectionError(issue);
      setConnection("error");
    }
  }, [acceptStatus]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await checkConnection(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 4000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, checkConnection]);

  const stopConnecting = useCallback(() => {
    pairingController.current?.abort();
    pairingController.current = null;
    setConnection("disconnected");
    setConnectionError(null);
  }, []);

  const connect = useCallback(async () => {
    const current = identityRef.current;
    if (!current || current.userId !== userId) return;
    pairingController.current?.abort();
    const controller = new AbortController();
    pairingController.current = controller;
    const challenge = newChallenge();
    setConnection("connecting");
    setConnectionError(null);
    launchCompanion(current.account, challenge);
    const deadline = Date.now() + 30000;
    let lastError: unknown = new CompanionError("timeout", "The connection has not been confirmed yet.");
    while (!controller.signal.aborted && Date.now() < deadline) {
      try {
        const value = await companionRequest("/pair", { body: { challenge, account: current.account }, signal: controller.signal, timeoutMs: 2000 });
        const parsed = pairingSchema.safeParse(value);
        if (!parsed.success || parsed.data.account !== current.account) throw new CompanionError("protocol", "The companion pairing response could not be verified.");
        if (controller.signal.aborted || identityRef.current?.account !== current.account || !mounted.current) return;
        pairingToken(current.account, parsed.data.token);
        pairingController.current = null;
        setIdentity({ ...current, token: parsed.data.token });
        setConnection("checking");
        try {
          const status = await companionRequest("/status", { token: parsed.data.token, signal: controller.signal });
          if (!controller.signal.aborted && mounted.current && identityRef.current?.account === current.account) acceptStatus(status);
        } catch (error) {
          if (!controller.signal.aborted && mounted.current && identityRef.current?.account === current.account) { setConnection("error"); setConnectionError(issueFrom(error)); }
        }
        return;
      } catch (error) {
        lastError = error;
        if (error instanceof CompanionError && error.code === "protocol") break;
      }
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 700);
        controller.signal.addEventListener("abort", done, { once: true });
        if (controller.signal.aborted) done();
      });
    }
    if (!controller.signal.aborted && mounted.current && identityRef.current?.account === current.account) {
      pairingController.current = null;
      setConnection("error");
      setConnectionError(issueFrom(lastError));
    }
  }, [acceptStatus, userId]);

  const startAuth = useCallback(async () => {
    const current = identityRef.current;
    if (!current?.token) return;
    setConnectionError(null);
    setConnection("authenticating");
    try {
      const value = authResponseSchema.parse(await companionRequest("/auth/start", { token: current.token, body: {} }));
      if (!mounted.current || identityRef.current?.account !== current.account) return;
      setStatus((previous) => previous ? { ...previous, auth: value.auth } : null);
      await checkConnection();
    } catch (error) {
      if (mounted.current && identityRef.current?.account === current.account) { setConnectionError(issueFrom(error)); setConnection("error"); }
    }
  }, [checkConnection]);

  const refreshTask = useCallback(async (signal?: AbortSignal) => {
    if (!userId) { setRestoring(false); return; }
    const ownScope = scope;
    const version = operationVersion.current;
    try {
      const server = unwrapTask(await companionRequest(`/api/local-tailoring/tasks?${taskQuery(jobId, target)}`, { local: false, signal }));
      if (server && (server.jobId !== jobId || server.target !== target)) throw new CompanionError("protocol", "The returned task belongs to a different document.");
      let latest = server;
      let undelivered = false;
      const current = identityRef.current;
      if (current?.token && current.userId === userId && (!server || isTaskRunning(server))) {
        try {
          const response = await companionRequest(`/tasks?${taskQuery(jobId, target)}`, { token: current.token, signal, timeoutMs: 1800 });
          if (typeof response !== "object" || !response || !("tasks" in response) || !Array.isArray(response.tasks)) throw new CompanionError("protocol", "Missing task list.");
          const localTasks = response.tasks.map(parseTask).filter((item): item is CompanionTask => !!item && item.jobId === jobId && item.target === target);
          const local = server ? localTasks.find((item) => item.taskId === server.taskId) : localTasks[0];
          undelivered = server?.status === "queued" && !local;
          latest = local ?? server;
        } catch { /* Durable server state remains available when the companion is unreachable. */ }
      }
      if (!signal?.aborted && mounted.current && scopeRef.current === ownScope && !activeOperation.current && operationVersion.current === version) {
        setTask(latest);
        setDispatchPending(undelivered);
        setRecoveryRequired(false);
        if (!latest || latest.status !== "queued" || undelivered) setTaskError(null);
        setRestoring(false);
      }
    } catch (error) {
      if (!signal?.aborted && mounted.current && scopeRef.current === ownScope) {
        setTaskError(issueFrom(error));
        setRestoring(false);
      }
    }
  }, [jobId, scope, target, userId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    activeOperation.current = false;
    operationVersion.current += 1;
    operationController.current?.abort();
    const poll = async () => {
      await refreshTask(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2200);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refreshTask]);

  const generate = useCallback(async () => {
    const current = identityRef.current;
    if (!current?.token || current.userId !== userId || connection !== "ready" || restoring || recoveryRequired || (isTaskRunning(task) && !dispatchPending) || activeOperation.current) return;
    const ownScope = scope;
    const controller = new AbortController();
    operationController.current = controller;
    activeOperation.current = true;
    operationVersion.current += 1;
    setStarting(true);
    setDispatchPending(false);
    setTaskError(null);
    let issued = false;
    try {
      const packet = taskPacketSchema.parse(await companionRequest("/api/local-tailoring/tasks", { local: false, body: { jobId, target }, signal: controller.signal }));
      issued = true;
      if (scopeRef.current !== ownScope || !mounted.current) return;
      setSubmittedTaskId(packet.taskId);
      setTask({ taskId: packet.taskId, jobId, target, status: "queued", attempt: 0, maxAttempts: 3 });
      const response = await companionRequest("/tasks", { token: current.token, body: { ...packet, jobId, target, apiOrigin: location.origin }, signal: controller.signal });
      const accepted = unwrapTask(response);
      if (!accepted || accepted.taskId !== packet.taskId || accepted.jobId !== jobId || accepted.target !== target) throw new CompanionError("protocol", "The companion returned a different task.");
      if (scopeRef.current === ownScope && mounted.current) setTask(accepted);
    } catch (error) {
      if (scopeRef.current === ownScope && mounted.current && !controller.signal.aborted) {
        const issue = issueFrom(error);
        setTaskError(issue);
        if (!issued && ["network", "timeout", "protocol"].includes(issue.code)) setRecoveryRequired(true);
      }
    } finally {
      if (scopeRef.current === ownScope && mounted.current) { activeOperation.current = false; setStarting(false); }
    }
  }, [connection, dispatchPending, jobId, recoveryRequired, restoring, scope, target, task, userId]);

  const cancel = useCallback(async () => {
    if (!task || !isTaskRunning(task) || cancelling) return;
    const ownScope = scope;
    operationVersion.current += 1;
    setCancelling(true);
    setTaskError(null);
    const current = identityRef.current;
    const localCancel = current?.token ? companionRequest(`/tasks/${encodeURIComponent(task.taskId)}/cancel`, { token: current.token, body: {}, timeoutMs: 2000 }).catch(() => null) : Promise.resolve(null);
    try {
      const response = await companionRequest(`/api/local-tailoring/tasks/${encodeURIComponent(task.taskId)}/cancel`, { local: false, body: {} });
      if (scopeRef.current === ownScope && mounted.current) setTask(unwrapTask(response));
    } catch (error) {
      if (scopeRef.current === ownScope && mounted.current) setTaskError(issueFrom(error));
    } finally {
      await localCancel;
      if (scopeRef.current === ownScope && mounted.current) { setCancelling(false); void refreshTask(); }
    }
  }, [cancelling, refreshTask, scope, task]);

  return {
    accountKey: userId ?? null,
    hasPairing: !!token,
    connection, connectionError, status, canConnect: !!identity && identity.userId === userId,
    connect, stopConnecting, checkConnection, startAuth,
    task, taskError, restoring: restoring || recoveryRequired, starting, cancelling, dispatchPending, submittedTaskId,
    generating: starting || (isTaskRunning(task) && !dispatchPending), generate, cancel, refreshTask,
  };
}

export type LocalTailorCompanion = ReturnType<typeof useLocalTailorCompanion>;
