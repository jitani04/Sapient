import { useRef, useState } from "react";

import { RateLimitError, transcribeAudio } from "./api";

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

export function useMicrophone(onTranscript: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRecording() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch {
      setError("Microphone access denied.");
      return;
    }

    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const mime = recorder.mimeType || "audio/webm";
      const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunksRef.current, { type: mime });
      setLoading(true);
      try {
        const text = await transcribeAudio(blob, `recording.${ext}`);
        onTranscript(text);
      } catch (err) {
        if (err instanceof RateLimitError) {
          setError(`Voice transcription is rate-limited. Try again in ~${err.retryAfterSeconds}s.`);
        } else {
          setError("Transcription failed. Try again.");
        }
      } finally {
        setLoading(false);
      }
    };

    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setRecording(false);
  }

  function toggle() {
    if (recording) stopRecording();
    else void startRecording();
  }

  return { recording, loading, error, toggle };
}
