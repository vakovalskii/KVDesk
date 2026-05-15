import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientEvent } from "../types";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { SpinnerIcon } from "./SpinnerIcon";
import { getPlatform } from "../platform";

const DEFAULT_ALLOWED_TOOLS = "Read,Edit,Bash";
const MAX_ROWS = 12;
const LINE_HEIGHT = 21;
const MAX_HEIGHT = MAX_ROWS * LINE_HEIGHT;

function CompactHistoryIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M12 3.1v2.25" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" />
      <path d="m9.35 5.55 2.65 2.6 2.65-2.6" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="5.35" y="11.15" width="13.3" height="1.95" rx="0.975" fill="currentColor" />
      <path d="M12 20.9v-2.25" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" />
      <path d="m9.35 18.45 2.65-2.6 2.65 2.6" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface PromptInputProps {
  sendEvent: (event: ClientEvent) => void;
  forcedRunningSessionId?: string | null;
}

export function usePromptActions(sendEvent: (event: ClientEvent) => void, forcedRunningSessionId?: string | null) {
  const { t } = useI18n();
  const prompt = useAppStore((state) => state.prompt);
  const cwd = useAppStore((state) => state.cwd);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const sessions = useAppStore((state) => state.sessions);
  const setPrompt = useAppStore((state) => state.setPrompt);
  const setPendingStart = useAppStore((state) => state.setPendingStart);
  const setGlobalError = useAppStore((state) => state.setGlobalError);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const selectedTemperature = useAppStore((state) => state.selectedTemperature);
  const sendTemperature = useAppStore((state) => state.sendTemperature);

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const isRunning = activeSession?.status === "running" || Boolean(forcedRunningSessionId && forcedRunningSessionId === activeSessionId);

  const handleSend = useCallback(async () => {
    const trimmedPrompt = prompt.trim();

    // For existing sessions, require a prompt
    if (activeSessionId && !trimmedPrompt) return;

    if (!activeSessionId) {
      // For LLM provider models (containing ::), pass the full id so the runner
      // can identify the provider. For legacy models, resolve to API name.
      const state = useAppStore.getState();
      const isProviderModel = selectedModel?.includes('::');
      const apiModelName = isProviderModel
        ? selectedModel
        : (state.llmModels?.find(m => m.id === selectedModel)?.name
          ?? state.availableModels?.find(m => m.id === selectedModel)?.name
          ?? selectedModel);

      setPendingStart(true);
      
      // Title starts as "New Chat"; backend will auto-generate via LLM
      const title = "New Chat";
      sendEvent({
        type: "session.start",
        payload: {
          title,
          prompt: trimmedPrompt, // Can be empty string
          cwd: cwd.trim() || undefined,
          allowedTools: DEFAULT_ALLOWED_TOOLS,
          model: apiModelName || selectedModel || undefined,
          temperature: sendTemperature ? selectedTemperature : undefined
        }
      });
      // Save selected model as default for future sessions
      if (selectedModel) {
        sendEvent({
          type: "scheduler.default_model.set",
          payload: { modelId: isProviderModel ? selectedModel : (apiModelName || selectedModel) }
        } as ClientEvent);
      }
      // Save temperature as default for future sessions
      sendEvent({
        type: "scheduler.default_temperature.set",
        payload: {
          temperature: selectedTemperature,
          sendTemperature: sendTemperature
        }
      } as ClientEvent);
    } else {
      if (activeSession?.status === "running") {
        setGlobalError(t("promptInput.sessionStillRunning"));
        return;
      }
      sendEvent({ type: "session.continue", payload: { sessionId: activeSessionId, prompt: trimmedPrompt, cwd: cwd.trim() || undefined } });
    }
    setPrompt("");
  }, [activeSession, activeSessionId, cwd, prompt, sendEvent, setGlobalError, setPendingStart, setPrompt, selectedModel, selectedTemperature, sendTemperature]);

  const handleStop = useCallback(() => {
    const targetSessionId = forcedRunningSessionId && forcedRunningSessionId === activeSessionId
      ? forcedRunningSessionId
      : activeSessionId;
    if (!targetSessionId) return;
    sendEvent({ type: "session.stop", payload: { sessionId: targetSessionId } });
  }, [activeSessionId, forcedRunningSessionId, sendEvent]);

  const handleStartFromModal = useCallback(() => {
    // Allow starting chat without cwd or prompt
    // If no cwd, file operations will be blocked by tools-executor
    handleSend();
  }, [handleSend]);

  return { prompt, setPrompt, isRunning, handleSend, handleStop, handleStartFromModal };
}

export function PromptInput({ sendEvent, forcedRunningSessionId = null }: PromptInputProps) {
  const { t } = useI18n();
  const { prompt, setPrompt, isRunning, handleSend, handleStop } = usePromptActions(sendEvent, forcedRunningSessionId);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const sessions = useAppStore((state) => state.sessions);
  const compactingSessionId = useAppStore((state) => state.compactingSessionId);
  const apiSettings = useAppStore((s) => s.apiSettings);
  const voiceServerStatus = useAppStore((s) => s.voiceServerStatus);
  const voiceTranscriptions = useAppStore((s) => s.voiceTranscriptions);
  const clearVoiceTranscription = useAppStore((s) => s.clearVoiceTranscription);

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const hasHistory = (activeSession?.messages?.length ?? 0) > 1;
  const isCompacting = compactingSessionId === activeSessionId;

  const handleCompact = useCallback(() => {
    if (!activeSessionId || isRunning || isCompacting) return;
    sendEvent({ type: "session.compact", payload: { sessionId: activeSessionId } });
  }, [activeSessionId, isRunning, isCompacting, sendEvent]);

  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const basePromptRef = useRef<string>("");
  const audioMimeRef = useRef<string>("");
  const voiceSessionIdRef = useRef<string>("");
  const stoppingRef = useRef(false);
  const sendErrorOnceRef = useRef(false);
  const lastStopMsRef = useRef<number | null>(null);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const chunkCountRef = useRef(0);

  const voiceSettings = apiSettings?.voiceSettings;
  const voiceEnabled = Boolean(voiceSettings?.baseUrl?.trim()) && voiceServerStatus.available;

  const voiceSessionId = useMemo(() => activeSessionId ?? "no-session", [activeSessionId]);

  const voiceText = voiceTranscriptions[voiceSessionId];

  // Apply transcription updates to prompt
  useEffect(() => {
    if (!voiceText) return;
    if (voiceText.partial !== undefined && voiceText.partial !== null) {
      const next = `${basePromptRef.current} ${voiceText.partial}`.trim();
      setPrompt(next);
    }
    if (voiceText.final !== undefined && voiceText.final !== null) {
      const next = `${basePromptRef.current} ${voiceText.final}`.trim();
      setPrompt(next);
      clearVoiceTranscription(voiceSessionId);
    }
  }, [clearVoiceTranscription, setPrompt, voiceSessionId, voiceText]);

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read audio chunk"));
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const idx = result.indexOf("base64,");
        resolve(idx >= 0 ? result.slice(idx + "base64,".length) : result);
      };
      reader.readAsDataURL(blob);
    });
  };

  const pickRecorderMime = (): string => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mp4",
    ];
    if (typeof MediaRecorder === "undefined") return "";
    if (typeof MediaRecorder.isTypeSupported !== "function") return "";
    for (const t of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(t)) return t;
      } catch {
        void 0;
      }
    }
    return "";
  };

  const cleanupRecording = useCallback(() => {
    // Idempotent cleanup; can be called from multiple handlers.
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      void 0;
    }
    streamRef.current = null;
    recorderRef.current = null;
    stoppingRef.current = false;
    setIsRecording(false);
  }, [setIsRecording]);

  const startRecording = async () => {
    if (!voiceSettings) return;
    if (isRunning) return;
    if (isRecording) return;

    setMicError(null);
    sendErrorOnceRef.current = false;
    stoppingRef.current = false;
    basePromptRef.current = prompt;
    chunkCountRef.current = 0;
    sendQueueRef.current = Promise.resolve();
    voiceSessionIdRef.current = voiceSessionId;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mime = pickRecorderMime();
      audioMimeRef.current = mime;

      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);

      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        try {
          if (!e.data || e.data.size === 0) return;
          chunkCountRef.current += 1;
          const vs = voiceSettings;
          if (!vs) return;
          const mime =
            audioMimeRef.current ||
            (recorderRef.current?.mimeType ? String(recorderRef.current.mimeType) : "") ||
            "audio/webm";
          const chunk = e.data;
          const sessionId = voiceSessionIdRef.current || voiceSessionId;
          sendQueueRef.current = sendQueueRef.current
            .then(async () => {
              const b64 = await blobToBase64(chunk);
              await getPlatform().invoke(
                "transcribe-voice-stream",
                b64,
                mime,
                sessionId,
                vs.baseUrl,
                vs.apiKey,
                vs.model,
                vs.language,
                false
              );
              return;
            })
            .catch(() => {});
        } catch {
          // Ignore chunk send errors; UI feedback handled on finalize.
        }
      };

      recorder.onerror = () => {
        setMicError("Ошибка записи аудио (MediaRecorder). Попробуй сменить формат или перезапустить приложение.");
        cleanupRecording();
      };

      recorder.onstop = () => {
        const vs = voiceSettings;
        if (!vs) {
          cleanupRecording();
          return;
        }

        const mime =
          audioMimeRef.current ||
          (recorderRef.current?.mimeType ? String(recorderRef.current.mimeType) : "") ||
          "audio/webm";
        const stopMs = Date.now();
        lastStopMsRef.current = stopMs;
        const sessionId = voiceSessionIdRef.current || voiceSessionId;

        // If user stopped too quickly, there may be no chunks yet.
        if (chunkCountRef.current === 0) {
          setMicError("Recording was too short. Hold to record for at least ~0.3s, then stop.");
          cleanupRecording();
          return;
        }

        // Enqueue finalization after the last chunk is sent.
        sendQueueRef.current = sendQueueRef.current
          .then(async () => {
            await getPlatform().invoke(
              "transcribe-voice-stream",
              "",
              mime,
              sessionId,
              vs.baseUrl,
              vs.apiKey,
              vs.model,
              vs.language,
              true
            );
            return;
          })
          .catch(() => {
            if (!sendErrorOnceRef.current) {
              sendErrorOnceRef.current = true;
              setMicError("Не удалось отправить аудио на сервер распознавания. Проверь Voice Base URL/Model и что сервер запущен.");
            }
          })
          .finally(() => {
            cleanupRecording();
          });
      };

      // Short timeslice enables near-real-time partials without flooding.
      recorder.start(500);
      setIsRecording(true);
    } catch (error: unknown) {
      const name = typeof error === "object" && error !== null && "name" in error
        ? String((error as { name?: unknown }).name ?? "")
        : "";
      if (name === "NotAllowedError") {
        setMicError("Доступ к микрофону отклонён. Разрешите доступ в настройках системы.");
      } else if (name === "NotFoundError") {
        setMicError("Микрофон не найден.");
      } else if (name === "NotReadableError") {
        setMicError("Микрофон занят другим приложением.");
      } else {
        setMicError(error instanceof Error ? error.message : String(error));
      }
      cleanupRecording();
    }
  };

  const stopRecording = useCallback((reason?: string) => {
    const recorder = recorderRef.current;
    if (!recorder) {
      if (reason) setMicError(reason);
      cleanupRecording();
      return;
    }
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (reason) setMicError(reason);
    try {
      // Force flush last chunk in some implementations.
      if (typeof recorder.requestData === "function") {
        recorder.requestData();
      }
    } catch {
      void 0;
    }
    try {
      recorder.stop();
    } catch {
      cleanupRecording();
      return;
    }
    // Fail-safe: if onstop doesn't fire, don't get stuck in recording state.
    setTimeout(() => {
      if (stoppingRef.current) {
        cleanupRecording();
      }
    }, 1500);
  }, [cleanupRecording, setMicError]);

  useEffect(() => {
    if (!isRecording) return;
    if (voiceServerStatus.available) return;
    const timer = setTimeout(() => {
      stopRecording("Voice server is unavailable. Recording stopped.");
    }, 0);
    return () => clearTimeout(timer);
  }, [isRecording, stopRecording, voiceServerStatus.available]);

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else void startRecording();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isRunning) { handleStop(); return; }
      handleSend();
      return;
    }
    
    // Shift+Enter - allow multiline (default behavior)
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    target.style.height = "auto";
    const scrollHeight = target.scrollHeight;
    if (scrollHeight > MAX_HEIGHT) {
      target.style.height = `${MAX_HEIGHT}px`;
      target.style.overflowY = "auto";
    } else {
      target.style.height = `${scrollHeight}px`;
      target.style.overflowY = "hidden";
    }
  };

  useEffect(() => {
    if (!promptRef.current) return;
    promptRef.current.style.height = "auto";
    const scrollHeight = promptRef.current.scrollHeight;
    if (scrollHeight > MAX_HEIGHT) {
      promptRef.current.style.height = `${MAX_HEIGHT}px`;
      promptRef.current.style.overflowY = "auto";
    } else {
      promptRef.current.style.height = `${scrollHeight}px`;
      promptRef.current.style.overflowY = "hidden";
    }
  }, [prompt]);

  return (
    <section
      data-prompt-input-shell
      className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-surface via-surface to-transparent pb-6 px-2 pt-8 lg:pb-8 lg:ml-[280px]"
    >
      <div className="mx-auto w-full max-w-full">
        <div className="flex w-full items-end gap-3 rounded-2xl border border-ink-900/10 bg-surface px-4 py-3 shadow-card">
          <textarea
            rows={1}
            className="flex-1 resize-none bg-transparent py-1.5 text-sm text-ink-800 placeholder:text-muted focus:outline-none"
            placeholder={t("promptInput.placeholder")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            ref={promptRef}
          />
          {hasHistory && !isRunning && (
            <button
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-all ${
                isCompacting
                  ? "border-accent/20 bg-white text-accent/60 cursor-not-allowed opacity-75"
                  : "border-accent/25 bg-white text-accent/80 hover:border-accent/40 hover:bg-accent/[0.06] hover:text-accent active:bg-accent/[0.10]"
              }`}
              style={isCompacting
                ? { boxShadow: "0 2px 8px rgba(226, 124, 82, 0.08)" }
                : { boxShadow: "0 3px 10px rgba(226, 124, 82, 0.10)" }}
              onClick={handleCompact}
              disabled={isCompacting}
              title={t("promptInput.compactTitle")}
              aria-label={t("promptInput.compactAriaLabel")}
            >
              {isCompacting ? (
                <SpinnerIcon className="h-[20px] w-[20px]" />
              ) : (
                <CompactHistoryIcon className="h-[20px] w-[20px]" />
              )}
            </button>
          )}
          {voiceEnabled && (
            <button
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                isRecording
                  ? "bg-error text-white hover:bg-error/90 voice-stop-pulse"
                  : "bg-ink-200 text-ink-700 hover:bg-ink-300"
              }`}
              onClick={toggleRecording}
              aria-label={isRecording ? "Stop recording" : "Start recording"}
              disabled={isRunning}
              title={isRecording ? "Stop recording" : "Start recording"}
            >
              {isRecording ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="currentColor" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor" />
                </svg>
              )}
            </button>
          )}
          <button
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all ${isRunning ? "bg-error text-white hover:bg-error/90" : "bg-accent text-white hover:bg-accent-hover"}`}
            style={isRunning
              ? { boxShadow: "0 6px 16px rgba(220, 38, 38, 0.22)" }
              : { boxShadow: "0 8px 20px rgba(226, 124, 82, 0.28)" }}
            onClick={isRunning ? handleStop : handleSend}
            aria-label={isRunning ? t("promptInput.stopSession") : t("promptInput.sendPrompt")}
          >
            {isRunning ? (
              <svg viewBox="0 0 24 24" className="h-[20px] w-[20px]" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-[20px] w-[20px]" aria-hidden="true"><path d="M3.4 20.6 21 12 3.4 3.4l2.8 7.2L16 12l-9.8 1.4-2.8 7.2Z" fill="currentColor" /></svg>
            )}
          </button>
        </div>
        {micError && (
          <div className="mt-2 px-2 text-xs text-error text-center">
            {micError}
          </div>
        )}
        <div className="mt-2 px-2 text-xs text-muted text-center">
          {t("promptInput.keyboardHint")}
        </div>
      </div>
    </section>
  );
}
