import { ScoreEngine } from "../src/domain/services/ScoreEngine";

describe("ScoreEngine", () => {
  const engine = new ScoreEngine();

  it("should increase score correctly for BUY_INTENT", () => {
    const result = engine.updateScore(0, ["BUY_INTENT"]);
    expect(result).toBe(25);
  });

  it("should decrease score correctly for OBJECTION", () => {
    const result = engine.updateScore(50, ["OBJECTION"]);
    expect(result).toBe(40);
  });

  it("should derive discovery stage for low score", () => {
    expect(engine.deriveStage(10)).toBe("discovery");
  });

  it("should derive close stage for high score", () => {
    expect(engine.deriveStage(90)).toBe("close");
  });
});
