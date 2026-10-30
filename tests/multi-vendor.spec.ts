import { describe, expect, it } from "vitest";
import { createNonEmptyText } from "../src/core/contracts.js";
import {
  CONTROL_GLASS_MCP_TOOLS,
  handleMcpRequest
} from "../src/harness/mcp-server.js";
import {
  buildVendorRequestPayload,
  createVendorModelConfig,
  detectAvailableVendors
} from "../src/vendors/llm-gateway.js";

describe("Universal Multi-Vendor AI Gateway & MCP Protocol", () => {
  it("formats Anthropic Claude, OpenAI GPT, and Google Gemini payloads via Branded Contracts", () => {
    const sys = createNonEmptyText("Enforce Dune AST and Branded Contracts.");
    const usr = createNonEmptyText("Audit this diff.");
    expect(sys.ok && usr.ok).toBe(true);
    if (!sys.ok || !usr.ok) return;

    const claudeCfg = createVendorModelConfig("anthropic");
    expect(claudeCfg.ok).toBe(true);
    if (!claudeCfg.ok) return;

    const claudeReq = buildVendorRequestPayload(
      claudeCfg.value,
      sys.value,
      usr.value,
      "test-claude-key"
    );
    expect(claudeReq.ok).toBe(true);
    if (claudeReq.ok) {
      expect(claudeReq.value.headers["x-api-key"]).toBe("test-claude-key");
      expect(claudeReq.value.body["model"]).toBe("claude-3-7-sonnet-latest");
    }

    const openaiCfg = createVendorModelConfig("openai");
    expect(openaiCfg.ok).toBe(true);
    if (!openaiCfg.ok) return;

    const openaiReq = buildVendorRequestPayload(
      openaiCfg.value,
      sys.value,
      usr.value,
      "test-openai-key"
    );
    expect(openaiReq.ok).toBe(true);
    if (openaiReq.ok) {
      expect(openaiReq.value.headers["authorization"]).toBe(
        "Bearer test-openai-key"
      );
    }

    const geminiCfg = createVendorModelConfig("gemini");
    expect(geminiCfg.ok).toBe(true);
    if (!geminiCfg.ok) return;

    const geminiReq = buildVendorRequestPayload(
      geminiCfg.value,
      sys.value,
      usr.value,
      "test-gemini-key"
    );
    expect(geminiReq.ok).toBe(true);
    if (geminiReq.ok) {
      expect(geminiReq.value.url).toContain("gemini-2.5-pro:generateContent");
    }
  });

  it("detects configured vendors from environment variables", () => {
    const detected = detectAvailableVendors({
      ANTHROPIC_API_KEY: "set",
      OPENAI_API_KEY: "set"
    });
    expect(detected).toEqual(["anthropic", "openai"]);
  });

  it("responds to MCP tools/list and tools/call JSON-RPC requests accurately", () => {
    const listRes = handleMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    });
    expect(listRes?.result).toEqual({ tools: CONTROL_GLASS_MCP_TOOLS });

    const callRes = handleMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "control_glass_diff_tier",
        arguments: {}
      }
    });
    expect(callRes?.error).toBeUndefined();
    expect(callRes?.result).toBeDefined();

    const langRes = handleMcpRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "control_glass_detect_languages",
        arguments: {}
      }
    });
    expect(langRes?.error).toBeUndefined();
    expect(langRes?.result).toBeDefined();
  });
});
