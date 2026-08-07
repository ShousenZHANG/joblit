"use client";

import { AgentTokenManager } from "./AgentTokenManager";
import { RunnerSetupStepper } from "./RunnerSetupStepper";
import { useAgentTokens } from "./useAgentTokens";

/**
 * Client shell for the Agent page: one credentials hook shared by the
 * onboarding stepper (quick-create, snippet injection, live completion) and
 * the token manager (list, named create, revoke), so a credential minted in
 * either place is instantly reflected in both.
 */
export function AgentWorkspace({ origin }: { origin: string }) {
  const tokensApi = useAgentTokens();

  return (
    <>
      <RunnerSetupStepper origin={origin} tokensApi={tokensApi} />
      <AgentTokenManager tokensApi={tokensApi} />
    </>
  );
}
