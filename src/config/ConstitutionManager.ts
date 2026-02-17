import fs from "fs";
import path from "path";

export interface Constitution {
  id: string;
  name: string;
  version: string;
  description: string;
  systemPrompt: string;
  principles: string[];
  limits: string[];
  communication: {
    style: string;
    emoji: boolean;
    codeBlocks: boolean;
    responseFormat: string;
    maxLength?: number;
  };
  behavior: {
    proactive: boolean;
    askClarifyingQuestions: boolean;
    suggestImprovements: boolean;
    explainWhenNeeded: boolean;
    [key: string]: any;
  };
  labelSchemas?: {
    [key: string]: string[];
  };
}

const CONSTITUTIONS_DIR = path.join(__dirname, "constitutions");

export class ConstitutionManager {
  private constitutions: Map<string, Constitution> = new Map();

  constructor() {
    this.loadAll();
  }

  private loadAll(): void {
    const files = fs.readdirSync(CONSTITUTIONS_DIR).filter(f => f.endsWith(".json"));

    for (const file of files) {
      const content = fs.readFileSync(path.join(CONSTITUTIONS_DIR, file), "utf-8");
      const constitution: Constitution = JSON.parse(content);
      this.constitutions.set(constitution.id, constitution);
    }

    console.log(`📜 Loaded ${this.constitutions.size} constitutions:`, Array.from(this.constitutions.keys()).join(", "));
  }

  get(id: string): Constitution | undefined {
    return this.constitutions.get(id);
  }

  getAll(): Constitution[] {
    return Array.from(this.constitutions.values());
  }

  getSystemPrompt(id: string): string | undefined {
    return this.constitutions.get(id)?.systemPrompt;
  }

  getPrinciples(id: string): string[] {
    return this.constitutions.get(id)?.principles || [];
  }

  buildPrompt(id: string, customContext?: string): string {
    const constitution = this.constitutions.get(id);
    if (!constitution) {
      throw new Error(`Constitution not found: ${id}`);
    }

    let prompt = constitution.systemPrompt + "\n\n";
    prompt += "PRINCIPIOS:\n";
    constitution.principles.forEach(p => prompt += `- ${p}\n`);
    
    if (customContext) {
      prompt += `\nCONTEXTO ADICIONAL:\n${customContext}\n`;
    }

    return prompt;
  }
}

export const constitutionManager = new ConstitutionManager();
