import type { ImageData } from "../types";

interface Props {
  image: ImageData;
}

export function ImageArtifactCard({ image }: Props) {
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
        <div className="image-artifact-caption">{image.caption}</div>
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
