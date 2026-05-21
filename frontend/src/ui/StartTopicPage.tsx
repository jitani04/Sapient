import { FormEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import { listProjectProfiles } from "../api";
import { formatSubjectName } from "../subjects";
import { getPendingStudyContext, setPendingStudyContext } from "../studyState";
import { buttonClass } from "./buttonClass";

export function StartTopicPage() {
  const navigate = useNavigate();
  const pendingContext = getPendingStudyContext();
  const [subject, setSubject] = useState(pendingContext?.subject ?? "");

  const profilesQuery = useQuery({
    queryKey: ["project-profiles"],
    queryFn: listProjectProfiles,
    staleTime: 30_000,
  });

  const existingSubjects = useMemo(() => {
    const all = (profilesQuery.data ?? [])
      .map((profile) => profile.subject?.trim())
      .filter((s): s is string => Boolean(s));
    // Dedup case-insensitively while preserving original casing.
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const s of all) {
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(s);
    }
    return unique.sort((a, b) => a.localeCompare(b));
  }, [profilesQuery.data]);

  function startWithSubject(value: string) {
    const next = value.trim();
    if (!next) return;
    setPendingStudyContext({
      subject: next,
      createdAt: pendingContext?.createdAt ?? new Date().toISOString(),
    });
    navigate("/start/materials");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startWithSubject(subject);
  }

  return (
    <div className="flow-page">
      <div className="flow-card">
        <h1>What are you studying?</h1>
        <p className="flow-copy">
          Pick one of your existing subjects or start a new one.
        </p>

        {existingSubjects.length > 0 && (
          <div className="flow-subject-grid">
            {existingSubjects.map((existing) => (
              <button
                key={existing}
                className="flow-subject-chip"
                onClick={() => startWithSubject(existing)}
                type="button"
              >
                {formatSubjectName(existing)}
              </button>
            ))}
          </div>
        )}

        <form className="flow-form" onSubmit={handleSubmit}>
          <label className="flow-field">
            <span>{existingSubjects.length > 0 ? "Or start a new subject" : "Subject"}</span>
            <input
              autoComplete="off"
              autoFocus
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Organic Chemistry, SQL, Calculus"
              value={subject}
            />
          </label>

          <div className="flow-actions">
            <Link className={buttonClass("secondary")} to="/dashboard">Back</Link>
            <button className={buttonClass("primary")} disabled={!subject.trim()} type="submit">
              Continue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
