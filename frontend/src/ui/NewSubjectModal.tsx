import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { listProjectProfiles, setupProject } from "../api";
import { buttonClass } from "./buttonClass";

interface Props {
  onClose: () => void;
}

export function NewSubjectModal({ onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ["project-profiles"],
    queryFn: listProjectProfiles,
    staleTime: 30_000,
  });

  const existingLower = useMemo(() => {
    return new Set(
      (profilesQuery.data ?? [])
        .map((profile) => profile.subject?.trim().toLowerCase())
        .filter((s): s is string => Boolean(s)),
    );
  }, [profilesQuery.data]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const cleanSubject = subject.trim();
      if (!cleanSubject) throw new Error("Subject name required.");
      if (existingLower.has(cleanSubject.toLowerCase())) {
        throw new Error("That subject already exists.");
      }
      await setupProject(cleanSubject, null, null, null);
      return cleanSubject;
    },
    onSuccess: async (cleanSubject) => {
      await queryClient.invalidateQueries({ queryKey: ["project-profiles"] });
      onClose();
      navigate(`/projects/${encodeURIComponent(cleanSubject)}`);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to create subject.");
    },
  });

  const busy = createMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subject.trim() || busy) return;
    setError(null);
    createMutation.mutate();
  }

  return (
    <div
      className="start-session-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        className="flow-card start-session-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          className="start-session-close"
          disabled={busy}
          onClick={onClose}
          type="button"
          aria-label="Close"
        >
          x
        </button>
        <h1>New subject</h1>
        <p className="flow-copy">Give it a name. You can add materials and sessions later.</p>
        <form className="flow-form" onSubmit={handleSubmit}>
          <label className="flow-field">
            <span>Subject</span>
            <input
              autoComplete="off"
              autoFocus
              disabled={busy}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="e.g. Organic Chemistry, SQL, Calculus"
              value={subject}
            />
          </label>
          {error && <div className="flow-error">{error}</div>}
          <div className="flow-actions">
            <button className={buttonClass("secondary")} disabled={busy} onClick={onClose} type="button">
              Cancel
            </button>
            <button className={buttonClass("primary")} disabled={!subject.trim() || busy} type="submit">
              {busy ? "Creating…" : "Create subject"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
