import { describe, it, expect } from "vitest";
import { runSimulation } from "../../features/coach/engine/simulator";

describe("question engine simulator", () => {
  it("runs and prints quick KPIs", () => {
    const res = runSimulation({
      nUsers: 1000,
      threshold: 0.9,
      maxQuestions: 8,
      minQuestions: 1,
      noise: 0.05,
      context: null,
      strengths_top5: null,
    });

    // 粗い妥当性チェック
    expect(res.avgQuestions).toBeGreaterThan(0);
    expect(res.avgConfidence).toBeGreaterThan(0.5);

    // コンソールにサマリ出力（開発者が見る用）
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
  });
});
