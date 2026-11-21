import type { ToolRisk } from '../../shared/types.js';

export interface ToolJsonSchema {
  type: 'object';
  properties: Record<
    string,
    {
      type: string;
      description: string;
      enum?: string[];
      items?: {
        type: string;
        properties?: Record<string, { type: string; description: string; enum?: string[] }>;
        required?: string[];
      };
    }
  >;
  required?: string[];
}

export interface ToolExecutionContext {
  defaultWorkspace: string;
  signal?: AbortSignal;
}

export interface ToolExecutionResult {
  text: string;
  imageDataUrl?: string;
  imageBase64?: string;
  imageMimeType?: string;
  filePath?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ToolJsonSchema;
  assessRisk: (args: Record<string, unknown>) => { risk: ToolRisk; reason: string };
  execute: (
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ) => Promise<ToolExecutionResult>;
}
