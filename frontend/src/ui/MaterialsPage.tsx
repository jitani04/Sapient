import { ChangeEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { FileText, Upload } from "lucide-react";

import { deleteMaterial, listMaterials, uploadMaterial } from "../api";
import { buttonClass } from "./buttonClass";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

const MATERIAL_ACCEPT = ".pdf,.pptx,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/x-markdown";

export function MaterialsView({ subject }: { subject: string }) {
  const decodedSubject = subject;
  const projectMaterialsPath = `/projects/${encodeURIComponent(decodedSubject)}`;
  const queryClient = useQueryClient();
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const materialsQuery = useQuery({
    queryKey: ["materials", decodedSubject],
    queryFn: () => listMaterials(decodedSubject),
    enabled: Boolean(decodedSubject),
    refetchInterval: (q) =>
      q.state.data?.some((m) => m.status === "processing") ? 3000 : false,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteMaterial(id),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["materials", decodedSubject] }); },
  });

  const materials = materialsQuery.data ?? [];

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploadError(null);
    setUploadingNames(files.map((f) => f.name));
    try {
      await Promise.all(files.map((f) => uploadMaterial(f, decodedSubject)));
      await queryClient.invalidateQueries({ queryKey: ["materials", decodedSubject] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingNames([]);
      e.target.value = "";
    }
  }

  const statusClass: Record<string, string> = {
    ready: "status-dot-ready",
    processing: "status-dot-processing",
    failed: "status-dot-failed",
  };

  return (
    <>
      <div className="content-card">
        <div className="content-card-title">Upload</div>
        <p className="settings-copy" style={{ marginBottom: "0.875rem" }}>
          Uploading here automatically attaches each file to <strong>{decodedSubject}</strong>.
        </p>
        <label className="upload-zone">
          <div className="upload-zone-icon"><Upload size={22} strokeWidth={1.6} /></div>
          <div className="upload-zone-label">Drop files or click to browse</div>
          <div className="upload-zone-sub">PDF, PPTX, DOCX, TXT, MD · max 10 MB each</div>
          <input type="file" multiple accept={MATERIAL_ACCEPT} style={{ display: "none" }} onChange={handleFiles} />
        </label>
        {uploadError ? <p className="error-text" style={{ marginTop: "0.5rem" }}>{uploadError}</p> : null}
      </div>

      <div className="content-card">
        <div className="content-card-title">All materials</div>

        {materialsQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {materialsQuery.isError ? <p className="error-text">Failed to load materials.</p> : null}

        <div className="material-list">
          {uploadingNames.map((name) => (
            <div key={name} className="material-row">
              <div className="material-row-icon"><FileText size={18} strokeWidth={1.6} /></div>
              <div className="material-row-info">
                <div className="material-row-name">{name}</div>
                <div className="material-row-meta">Uploading…</div>
              </div>
              <div className="status-dot status-dot-processing" />
            </div>
          ))}

          {materials.length === 0 && uploadingNames.length === 0 && !materialsQuery.isLoading ? (
            <div className="empty-state empty-state-compact">
              <div className="empty-state-icon"><FileText size={24} strokeWidth={1.6} /></div>
              <h3>No materials yet</h3>
              <p>
                Upload lecture slides, readings, notes, or a syllabus so tutor answers can cite this subject's actual material.
              </p>
              <div className="empty-state-tips" aria-label="Supported material types">
                <span>PDF</span>
                <span>PPTX</span>
                <span>DOCX</span>
                <span>TXT/MD</span>
              </div>
            </div>
          ) : null}

          {materials.map((m) => (
            <div key={m.id} className="material-row">
              <div className="material-row-icon"><FileText size={18} strokeWidth={1.6} /></div>
              <div className="material-row-info">
                <Link className="material-row-name material-row-link" to={`${projectMaterialsPath}/materials/${m.id}`}>
                  {m.filename}
                </Link>
                <div className="material-row-meta">
                  {formatDate(m.created_at)}
                  {m.error_message ? ` · ${m.error_message}` : ""}
                </div>
              </div>
              <div className={`status-dot ${statusClass[m.status] ?? ""}`} />
              <button
                className={buttonClass("secondary")}
                style={{ fontSize: "0.76rem", padding: "0.3rem 0.65rem" }}
                disabled={deleteMutation.isPending}
                onClick={() => void deleteMutation.mutateAsync(m.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function MaterialsPage() {
  const { subject } = useParams<{ subject: string }>();
  const decodedSubject = decodeURIComponent(subject ?? "");
  if (!decodedSubject) {
    return <Navigate replace to="/dashboard" />;
  }
  return <Navigate replace to={`/projects/${encodeURIComponent(decodedSubject)}?tab=materials`} />;
}
