import type {
  ContextualYearExpression,
  RelationDraft,
  YearExpression,
} from "./types";

function connector(
  value: string,
  start: number,
  end: number,
): { start: number; end: number; kind: RelationDraft["kind"] } | null {
  const between = value.slice(start, end);
  const match = [...between.matchAll(/\b(and|or|plus)\b/giu)].at(-1);
  if (!match) return null;
  return {
    start: start + match.index,
    end: start + match.index + match[0].length,
    kind: match[1]?.toLocaleLowerCase("en") === "or" ? "ANY_OF" : "ALL_OF",
  };
}

function subsetConnector(
  value: string,
  start: number,
  end: number,
): { start: number; end: number; kind: RelationDraft["kind"] } | null {
  const word = connector(value, start, end);
  if (word) return word;
  const punctuation = [...value.slice(start, end).matchAll(/[,;]/gu)].at(-1);
  if (!punctuation) return null;
  return {
    start: start + punctuation.index,
    end: start + punctuation.index + punctuation[0].length,
    kind: "ALL_OF",
  };
}

/**
 * Group expressions only when their connector grammar is unambiguous. Unsafe
 * mixed/conditional paths survive as REVIEW findings without a relation.
 */
export function contextualizeExpressions(
  evidence: string,
  evidenceStart: number,
  expressions: YearExpression[],
): ContextualYearExpression[] {
  if (expressions.length < 2) {
    return expressions.map((expression) => ({
      expression,
      clauseStart: 0,
      clauseEnd: evidence.length,
      forceReview: false,
    }));
  }

  const first = expressions[0];
  const second = expressions[1];
  if (!first || !second) return [];
  const inclusionGap = evidence.slice(first.end, second.start);
  const inclusion = inclusionGap.match(/\b(?:including|of\s+which)\b/iu);
  const subsetConnectors = expressions
    .slice(1, -1)
    .map((expression, index) =>
      subsetConnector(
        evidence,
        expression.end,
        expressions[index + 2]?.start ?? expression.end,
      ),
    );
  const conditional =
    /\band\s*\/\s*or\b|\b(?:if|unless|provided(?:\s+that)?|depending(?:\s+on)?)\b/iu.test(
      evidence,
    );
  if (
    inclusion &&
    !conditional &&
    subsetConnectors.every((item) => item?.kind === "ALL_OF")
  ) {
    const boundaryStart = first.end + (inclusion.index ?? 0);
    const boundaryEnd = boundaryStart + inclusion[0].length;
    const groupId = `experience-group-${evidenceStart}-${evidenceStart + evidence.length}-included`;
    return expressions.map((expression, index) => ({
      expression,
      clauseStart:
        index === 0
          ? 0
          : index === 1
            ? boundaryEnd
            : (subsetConnectors[index - 2]?.end ?? boundaryEnd),
      clauseEnd:
        index === 0
          ? boundaryStart
          : (subsetConnectors[index - 1]?.start ?? evidence.length),
      relation: {
        groupId,
        kind: "ALL_OF",
        role: index === 0 ? "TOTAL" : "SUBSET",
      },
      forceReview: false,
    }));
  }

  const connectors = expressions
    .slice(0, -1)
    .map((expression, index) =>
      connector(
        evidence,
        expression.end,
        expressions[index + 1]?.start ?? expression.end,
      ),
    );
  const kind = connectors[0]?.kind;
  const complete = connectors.filter(Boolean).length === connectors.length;
  const homogeneous = connectors.every((item) => item?.kind === kind);
  const unsafe = conditional || !complete || !homogeneous || !kind;
  const relation: RelationDraft | undefined = unsafe
    ? undefined
    : {
        groupId: `experience-group-${evidenceStart}-${evidenceStart + evidence.length}-${kind.toLocaleLowerCase("en")}`,
        kind,
      };

  return expressions.map((expression, index) => ({
    expression,
    clauseStart: connectors[index - 1]?.end ?? 0,
    clauseEnd: connectors[index]?.start ?? evidence.length,
    ...(relation ? { relation } : {}),
    forceReview: unsafe,
  }));
}

/** Keep truncation from exposing a half relation group. */
export function capCompleteRelationGroups<
  T extends { relation?: RelationDraft },
>(requirements: T[], limit: number): { requirements: T[]; truncated: boolean } {
  const truncated = requirements.length > limit;
  let capped = requirements.slice(0, limit);
  if (!truncated) return { requirements: capped, truncated };

  const totals = new Map<string, number>();
  const included = new Map<string, number>();
  for (const requirement of requirements) {
    const id = requirement.relation?.groupId;
    if (id) totals.set(id, (totals.get(id) ?? 0) + 1);
  }
  for (const requirement of capped) {
    const id = requirement.relation?.groupId;
    if (id) included.set(id, (included.get(id) ?? 0) + 1);
  }
  const incomplete = new Set(
    [...included].flatMap(([id, count]) =>
      count === totals.get(id) ? [] : [id],
    ),
  );
  capped = capped.filter(
    (item) => !item.relation || !incomplete.has(item.relation.groupId),
  );
  return { requirements: capped, truncated };
}
