import type { ParamDefinition, ParamDefinitions } from './param-definition.interface';
export interface ModelSelection { configId?: string; configRevision?: number; featureType?: string; provider?: string }

export interface RuleCondition { field: string; operator: 'eq' | 'in' | 'present' | 'absent'; value?: any }
export interface ParamRule {
  when: RuleCondition[];
  require?: string[];
  forbid?: string[];
  values?: Record<string, any[]>;
  minTotalItems?: { fields: string[]; min: number };
  maxTotalItems?: { fields: string[]; max: number };
  message?: string;
}
export interface ModelUI { order?: string[]; advanced?: string[]; groups?: Record<string, string[]> }
export interface ModelDocs { sections?: Array<{ title: string; content: string }>; limitations?: string[] }
export interface ModelExample { name: string; input: Record<string, any>; output?: any }
export interface ModelPricing {
  /** Count Unicode code points of usage_param, rather than accepting client-provided units. */
  usage_measure?: 'characters';
  usage_type?: 'count' | 'duration' | 'token'; usage_param?: string; tier_param?: string;
  /** First matching rule selects an explicit unit_price_map key. */
  tier_rules?: Array<{ when: RuleCondition[]; tier: string }>;
  auto_value?: number; auto_prelock_units?: number;
}
export interface PublicModelPricing extends ModelPricing {
  currency: string;
  tiers: Record<string, number>;
}
export interface ModelContract {
  params?: ParamDefinitions; params_rules?: ParamRule[]; ui_schema?: ModelUI;
  output_schema?: ParamDefinition; docs?: ModelDocs; examples?: ModelExample[]; pricing?: ModelPricing;
}
