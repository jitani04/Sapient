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
    <div className="resource-card relative flex max-w-[600px] gap-[0.85rem] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] px-[0.9rem] py-3">
      {resource.thumbnail_url && (
        <a
          className="group relative block w-[140px] flex-shrink-0 overflow-hidden rounded-lg bg-[var(--panel-bg)]"
          href={resource.url}
          rel="noreferrer"
          target="_blank"
        >
          <img
            alt={resource.title}
            src={resource.thumbnail_url}
            className="block aspect-video w-full object-cover"
          />
          {isVideo && (
            <span
              className="absolute inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.25)] text-white transition-colors group-hover:bg-[rgba(0,0,0,0.4)]"
              aria-hidden
            >
              <Play size={20} strokeWidth={2} fill="currentColor" />
            </span>
          )}
        </a>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-[0.3rem]">
        <div className="flex items-center gap-[0.35rem] text-[0.7rem] uppercase tracking-[0.04em] text-[var(--text-muted)]">
          <Icon size={12} strokeWidth={2} />
          <span>{isVideo ? "Video" : "Article"}</span>
          <span className="opacity-50">·</span>
          <span>{hostname}</span>
        </div>
        <a
          className="inline-flex items-baseline gap-[0.3rem] text-[0.92rem] font-semibold leading-[1.3] text-[var(--text-main)] no-underline hover:text-[var(--accent)] hover:underline"
          href={resource.url}
          rel="noreferrer"
          target="_blank"
        >
          {resource.title}
          <ExternalLink size={12} strokeWidth={2} className="flex-shrink-0 opacity-50" />
        </a>
        {reason && (
          <div className="text-[0.82rem] italic text-[var(--accent-dark)]">{reason}</div>
        )}
        {resource.snippet && (
          <div className="line-clamp-2 text-[0.8rem] leading-[1.4] text-[var(--text-muted)]">
            {resource.snippet}
          </div>
        )}
      </div>
      {onDelete && (
        <button
          className="absolute right-[0.45rem] top-[0.45rem] cursor-pointer appearance-none rounded border-none bg-transparent p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-dim)] hover:text-[var(--text-main)]"
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
