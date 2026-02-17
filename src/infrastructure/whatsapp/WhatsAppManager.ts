import fs from "fs";
import path from "path";

export interface Lead {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  segment: string;
  status: "new" | "contacted" | "qualified" | "converted" | "lost";
  source: string;
  interest?: string;
  budget?: string;
  notes: string[];
  conversationStart: Date;
  lastInteraction: Date;
  messagesCount: number;
  totalSpent: number;
}

export interface SentimentResult {
  sentiment: "positive" | "neutral" | "negative" | "angry" | "sad";
  score: number;
  keywords: string[];
}

export interface WhatsAppMessage {
  from: string;
  type: string;
  text?: string;
  image?: any;
  audio?: any;
}

export interface WhatsAppResponse {
  to: string;
  type: string;
  text?: string;
  template?: string;
  parameters?: Record<string, string>;
}

const TEMPLATES_PATH = path.join(__dirname, "responseTemplates.json");

class WhatsAppManager {
  private templates: any;
  private leads: Map<string, Lead> = new Map();
  private sentimentCache: Map<string, SentimentResult> = new Map();

  constructor() {
    this.loadTemplates();
  }

  private loadTemplates(): void {
    try {
      const content = fs.readFileSync(TEMPLATES_PATH, "utf-8");
      this.templates = JSON.parse(content);
    } catch (error) {
      console.error("Error loading templates:", error);
      this.templates = { greetings: [], sentiment_responses: {}, escalation_triggers: [], transfer_keywords: [], templates: {} };
    }
  }

  matchTemplate(message: string): { response: string; category: string } | null {
    const lower = message.toLowerCase().trim();
    
    for (const template of this.templates.greetings) {
      for (const trigger of template.trigger) {
        if (lower.includes(trigger.toLowerCase())) {
          return { response: template.response, category: template.category };
        }
      }
    }
    return null;
  }

  analyzeSentiment(message: string): SentimentResult {
    const cacheKey = message.substring(0, 50);
    if (this.sentimentCache.has(cacheKey)) {
      return this.sentimentCache.get(cacheKey)!;
    }

    const lower = message.toLowerCase();
    const keywords: string[] = [];
    let negativeScore = 0;
    let positiveScore = 0;
    let angryScore = 0;

    const negativeWords = [
      "mal", "terrible", "horrible", "pésimo", "peor", "enfadado", "furioso",
      "frustrado", "no funciona", "error", "problema", "queja", "reclamo",
      "nunca", "todavía no", "increíble", "no me ayudan", "inaceptable"
    ];

    const positiveWords = [
      "gracias", "perfecto", "excelente", "genial", "wonderful", "great",
      "awesome", "love", "amazing", "fantástico", "maravilloso"
    ];

    const angryWords = [
      "enojado", "furioso", "asco", "no puedo más", "ya basta",
      "esto es inaceptable", "voy a llamar", "denunciar", "abogado"
    ];

    for (const word of negativeWords) {
      if (lower.includes(word)) {
        keywords.push(word);
        negativeScore += 1;
      }
    }

    for (const word of positiveWords) {
      if (lower.includes(word)) {
        keywords.push(word);
        positiveScore += 1;
      }
    }

    for (const word of angryWords) {
      if (lower.includes(word)) {
        keywords.push(word);
        angryScore += 2;
      }
    }

    let sentiment: SentimentResult["sentiment"] = "neutral";
    let score = 0;

    if (angryScore > 0) {
      sentiment = "angry";
      score = -0.8;
    } else if (negativeScore > positiveScore) {
      sentiment = "negative";
      score = -0.5;
    } else if (positiveScore > negativeScore) {
      sentiment = "positive";
      score = 0.5;
    }

    const result = { sentiment, score, keywords };
    this.sentimentCache.set(cacheKey, result);
    return result;
  }

  shouldEscalate(message: string): boolean {
    const lower = message.toLowerCase();
    return this.templates.escalation_triggers.some((trigger: string) => 
      lower.includes(trigger.toLowerCase())
    );
  }

  shouldTransferToHuman(message: string): boolean {
    const lower = message.toLowerCase();
    return this.templates.transfer_keywords.some((keyword: string) => 
      lower.includes(keyword.toLowerCase())
    );
  }

  getSentimentResponse(sentiment: string): string | null {
    const responses = this.templates.sentiment_responses[sentiment];
    if (!responses || responses.length === 0) return null;
    return responses[Math.floor(Math.random() * responses.length)];
  }

  fillTemplate(templateName: string, params: Record<string, string>): string {
    let template = this.templates.templates[templateName] || templateName;
    for (const [key, value] of Object.entries(params)) {
      template = template.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    return template;
  }

  createLead(phone: string, source: string = "whatsapp"): Lead {
    const lead: Lead = {
      id: `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      phone,
      segment: "lead_frio",
      status: "new",
      source,
      notes: [],
      conversationStart: new Date(),
      lastInteraction: new Date(),
      messagesCount: 0,
      totalSpent: 0
    };
    this.leads.set(phone, lead);
    return lead;
  }

  getLead(phone: string): Lead | undefined {
    return this.leads.get(phone);
  }

  updateLead(phone: string, data: Partial<Lead>): Lead | undefined {
    const lead = this.leads.get(phone);
    if (!lead) return undefined;
    
    Object.assign(lead, data);
    lead.lastInteraction = new Date();
    this.leads.set(phone, lead);
    return lead;
  }

  updateLeadField(phone: string, field: keyof Lead, value: any): void {
    const lead = this.leads.get(phone);
    if (lead) {
      (lead as any)[field] = value;
      lead.lastInteraction = new Date();
    }
  }

  getAllLeads(): Lead[] {
    return Array.from(this.leads.values());
  }

  getLeadsByStatus(status: Lead["status"]): Lead[] {
    return Array.from(this.leads.values()).filter(l => l.status === status);
  }

  generateLeadReport(): {
    total: number;
    byStatus: Record<string, number>;
    bySegment: Record<string, number>;
    avgMessages: number;
  } {
    const leads = this.getAllLeads();
    const byStatus: Record<string, number> = {};
    const bySegment: Record<string, number> = {};

    for (const lead of leads) {
      byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
      bySegment[lead.segment] = (bySegment[lead.segment] || 0) + 1;
    }

    return {
      total: leads.length,
      byStatus,
      bySegment,
      avgMessages: leads.length > 0 
        ? leads.reduce((sum, l) => sum + l.messagesCount, 0) / leads.length 
        : 0
    };
  }
}

export const whatsappManager = new WhatsAppManager();
