import { FormEvent, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { Navigate, useNavigate } from "react-router-dom";

import { login, loginWithGoogle, register } from "../api";
import { isAuthenticated, setToken } from "../auth";
import type { AuthResult } from "../types";
import { ThemeToggle } from "./ThemeToggle";

type ModalMode = "signin" | "signup";

export function LandingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authenticated = isAuthenticated();
  const [mode, setMode] = useState<ModalMode | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const busyLabel = loadingLabel || (mode === "signup" ? "Creating account…" : "Signing in…");

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".motion-reveal"));
    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.16 },
    );

    for (const element of elements) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, []);

  if (authenticated) {
    return <Navigate replace to="/dashboard" />;
  }

  function openModal(m: ModalMode) {
    if (loading) return;
    setEmail("");
    setPassword("");
    setError(null);
    setLoadingLabel("");
    setMode(m);
  }

  async function handleAuthResult(result: AuthResult) {
    setToken(result.access_token);
    queryClient.setQueryData(["me"], result.user);
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    navigate(result.user.onboarding_complete ? "/dashboard" : "/onboarding");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoadingLabel(mode === "signup" ? "Creating account…" : "Signing in…");
    setLoading(true);
    try {
      const result = mode === "signup" ? await register(email, password) : await login(email, password);
      await handleAuthResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
      setLoadingLabel("");
    }
  }

  async function handleGoogleSuccess(response: CredentialResponse) {
    if (!response.credential) {
      setError("Google did not return a credential.");
      return;
    }
    setError(null);
    setLoadingLabel(mode === "signup" ? "Creating your Google account…" : "Signing in with Google…");
    setLoading(true);
    try {
      const result = await loginWithGoogle(response.credential);
      await handleAuthResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setLoading(false);
      setLoadingLabel("");
    }
  }

  return (
    <div className="landing-shell">
      <nav className="landing-nav">
        <span className="landing-wordmark">Sapient</span>
        <div className="landing-nav-right">
          <ThemeToggle variant="icon" />
          <button className="button button-secondary" onClick={() => openModal("signin")} type="button">
            Sign in
          </button>
        </div>
      </nav>

      <main className="landing-main">
        <section className="landing-hero">
          <h1 className="landing-headline motion-reveal motion-rise motion-delay-1">
            A tutor built for <em>sapience</em>.
          </h1>
          <p className="landing-sub motion-reveal motion-rise motion-delay-2">
            Reasoning, reflection, and learning that carries forward from one study session to the next.
          </p>
          <div className="landing-cta-row motion-reveal motion-rise motion-delay-3">
            <button className="button button-primary" onClick={() => openModal("signup")} type="button">
              Start your first study session
            </button>
            <button className="button button-secondary" onClick={() => openModal("signin")} type="button">
              Sign in
            </button>
          </div>
        </section>

        <section className="landing-showcase landing-showcase-tinted motion-reveal motion-rise">
          <div className="landing-showcase-copy">
            <span className="landing-eyebrow">Retrieval-augmented</span>
            <h2>Grounded in <em>your</em> materials.</h2>
            <p>
              Every answer cites the page, paragraph, or slide it came from &mdash; pulled from notes
              and readings you upload, not just the model's training data.
            </p>
          </div>
          <div className="landing-showcase-visual" aria-hidden="true">
            <div className="landing-answer-card">
              <div className="landing-answer-line landing-answer-line-1" />
              <div className="landing-answer-line landing-answer-line-2" />
              <div className="landing-answer-line landing-answer-line-3" />
              <div className="landing-source-row">
                <span className="landing-source-chip">Fine Art · slide 12</span>
                <span className="landing-source-chip">notes.pdf · p. 4</span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-showcase landing-showcase-reverse motion-reveal motion-rise">
          <div className="landing-showcase-copy">
            <span className="landing-eyebrow">Bayesian Knowledge Tracing</span>
            <h2>Mastery, <em>modeled</em>.</h2>
            <p>
              Sapient maintains a BKT state per subject &mdash; a probability that you've mastered each
              concept. Quiz attempts update it; the tutor uses it to decide what to revisit next.
            </p>
          </div>
          <div className="landing-showcase-visual" aria-hidden="true">
            <svg className="landing-mastery-chart" viewBox="0 0 260 140" preserveAspectRatio="none">
              <line className="landing-mastery-grid" x1="32" y1="30" x2="252" y2="30" />
              <line className="landing-mastery-grid" x1="32" y1="60" x2="252" y2="60" />
              <line className="landing-mastery-grid" x1="32" y1="90" x2="252" y2="90" />
              <rect className="landing-mastery-band" x="32" y="86" width="220" height="22" />
              <polyline
                className="landing-mastery-curve"
                points="32,112 54,106 76,98 98,92 120,82 142,72 164,58 186,48 208,42 230,38 252,34"
              />
              <line className="landing-mastery-axis" x1="32" y1="120" x2="252" y2="120" />
              <line className="landing-mastery-axis" x1="32" y1="20" x2="32" y2="120" />
              <text className="landing-mastery-tick" x="0" y="34">1.0</text>
              <text className="landing-mastery-tick" x="0" y="92">0.5</text>
              <text className="landing-mastery-tick" x="0" y="122">0.0</text>
              <text className="landing-mastery-xtick" x="32" y="134">Day 1</text>
              <text className="landing-mastery-xtick" x="142" y="134">Day 7</text>
              <text className="landing-mastery-xtick" x="252" y="134" textAnchor="end">Day 14</text>
            </svg>
            <div className="landing-mastery-legend">
              <span className="landing-legend-dot landing-legend-dot-band" />
              needs-review band (mastery &lt; 0.62)
            </div>
          </div>
        </section>

        <section className="landing-showcase landing-showcase-tinted motion-reveal motion-rise">
          <div className="landing-showcase-copy">
            <span className="landing-eyebrow">SM-2 spaced repetition</span>
            <h2>Sessions that <em>compound</em>.</h2>
            <p>
              Notes you save during chat enter a spaced repetition schedule. Diagrams become
              Mermaid sources. Flashcards re-surface when you're about to forget. Smart reminders
              cross-reference upcoming deadlines with your weakest topics.
            </p>
          </div>
          <div className="landing-showcase-visual" aria-hidden="true">
            <div className="landing-schedule-stack">
              <div className="landing-schedule-card">
                <span className="landing-schedule-when">Today</span>
                <span className="landing-schedule-card-label">SQL · LEFT JOIN</span>
                <div className="landing-schedule-bar" />
              </div>
              <div className="landing-schedule-card landing-schedule-card-2">
                <span className="landing-schedule-when">+3 days</span>
                <span className="landing-schedule-card-label">Calculus · chain rule</span>
                <div className="landing-schedule-bar landing-schedule-bar-2" />
              </div>
              <div className="landing-schedule-card landing-schedule-card-3">
                <span className="landing-schedule-when">+9 days</span>
                <span className="landing-schedule-card-label">Bio · mitosis phases</span>
                <div className="landing-schedule-bar landing-schedule-bar-3" />
              </div>
            </div>
          </div>
        </section>

        <section className="landing-showcase landing-showcase-reverse motion-reveal motion-rise">
          <div className="landing-showcase-copy">
            <span className="landing-eyebrow">Canvas calendar · smart reminders</span>
            <h2>Deadlines that know what you're <em>behind on</em>.</h2>
            <p>
              Paste your Canvas iCal link and Sapient syncs every assignment due date. The reminder
              feed cross-references those deadlines with your BKT mastery — so when an essay is two
              days out, the tutor surfaces the weakest concept you'll need first.
            </p>
          </div>
          <div className="landing-showcase-visual" aria-hidden="true">
            <div className="landing-reminder-stack">
              <div className="landing-reminder-card landing-reminder-card-urgent">
                <span className="landing-reminder-meta">Due in 2 days · Canvas</span>
                <span className="landing-reminder-title">Essay: Modernism in poetry</span>
                <span className="landing-reminder-hint">Composition mastery 0.41 — start there.</span>
              </div>
              <div className="landing-reminder-card landing-reminder-card-soon">
                <span className="landing-reminder-meta">Due Fri · Calculus II</span>
                <span className="landing-reminder-title">Problem set 6</span>
                <span className="landing-reminder-hint">Chain rule needs review.</span>
              </div>
              <div className="landing-reminder-card landing-reminder-card-later">
                <span className="landing-reminder-meta">Next week</span>
                <span className="landing-reminder-title">Bio · cell cycle quiz</span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-showcase landing-showcase-tinted motion-reveal motion-rise">
          <div className="landing-showcase-copy">
            <span className="landing-eyebrow">Resource recommendations</span>
            <h2>The right video, at the right <em>moment</em>.</h2>
            <p>
              When you're stuck — or when you ask — the tutor recommends a YouTube tutorial or web
              article inline, with a one-line reason it'll help you right now. Every resource saves
              to a per-subject Resources tab so the list grows as you study.
            </p>
          </div>
          <div className="landing-showcase-visual" aria-hidden="true">
            <div className="landing-resource-stack">
              <div className="landing-resource-card">
                <div className="landing-resource-thumb">
                  <span className="landing-resource-play">▶</span>
                </div>
                <div className="landing-resource-body">
                  <span className="landing-resource-kind">Video · youtube.com</span>
                  <span className="landing-resource-title">CSS Grid in 12 minutes</span>
                  <span className="landing-resource-reason">A visual run-through clears up how columns and rows interact.</span>
                </div>
              </div>
              <div className="landing-resource-card landing-resource-card-article">
                <div className="landing-resource-body">
                  <span className="landing-resource-kind">Article · css-tricks.com</span>
                  <span className="landing-resource-title">A Complete Guide to CSS Grid</span>
                  <span className="landing-resource-reason">The canonical reference once you have the basics.</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-showcase landing-showcase-reverse motion-reveal motion-rise">
          <div className="landing-showcase-copy">
            <span className="landing-eyebrow">Quizzes · tied to mastery</span>
            <h2>Quizzes that <em>track</em> what they ask.</h2>
            <p>
              Multiple-choice and short-answer questions generated mid-chat as concept checks. Each
              attempt updates your BKT state, so the next "what should I review?" answer is built
              from real evidence — not guesses. Write your own questions too and they join the same
              pool.
            </p>
          </div>
          <div className="landing-showcase-visual" aria-hidden="true">
            <div className="landing-quiz-card">
              <span className="landing-quiz-tag">Multiple choice · SQL</span>
              <p className="landing-quiz-q">Which join returns rows with no match on the right side?</p>
              <div className="landing-quiz-option landing-quiz-option-correct">LEFT JOIN</div>
              <div className="landing-quiz-option">INNER JOIN</div>
              <div className="landing-quiz-option">RIGHT JOIN</div>
              <div className="landing-quiz-mastery">
                <span>Mastery: SQL · LEFT JOIN</span>
                <div className="landing-quiz-mastery-bar"><span style={{ width: "73%" }} /></div>
                <span>0.73</span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-showcase landing-showcase-tinted motion-reveal motion-rise">
          <div className="landing-showcase-copy">
            <span className="landing-eyebrow">Bring your own model</span>
            <h2>Switch when one isn't <em>working</em>.</h2>
            <p>
              Every conversation can run on Gemini 2.5 Flash, Claude Sonnet 4.6, or GPT-4o — pick
              from the chat header, no settings page detour. New conversations default to your
              last-used model, the same way ChatGPT and Claude.ai do it.
            </p>
          </div>
          <div className="landing-showcase-visual" aria-hidden="true">
            <div className="landing-model-stack">
              <div className="landing-model-pill landing-model-pill-active">Gemini 2.5 Flash</div>
              <div className="landing-model-pill">Claude Sonnet 4.6</div>
              <div className="landing-model-pill">GPT-4o</div>
              <div className="landing-model-hint">Picked per conversation · last-used stays default</div>
            </div>
          </div>
        </section>

        <section className="landing-loop motion-reveal motion-rise">
          <span className="landing-eyebrow">Human in the loop</span>
          <h2>You generate, you <em>curate</em>.</h2>
          <p>
            Save any snippet, diagram, or image from chat into your notes. Author your own quizzes
            and flashcards alongside the LLM-generated ones. The system stores what you tell it to.
          </p>
        </section>

        <section className="landing-closing motion-reveal motion-rise">
          <h2>Ready when you are.</h2>
          <button className="button button-primary" onClick={() => openModal("signup")} type="button">
            Start your first study session
          </button>
        </section>
      </main>

      <footer className="landing-footer">
        A masters project on stateful AI tutoring
      </footer>

      {mode !== null && (
        <div className="landing-modal-backdrop" onClick={() => !loading && setMode(null)} role="presentation">
          <div
            className={`landing-modal ${loading ? "landing-modal-busy" : ""}`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-busy={loading}
          >
            <div className="landing-modal-head">
              <div>
                <span className="landing-kicker-sm">Account</span>
                <h2>{mode === "signup" ? "Create account" : "Welcome back"}</h2>
              </div>
              <button className="modal-close-x" disabled={loading} onClick={() => setMode(null)} type="button">×</button>
            </div>

            <div className="modal-tabs-row">
              <button className={`modal-tab-btn ${mode === "signin" ? "active" : ""}`} disabled={loading} onClick={() => setMode("signin")} type="button">
                Sign in
              </button>
              <button className={`modal-tab-btn ${mode === "signup" ? "active" : ""}`} disabled={loading} onClick={() => setMode("signup")} type="button">
                Create account
              </button>
            </div>

            <div className="google-auth-box">
              {loading ? (
                <div className="auth-loading-card" role="status" aria-live="polite">
                  <span className="auth-loading-spinner" />
                  <span>{busyLabel}</span>
                </div>
              ) : googleClientId ? (
                <GoogleLogin
                  onError={() => setError("Google sign-in failed.")}
                  onSuccess={(response) => void handleGoogleSuccess(response)}
                  text={mode === "signup" ? "signup_with" : "signin_with"}
                  useOneTap={false}
                />
              ) : (
                <p className="muted">Set VITE_GOOGLE_CLIENT_ID to enable Google sign-in.</p>
              )}
            </div>

            <div className="modal-divider"><span>or use email</span></div>

            <form className="modal-form" onSubmit={(e) => void handleSubmit(e)}>
              <div className="modal-field">
                <label>Email</label>
                <input
                  className="modal-input"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  disabled={loading}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="modal-field">
                <label>Password</label>
                <input
                  className="modal-input"
                  type="password"
                  required
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder="Enter your password"
                  value={password}
                  disabled={loading}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error ? <p className="error-text">{error}</p> : null}

              <div className="modal-actions">
                <button className="button button-secondary" disabled={loading} onClick={() => setMode(null)} type="button">Cancel</button>
                <button className="button button-primary" disabled={loading} type="submit">
                  {loading ? busyLabel : mode === "signup" ? "Create account" : "Sign in"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
