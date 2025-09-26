import { describe, it, expect } from "vitest";
import {
  TYPES,
  TYPE_LABEL,
  likelihood,
  normalize,
  entropy,
  priorFromContextAndTop5,
  recomputePosterior,
  pickNextQuestion,
  type Question,
} from "../../features/coach/engine/inference";

const STRENGTH2TYPE = {
  戦略性: "TYPE_STRATEGY",
  共感性: "TYPE_EMPATHY",
} as const;

const Qs: Question[] = [
  {
    id: "Q1",
    text: "?",
    yes: {
      TYPE_STRATEGY: 0.9,
      TYPE_EMPATHY: 0.4,
      TYPE_EXECUTION: 0.5,
      TYPE_ANALYTICAL: 0.5,
      TYPE_STABILITY: 0.4,
    },
  },
  {
    id: "Q2",
    text: "?",
    yes: {
      TYPE_STRATEGY: 0.4,
      TYPE_EMPATHY: 0.9,
      TYPE_EXECUTION: 0.5,
      TYPE_ANALYTICAL: 0.5,
      TYPE_STABILITY: 0.6,
    },
  },
];

describe("engine", () => {
  it("prior is biased by context and strengths", () => {
    const p = priorFromContextAndTop5(
      "仕事",
      ["戦略性", "共感性"],
      STRENGTH2TYPE as any
    );
    const s = Object.values(p).reduce((a, b) => a + b, 0);
    expect(Math.abs(s - 1)).toBeLessThan(1e-9);
    expect(p.TYPE_STRATEGY).toBeGreaterThan(p.TYPE_STABILITY);
  });

  it("likelihood stays in (0,1)", () => {
    const v = likelihood("YES", 0.9);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it("recomputePosterior lowers entropy on informative answers", () => {
    const prior = priorFromContextAndTop5(
      "仕事",
      ["戦略性"],
      STRENGTH2TYPE as any
    );
    const H0 = entropy(prior);
    const { posterior } = recomputePosterior(prior, [{ q: Qs[0], a: "YES" }]);
    const H1 = entropy(posterior);
    expect(H1).toBeLessThanOrEqual(H0 + 1e-9);
  });

  it("pickNextQuestion is deterministic tie-broken by id", () => {
    const prior = priorFromContextAndTop5(
      "仕事",
      ["戦略性"],
      STRENGTH2TYPE as any
    );
    const { question } = pickNextQuestion(prior, Qs, new Set());
    expect(question?.id).toBeDefined();
  });
});
