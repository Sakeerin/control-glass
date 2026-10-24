import {
  type NonEmptyText,
  type Result,
  createNonEmptyText,
  err,
  ok
} from "../core/contracts.js";

export type AiVendorId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openai-compatible";

export interface VendorModelConfig {
  readonly vendor: AiVendorId;
  readonly modelId: NonEmptyText;
  readonly endpointUrl: string;
  readonly apiKeyEnvVar: string;
}

export interface VendorRequestPayload {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

const DEFAULT_VENDOR_ENDPOINTS: Record<AiVendorId, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
  "openai-compatible": "http://localhost:11434/v1/chat/completions"
};

const DEFAULT_VENDOR_MODELS: Record<AiVendorId, string> = {
  anthropic: "claude-3-7-sonnet-latest",
  openai: "gpt-4o",
  gemini: "gemini-2.5-pro",
  "openai-compatible": "deepseek-r1"
};

const DEFAULT_VENDOR_ENV_KEYS: Record<AiVendorId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  "openai-compatible": "OPENAI_COMPATIBLE_API_KEY"
};

export function createVendorModelConfig(
  vendor: AiVendorId,
  customModelId?: string,
  customEndpointUrl?: string
): Result<VendorModelConfig, "EMPTY_TEXT_FORBIDDEN"> {
  const modelRes = createNonEmptyText(
    customModelId ?? DEFAULT_VENDOR_MODELS[vendor]
  );
  if (!modelRes.ok) {
    return modelRes;
  }

  return ok({
    vendor,
    modelId: modelRes.value,
    endpointUrl: customEndpointUrl ?? DEFAULT_VENDOR_ENDPOINTS[vendor],
    apiKeyEnvVar: DEFAULT_VENDOR_ENV_KEYS[vendor]
  });
}

export function buildVendorRequestPayload(
  config: VendorModelConfig,
  systemPrompt: NonEmptyText,
  userPrompt: NonEmptyText,
  apiKey: string
): Result<VendorRequestPayload, "MISSING_VENDOR_API_KEY"> {
  if (config.vendor !== "openai-compatible" && apiKey.trim().length === 0) {
    return err("MISSING_VENDOR_API_KEY");
  }

  if (config.vendor === "anthropic") {
    return ok({
      url: config.endpointUrl,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: {
        model: config.modelId,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      }
    });
  }

  if (config.vendor === "gemini") {
    return ok({
      url: `${config.endpointUrl}/${config.modelId}:generateContent?key=${apiKey}`,
      headers: {
        "content-type": "application/json"
      },
      body: {
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }]
          }
        ]
      }
    });
  }

  return ok({
    url: config.endpointUrl,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: {
      model: config.modelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    }
  });
}

export function detectAvailableVendors(
  env: Record<string, string | undefined> = process.env
): readonly AiVendorId[] {
  const available: AiVendorId[] = [];
  if (env["ANTHROPIC_API_KEY"]) available.push("anthropic");
  if (env["OPENAI_API_KEY"]) available.push("openai");
  if (env["GEMINI_API_KEY"]) available.push("gemini");
  if (env["OPENAI_COMPATIBLE_API_KEY"] || env["OLLAMA_HOST"]) {
    available.push("openai-compatible");
  }
  return available;
}
