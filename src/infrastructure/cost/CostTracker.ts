export class CostTracker {
  private readonly costPer1kTokens: number;
  private readonly budgetThreshold: number;

  constructor(config: { costPer1kTokens: number; budgetThreshold: number }) {
    this.costPer1kTokens = config.costPer1kTokens;
    this.budgetThreshold = config.budgetThreshold;
  }

  calculateCost(tokensUsed: number): number {
    return (tokensUsed / 1000) * this.costPer1kTokens;
  }

  isOverBudget(totalCost: number): boolean {
    return totalCost >= this.budgetThreshold;
  }
}
