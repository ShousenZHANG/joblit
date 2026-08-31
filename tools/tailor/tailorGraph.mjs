/**
 * The tailoring loop as a LangGraph state machine.
 *
 * Same semantics as the hand-written loop it replaced — generate, judge with
 * the deterministic gates, feed a rejection back as a repair instruction,
 * stop on acceptance, a repeated failure code, or the attempt cap. What the
 * graph buys over the for-loop: the termination conditions live on one
 * conditional edge instead of three scattered branches, every transition is
 * checkpointed (MemorySaver), and a human-approval interrupt can later be
 * added as a node rather than a rewrite.
 *
 * Nothing in the judging path is a model (ADR-0023): the `judge` node runs
 * the same `acceptApplicationGeneration` gates production runs, and the
 * repair edge carries their typed error, not an opinion.
 */
import { END, START, MemorySaver, StateGraph } from "@langchain/langgraph";

export const MAX_ATTEMPTS = 3;

/** Same failure twice running means the model cannot fix it; stop paying. */
function hasStalled(codes) {
  return codes.length >= 2 && codes.at(-1) === codes.at(-2);
}

/**
 * Build the graph with its effects injected: `generate(prompt)` runs the
 * model, `judge(raw)` runs the gates, `repair(error)` turns a typed rejection
 * into the next prompt's instruction. Injection keeps the graph testable
 * without a model call and keeps this module free of hermes/prisma imports.
 */
export function buildTailorGraph({ generate, judge, repair, onProgress = () => {} }) {
  const graph = new StateGraph({
    channels: {
      basePrompt: null,
      prompt: null,
      attempt: { reducer: (_prev, next) => next, default: () => 0 },
      raw: null,
      verdict: null,
      codes: { reducer: (prev, next) => prev.concat(next), default: () => [] },
      rejections: { reducer: (prev, next) => prev.concat(next), default: () => [] },
      tokensIn: { reducer: (prev, next) => prev + next, default: () => 0 },
      tokensOut: { reducer: (prev, next) => prev + next, default: () => 0 },
      outcome: null,
    },
  })
    .addNode("generate", async (state) => {
      const attempt = state.attempt + 1;
      onProgress({ phase: "generate", attempt, of: MAX_ATTEMPTS });
      const { raw, usage } = await generate(state.prompt);
      return {
        attempt,
        raw,
        tokensIn: usage?.input_tokens ?? 0,
        tokensOut: usage?.output_tokens ?? 0,
      };
    })
    .addNode("judge", async (state) => {
      const verdict = await judge(state.raw);
      if (verdict.ok) return { verdict, outcome: "accepted" };
      onProgress({
        phase: "rejected",
        attempt: state.attempt,
        code: verdict.error.code,
        message: verdict.error.message,
      });
      const codes = state.codes.concat(verdict.error.code);
      const outcome = hasStalled(codes)
        ? "stalled"
        : state.attempt >= MAX_ATTEMPTS
          ? "exhausted"
          : "retry";
      return {
        verdict,
        outcome,
        codes: [verdict.error.code],
        rejections: [
          { attempt: state.attempt, code: verdict.error.code, message: verdict.error.message },
        ],
      };
    })
    .addNode("repair", (state) => ({
      prompt: state.basePrompt + repair(state.verdict.error),
    }))
    .addEdge(START, "generate")
    .addEdge("generate", "judge")
    .addConditionalEdges("judge", (state) => (state.outcome === "retry" ? "repair" : END), [
      "repair",
      END,
    ])
    .addEdge("repair", "generate");

  return graph.compile({ checkpointer: new MemorySaver() });
}

/** Run one tailoring attempt series; returns the final state. */
export async function runTailorGraph(app, { basePrompt, threadId }) {
  return app.invoke(
    { basePrompt, prompt: basePrompt },
    // Recursion counts every super-step; 3 attempts of generate->judge->repair
    // plus START/END padding stays well inside 25.
    { configurable: { thread_id: threadId }, recursionLimit: 25 },
  );
}
