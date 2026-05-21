import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileQuestion } from "lucide-react";

import { deleteMaterial, getMaterialExtractedText, getMaterialPreviewUrl, listMaterials } from "../api";
import { MarkdownText } from "./MarkdownText";
import { buttonClass } from "./buttonClass";

function isMarkdownMime(mime: string): boolean {
  const lower = mime.toLowerCase();
  return lower.startsWith("text/markdown") || lower === "text/x-markdown";
}

function isPlainTextMime(mime: string): boolean {
  return mime.toLowerCase().startsWith("text/") && !isMarkdownMime(mime);
}

function isIframePreviewable(mime: string): boolean {
  const lower = mime.toLowerCase();
  return lower === "application/pdf" || lower.startsWith("image/");
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MaterialDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { materialId, subject } = useParams<{ materialId: string; subject: string }>();
  const decodedSubject = decodeURIComponent(subject ?? "");
  const parsedMaterialId = Number(materialId);
  const projectMaterialsPath = decodedSubject
    ? `/projects/${encodeURIComponent(decodedSubject)}?tab=materials`
    : "/dashboard";

  const materialsQuery = useQuery({
    queryKey: ["materials", decodedSubject],
    queryFn: () => listMaterials(decodedSubject),
    enabled: Boolean(decodedSubject),
    refetchInterval: (q) =>
      q.state.data?.some((material) => material.status === "processing") ? 3000 : false,
  });

  const material = materialsQuery.data?.find((item) => item.id === parsedMaterialId);
  const isReady = material?.status === "ready";

  const previewQuery = useQuery({
    queryKey: ["material-preview", parsedMaterialId],
    queryFn: () => getMaterialPreviewUrl(parsedMaterialId),
    enabled: isReady && Number.isInteger(parsedMaterialId) && parsedMaterialId > 0,
    refetchInterval: (q) => {
      const expiresIn = q.state.data?.expires_in;
      if (!expiresIn) return false;
      return Math.max(60_000, (expiresIn - 60) * 1000);
    },
    staleTime: 30_000,
  });

  const previewMime = previewQuery.data?.mime_type ?? material?.mime_type ?? "";
  const isTextPreview = isMarkdownMime(previewMime) || isPlainTextMime(previewMime);
  const needsExtractedText = isReady && !isTextPreview && !isIframePreviewable(previewMime);
  const extractedTextQuery = useQuery({
    queryKey: ["material-extracted-text", parsedMaterialId],
    enabled: needsExtractedText,
    staleTime: 60_000,
    queryFn: () => getMaterialExtractedText(parsedMaterialId),
  });
  const textContentQuery = useQuery({
    queryKey: ["material-preview-text", parsedMaterialId, previewQuery.data?.url],
    enabled: Boolean(previewQuery.data?.url) && isTextPreview,
    staleTime: 30_000,
    queryFn: async () => {
      const resp = await fetch(previewQuery.data!.url);
      if (!resp.ok) throw new Error(`Could not load file (${resp.status}).`);
      return resp.text();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteMaterial(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["materials", decodedSubject] });
      navigate(projectMaterialsPath);
    },
  });

  if (!Number.isInteger(parsedMaterialId) || parsedMaterialId <= 0) {
    return (
      <div className="page-shell">
        <div className="empty-state">
          <div className="empty-state-icon"><FileQuestion size={26} strokeWidth={1.6} /></div>
          <h3>Material not found</h3>
          <p>This material link is not valid.</p>
          <Link className={buttonClass("primary")} to={projectMaterialsPath}>Back to materials</Link>
        </div>
      </div>
    );
  }

  if (materialsQuery.isLoading) {
    return (
      <div className="page-shell">
        <p className="muted">Loading material…</p>
      </div>
    );
  }

  if (!material) {
    return (
      <div className="page-shell">
        <div className="empty-state">
          <div className="empty-state-icon"><FileQuestion size={26} strokeWidth={1.6} /></div>
          <h3>Material not found</h3>
          <p>It may have been deleted, or you may not have access to it.</p>
          <Link className={buttonClass("primary")} to={projectMaterialsPath}>Back to materials</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-text">
          <Link className="text-link page-back-link" to={projectMaterialsPath}>Back to materials</Link>
          <h1 className="page-title">{material.filename}</h1>
          <p className="page-subtitle">
            {material.subject ?? "General"} material uploaded on {formatDateTime(material.created_at)}.
          </p>
        </div>
        <button
          className={buttonClass("secondary")}
          disabled={deleteMutation.isPending}
          onClick={() => void deleteMutation.mutateAsync(material.id)}
          type="button"
        >
          {deleteMutation.isPending ? "Deleting…" : "Delete"}
        </button>
      </div>

      {material.status === "processing" ? (
        <p className="muted">Sapient is still reading and indexing this file.</p>
      ) : null}
      {material.status === "failed" ? (
        <p className="error-text">{material.error_message ?? "Processing failed."}</p>
      ) : null}

      {isReady ? (
        <div className="content-card">
          {previewQuery.isLoading ? <p className="muted">Loading preview...</p> : null}
          {previewQuery.isError ? (
            <p className="error-text">Could not load preview. {(previewQuery.error as Error)?.message ?? ""}</p>
          ) : null}
          {previewQuery.data ? (
            <div className="material-preview-frame">
              {isTextPreview ? (
                <div
                  style={{
                    width: "100%",
                    maxHeight: "70vh",
                    overflow: "auto",
                    border: "1px solid var(--border, #e2e2e2)",
                    borderRadius: "8px",
                    background: "#fff",
                    padding: "1rem 1.25rem",
                  }}
                >
                  {textContentQuery.isLoading ? (
                    <p className="muted">Loading file...</p>
                  ) : textContentQuery.isError ? (
                    <p className="error-text">
                      Could not load file. {(textContentQuery.error as Error)?.message ?? ""}
                    </p>
                  ) : isMarkdownMime(previewMime) ? (
                    <MarkdownText className="markdown-body">{textContentQuery.data ?? ""}</MarkdownText>
                  ) : (
                    <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                      {textContentQuery.data ?? ""}
                    </pre>
                  )}
                </div>
              ) : isIframePreviewable(previewMime) ? (
                <iframe
                  key={previewQuery.data.url}
                  src={previewQuery.data.url}
                  title={`Preview of ${material.filename}`}
                  style={{ width: "100%", height: "70vh", border: "1px solid var(--border, #e2e2e2)", borderRadius: "8px", background: "#fff" }}
                />
              ) : (
                <div className="material-extracted-preview">
                  {extractedTextQuery.isLoading ? (
                    <p className="muted">Loading extracted text…</p>
                  ) : extractedTextQuery.isError ? (
                    <p className="error-text">
                      Could not load extracted text. {(extractedTextQuery.error as Error)?.message ?? ""}
                    </p>
                  ) : extractedTextQuery.data && extractedTextQuery.data.chunks.length === 0 ? (
                    <p className="muted">No text was extracted from this file.</p>
                  ) : (
                    <div className="material-extracted-body">
                      {(extractedTextQuery.data?.chunks ?? []).map((chunk, idx) => (
                        <section key={idx} className="material-extracted-chunk">
                          {chunk.page_number != null && (
                            <div className="material-extracted-page">Page {chunk.page_number}</div>
                          )}
                          <p>{chunk.content}</p>
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                <a className={buttonClass("secondary")} href={previewQuery.data.url} target="_blank" rel="noreferrer">
                  Open in new tab
                </a>
                <a
                  className={buttonClass("secondary")}
                  href={previewQuery.data.url}
                  download={material.filename}
                >
                  Download
                </a>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
