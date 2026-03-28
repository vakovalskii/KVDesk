import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "./test-utils";
import { SettingsModal } from "../src/ui/components/SettingsModal";
import type { ApiSettings } from "../src/ui/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

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
    const state = { llmProviders: [], llmModels: [] };
    return selector(state);
  }),
}));

// ─── Вспомогательные функции ──────────────────────────────────────────────────

/** Открывает SettingsModal и переходит на вкладку Tools */
async function openToolsTab(currentSettings: ApiSettings | null = null) {
  const onSave = vi.fn();
  renderWithI18n(
    <SettingsModal
      onClose={vi.fn()}
      onSave={onSave}
      currentSettings={currentSettings}
    />
  );

  await waitFor(() => {
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole("button", { name: "Tools" }));

  await waitFor(() => {
    expect(screen.getByText("Tool Groups")).toBeInTheDocument();
  });

  return { onSave };
}

// ─── Тесты ────────────────────────────────────────────────────────────────────

describe("SettingsModal — File Viewer setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("отображение секции File Viewer", () => {
    it("секция File Viewer присутствует на вкладке Tools", async () => {
      await openToolsTab();

      await waitFor(() => {
        expect(screen.getByText("File Viewer")).toBeInTheDocument();
        expect(screen.getByText("How files are opened from the file browser")).toBeInTheDocument();
      });
    });

    it("переключатель 'Built-in Preview' присутствует", async () => {
      await openToolsTab();

      await waitFor(() => {
        expect(screen.getByText("Built-in Preview")).toBeInTheDocument();
      });
    });

    it("по умолчанию встроенный просмотрщик включён (useBuiltinViewer не задан)", async () => {
      await openToolsTab(null);

      await waitFor(() => {
        expect(screen.getByText("Built-in Preview")).toBeInTheDocument();
      });

      // Описание должно говорить о встроенном превью (режим ON)
      expect(
        screen.getByText("Single click shows built-in preview panel with thumbnails and text")
      ).toBeInTheDocument();
    });

    it("когда useBuiltinViewer=true — показывает описание режима ON", async () => {
      await openToolsTab({ apiKey: "", baseUrl: "", model: "", useBuiltinViewer: true });

      await waitFor(() => {
        expect(
          screen.getByText("Single click shows built-in preview panel with thumbnails and text")
        ).toBeInTheDocument();
      });
    });

    it("когда useBuiltinViewer=false — показывает описание режима OFF", async () => {
      await openToolsTab({ apiKey: "", baseUrl: "", model: "", useBuiltinViewer: false });

      await waitFor(() => {
        expect(
          screen.getByText("Single click opens files in the system default application")
        ).toBeInTheDocument();
      });
    });
  });

  describe("переключение", () => {
    it("клик по переключателю меняет описание с ON на OFF", async () => {
      await openToolsTab({ apiKey: "", baseUrl: "", model: "", useBuiltinViewer: true });

      await waitFor(() => {
        expect(
          screen.getByText("Single click shows built-in preview panel with thumbnails and text")
        ).toBeInTheDocument();
      });

      // Находим чекбокс для Built-in Preview
      // В ToolsTab все чекбоксы — sr-only, берём по порядку
      // File Viewer — последняя секция, её чекбокс идёт после useGitForDiff
      const checkboxes = screen.getAllByRole("checkbox");
      const viewerCheckbox = checkboxes[checkboxes.length - 1]; // последний в списке

      fireEvent.click(viewerCheckbox);

      await waitFor(() => {
        expect(
          screen.getByText("Single click opens files in the system default application")
        ).toBeInTheDocument();
      });
    });

    it("клик по переключателю меняет описание с OFF на ON", async () => {
      await openToolsTab({ apiKey: "", baseUrl: "", model: "", useBuiltinViewer: false });

      await waitFor(() => {
        expect(
          screen.getByText("Single click opens files in the system default application")
        ).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole("checkbox");
      const viewerCheckbox = checkboxes[checkboxes.length - 1];

      fireEvent.click(viewerCheckbox);

      await waitFor(() => {
        expect(
          screen.getByText("Single click shows built-in preview panel with thumbnails and text")
        ).toBeInTheDocument();
      });
    });
  });

  describe("сохранение настройки", () => {
    it("сохраняет useBuiltinViewer=true если включён", async () => {
      const { onSave } = await openToolsTab({
        apiKey: "",
        baseUrl: "",
        model: "",
        useBuiltinViewer: true,
      });

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const saved = onSave.mock.calls[0][0] as ApiSettings;
      expect(saved.useBuiltinViewer).toBe(true);
    });

    it("сохраняет useBuiltinViewer=false если выключен", async () => {
      const { onSave } = await openToolsTab({
        apiKey: "",
        baseUrl: "",
        model: "",
        useBuiltinViewer: false,
      });

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const saved = onSave.mock.calls[0][0] as ApiSettings;
      expect(saved.useBuiltinViewer).toBe(false);
    });

    it("сохраняет useBuiltinViewer=true после включения переключателя", async () => {
      const { onSave } = await openToolsTab({
        apiKey: "",
        baseUrl: "",
        model: "",
        useBuiltinViewer: false, // начинаем с OFF
      });

      await waitFor(() => {
        expect(
          screen.getByText("Single click opens files in the system default application")
        ).toBeInTheDocument();
      });

      // Включаем
      const checkboxes = screen.getAllByRole("checkbox");
      fireEvent.click(checkboxes[checkboxes.length - 1]);

      await waitFor(() => {
        expect(
          screen.getByText("Single click shows built-in preview panel with thumbnails and text")
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const saved = onSave.mock.calls[0][0] as ApiSettings;
      expect(saved.useBuiltinViewer).toBe(true);
    });

    it("сохраняет useBuiltinViewer=false после отключения переключателя", async () => {
      const { onSave } = await openToolsTab({
        apiKey: "",
        baseUrl: "",
        model: "",
        useBuiltinViewer: true, // начинаем с ON
      });

      await waitFor(() => {
        expect(
          screen.getByText("Single click shows built-in preview panel with thumbnails and text")
        ).toBeInTheDocument();
      });

      // Выключаем
      const checkboxes = screen.getAllByRole("checkbox");
      fireEvent.click(checkboxes[checkboxes.length - 1]);

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const saved = onSave.mock.calls[0][0] as ApiSettings;
      expect(saved.useBuiltinViewer).toBe(false);
    });

    it("когда useBuiltinViewer не задан — сохраняет true (дефолт)", async () => {
      const { onSave } = await openToolsTab(null);

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const saved = onSave.mock.calls[0][0] as ApiSettings;
      expect(saved.useBuiltinViewer).toBe(true);
    });
  });

  describe("i18n — русский язык", () => {
    it("показывает переведённые тексты на русском", async () => {
      const onSave = vi.fn();
      renderWithI18n(
        <SettingsModal
          onClose={vi.fn()}
          onSave={onSave}
          currentSettings={null}
        />,
        { initialLocale: "ru" }
      );

      await waitFor(() => {
        expect(screen.getByText("Настройки")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));

      await waitFor(() => {
        expect(screen.getByText("Просмотр файлов")).toBeInTheDocument();
        expect(screen.getByText("Встроенный просмотрщик")).toBeInTheDocument();
        expect(
          screen.getByText("Одиночный клик показывает встроенное превью с миниатюрами и текстом")
        ).toBeInTheDocument();
      });
    });
  });
});
