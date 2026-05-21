import { Link } from "react-router-dom";

import { getToken } from "../auth";
import { buttonClass } from "./buttonClass";

export function NotFoundPage() {
  const isSignedIn = Boolean(getToken());

  return (
    <div className="not-found-page">
      <div className="content-card flex w-full max-w-[520px] flex-col gap-4">
        <div className="text-[0.72rem] font-extrabold tracking-[0.16em] text-[var(--accent)]">404</div>
        <h1 className="text-[clamp(2rem,6vw,3.4rem)]">Page not found</h1>
        <p className="leading-[1.65] text-[var(--text-soft)]">
          This route does not exist yet, or the link points to something that was moved.
        </p>
        <div className="flow-actions">
          <Link className={buttonClass("primary")} to={isSignedIn ? "/dashboard" : "/"}>
            {isSignedIn ? "Go to dashboard" : "Go home"}
          </Link>
          {isSignedIn ? (
            <Link className={buttonClass("secondary")} to="/sessions/new">
              Start a study session
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
