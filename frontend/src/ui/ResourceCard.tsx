import { ExternalLink, Play, BookOpen, X } from "lucide-react";

import type { Resource, ResourceData } from "../types";

type ResourceLike = Resource | (ResourceData & { reason?: string | null });

interface Props {
  resource: ResourceLike;
  onDelete?: (id: number) => void;
  showReason?: boolean;
}

export function ResourceCard({ resource, onDelete, showReason = true }: Props) {
  const isVideo = resource.kind === "video";
  const Icon = isVideo ? Play : BookOpen;
  const hostname = (() => {
    try {
      return new URL(resource.url).hostname.replace(/^www\./, "");
    } catch {
      return resource.url;
    }
  })();
  const reason = showReason && "reason" in resource && resource.reason ? resource.reason : null;

  return (
    <div className={`resource-card resource-${resource.kind}`}>
      {resource.thumbnail_url && (
        <a
          className="resource-thumb"
          href={resource.url}
          rel="noreferrer"
          target="_blank"
        >
          <img alt={resource.title} src={resource.thumbnail_url} />
          {isVideo && (
            <span className="resource-thumb-play" aria-hidden>
              <Play size={20} strokeWidth={2} fill="currentColor" />
            </span>
          )}
        </a>
      )}
      <div className="resource-body">
        <div className="resource-meta">
          <Icon size={12} strokeWidth={2} />
          <span>{isVideo ? "Video" : "Article"}</span>
          <span className="resource-meta-sep">·</span>
          <span>{hostname}</span>
        </div>
        <a className="resource-title" href={resource.url} rel="noreferrer" target="_blank">
          {resource.title}
          <ExternalLink size={12} strokeWidth={2} />
        </a>
        {reason && <div className="resource-reason">{reason}</div>}
        {resource.snippet && <div className="resource-snippet">{resource.snippet}</div>}
      </div>
      {onDelete && (
        <button
          className="resource-delete"
          onClick={() => onDelete(resource.id)}
          title="Remove from resources"
          type="button"
        >
          <X size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
