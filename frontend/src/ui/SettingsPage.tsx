import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { getCurrentUser, updateTutorPreferences } from "../api";
import { clearToken } from "../auth";
import { ThemeToggle } from "./ThemeToggle";
import { useReadingPrefs } from "../ReadingPrefsContext";
import type { FontSize, FontFamily } from "../readingPrefs";
import type { TutorVoice } from "../types";

const POMODORO_KEY = "kp-pomodoro";

const TONE_OPTIONS = ["Supportive", "Direct", "Encouraging", "Calm", "Playful"];
const STYLE_OPTIONS = ["Socratic guide", "Step-by-step coach", "Exam prep trainer", "Subject mentor", "Concept explainer"];
const VOICE_OPTIONS: { value: TutorVoice; label: string; description: string }[] = [
  { value: "nova", label: "Nova", description: "Balanced and clear" },
  { value: "alloy", label: "Alloy", description: "Neutral and polished" },
  { value: "ash", label: "Ash", description: "Calm and grounded" },
  { value: "coral", label: "Coral", description: "Warm and upbeat" },
  { value: "echo", label: "Echo", description: "Crisp and direct" },
  { value: "fable", label: "Fable", description: "Soft and storytelling" },
  { value: "onyx", label: "Onyx", description: "Deep and steady" },
  { value: "sage", label: "Sage", description: "Measured and thoughtful" },
  { value: "shimmer", label: "Shimmer", description: "Bright and energetic" },
];

const FONT_SIZE_OPTIONS: { label: string; value: FontSize }[] = [
  { label: "Small", value: "small" },
  { label: "Medium", value: "medium" },
  { label: "Large", value: "large" },
];

const FONT_FAMILY_OPTIONS: { label: string; value: FontFamily }[] = [
  { label: "Sans-serif", value: "sans" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "mono" },
];

type Tab = "tutor" | "preferences";

export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: getCurrentUser });
  const [tab, setTab] = useState<Tab>("tutor");
  const [tutorName, setTutorName] = useState("Sapient");
  const [tutorTone, setTutorTone] = useState("Supportive");
  const [tutorStyle, setTutorStyle] = useState("Socratic guide");
  const [tutorInstructions, setTutorInstructions] = useState("");
  const [tutorVoice, setTutorVoice] = useState<TutorVoice>("nova");
  const { fontSize, setFontSize, fontFamily, setFontFamily, bionic, setBionic } = useReadingPrefs();
  const [pomodoroEnabled, setPomodoroEnabled] = useState(() => localStorage.getItem(POMODORO_KEY) === "true");

  function togglePomodoro() {
    const next = !pomodoroEnabled;
    setPomodoroEnabled(next);
    localStorage.setItem(POMODORO_KEY, String(next));
  }
  const [customizationStatus, setCustomizationStatus] = useState<string | null>(null);
  const [customizationError, setCustomizationError] = useState<string | null>(null);
  const [savingCustomization, setSavingCustomization] = useState(false);

  useEffect(() => {
    if (!user) return;
    setTutorName(user.tutor_name || "Sapient");
    setTutorTone(user.tutor_tone || "Supportive");
    setTutorStyle(user.tutor_style || "Socratic guide");
    setTutorInstructions(user.tutor_instructions || "");
    setTutorVoice(user.tutor_voice || "nova");
  }, [user]);

  function handleSignOut() {
    clearToken();
    queryClient.clear();
    navigate("/");
  }

  async function handleTutorSubmit(event: FormEvent) {
    event.preventDefault();
    setCustomizationStatus(null);
    setCustomizationError(null);
    setSavingCustomization(true);

    try {
      const updatedUser = await updateTutorPreferences({
        tutor_name: tutorName,
        tutor_tone: tutorTone,
        tutor_style: tutorStyle,
        tutor_instructions: tutorInstructions,
        tutor_voice: tutorVoice,
      });
      queryClient.setQueryData(["me"], updatedUser);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setCustomizationStatus("Tutor saved. New study sessions will use these preferences.");
    } catch (err) {
      setCustomizationError(err instanceof Error ? err.message : "Could not save tutor preferences.");
    } finally {
      setSavingCustomization(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Adjust account, appearance, and study session preferences.</p>
        </div>
      </div>

      <div className="settings-tabs">
        <button
          className={`settings-tab${tab === "tutor" ? " active" : ""}`}
          onClick={() => setTab("tutor")}
          type="button"
        >
          Tutor
        </button>
        <button
          className={`settings-tab${tab === "preferences" ? " active" : ""}`}
          onClick={() => setTab("preferences")}
          type="button"
        >
          Preferences
        </button>
      </div>

      {tab === "tutor" && (
        <div className="settings-grid">
          <form className="content-card tutor-customization-card" onSubmit={(event) => void handleTutorSubmit(event)}>
            <div className="content-card-title">Customize your tutor</div>
            <p className="settings-copy">
              Shape how your AI tutor sounds and teaches. These preferences affect future study session responses.
            </p>

            <label className="flow-field">
              <span>Tutor name</span>
              <input
                maxLength={80}
                onChange={(event) => setTutorName(event.target.value)}
                placeholder="Sapient"
                required
                value={tutorName}
              />
            </label>

            <div className="flow-field">
              <span>Tone</span>
              <div className="settings-choice-grid">
                {TONE_OPTIONS.map((option) => (
                  <button
                    className={`settings-choice ${tutorTone === option ? "selected" : ""}`}
                    key={option}
                    onClick={() => setTutorTone(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="flow-field">
              <span>Teaching style</span>
              <div className="settings-choice-grid">
                {STYLE_OPTIONS.map((option) => (
                  <button
                    className={`settings-choice ${tutorStyle === option ? "selected" : ""}`}
                    key={option}
                    onClick={() => setTutorStyle(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <label className="flow-field">
              <span>Custom instructions</span>
              <textarea
                className="settings-textarea"
                maxLength={1000}
                onChange={(event) => setTutorInstructions(event.target.value)}
                placeholder="Example: Use concise examples, challenge me before explaining, and connect concepts to product design."
                rows={5}
                value={tutorInstructions}
              />
            </label>

            <div className="flow-field">
              <span>Read-aloud voice</span>
              <div className="settings-choice-grid">
                {VOICE_OPTIONS.map((option) => (
                  <button
                    className={`settings-choice ${tutorVoice === option.value ? "selected" : ""}`}
                    key={option.value}
                    onClick={() => setTutorVoice(option.value)}
                    type="button"
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
              <p className="settings-copy">
                This controls the voice used when you tap <strong>Read aloud</strong> on tutor responses.
              </p>
            </div>

            <div className="tutor-preview">
              <div className="msg-avatar msg-avatar-ai">{tutorName.slice(0, 2).toUpperCase() || "KP"}</div>
              <div>
                <strong>{tutorName || "Sapient"}</strong>
                <p>{tutorTone} · {tutorStyle} · {VOICE_OPTIONS.find((option) => option.value === tutorVoice)?.label ?? tutorVoice}</p>
              </div>
            </div>

            {customizationStatus ? <p className="success-text">{customizationStatus}</p> : null}
            {customizationError ? <p className="error-text">{customizationError}</p> : null}

            <div className="settings-actions">
              <button className="button button-primary" disabled={savingCustomization} type="submit">
                {savingCustomization ? "Saving..." : "Save tutor"}
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === "preferences" && (
        <div className="settings-grid">
          <div className="content-card">
            <div className="content-card-title">Appearance</div>
            <p className="settings-copy">Switch between dark and light mode. Your preference is saved on this device.</p>
            <div className="settings-control">
              <ThemeToggle />
            </div>
          </div>

          <div className="content-card">
            <div className="content-card-title">Reading</div>
            <p className="settings-copy">Customize how text looks and reads across the app. Preferences are saved on this device.</p>

            <div className="flow-field">
              <span>Font size</span>
              <div className="settings-choice-grid">
                {FONT_SIZE_OPTIONS.map(({ label, value }) => (
                  <button
                    className={`settings-choice ${fontSize === value ? "selected" : ""}`}
                    key={value}
                    onClick={() => setFontSize(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flow-field">
              <span>Font style</span>
              <div className="settings-choice-grid">
                {FONT_FAMILY_OPTIONS.map(({ label, value }) => (
                  <button
                    className={`settings-choice ${fontFamily === value ? "selected" : ""}`}
                    key={value}
                    onClick={() => setFontFamily(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-row" style={{ alignItems: "flex-start", gap: "1rem" }}>
              <div>
                <span style={{ fontWeight: 500 }}>Bionic reading</span>
                <p className="settings-copy" style={{ marginTop: "0.2rem" }}>
                  Bolds the first half of each word to help your eyes move faster across text.
                </p>
              </div>
              <button
                className={`settings-choice ${bionic ? "selected" : ""}`}
                onClick={() => setBionic(!bionic)}
                style={{ flexShrink: 0 }}
                type="button"
              >
                {bionic ? "On" : "Off"}
              </button>
            </div>
          </div>

          <div className="content-card">
            <div className="content-card-title">Focus mode</div>
            <div className="settings-row" style={{ alignItems: "flex-start", gap: "1rem" }}>
              <div>
                <span style={{ fontWeight: 500 }}>Pomodoro timer</span>
                <p className="settings-copy" style={{ marginTop: "0.2rem" }}>
                  Show a break reminder every 25 minutes during a study session.
                </p>
              </div>
              <button
                className={`settings-choice ${pomodoroEnabled ? "selected" : ""}`}
                onClick={togglePomodoro}
                style={{ flexShrink: 0 }}
                type="button"
              >
                {pomodoroEnabled ? "On" : "Off"}
              </button>
            </div>
          </div>

          <div className="content-card">
            <div className="content-card-title">Account</div>
            <div className="settings-row">
              <span>Signed in as</span>
              <strong>{user?.email ?? "Loading..."}</strong>
            </div>
            <div className="settings-row">
              <span>Display name</span>
              <strong>{user?.name ?? "Not set"}</strong>
            </div>
            <div className="settings-actions">
              <button className="button button-secondary" onClick={() => navigate("/profile")} type="button">
                Edit profile
              </button>
              <button className="button button-secondary" onClick={handleSignOut} type="button">
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
