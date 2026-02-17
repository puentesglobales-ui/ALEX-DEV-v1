import fetch from "node-fetch";

export interface BitrixConfig {
  webhookUrl: string;
  domain: string;
}

export interface BitrixLead {
  TITLE?: string;
  NAME?: string;
  LAST_NAME?: string;
  PHONE?: Array<{ VALUE: string; VALUE_TYPE: string }>;
  EMAIL?: Array<{ VALUE: string; VALUE_TYPE: string }>;
  SOURCE_ID?: string;
  SOURCE_DESCRIPTION?: string;
  COMMENTS?: string;
  UF_CRM_INTEREST?: string;
  UF_BUDGET?: string;
  CONTACT_ID?: string;
}

export interface BitrixContact {
  NAME?: string;
  LAST_NAME?: string;
  PHONE?: Array<{ VALUE: string; VALUE_TYPE: string }>;
  EMAIL?: Array<{ VALUE: string; VALUE_TYPE: string }>;
}

export interface BitrixResult {
  result: any;
  time: {
    start: number;
    finish: number;
    duration: number;
    processing: number;
  };
}

export class Bitrix24Client {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl.replace(/\/$/, "");
  }

  async call(method: string, params: any = {}): Promise<BitrixResult> {
    const url = `${this.webhookUrl}/rest/1/${method}.json`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      throw new Error(`Bitrix24 API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as BitrixResult;
    
    if (data.result && data.result.error) {
      throw new Error(`Bitrix24 Error: ${data.result.error}`);
    }

    return data;
  }

  async createLead(lead: BitrixLead): Promise<number> {
    const result = await this.call("crm.lead.add", {
      fields: lead
    });
    return result.result;
  }

  async createContact(contact: BitrixContact): Promise<number> {
    const result = await this.call("crm.contact.add", {
      fields: contact
    });
    return result.result;
  }

  async createLeadWithContact(lead: BitrixLead, contact: BitrixContact): Promise<{ leadId: number; contactId: number }> {
    const contactId = await this.createContact(contact);
    
    const leadWithContact: BitrixLead = {
      ...lead,
      CONTACT_ID: contactId.toString()
    };
    
    const leadId = await this.createLead(leadWithContact);
    
    return { leadId, contactId };
  }

  async updateLead(id: number, fields: Partial<BitrixLead>): Promise<boolean> {
    const result = await this.call("crm.lead.update", {
      id,
      fields
    });
    return result.result;
  }

  async getLead(id: number): Promise<any> {
    const result = await this.call("crm.lead.get", { id });
    return result.result;
  }

  async listLeads(filter: any = {}, params: any = {}): Promise<any[]> {
    const result = await this.call("crm.lead.list", {
      filter,
      params
    });
    return result.result;
  }

  async searchContacts(phone: string): Promise<any[]> {
    const result = await this.call("crm.contact.list", {
      filter: {
        "%PHONE": phone
      }
    });
    return result.result;
  }
}
