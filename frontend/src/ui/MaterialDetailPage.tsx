import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { deleteMaterial, getMaterialPreviewUrl, listConversations, listMaterials } from "../api";
import { normalizeSubject } from "../subjects";
import { MarkdownText } from "./MarkdownText";

function isMarkdownMime(mime: string): boolean {
  const lower = mime.toLowerCase();
  return lower.startsWith("text/markdown") || lower === "text/x-markdown";
}

function isPlainTextMime(mime: string): boolean {
  return mime.toLowerCase().startsWith("text/") && !isMarkdownMime(mime);
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

function getFirstUserMessage(messages: { role: string; content: string }[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();
  if (!firstUserMessage) return "Untitled study session";
  return firstUserMessage.length > 88 ? `${firstUserMessage.slice(0, 88)}...` : firstUserMessage;
}

export function MaterialDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { materialId, subject } = useParams<{ materialId: string; subject: string }>();
  const decodedSubject = decodeURIComponent(subject ?? "");
  const parsedMaterialId = Number(materialId);
  const projectMaterialsPath = decodedSubject
    ? `/projects/${encodeURIComponent(decodedSubject)}/materials`
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

  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteMaterial(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["materials", decodedSubject] });
      navigate(projectMaterialsPath);
    },
  });

  const relatedConversations = (conversationsQuery.data ?? [])
    .filter((conversation) => {
      if (!material?.subject) return conversation.subject === null;
      return normalizeSubject(conversation.subject) === normalizeSubject(material.subject);
    })
    .sort((a, b) => b.id - a.id)
    .slice(0, 6);

  const statusClass: Record<string, string> = {
    ready: "pill-green",
    processing: "pill-blue",
    failed: "pill-red",
  };

  if (!Number.isInteger(parsedMaterialId) || parsedMaterialId <= 0) {
    return (
      <div className="page-shell">
        <div className="empty-state">
          <div className="empty-state-icon">?</div>
          <h3>Material not found</h3>
          <p>This material link is not valid.</p>
          <Link className="button button-primary" to={projectMaterialsPath}>Back to materials</Link>
        </div>
      </div>
    );
  }

  if (materialsQuery.isLoading) {
    return (
      <div className="page-shell">
        <p className="muted">Loading material...</p>
      </div>
    );
  }

  if (!material) {
    return (
      <div className="page-shell">
        <div className="empty-state">
          <div className="empty-state-icon">?</div>
          <h3>Material not found</h3>
          <p>It may have been deleted, or you may not have access to it.</p>
          <Link className="button button-primary" to={projectMaterialsPath}>Back to materials</Link>
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
          className="button button-secondary"
          disabled={deleteMutation.isPending}
          onClick={() => void deleteMutation.mutateAsync(material.id)}
          type="button"
        >
          {deleteMutation.isPending ? "Deleting..." : "Delete"}
        </button>
      </div>

      <div className="material-detail-grid">
        <div className="content-card material-detail-main">
          <div className="content-card-title">File status</div>
          <div className="material-detail-status">
            <span className={`pill ${statusClass[material.status] ?? "pill-gray"}`}>
              {material.status}
            </span>
            {material.status === "processing" ? (
              <p className="settings-copy">Sapient is still reading and indexing this file.</p>
            ) : null}
            {material.status === "ready" ? (
              <p className="settings-copy">This file is ready to ground tutor answers and source retrieval.</p>
            ) : null}
            {material.status === "failed" ? (
              <p className="error-text">{material.error_message ?? "Processing failed."}</p>
            ) : null}
          </div>
        </div>

        <div className="content-card">
          <div className="content-card-title">Details</div>
          <div className="settings-row">
            <span>Subject</span>
            <strong>{material.subject ?? "General"}</strong>
          </div>
          <div className="settings-row">
            <span>Type</span>
            <strong>{material.mime_type}</strong>
          </div>
          <div className="settings-row">
            <span>Uploaded</span>
            <strong>{formatDateTime(material.created_at)}</strong>
          </div>
          <div className="settings-row">
            <span>Processed</span>
            <strong>{formatDateTime(material.processed_at)}</strong>
          </div>
          <div className="settings-row">
            <span>Material ID</span>
            <strong>#{material.id}</strong>
          </div>
          {material.subject ? (
            <div className="settings-actions">
              <Link className="button button-secondary" to={`/projects/${encodeURIComponent(material.subject)}`}>
                Open subject
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      {isReady ? (
        <div className="content-card">
          <div className="content-card-title">Preview</div>
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
              ) : (
                <iframe
                  key={previewQuery.data.url}
                  src={previewQuery.data.url}
                  title={`Preview of ${material.filename}`}
                  style={{ width: "100%", height: "70vh", border: "1px solid var(--border, #e2e2e2)", borderRadius: "8px", background: "#fff" }}
                />
              )}
              <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                <a className="button button-secondary" href={previewQuery.data.url} target="_blank" rel="noreferrer">
                  Open in new tab
                </a>
                <a
                  className="button button-secondary"
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

      <div className="content-card">
        <div className="content-card-title">Related study sessions</div>
        {conversationsQuery.isLoading ? <p className="muted">Loading study sessions...</p> : null}
        {!conversationsQuery.isLoading && relatedConversations.length === 0 ? (
          <p className="muted">No study sessions are tagged with this material&apos;s subject yet.</p>
        ) : null}
        <div className="material-related-list">
          {relatedConversations.map((conversation) => (
            <Link className="material-related-row" key={conversation.id} to={`/sessions/${conversation.id}`}>
              <span>{getFirstUserMessage(conversation.messages)}</span>
              <small>{conversation.subject ?? "General"} · Study session #{conversation.id}</small>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
