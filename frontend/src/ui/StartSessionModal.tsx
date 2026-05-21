import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { createConversation, generateMindMap, listProjectProfiles, setupProject, uploadMaterial } from "../api";
import { formatSubjectName } from "../subjects";
import { buttonClass } from "./buttonClass";

const MATERIAL_ACCEPT = ".pdf,.pptx,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/x-markdown";

type Step = "topic" | "materials" | "method";

interface Props {
  initialSubject?: string;
  onClose: () => void;
}

export function StartSessionModal({ initialSubject, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(initialSubject ? "materials" : "topic");
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ["project-profiles"],
    queryFn: listProjectProfiles,
    staleTime: 30_000,
  });

  const existingSubjects = useMemo(() => {
    const all = (profilesQuery.data ?? [])
      .map((profile) => profile.subject?.trim())
      .filter((s): s is string => Boolean(s));
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const item of all) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique.sort((a, b) => a.localeCompare(b));
  }, [profilesQuery.data]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const cleanSubject = subject.trim();
      if (!cleanSubject) throw new Error("Choose a subject first.");
      await setupProject(cleanSubject, null, null, null);
      const conversation = await createConversation(cleanSubject);
      try {
        await generateMindMap(cleanSubject);
      } catch {
        // The subject page retries map generation when needed.
      }
      return { conversation, cleanSubject };
    },
    onSuccess: async ({ conversation, cleanSubject }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["project-profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["project-profile", cleanSubject] }),
      ]);
      onClose();
      navigate(initialSubject ? `/sessions/${conversation.id}` : `/projects/${encodeURIComponent(cleanSubject)}/setup?session=${conversation.id}`);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to start study session.");
    },
  });

  function selectSubject(nextSubject: string) {
    setSubject(nextSubject);
    setError(null);
    setStep("materials");
  }

  function handleTopicSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subject.trim()) return;
    selectSubject(subject.trim());
  }

  function handleFilesChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFiles(Array.from(event.target.files ?? []));
  }

  async function handleMaterialsContinue() {
    const cleanSubject = subject.trim();
    if (!cleanSubject) {
      setStep("topic");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      if (selectedFiles.length > 0) {
        await Promise.all(selectedFiles.map((file) => uploadMaterial(file, cleanSubject)));
      }
      setStep("method");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to upload materials.");
    } finally {
      setUploading(false);
    }
  }

  const busy = uploading || startMutation.isPending;

  return (
    <div
      className="start-session-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div className="flow-card start-session-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <button className="start-session-close" disabled={busy} onClick={onClose} type="button" aria-label="Close">
          x
        </button>

        {step === "topic" && (
          <>
            <h1>What are you studying?</h1>
            <p className="flow-copy">Pick one of your existing subjects or start a new one.</p>

            {existingSubjects.length > 0 && (
              <div className="flow-subject-grid">
                {existingSubjects.map((existing) => (
                  <button
                    key={existing}
                    className="flow-subject-chip"
                    onClick={() => selectSubject(existing)}
                    type="button"
                  >
                    {formatSubjectName(existing)}
                  </button>
                ))}
              </div>
            )}

            <form className="flow-form" onSubmit={handleTopicSubmit}>
              <label className="flow-field">
                <span>{existingSubjects.length > 0 ? "Or start a new subject" : "Subject"}</span>
                <input
                  autoComplete="off"
                  autoFocus
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="e.g. Organic Chemistry, SQL, Calculus"
                  value={subject}
                />
              </label>
              <div className="flow-actions">
                <button className={buttonClass("secondary")} onClick={onClose} type="button">Cancel</button>
                <button className={buttonClass("primary")} disabled={!subject.trim()} type="submit">Continue</button>
              </div>
            </form>
          </>
        )}

        {step === "materials" && (
          <>
            <h1>Upload course material</h1>
            <p className="flow-copy">Optional. Uploads keep answers grounded in your actual material.</p>
            <p className="flow-subcopy">{subject}</p>

            <label className="upload-dropzone">
              <span>Drop PDFs, slide decks, lecture notes, or syllabi here</span>
              <small>Supported formats: PDF, PPTX, DOCX, TXT, and MD.</small>
              <input multiple accept={MATERIAL_ACCEPT} onChange={handleFilesChange} type="file" />
            </label>

            {selectedFiles.length > 0 ? (
              <div className="selection-list">
                {selectedFiles.map((file) => (
                  <div className="selection-item" key={`${file.name}-${file.size}`}>{file.name}</div>
                ))}
              </div>
            ) : null}

            {error ? <p className="error-text">{error}</p> : null}

            <div className="flow-actions">
              <button className={buttonClass("secondary")} disabled={busy} onClick={() => initialSubject ? onClose() : setStep("topic")} type="button">
                {initialSubject ? "Cancel" : "Back"}
              </button>
              <button className={buttonClass("primary")} disabled={busy} onClick={() => void handleMaterialsContinue()} type="button">
                {uploading ? "Uploading..." : "Continue"}
              </button>
            </div>
          </>
        )}

        {step === "method" && (
          <>
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
                <span>When you're trying to solve something, you get a nudge, not the answer.</span>
              </div>
              <div className="method-card">
                <strong>Grounded in your material</strong>
                <span>Uploaded readings are quoted directly when relevant, not paraphrased.</span>
              </div>
            </div>

            <div className="flow-summary">
              <span>{subject}</span>
            </div>

            {error ? <p className="error-text">{error}</p> : null}

            <div className="flow-actions">
              <button className={buttonClass("secondary")} disabled={busy} onClick={() => setStep("materials")} type="button">Back</button>
              <button className={buttonClass("primary")} disabled={busy} onClick={() => startMutation.mutate()} type="button">
                {startMutation.isPending ? "Creating..." : "Start subject"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
