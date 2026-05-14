import { useEffect, useRef, useState } from "react";

import { RateLimitError, transcribeAudio } from "./api";

const SPEECH_RMS_THRESHOLD = 0.045;
const SPEECH_START_MS = 280;
const SILENCE_END_MS = 850;
const MIN_UTTERANCE_MS = 450;

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

interface LectureVoiceInputOptions {
  active: boolean;
  onSpeechStart: () => void;
  onTranscript: (text: string) => void;
  getEchoReference: () => string;
}

function getAudioContextCtor(): typeof AudioContext | null {
  return window.AudioContext ?? null;
}

function mimeExtension(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function looksLikeEcho(candidate: string, reference: string): boolean {
  const candidateWords = tokenize(candidate);
  const referenceWords = tokenize(reference);
  if (candidateWords.length < 4 || referenceWords.length < 8) return false;

  const referenceSet = new Set(referenceWords);
  const shared = candidateWords.filter((word) => referenceSet.has(word)).length;
  if (shared >= 4 && shared / candidateWords.length >= 0.72) return true;

  const candidatePhrase = candidateWords.join(" ");
  const referencePhrase = referenceWords.join(" ");
  return candidateWords.length >= 5 && referencePhrase.includes(candidatePhrase);
}

export function useLectureVoiceInput({
  active,
  onSpeechStart,
  onTranscript,
  getEchoReference,
}: LectureVoiceInputOptions) {
  const [supported] = useState(() => (
    typeof window !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== "undefined"
    && !!getAudioContextCtor()
  ));
  const [enabled, setEnabled] = useState(true);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const monitorTimerRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speechStartedAtRef = useRef<number | null>(null);
  const silenceStartedAtRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  const enabledRef = useRef(enabled);
  const onSpeechStartRef = useRef(onSpeechStart);
  const onTranscriptRef = useRef(onTranscript);
  const getEchoReferenceRef = useRef(getEchoReference);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    onSpeechStartRef.current = onSpeechStart;
    onTranscriptRef.current = onTranscript;
    getEchoReferenceRef.current = getEchoReference;
  }, [onSpeechStart, onTranscript, getEchoReference]);

  function stopRecorder() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    }
    recorderRef.current = null;
    recordingStartedAtRef.current = null;
    silenceStartedAtRef.current = null;
    speechStartedAtRef.current = null;
    setRecording(false);
  }

  function startRecorder(stream: MediaStream) {
    if (recorderRef.current?.state === "recording") return;

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recordingStartedAtRef.current = performance.now();
    silenceStartedAtRef.current = null;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const mime = recorder.mimeType || "audio/webm";
      const chunks = chunksRef.current.splice(0);
      if (chunks.length === 0) return;

      const blob = new Blob(chunks, { type: mime });
      setTranscribing(true);
      void transcribeAudio(blob, `lecture.${mimeExtension(mime)}`)
        .then((text) => {
          const clean = text.trim();
          if (!clean) return;
          if (looksLikeEcho(clean, getEchoReferenceRef.current())) return;
          onTranscriptRef.current(clean);
        })
        .catch((err) => {
          if (err instanceof RateLimitError) {
            setError(`Voice transcription is rate-limited. Try again in ~${err.retryAfterSeconds}s.`);
          } else {
            setError("Voice transcription failed. Try again.");
          }
        })
        .finally(() => setTranscribing(false));
    };

    onSpeechStartRef.current();
    recorder.start();
    setRecording(true);
  }

  function stopMonitoring() {
    if (monitorTimerRef.current !== null) {
      window.clearInterval(monitorTimerRef.current);
      monitorTimerRef.current = null;
    }
    stopRecorder();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    analyserRef.current = null;
    setListening(false);
  }

  function monitor(stream: MediaStream, analyser: AnalyserNode) {
    const buffer = new Uint8Array(analyser.fftSize);
    monitorTimerRef.current = window.setInterval(() => {
      if (!activeRef.current || !enabledRef.current) return;

      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / buffer.length);
      const now = performance.now();
      const isSpeech = rms >= SPEECH_RMS_THRESHOLD;

      if (!recorderRef.current) {
        if (!isSpeech) {
          speechStartedAtRef.current = null;
          return;
        }
        speechStartedAtRef.current ??= now;
        if (now - speechStartedAtRef.current >= SPEECH_START_MS) {
          startRecorder(stream);
        }
        return;
      }

      if (isSpeech) {
        silenceStartedAtRef.current = null;
        return;
      }

      silenceStartedAtRef.current ??= now;
      const startedAt = recordingStartedAtRef.current ?? now;
      if (now - silenceStartedAtRef.current >= SILENCE_END_MS && now - startedAt >= MIN_UTTERANCE_MS) {
        stopRecorder();
      }
    }, 80);
  }

  useEffect(() => {
    if (!supported || !active || !enabled) {
      stopMonitoring();
      return;
    }

    let cancelled = false;

    async function startMonitoring() {
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const AudioContextCtor = getAudioContextCtor();
        if (!AudioContextCtor) return;

        const audioContext = new AudioContextCtor();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.15;
        source.connect(analyser);

        streamRef.current = stream;
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        setListening(true);
        monitor(stream, analyser);
      } catch {
        setEnabled(false);
        setListening(false);
        setError("Microphone access denied.");
      }
    }

    void startMonitoring();

    return () => {
      cancelled = true;
      stopMonitoring();
    };
    // stopMonitoring intentionally reads refs; including it would restart the audio graph every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, enabled, supported]);

  function toggleEnabled() {
    if (!supported) return;
    setEnabled((current) => !current);
    setError(null);
  }

  return { supported, listening, recording, transcribing, enabled, error, toggleEnabled };
}
