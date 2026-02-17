import { PrismaClient } from "@prisma/client";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  constitutionId: string;
  whatsapp?: {
    phoneNumberId?: string;
    accessToken?: string;
  };
  bitrix?: {
    webhookUrl?: string;
  };
  limits: {
    dailyTokens: number;
    maxTokensPerResponse: number;
    maxInteractions: number;
  };
  settings: Record<string, any>;
  active: boolean;
  createdAt: Date;
}

const prisma = new PrismaClient();

class TenantManager {
  private tenants: Map<string, Tenant> = new Map();
  private defaultTenant: Tenant = {
    id: "default",
    name: "Default Tenant",
    slug: "default",
    constitutionId: "conversational-programming",
    limits: {
      dailyTokens: 1000,
      maxTokensPerResponse: 150,
      maxInteractions: 100
    },
    settings: {},
    active: true,
    createdAt: new Date()
  };

  constructor() {
    this.tenants.set("default", this.defaultTenant);
  }

  async loadFromDatabase(): Promise<void> {
    try {
      const dbTenants = await prisma.conversationState.findMany({
        distinct: ["userId"],
        select: { userId: true }
      });
      
      console.log(`📊 Loaded ${dbTenants.length} tenant references from database`);
    } catch (error) {
      console.log("Using in-memory tenant storage");
    }
  }

  createTenant(data: Omit<Tenant, "id" | "createdAt">): Tenant {
    const id = `tenant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const tenant: Tenant = {
      ...data,
      id,
      createdAt: new Date()
    };
    
    this.tenants.set(id, tenant);
    this.tenants.set(data.slug, tenant);
    
    return tenant;
  }

  getTenant(idOrSlug: string): Tenant | undefined {
    return this.tenants.get(idOrSlug) || this.defaultTenant;
  }

  getTenantBySlug(slug: string): Tenant | undefined {
    return this.tenants.get(slug);
  }

  updateTenant(id: string, data: Partial<Tenant>): Tenant | undefined {
    const tenant = this.tenants.get(id);
    if (!tenant) return undefined;
    
    const updated = { ...tenant, ...data };
    this.tenants.set(id, updated);
    if (tenant.slug !== updated.slug) {
      this.tenants.set(updated.slug, updated);
    }
    
    return updated;
  }

  deleteTenant(id: string): boolean {
    const tenant = this.tenants.get(id);
    if (!tenant || tenant.id === "default") return false;
    
    this.tenants.delete(id);
    this.tenants.delete(tenant.slug);
    
    return true;
  }

  getAllTenants(): Tenant[] {
    return Array.from(this.tenants.values()).filter(t => t.id !== "default" || t.slug !== "default");
  }

  getActiveTenants(): Tenant[] {
    return Array.from(this.tenants.values()).filter(t => t.active);
  }

  setDefaultConstitution(tenantId: string, constitutionId: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    
    tenant.constitutionId = constitutionId;
    this.tenants.set(tenantId, tenant);
    
    return true;
  }

  configureWhatsApp(tenantId: string, config: { phoneNumberId: string; accessToken: string }): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    
    tenant.whatsapp = config;
    this.tenants.set(tenantId, tenant);
    
    return true;
  }

  configureBitrix(tenantId: string, webhookUrl: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    
    tenant.bitrix = { webhookUrl };
    this.tenants.set(tenantId, tenant);
    
    return true;
  }

  setLimits(tenantId: string, limits: { dailyTokens?: number; maxTokensPerResponse?: number; maxInteractions?: number }): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    
    tenant.limits = { ...tenant.limits, ...limits };
    this.tenants.set(tenantId, tenant);
    
    return true;
  }

  getTenantStats(tenantId: string): {
    id: string;
    name: string;
    constitution: string;
    whatsapp: boolean;
    bitrix: boolean;
    limits: Tenant["limits"];
  } | undefined {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return undefined;
    
    return {
      id: tenant.id,
      name: tenant.name,
      constitution: tenant.constitutionId,
      whatsapp: !!tenant.whatsapp?.phoneNumberId,
      bitrix: !!tenant.bitrix?.webhookUrl,
      limits: tenant.limits
    };
  }
}

export const tenantManager = new TenantManager();
