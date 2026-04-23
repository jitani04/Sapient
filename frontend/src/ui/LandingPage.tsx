import { FormEvent, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { login, loginWithGoogle, register } from "../api";
import { isAuthenticated, setToken } from "../auth";
import type { AuthResult } from "../types";
import { ThemeToggle } from "./ThemeToggle";

const FEATURES = [
  {
    icon: "◎",
    title: "Socratic Questioning",
    description: "The tutor asks targeted questions that guide you to the answer through active recall.",
  },
  {
    icon: "✣",
    title: "Concept Mapping",
    description: "Build connections between topics with project maps that organize what you are learning.",
  },
  {
    icon: "↗",
    title: "Progress Tracking",
    description: "Track materials, sessions, and subjects so every conversation keeps momentum.",
  },
  {
    icon: "▤",
    title: "Grounded Practice",
    description: "Upload notes and readings so explanations can stay tied to your actual course material.",
  },
  {
    icon: "?",
    title: "Active Recall",
    description: "Practice with quizzes, hints, and checkpoints before the tutor gives full explanations.",
  },
  {
    icon: "◌",
    title: "Metacognition",
    description: "Reflect on where you are stuck and choose a better study strategy for the next step.",
  },
];

const STEPS = [
  { number: "01", title: "Upload your material", body: "Add notes, readings, or a topic you want to master." },
  { number: "02", title: "Engage actively", body: "Answer guided questions and ask for hints when you need them." },
  { number: "03", title: "Track and improve", body: "Return to projects, review sessions, and keep building mastery." },
];

type ModalMode = "signin" | "signup";

function NeuralNetCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const canvasEl = canvas;
    const context = ctx;

    const nodes = [
      { rx: 0.8, ry: 0.1 }, { rx: 0.68, ry: 0.2 }, { rx: 0.88, ry: 0.28 },
      { rx: 0.73, ry: 0.38 }, { rx: 0.6, ry: 0.46 }, { rx: 0.82, ry: 0.52 },
      { rx: 0.66, ry: 0.62 }, { rx: 0.52, ry: 0.7 }, { rx: 0.78, ry: 0.76 },
      { rx: 0.9, ry: 0.86 }, { rx: 0.58, ry: 0.88 },
    ];
    const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [2, 5], [3, 4], [3, 5], [4, 6], [5, 6], [5, 8], [6, 7], [6, 8], [7, 10], [8, 9], [8, 10]];
    const signals = edges.map((edge, i) => ({ edge, t: (i * 0.18) % 1, speed: 0.004 + Math.random() * 0.003, on: Math.random() > 0.35 }));
    let frame = 0;
    let raf = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvasEl.width = canvasEl.offsetWidth * dpr;
      canvasEl.height = canvasEl.offsetHeight * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      const width = canvasEl.offsetWidth;
      const height = canvasEl.offsetHeight;
      context.clearRect(0, 0, width, height);
      const placed = nodes.map((node) => ({ x: node.rx * width, y: node.ry * height }));

      edges.forEach(([a, b]) => {
        context.beginPath();
        context.moveTo(placed[a].x, placed[a].y);
        context.lineTo(placed[b].x, placed[b].y);
        context.strokeStyle = "rgba(115,147,179,0.18)";
        context.lineWidth = 1;
        context.stroke();
      });

      signals.forEach((signal) => {
        if (!signal.on) return;
        const [a, b] = signal.edge;
        const x = placed[a].x + (placed[b].x - placed[a].x) * signal.t;
        const y = placed[a].y + (placed[b].y - placed[a].y) * signal.t;
        const glow = context.createRadialGradient(x, y, 0, x, y, 8);
        glow.addColorStop(0, "rgba(158,183,207,0.95)");
        glow.addColorStop(1, "rgba(115,147,179,0)");
        context.beginPath();
        context.arc(x, y, 8, 0, Math.PI * 2);
        context.fillStyle = glow;
        context.fill();
        signal.t += signal.speed;
        if (signal.t > 1) {
          signal.t = 0;
          signal.on = Math.random() > 0.25;
        }
      });

      placed.forEach((node, i) => {
        const pulse = 0.82 + Math.sin(frame * 0.032 + i * 0.9) * 0.18;
        const radius = 6.5 * pulse;
        const glow = context.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius * 3.5);
        glow.addColorStop(0, `rgba(115,147,179,${0.18 * pulse})`);
        glow.addColorStop(1, "rgba(115,147,179,0)");
        context.beginPath();
        context.arc(node.x, node.y, radius * 3.5, 0, Math.PI * 2);
        context.fillStyle = glow;
        context.fill();
        context.beginPath();
        context.arc(node.x, node.y, radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(115,147,179,${0.88 * pulse})`;
        context.fill();
      });

      frame += 1;
      raf = requestAnimationFrame(draw);
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvasEl);
    draw();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas className="bb-neural-canvas" ref={canvasRef} />;
}

export function LandingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authenticated = isAuthenticated();
  const [mode, setMode] = useState<ModalMode | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

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
    setEmail(""); setPassword(""); setError(null); setMode(m);
  }

  async function handleAuthResult(result: AuthResult) {
    setToken(result.access_token);
    queryClient.setQueryData(["me"], result.user);
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    navigate(result.user.onboarding_complete ? "/dashboard" : "/onboarding");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const result = mode === "signup" ? await register(email, password) : await login(email, password);
      await handleAuthResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSuccess(response: CredentialResponse) {
    if (!response.credential) {
      setError("Google did not return a credential.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const result = await loginWithGoogle(response.credential);
      await handleAuthResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bb-landing landing-page">
      <nav className="bb-nav">
        <div className="bb-nav-inner">
          <Link className="bb-nav-logo" to="/">
            <span className="bb-logo-mark">◎</span>
            <span>BrainBoost AI</span>
          </Link>
          <div className="bb-nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#start">Get started</a>
          </div>
          <ThemeToggle compact />
          <button className="bb-btn bb-btn-ghost" onClick={() => openModal("signin")} type="button">Sign in</button>
          <button className="bb-btn bb-btn-primary" onClick={() => openModal("signup")} type="button">Sign up</button>
        </div>
      </nav>

      <header className="bb-hero landing-hero">
        <div className="bb-hero-inner">
          <div className="bb-hero-copy motion-reveal motion-slide-left">
            <span className="landing-kicker">KnowledgePal tutoring engine</span>
            <h1 className="bb-hero-h1">
              <span>Learn smarter,</span>
              <span className="bb-hero-muted">not harder</span>
            </h1>
            <p className="bb-hero-body">
              AI-powered tutoring that strengthens learning through active engagement, personalized
              challenges, and material-grounded guidance. Do not let AI replace you. Use it to amplify your potential.
            </p>
            <div className="landing-actions">
              <button className="bb-btn bb-btn-primary bb-btn-lg" onClick={() => openModal("signup")} type="button">
                Start learning
              </button>
              <button className="bb-btn bb-btn-outline bb-btn-lg" onClick={() => openModal("signin")} type="button">
                Sign in
              </button>
            </div>
            <div className="landing-inline-links">
              <Link className="text-link" to="/materials">Upload material</Link>
              <Link className="text-link" to="/history">Session history</Link>
            </div>
          </div>
          <div className="bb-hero-visual motion-reveal motion-scale" aria-hidden="true">
            <NeuralNetCanvas />
          </div>
        </div>
      </header>

      <section className="bb-features" id="features">
        <div className="bb-section-inner">
          <h2 className="bb-section-h2 motion-reveal motion-rise">Active learning features</h2>
          <p className="bb-section-sub motion-reveal motion-rise">KnowledgePal guides you to discover answers, not just receive them.</p>
          <div className="bb-feat-grid landing-grid">
            {FEATURES.map((f, index) => (
              <article
                className="bb-feat-card landing-card motion-reveal motion-card"
                key={f.title}
                style={{ transitionDelay: `${index * 65}ms` }}
              >
                <div className="bb-feat-icon">{f.icon}</div>
                <h2>{f.title}</h2>
                <p>{f.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bb-how" id="how">
        <div className="bb-section-inner">
          <div className="bb-steps">
            {STEPS.map((step, index) => (
              <article
                className="bb-step motion-reveal motion-rise"
                key={step.number}
                style={{ transitionDelay: `${index * 90}ms` }}
              >
                <div className="bb-step-num">{step.number}</div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bb-cta" id="start">
        <div className="bb-section-inner motion-reveal motion-rise">
          <h2>Ready to unlock your learning potential?</h2>
          <p>Start with a project, upload material, and let the tutor guide the next question.</p>
          <button className="bb-btn bb-btn-primary bb-btn-xl" onClick={() => openModal("signup")} type="button">
            Get started free
          </button>
        </div>
      </section>

      <footer className="bb-footer">© 2026 BrainBoost AI. Powered by KnowledgePal.</footer>

      {mode !== null && (
        <div className="landing-modal-backdrop" onClick={() => setMode(null)} role="presentation">
          <div
            className="landing-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="landing-modal-head">
              <div>
                <span className="landing-kicker-sm">Account</span>
                <h2>{mode === "signup" ? "Create account" : "Welcome back"}</h2>
              </div>
              <button className="modal-close-x" onClick={() => setMode(null)} type="button">×</button>
            </div>

            <div className="modal-tabs-row">
              <button className={`modal-tab-btn ${mode === "signin" ? "active" : ""}`} onClick={() => setMode("signin")} type="button">
                Sign in
              </button>
              <button className={`modal-tab-btn ${mode === "signup" ? "active" : ""}`} onClick={() => setMode("signup")} type="button">
                Create account
              </button>
            </div>

            <div className="google-auth-box">
              {googleClientId ? (
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
                  type="email" required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="modal-field">
                <label>Password</label>
                <input
                  className="modal-input"
                  type="password" required
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error ? <p className="error-text">{error}</p> : null}

              <div className="modal-actions">
                <button className="button button-secondary" onClick={() => setMode(null)} type="button">Cancel</button>
                <button className="button button-primary" disabled={loading} type="submit">
                  {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
