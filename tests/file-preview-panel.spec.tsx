import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithI18n } from "./test-utils";
import { FilePreviewPanel } from "../src/ui/components/FilePreviewPanel";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSend = vi.fn();
const mockInvoke = vi.fn();

vi.mock("../src/ui/platform", () => ({
  getPlatform: vi.fn(() => ({
    invoke: mockInvoke,
    send: mockSend,
    sendClientEvent: vi.fn(),
    onServerEvent: vi.fn(() => () => {}),
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Вспомогательные фабрики ──────────────────────────────────────────────────

function makeFile(name: string, size = 1024) {
  return { name, path: `/project/${name}`, isDirectory: false, size };
}

// ─── Тесты ────────────────────────────────────────────────────────────────────

describe("FilePreviewPanel", () => {
  describe("общий UI", () => {
    it("показывает имя файла в заголовке", async () => {
      mockInvoke.mockResolvedValue(null);

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        // Имя файла должно быть в заголовке панели
        const headings = screen.getAllByText("photo.jpg");
        expect(headings.length).toBeGreaterThanOrEqual(1);
      });
    });

    it("показывает расширение и размер файла в мета-строке", async () => {
      mockInvoke.mockResolvedValue(null);

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg", 204800)} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("JPG")).toBeInTheDocument();
        expect(screen.getByText("200.0 KB")).toBeInTheDocument();
      });
    });

    it("кнопка onClose вызывает коллбэк", async () => {
      mockInvoke.mockResolvedValue(null);
      const onClose = vi.fn();

      renderWithI18n(
        <FilePreviewPanel file={makeFile("doc.txt")} onClose={onClose} />
      );

      await waitFor(() => {
        expect(screen.queryByText("Loading preview...")).not.toBeInTheDocument();
      });

      const closeBtn = screen.getByLabelText("Close preview");
      fireEvent.click(closeBtn);

      expect(onClose).toHaveBeenCalled();
    });

    it("кнопка «Open» вызывает open-file", async () => {
      mockInvoke.mockResolvedValue(null);

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("Open")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Open"));

      expect(mockSend).toHaveBeenCalledWith("open-file", "/project/photo.jpg");
    });
  });

  describe("изображения", () => {
    it("вызывает get-thumbnail с size=1920 для изображений", async () => {
      mockInvoke.mockResolvedValue("data:image/webp;base64,ABC");

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "get-thumbnail",
          "/project/photo.jpg",
          1920
        );
      });
    });

    it("отображает изображение когда thumbnail загружен", async () => {
      const dataUrl = "data:image/webp;base64,ABC123";
      mockInvoke.mockResolvedValue(dataUrl);

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        const img = screen.getByRole("img");
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute("src", dataUrl);
      });
    });

    it("показывает 'No preview available' если thumbnail вернул null", async () => {
      mockInvoke.mockResolvedValue(null);

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("No preview available")).toBeInTheDocument();
      });
    });

    it("показывает ошибку если get-thumbnail упал", async () => {
      mockInvoke.mockRejectedValue(new Error("sharp failed"));

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.png")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("sharp failed")).toBeInTheDocument();
      });
    });

    it("показывает состояние загрузки пока идёт запрос", async () => {
      // Promise который никогда не резолвится
      mockInvoke.mockReturnValue(new Promise(() => {}));

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg")} onClose={vi.fn()} />
      );

      expect(screen.getByText("Loading preview...")).toBeInTheDocument();
    });

    it("поддерживает все форматы изображений", async () => {
      const imageFormats = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "tif", "tiff", "heic", "heif"];

      for (const ext of imageFormats) {
        mockInvoke.mockResolvedValue("data:image/webp;base64,TEST");

        const { unmount } = renderWithI18n(
          <FilePreviewPanel file={makeFile(`image.${ext}`)} onClose={vi.fn()} />
        );

        await waitFor(() => {
          expect(mockInvoke).toHaveBeenCalledWith("get-thumbnail", `/project/image.${ext}`, 1920);
        });

        mockInvoke.mockClear();
        unmount();
      }
    });
  });

  describe("текстовые файлы", () => {
    it("вызывает get-file-text-preview для текстовых файлов", async () => {
      mockInvoke.mockResolvedValue("const x = 1;");

      renderWithI18n(
        <FilePreviewPanel file={makeFile("index.ts")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "get-file-text-preview",
          "/project/index.ts",
          6000
        );
      });
    });

    it("отображает текстовое содержимое в <pre>", async () => {
      const content = "function hello() {\n  return 42;\n}";
      mockInvoke.mockResolvedValue(content);

      renderWithI18n(
        <FilePreviewPanel file={makeFile("main.ts")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        const pre = document.querySelector("pre");
        expect(pre).toBeInTheDocument();
        expect(pre?.textContent).toContain("function hello");
        expect(pre?.textContent).toContain("return 42");
      });
    });

    it("показывает пустой <pre> для пустого файла", async () => {
      mockInvoke.mockResolvedValue("");

      renderWithI18n(
        <FilePreviewPanel file={makeFile("empty.txt")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        const pre = document.querySelector("pre");
        expect(pre).toBeInTheDocument();
        expect(pre?.textContent).toBe("");
      });
    });

    it("показывает ошибку если get-file-text-preview упал", async () => {
      mockInvoke.mockRejectedValue(new Error("Permission denied"));

      renderWithI18n(
        <FilePreviewPanel file={makeFile("secret.txt")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("Permission denied")).toBeInTheDocument();
      });
    });

    it("поддерживает все текстовые форматы", async () => {
      const textFormats = [
        "txt", "md", "json", "yaml", "yml", "toml", "ts", "tsx",
        "js", "jsx", "py", "rs", "go", "sh", "html", "css", "sql",
      ];

      for (const ext of textFormats) {
        mockInvoke.mockResolvedValue(`content of ${ext}`);

        const { unmount } = renderWithI18n(
          <FilePreviewPanel file={makeFile(`file.${ext}`)} onClose={vi.fn()} />
        );

        await waitFor(() => {
          expect(mockInvoke).toHaveBeenCalledWith(
            "get-file-text-preview",
            `/project/file.${ext}`,
            6000
          );
        });

        mockInvoke.mockClear();
        unmount();
      }
    });
  });

  describe("другие типы файлов", () => {
    it("не вызывает IPC для неподдерживаемых файлов", async () => {
      renderWithI18n(
        <FilePreviewPanel file={makeFile("archive.zip")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        // loading быстро заканчивается без IPC
        expect(screen.getByText("No preview available")).toBeInTheDocument();
      });

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("показывает 'No preview available' для бинарных файлов", async () => {
      renderWithI18n(
        <FilePreviewPanel file={makeFile("app.exe")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("No preview available")).toBeInTheDocument();
      });
    });
  });

  describe("отображение изображения (размеры)", () => {
    it("изображение имеет max-w-full / max-h-full / object-contain (не растягивается)", async () => {
      mockInvoke.mockResolvedValue("data:image/webp;base64,ABC");

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        const img = screen.getByRole("img");
        expect(img.className).toContain("max-w-full");
        expect(img.className).toContain("max-h-full");
        expect(img.className).toContain("object-contain");
      });
    });

    it("изображение не растягивается по ширине (нет class w-full на img)", async () => {
      mockInvoke.mockResolvedValue("data:image/webp;base64,ABC");

      renderWithI18n(
        <FilePreviewPanel file={makeFile("small.png")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        const img = screen.getByRole("img");
        // w-full заставляет img растягиваться — его НЕ должно быть
        const classes = img.className.split(/\s+/);
        expect(classes).not.toContain("w-full");
      });
    });
  });

  describe("зум (лупа)", () => {
    it("кнопка зума отображается под изображением", async () => {
      mockInvoke.mockResolvedValue("data:image/webp;base64,ABC");

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("Zoom")).toBeInTheDocument();
      });
    });

    it("клик по кнопке зума переключает состояние (включить/выключить)", async () => {
      mockInvoke.mockResolvedValue("data:image/webp;base64,ABC");

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("Zoom")).toBeInTheDocument();
      });

      const zoomBtn = screen.getByText("Zoom");

      // Изначально зум выключен — индикатор уровня не виден
      expect(screen.queryByText("3.0x")).not.toBeInTheDocument();

      // Включаем зум
      fireEvent.click(zoomBtn);

      // Индикатор уровня зума должен появиться
      expect(screen.getByText("3.0x")).toBeInTheDocument();

      // Выключаем зум
      fireEvent.click(zoomBtn);

      // Индикатор уровня зума должен исчезнуть
      expect(screen.queryByText("3.0x")).not.toBeInTheDocument();
    });

    it("индикатор уровня зума показывает начальное значение 3.0x", async () => {
      mockInvoke.mockResolvedValue("data:image/webp;base64,ABC");

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("Zoom")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Zoom"));

      expect(screen.getByText("3.0x")).toBeInTheDocument();
    });

    it("кнопка зума не отображается для текстовых файлов", async () => {
      mockInvoke.mockResolvedValue("some text content");

      renderWithI18n(
        <FilePreviewPanel file={makeFile("readme.md")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        const pre = document.querySelector("pre");
        expect(pre).toBeInTheDocument();
      });

      expect(screen.queryByText("Zoom")).not.toBeInTheDocument();
    });

    it("кнопка зума не отображается для неподдерживаемых файлов", async () => {
      renderWithI18n(
        <FilePreviewPanel file={makeFile("archive.zip")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("No preview available")).toBeInTheDocument();
      });

      expect(screen.queryByText("Zoom")).not.toBeInTheDocument();
    });

    it("курсор crosshair при включённом зуме", async () => {
      mockInvoke.mockResolvedValue("data:image/webp;base64,ABC");

      renderWithI18n(
        <FilePreviewPanel file={makeFile("photo.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("Zoom")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Zoom"));

      const img = screen.getByRole("img");
      const imageArea = img.closest("[style]")?.parentElement?.closest("[style]");
      expect(imageArea).toBeTruthy();
      expect(imageArea!.style.cursor).toBe("crosshair");
    });
  });

  describe("смена файла", () => {
    it("перезагружает превью при смене файла", async () => {
      mockInvoke
        .mockResolvedValueOnce("data:image/webp;base64,FIRST")
        .mockResolvedValueOnce("data:image/webp;base64,SECOND");

      const { rerender } = renderWithI18n(
        <FilePreviewPanel file={makeFile("first.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("get-thumbnail", "/project/first.jpg", 1920);
      });

      rerender(
        <FilePreviewPanel file={makeFile("second.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("get-thumbnail", "/project/second.jpg", 1920);
      });

      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    it("сбрасывает состояние ошибки при смене файла", async () => {
      mockInvoke
        .mockRejectedValueOnce(new Error("sharp failed"))
        .mockResolvedValueOnce("text content");

      const { rerender } = renderWithI18n(
        <FilePreviewPanel file={makeFile("broken.jpg")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("sharp failed")).toBeInTheDocument();
      });

      rerender(
        <FilePreviewPanel file={makeFile("readme.md")} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.queryByText("sharp failed")).not.toBeInTheDocument();
      });
    });
  });
});
