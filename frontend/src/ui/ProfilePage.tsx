import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { completeOnboarding, getCurrentUser } from "../api";

const USE_CASES = [
  "Studying for a class",
  "Preparing for exams",
  "Learning a new skill",
  "Building a project",
  "Reviewing uploaded materials",
];

export function ProfilePage() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery({ queryKey: ["me"], queryFn: getCurrentUser });
  const [name, setName] = useState("");
  const [useCase, setUseCase] = useState("");
  const [customUseCase, setCustomUseCase] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.name ?? "");
    if (user.use_case && USE_CASES.includes(user.use_case)) {
      setUseCase(user.use_case);
      setCustomUseCase("");
    } else if (user.use_case) {
      setUseCase("Other");
      setCustomUseCase(user.use_case);
    }
  }, [user]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const finalUseCase = useCase === "Other" ? customUseCase : useCase;
    setStatus(null);
    setError(null);
    setSaving(true);
    try {
      const updatedUser = await completeOnboarding(name, finalUseCase);
      queryClient.setQueryData(["me"], updatedUser);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setStatus("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">Profile</h1>
          <p className="page-subtitle">Manage how KnowledgePal addresses you and understands your study goals.</p>
        </div>
      </div>

      <div className="settings-grid">
        <form className="content-card profile-card" onSubmit={(event) => void handleSubmit(event)}>
          <div className="content-card-title">Personal details</div>

          <label className="flow-field">
            <span>Name</span>
            <input
              autoComplete="name"
              disabled={isLoading}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              required
              value={name}
            />
          </label>

          <div className="flow-field">
            <span>What are you using the app for?</span>
            <div className="onboarding-choice-grid">
              {[...USE_CASES, "Other"].map((option) => (
                <button
                  className={`onboarding-choice ${useCase === option ? "selected" : ""}`}
                  key={option}
                  onClick={() => setUseCase(option)}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {useCase === "Other" ? (
            <label className="flow-field">
              <span>Tell us more</span>
              <input
                onChange={(event) => setCustomUseCase(event.target.value)}
                placeholder="Describe your goal"
                required
                value={customUseCase}
              />
            </label>
          ) : null}

          {status ? <p className="success-text">{status}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}

          <div className="flow-actions">
            <button className="button button-primary" disabled={saving || isLoading || !useCase} type="submit">
              {saving ? "Saving..." : "Save profile"}
            </button>
          </div>
        </form>

        <div className="content-card account-card">
          <div className="content-card-title">Account</div>
          <div className="settings-row">
            <span>Email</span>
            <strong>{user?.email ?? "Loading..."}</strong>
          </div>
          <div className="settings-row">
            <span>Onboarding</span>
            <strong>{user?.onboarding_complete ? "Complete" : "Incomplete"}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
