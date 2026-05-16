import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";

import { createConversation, generateMindMap } from "../api";
import { clearPendingStudyContext, getPendingStudyContext } from "../studyState";

export function StartMethodPage() {
  const navigate = useNavigate();
  const pendingContext = getPendingStudyContext();
  const [error, setError] = useState<string | null>(null);

  if (!pendingContext) {
    return <Navigate replace to="/start/topic" />;
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const conversation = await createConversation(pendingContext.subject);
      try {
        await generateMindMap(pendingContext.subject);
      } catch {
        // Setup save and the project page both retry this automatically.
      }
      return conversation;
    },
    onSuccess: (c) => {
      clearPendingStudyContext();
      navigate(`/projects/${encodeURIComponent(pendingContext.subject)}/setup?session=${c.id}`, { replace: true });
    },
    onError: () => setError("Failed to create subject. Please try again."),
  });

  return (
    <div className="flow-page">
      <div className="flow-card">
        <div className="flow-step">Step 3 of 3</div>
        <h1>How Sapient works</h1>
        <p className="flow-copy">
          A direct teaching loop: explain the concept clearly, check understanding, give hints
          when you're stuck. Examples for every principle.
        </p>

        <div className="method-principles">
          <div className="method-card">
            <strong>Explain, then check</strong>
            <span>Concepts are taught with examples first, then a focused follow-up question.</span>
          </div>
          <div className="method-card">
            <strong>Hints on attempt</strong>
            <span>When you're trying to solve something, you get a nudge — not the answer.</span>
          </div>
          <div className="method-card">
            <strong>Grounded in your material</strong>
            <span>Uploaded readings are quoted directly when relevant, not paraphrased.</span>
          </div>
        </div>

        <div className="flow-summary">
          <span>{pendingContext.subject}</span>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="flow-actions">
          <Link className="button button-secondary" to="/start/materials">
            Back
          </Link>
          <button
            className="button button-primary"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
            type="button"
          >
            {createMutation.isPending ? "Creating subject…" : "Start subject"}
          </button>
        </div>
      </div>
    </div>
  );
}
