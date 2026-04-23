import { Link } from "react-router-dom";

import { getToken } from "../auth";

export function NotFoundPage() {
  const isSignedIn = Boolean(getToken());

  return (
    <div className="not-found-page">
      <div className="content-card not-found-card">
        <div className="not-found-code">404</div>
        <h1>Page not found</h1>
        <p>
          This route does not exist yet, or the link points to something that was moved.
        </p>
        <div className="flow-actions">
          <Link className="button button-primary" to={isSignedIn ? "/dashboard" : "/"}>
            {isSignedIn ? "Go to dashboard" : "Go home"}
          </Link>
          {isSignedIn ? (
            <Link className="button button-secondary" to="/sessions/new">
              Start a session
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
