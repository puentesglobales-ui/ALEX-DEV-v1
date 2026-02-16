export class ScoreEngine {
  private weights: Record<string, number> = {
    DEBUG_REQUEST: 15,
    REFACTOR_REQUEST: 20,
    ARCHITECTURE_DESIGN: 30,
    OPTIMIZATION_SUGGESTION: 25,
    TECHNICAL_BLOCKER: -10,
    CLARIFICATION_PROVIDED: 10
  };

  updateScore(current: number, signals: string[]) {
    const delta = signals.reduce(
      (acc, s) => acc + (this.weights[s] || 0),
      0
    );
    // Score representa el "Project Readiness" o "Complexity Resolution"
    return Math.max(0, current + delta);
  }

  deriveStage(score: number): string {
    if (score < 25) return "triage";
    if (score < 50) return "analysis";
    if (score < 80) return "implementation";
    return "review";
  }
}
