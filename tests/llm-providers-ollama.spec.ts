import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../src/agent/types";
import {
  checkModelsAvailability,
  fetchModelsFromProvider,
  validateProvider,
} from "../src/agent/libs/llm-providers";

describe("llm-providers ollama", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches Ollama models from /api/tags and maps them", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            name: "llama3:8b",
            details: { family: "llama", context_length: 8192 },
          },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock as any);

    const provider: LLMProvider = {
      id: "ollama-local",
      type: "ollama",
      name: "Ollama Local",
      apiKey: "",
      baseUrl: "http://localhost:11434/v1",
      enabled: true,
    };

    const models = await fetchModelsFromProvider(provider);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/tags");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
    expect(models).toEqual([
      {
        id: "ollama-local::llama3:8b",
        name: "llama3:8b",
        providerId: "ollama-local",
        providerType: "ollama",
        description: "llama",
        enabled: true,
        contextLength: 8192,
      },
    ]);
  });

  it("uses model.model fallback when model.name is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { model: "gemma3", details: { family: "gemma" } },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const provider: LLMProvider = {
      id: "ollama-local",
      type: "ollama",
      name: "Ollama Local",
      apiKey: "",
      baseUrl: "http://localhost:11434/v1",
      enabled: true,
    };

    const models = await fetchModelsFromProvider(provider);

    expect(models).toEqual([
      expect.objectContaining({
        id: "ollama-local::gemma3",
        name: "gemma3",
        description: "gemma",
      }),
    ]);
  });

  it("checks Ollama model availability without Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock as any);

    const provider: LLMProvider = {
      id: "ollama-remote",
      type: "ollama",
      name: "Ollama Remote",
      apiKey: "",
      baseUrl: "http://10.0.0.10:11434/v1",
      enabled: true,
    };

    await checkModelsAvailability(provider, [
      {
        id: "ollama-remote::llama3:8b",
        name: "llama3:8b",
        providerId: "ollama-remote",
        providerType: "ollama",
        enabled: true,
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://10.0.0.10:11434/v1/chat/completions");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    const body = JSON.parse(options.body);
    expect(body.model).toBe("llama3:8b");
  });

  it("validates Ollama provider without apiKey but with baseUrl", () => {
    expect(
      validateProvider({ type: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1" }),
    ).toEqual({ valid: true });

    expect(validateProvider({ type: "ollama", name: "Ollama" })).toEqual({
      valid: false,
      error: "Base URL is required for this provider type",
    });
  });
});
