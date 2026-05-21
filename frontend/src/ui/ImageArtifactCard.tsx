import type { ImageData } from "../types";

interface Props {
  image: ImageData;
  onSave?: (image: ImageData) => void;
  saved?: boolean;
}

export function ImageArtifactCard({ image, onSave, saved }: Props) {
  const saveButtonClasses = [
    "inline-flex flex-shrink-0 cursor-pointer items-center gap-[0.3rem] whitespace-nowrap rounded-[5px] border px-2 py-[0.2rem] text-[0.72rem] font-semibold transition-colors",
    saved
      ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
      : "border-[var(--panel-border)] bg-transparent text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]",
  ].join(" ");

  return (
    <figure className="image-artifact-card m-0 max-w-[540px] overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--surface)]">
      <a
        className="block bg-[var(--panel-bg)]"
        href={image.source_url}
        rel="noreferrer"
        target="_blank"
      >
        <img
          alt={image.caption || image.query}
          src={image.image_url}
          className="block aspect-video w-full object-cover"
        />
      </a>
      <figcaption className="px-[0.875rem] pb-[0.78rem] pt-[0.72rem]">
        <div className="flex items-start justify-between gap-2">
          <div className="text-[0.84rem] font-bold leading-[1.4] text-[var(--text-main)]">{image.caption}</div>
          {onSave && (
            <button
              className={saveButtonClasses}
              onClick={() => onSave(image)}
              type="button"
              title={saved ? "Saved to notes" : "Save to notes"}
            >
              <svg fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" height="14" viewBox="0 0 24 24" width="14" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              {saved ? "Saved" : "Save"}
            </button>
          )}
        </div>
        <div className="mt-[0.28rem] text-[0.72rem] leading-[1.4] text-[var(--text-muted)] [&_a:hover]:underline [&_a]:font-bold [&_a]:text-[var(--accent-dark)] [&_a]:no-underline">
          Image from{" "}
          <a href={image.source_url} rel="noreferrer" target="_blank">
            {image.source}
          </a>
          {image.creator && (
            <>
              {" "}by{" "}
              {image.creator_url ? (
                <a href={image.creator_url} rel="noreferrer" target="_blank">
                  {image.creator}
                </a>
              ) : (
                <span>{image.creator}</span>
              )}
            </>
          )}
          {image.license && (
            <>
              {" "}·{" "}
              {image.license_url ? (
                <a href={image.license_url} rel="noreferrer" target="_blank">
                  {image.license}
                </a>
              ) : (
                <span>{image.license}</span>
              )}
            </>
          )}
        </div>
      </figcaption>
    </figure>
  );
}
