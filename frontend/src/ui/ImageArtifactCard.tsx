import type { ImageData } from "../types";

interface Props {
  image: ImageData;
  onSave?: (image: ImageData) => void;
  saved?: boolean;
}

export function ImageArtifactCard({ image, onSave, saved }: Props) {
  return (
    <figure className="image-artifact-card">
      <a
        className="image-artifact-media"
        href={image.source_url}
        rel="noreferrer"
        target="_blank"
      >
        <img alt={image.caption || image.query} src={image.image_url} />
      </a>
      <figcaption className="image-artifact-body">
        <div className="image-artifact-header">
          <div className="image-artifact-caption">{image.caption}</div>
          {onSave && (
            <button
              className={`image-artifact-save${saved ? " saved" : ""}`}
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
        <div className="image-artifact-attribution">
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
