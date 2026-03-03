import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsModal } from "../src/ui/components/SettingsModal";
import { renderWithI18n } from "./test-utils";

const mockSendClientEvent = vi.fn();
const mockInvoke = vi.fn();

vi.mock("../src/ui/platform", () => ({
  getPlatform: vi.fn(() => ({
    sendClientEvent: mockSendClientEvent,
    invoke: mockInvoke,
    onServerEvent: vi.fn(() => () => {}),
  })),
}));

vi.mock("../src/ui/store/useAppStore", () => ({
  useAppStore: vi.fn((selector: (s: unknown) => unknown) => {
    const state = {
      llmProviders: [],
      llmModels: [],
    };
    return selector(state);
  }),
}));

describe("SettingsModal Ollama provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows remote toggle and URL input only when remote mode is enabled", async () => {
    renderWithI18n(
      <SettingsModal
        onClose={vi.fn()}
        onSave={vi.fn()}
        currentSettings={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "+ Add Provider" }));

    const providerTypeSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(providerTypeSelect, { target: { value: "ollama" } });

    expect(screen.getByText("Use remote Ollama endpoint")).toBeInTheDocument();
    expect(
      screen.getByText("Local mode: using http://localhost:11434/v1. Enable remote endpoint to connect to Ollama over network."),
    ).toBeInTheDocument();

    expect(screen.queryByPlaceholderText("http://192.168.1.20:11434/v1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));

    expect(screen.getByPlaceholderText("http://192.168.1.20:11434/v1")).toBeInTheDocument();
  });
});
