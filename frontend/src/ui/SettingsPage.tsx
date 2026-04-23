import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { getCurrentUser, updateTutorPreferences } from "../api";
import { clearToken } from "../auth";
import { ThemeToggle } from "./ThemeToggle";

const TONE_OPTIONS = ["Supportive", "Direct", "Encouraging", "Calm", "Playful"];
const STYLE_OPTIONS = ["Socratic guide", "Step-by-step coach", "Exam prep trainer", "Project mentor", "Concept explainer"];

export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: getCurrentUser });
  const [tutorName, setTutorName] = useState("KnowledgePal");
  const [tutorTone, setTutorTone] = useState("Supportive");
  const [tutorStyle, setTutorStyle] = useState("Socratic guide");
  const [tutorInstructions, setTutorInstructions] = useState("");
  const [customizationStatus, setCustomizationStatus] = useState<string | null>(null);
  const [customizationError, setCustomizationError] = useState<string | null>(null);
  const [savingCustomization, setSavingCustomization] = useState(false);

  useEffect(() => {
    if (!user) return;
    setTutorName(user.tutor_name || "KnowledgePal");
    setTutorTone(user.tutor_tone || "Supportive");
    setTutorStyle(user.tutor_style || "Socratic guide");
    setTutorInstructions(user.tutor_instructions || "");
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
      });
      queryClient.setQueryData(["me"], updatedUser);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setCustomizationStatus("Tutor saved. New chats will use these preferences.");
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
          <p className="page-subtitle">Adjust account, appearance, and session preferences.</p>
        </div>
      </div>

      <div className="settings-grid">
        <form className="content-card tutor-customization-card" onSubmit={(event) => void handleTutorSubmit(event)}>
          <div className="content-card-title">Customize your tutor</div>
          <p className="settings-copy">
            Shape how your AI tutor sounds and teaches. These preferences affect future chat responses.
          </p>

          <label className="flow-field">
            <span>Tutor name</span>
            <input
              maxLength={80}
              onChange={(event) => setTutorName(event.target.value)}
              placeholder="KnowledgePal"
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

          <div className="tutor-preview">
            <div className="msg-avatar msg-avatar-ai">{tutorName.slice(0, 2).toUpperCase() || "KP"}</div>
            <div>
              <strong>{tutorName || "KnowledgePal"}</strong>
              <p>{tutorTone} · {tutorStyle}</p>
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

        <div className="content-card">
          <div className="content-card-title">Appearance</div>
          <p className="settings-copy">Switch between dark and light mode. Your preference is saved on this device.</p>
          <div className="settings-control">
            <ThemeToggle />
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

        <div className="content-card">
          <div className="content-card-title">Tutor behavior</div>
          <p className="settings-copy">
            {tutorName || "Your tutor"} is still configured to ask first, scaffold with hints, and ground answers in uploaded materials when available.
          </p>
        </div>
      </div>
    </div>
  );
}
