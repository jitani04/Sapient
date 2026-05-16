import { useRef, useState } from "react";

import { RateLimitError, createConversation, fetchSpeech, streamChat } from "./api";
import type { ChatStreamEvent, DiagramData, ImageData, KeyIdea, RetrievedSource } from "./types";

interface SpeechChunk {
  displayText: string;
  spokenText: string;
  audioUrlPromise: Promise<string>;
  keyIdeas: KeyIdea[];
  diagrams: DiagramData[];
  images: ImageData[];
  pauseAfterMs?: number;
}

export interface LectureSession {
  conversationId: number | null;
  agentThinking: boolean;
  agentSpeaking: boolean;
  transcript: string;
  keyIdeas: KeyIdea[];
  currentKeyIdea: KeyIdea | null;
  diagrams: DiagramData[];
  currentDiagram: DiagramData | null;
  images: ImageData[];
  currentImage: ImageData | null;
  sources: RetrievedSource[];
  error: string | null;
}

interface SendOptions {
  interrupt?: boolean;
  speak?: boolean;
}

const EMPTY: LectureSession = {
  conversationId: null,
  agentThinking: false,
  agentSpeaking: false,
  transcript: "",
  keyIdeas: [],
  currentKeyIdea: null,
  diagrams: [],
  currentDiagram: null,
  images: [],
  currentImage: null,
  sources: [],
  error: null,
};

const CODE_DISPLAY_SPOKEN_PROMPT = "Read the code I displayed.";
const CODE_DISPLAY_PAUSE_MS = 10_000;

function isCodeLike(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /<!doctype\s+html|<html[\s>]|<\/[a-z][\w-]*>|^\s*(const|let|var|function|class|def|import|from|public|private|SELECT|INSERT|UPDATE|DELETE)\b/im.test(trimmed)
    || /[{};]\s*$/.test(trimmed)
    || trimmed.split("\n").filter((line) => /^\s{2,}\S/.test(line)).length >= 2;
}

function toCodeMarkdown(language: string | undefined, code: string): string {
  const safeLanguage = language?.trim().replace(/[^\w-]/g, "") ?? "";
  return `\`\`\`${safeLanguage}\n${code.trim()}\n\`\`\``;
}

function extractCodeDisplay(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const tripleFence = trimmed.match(/```([\w-]+)?\s*\n?([\s\S]*?)```/);
  if (tripleFence && isCodeLike(tripleFence[2])) {
    return toCodeMarkdown(tripleFence[1], tripleFence[2]);
  }

  const doubleFence = trimmed.match(/^``([\w-]+)?\s+([\s\S]*?)``$/);
  if (doubleFence && isCodeLike(doubleFence[2])) {
    return toCodeMarkdown(doubleFence[1], doubleFence[2]);
  }

  const languagePrefix = trimmed.match(/^(html|css|javascript|js|typescript|ts|tsx|jsx|python|py|sql|json|bash|sh)\s+([\s\S]+)$/i);
  if (languagePrefix && isCodeLike(languagePrefix[2])) {
    return toCodeMarkdown(languagePrefix[1].toLowerCase(), languagePrefix[2]);
  }

  if (isCodeLike(trimmed) && trimmed.length >= 40) {
    return toCodeMarkdown(undefined, trimmed);
  }

  return null;
}

function hasOpenCodeFence(value: string): boolean {
  const tripleFenceCount = value.match(/```/g)?.length ?? 0;
  if (tripleFenceCount % 2 === 1) return true;

  const trimmed = value.trim();
  return trimmed.startsWith("``") && !trimmed.endsWith("``");
}

function cleanSpokenText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, CODE_DISPLAY_SPOKEN_PROMPT)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*checkpoint question\s*:\s*/gim, "")
    .replace(/^\s*(checkpoint|question)\s*:\s*/gim, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function useLectureSession(subject: string | null) {
  const [session, setSession] = useState<LectureSession>(EMPTY);

  const convIdRef = useRef<number | null>(null);
  const chunkQueueRef = useRef<SpeechChunk[]>([]);
  const isPlayingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const pauseTimerRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const controllersRef = useRef<Set<AbortController>>(new Set());
  const lastPromptRef = useRef<string | null>(null);
  const playbackRateRef = useRef(1);
  // Incremented on every send() call; stale handleEvent closures detect mismatch and exit early.
  const genRef = useRef(0);

  function revokeQueuedUrls() {
    for (const chunk of chunkQueueRef.current) {
      void chunk.audioUrlPromise
        .then((url) => {
          if (url) URL.revokeObjectURL(url);
        })
        .catch(() => {});
    }
  }

  function stopAudio() {
    if (pauseTimerRef.current != null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }
    revokeQueuedUrls();
    isPlayingRef.current = false;
    chunkQueueRef.current = [];
  }

  function abortInFlight() {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
  }

  function playNext() {
    if (!activeRef.current) return;
    const chunk = chunkQueueRef.current.shift();
    if (!chunk) {
      isPlayingRef.current = false;
      setSession((s) => ({
        ...s,
        agentSpeaking: false,
        transcript: s.transcript.trim().startsWith("```") ? s.transcript : "",
      }));
      return;
    }

    function advanceAfterPause() {
      if (chunk?.pauseAfterMs) {
        pauseTimerRef.current = window.setTimeout(() => {
          pauseTimerRef.current = null;
          playNext();
        }, chunk.pauseAfterMs);
        return;
      }
      playNext();
    }

    isPlayingRef.current = true;
    setSession((s) => ({
      ...s,
      agentSpeaking: true,
      transcript: chunk.displayText,
      keyIdeas: chunk.keyIdeas.length > 0 ? [...s.keyIdeas, ...chunk.keyIdeas] : s.keyIdeas,
      diagrams: chunk.diagrams.length > 0 ? [...s.diagrams, ...chunk.diagrams] : s.diagrams,
      images: chunk.images.length > 0 ? [...s.images, ...chunk.images] : s.images,
      currentKeyIdea: chunk.keyIdeas.length > 0 ? chunk.keyIdeas[chunk.keyIdeas.length - 1] : s.currentKeyIdea,
      currentDiagram: chunk.diagrams.length > 0 ? chunk.diagrams[chunk.diagrams.length - 1] : s.currentDiagram,
      currentImage: chunk.images.length > 0 ? chunk.images[chunk.images.length - 1] : s.currentImage,
    }));

    chunk.audioUrlPromise
      .then((url) => {
        if (!url) {
          advanceAfterPause();
          return;
        }
        if (!isPlayingRef.current || !activeRef.current) {
          URL.revokeObjectURL(url);
          playNext();
          return;
        }
        const audio = new Audio(url);
        audio.playbackRate = playbackRateRef.current;
        audioRef.current = audio;
        currentAudioUrlRef.current = url;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (currentAudioUrlRef.current === url) currentAudioUrlRef.current = null;
          audioRef.current = null;
          advanceAfterPause();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (currentAudioUrlRef.current === url) currentAudioUrlRef.current = null;
          audioRef.current = null;
          advanceAfterPause();
        };
        void audio.play().catch(() => {
          URL.revokeObjectURL(url);
          if (currentAudioUrlRef.current === url) currentAudioUrlRef.current = null;
          advanceAfterPause();
        });
      })
      .catch(() => advanceAfterPause());
  }

  function appendArtifacts(keyIdeas: KeyIdea[], diagrams: DiagramData[], images: ImageData[]) {
    if (keyIdeas.length === 0 && diagrams.length === 0 && images.length === 0) return;
    setSession((s) => ({
      ...s,
      keyIdeas: keyIdeas.length > 0 ? [...s.keyIdeas, ...keyIdeas] : s.keyIdeas,
      diagrams: diagrams.length > 0 ? [...s.diagrams, ...diagrams] : s.diagrams,
      images: images.length > 0 ? [...s.images, ...images] : s.images,
      currentKeyIdea: keyIdeas.length > 0 ? keyIdeas[keyIdeas.length - 1] : s.currentKeyIdea,
      currentDiagram: diagrams.length > 0 ? diagrams[diagrams.length - 1] : s.currentDiagram,
      currentImage: images.length > 0 ? images[images.length - 1] : s.currentImage,
    }));
  }

  async function send(message: string, options: SendOptions = {}) {
    const interrupt = options.interrupt ?? true;
    const speak = options.speak ?? true;

    // Increment generation — any in-flight handleEvent from a previous call will see the
    // mismatch and return early, preventing stale events from mixing into this new stream.
    const myGen = interrupt ? ++genRef.current : genRef.current;

    if (interrupt) {
      abortInFlight();
      stopAudio();
      lastPromptRef.current = message;
    }
    const controller = new AbortController();
    controllersRef.current.add(controller);
    setSession((s) => ({
      ...s,
      agentThinking: true,
      agentSpeaking: interrupt ? false : s.agentSpeaking,
      transcript: interrupt ? "" : s.transcript,
      error: null,
    }));

    let convId = convIdRef.current;
    if (!convId) {
      try {
        const conv = await createConversation(subject ?? undefined, { isLecture: true });
        if (genRef.current !== myGen) return;
        convId = conv.id;
        convIdRef.current = convId;
        setSession((s) => ({ ...s, conversationId: convId! }));
      } catch {
        if (genRef.current !== myGen) return;
        setSession((s) => ({ ...s, error: "Could not start lecture session.", agentThinking: false }));
        return;
      }
    }

    // Local refs for this stream only — keeps each send() isolated.
    const tokenBuf = { current: "" };
    const pending = { keyIdeas: [] as KeyIdea[], diagrams: [] as DiagramData[], images: [] as ImageData[] };

    function enqueueChunk(text: string) {
      if (genRef.current !== myGen) return;
      const codeDisplay = extractCodeDisplay(text);
      const displayText = codeDisplay ?? cleanSpokenText(text);
      const spokenText = codeDisplay ? CODE_DISPLAY_SPOKEN_PROMPT : cleanSpokenText(text);
      if (!displayText.trim() || !spokenText.trim()) return;
      const keyIdeas = pending.keyIdeas.splice(0);
      const diagrams = pending.diagrams.splice(0);
      const images = pending.images.splice(0);
      if (!speak) {
        appendArtifacts(keyIdeas, diagrams, images);
        return;
      }
      const audioUrlPromise = fetchSpeech(spokenText).catch(() => "");
      chunkQueueRef.current.push({
        displayText,
        spokenText,
        audioUrlPromise,
        keyIdeas,
        diagrams,
        images,
        pauseAfterMs: codeDisplay ? CODE_DISPLAY_PAUSE_MS : undefined,
      });
      if (!isPlayingRef.current) playNext();
    }

    function tryFlush() {
      const buf = tokenBuf.current;
      if (hasOpenCodeFence(buf)) return;

      const pp = buf.indexOf("\n\n");
      if (pp >= 0) {
        enqueueChunk(buf.slice(0, pp));
        tokenBuf.current = buf.slice(pp + 2);
        tryFlush();
        return;
      }
      if (buf.length >= 120) {
        const match = /[.!?]\s/.exec(buf.slice(80));
        if (match) {
          const idx = 80 + match.index + match[0].length;
          enqueueChunk(buf.slice(0, idx));
          tokenBuf.current = buf.slice(idx);
        }
      }
    }

    function handleEvent(event: ChatStreamEvent) {
      // Discard events from a previous send() call.
      if (genRef.current !== myGen) return;

      if (event.event === "token") {
        if (!speak) return;
        tokenBuf.current += event.data.delta;
        tryFlush();
      } else if (event.event === "sources") {
        setSession((s) => ({ ...s, sources: event.data.sources }));
      } else if (event.event === "key_idea") {
        pending.keyIdeas.push({
          id: event.data.id,
          concept: event.data.concept,
          summary: event.data.summary,
          subject: subject ?? null,
          sr_repetitions: 0,
          sr_due_date: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
      } else if (event.event === "diagram") {
        if (speak) {
          pending.diagrams.push(event.data);
        } else {
          appendArtifacts([], [event.data], []);
        }
      } else if (event.event === "image") {
        if (speak) {
          pending.images.push(event.data);
        } else {
          appendArtifacts([], [], [event.data]);
        }
      } else if (event.event === "end") {
        enqueueChunk(tokenBuf.current);
        tokenBuf.current = "";
        const ki = pending.keyIdeas.splice(0);
        const dg = pending.diagrams.splice(0);
        const img = pending.images.splice(0);
        appendArtifacts(ki, dg, img);
        setSession((s) => ({ ...s, agentThinking: false }));
      } else if (event.event === "error") {
        const friendly = event.data.rate_limited && event.data.retry_after_seconds
          ? `AI is rate-limited. Try again in ~${event.data.retry_after_seconds}s.`
          : event.data.error;
        setSession((s) => ({ ...s, error: friendly, agentThinking: false }));
      }
    }

    try {
      await streamChat(convId, { message }, handleEvent, controller.signal);
    } catch (err) {
      if (genRef.current !== myGen) return;
      // AbortError on intentional cancellation — don't surface as an error.
      if (err instanceof DOMException && err.name === "AbortError") return;
      const friendly = err instanceof RateLimitError
        ? `AI is rate-limited. Try again in ~${err.retryAfterSeconds}s.`
        : err instanceof Error ? err.message : "Stream failed.";
      setSession((s) => ({
        ...s,
        error: friendly,
        agentThinking: false,
      }));
    } finally {
      controllersRef.current.delete(controller);
    }
  }

  function retry() {
    const prompt = lastPromptRef.current;
    if (!prompt) return;
    void send(prompt);
  }

  function stop() {
    genRef.current++;
    abortInFlight();
    stopAudio();
    setSession((s) => ({
      ...s,
      agentThinking: false,
      agentSpeaking: false,
      transcript: "",
      error: null,
    }));
  }

  function setPlaybackRate(rate: number) {
    playbackRateRef.current = rate;
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }

  function activate() {
    activeRef.current = true;
    convIdRef.current = null;
    genRef.current = 0;
    lastPromptRef.current = null;
    setSession(EMPTY);
  }

  function deactivate() {
    activeRef.current = false;
    genRef.current++; // invalidate any in-flight stream
    abortInFlight();
    stopAudio();
    lastPromptRef.current = null;
    setSession(EMPTY);
  }

  return { session, send, retry, stop, setPlaybackRate, activate, deactivate };
}
