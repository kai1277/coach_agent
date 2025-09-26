import { describe, it, expect } from "vitest";
import { runSimulation } from "../../features/coach/engine/simulator";

describe("question engine simulator", () => {
  it("runs and prints quick KPIs", () => {
    const res = runSimulation({
      nUsers: 2000,
      threshold: 0.9,
      maxQuestions: 12,
      minQuestions: 1,
      noise: 0.0,
      context: null,
      strengths_top5: null,
    });

    expect(res.avgQuestions).toBeGreaterThan(0);
    expect(res.avgConfidence).toBeGreaterThan(0.5);

    // デバッグ出力
    // eslint-disable-next-line no-console
    console.table({
      avgQuestions: res.avgQuestions.toFixed(2),
      avgConfidence: res.avgConfidence.toFixed(3),
      stopByThreshold: res.stopByThreshold.toFixed(2),
      stopByMax: res.stopByMax.toFixed(2),
      typeHitRate: res.typeHitRate.toFixed(2),
    });
    // eslint-disable-next-line no-console
    console.log("Top IG questions:", res.igPerQuestion.slice(0, 8));
  }, 15000); // ★ ここを追加（15秒）
});
