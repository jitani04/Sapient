import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  RateLimitError,
  generateMindMap,
  getProjectProfile,
  searchProjectCoverImages,
  setupProject,
  uploadProjectCoverImage,
} from "../api";
import type { ProjectCoverImageOption } from "../types";
import { buttonClass } from "./buttonClass";

const LEVELS = [
  { value: "beginner", label: "Complete beginner", description: "Little to no prior experience" },
  { value: "some", label: "Some experience", description: "I know the basics but have gaps" },
  { value: "intermediate", label: "Intermediate", description: "Comfortable with the fundamentals" },
  { value: "advanced", label: "Advanced", description: "Looking to go deeper or fill edge cases" },
];

export function ProjectSetupPage() {
  const { subject } = useParams<{ subject: string }>();
  const [searchParams] = useSearchParams();
  const decoded = decodeURIComponent(subject ?? "");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [level, setLevel] = useState<string | null>(null);
  const [goals, setGoals] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [coverImageStorageKey, setCoverImageStorageKey] = useState<string | null>(null);
  const [coverImageSource, setCoverImageSource] = useState<string | null>(null);
  const [coverImageSourceUrl, setCoverImageSourceUrl] = useState<string | null>(null);
  const [coverImagePhotographer, setCoverImagePhotographer] = useState<string | null>(null);
  const [coverImagePhotographerUrl, setCoverImagePhotographerUrl] = useState<string | null>(null);
  const [coverSearchQuery, setCoverSearchQuery] = useState("");
  const [coverSearchResults, setCoverSearchResults] = useState<ProjectCoverImageOption[]>([]);
  const [coverSearchError, setCoverSearchError] = useState<string | null>(null);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const sessionId = searchParams.get("session");
  const destination = sessionId ? `/sessions/${sessionId}` : `/projects/${encodeURIComponent(decoded)}`;

  const { data: profile } = useQuery({
    queryKey: ["project-profile", decoded],
    queryFn: () => getProjectProfile(decoded),
    enabled: Boolean(decoded),
  });

  useEffect(() => {
    if (!profile || hydrated) return;
    setLevel(profile.level);
    setGoals(profile.goals ?? "");
    setCoverImageUrl(profile.cover_image_url ?? "");
    setCoverImageStorageKey(profile.cover_image_storage_key ?? null);
    setCoverImageSource(profile.cover_image_source ?? null);
    setCoverImageSourceUrl(profile.cover_image_source_url ?? null);
    setCoverImagePhotographer(profile.cover_image_photographer ?? null);
    setCoverImagePhotographerUrl(profile.cover_image_photographer_url ?? null);
    setCoverSearchQuery(profile.subject);
    setHydrated(true);
  }, [profile, hydrated]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (hydrated) return;
    setCoverSearchQuery(decoded);
  }, [decoded, hydrated]);

  const coverSearchMutation = useMutation({
    mutationFn: async () => searchProjectCoverImages(coverSearchQuery.trim() || decoded),
    onSuccess: (results) => {
      setCoverSearchResults(results);
      setCoverSearchError(results.length === 0 ? "No images found for that search." : null);
    },
    onError: (err) => {
      setCoverSearchResults([]);
      setCoverSearchError(err instanceof Error ? err.message : "Image search failed.");
    },
  });

  const coverUploadMutation = useMutation({
    mutationFn: async (file: File) => uploadProjectCoverImage(file),
    onSuccess: (result) => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = result.cover_image_url;
      setCoverImageUrl(result.cover_image_url);
      setCoverImageStorageKey(result.storage_key);
      setCoverImageSource("upload");
      setCoverImageSourceUrl(null);
      setCoverImagePhotographer(null);
      setCoverImagePhotographerUrl(null);
      setCoverUploadError(null);
    },
    onError: (err) => {
      setCoverUploadError(err instanceof Error ? err.message : "Image upload failed.");
    },
  });

  const setupMutation = useMutation({
    mutationFn: async () => {
      const trimmedGoals = goals.trim() || null;
      const trimmedCoverImageUrl = coverImageStorageKey ? null : (coverImageUrl.trim() || null);
      const levelChanged = (profile?.level ?? null) !== level;
      const goalsChanged = (profile?.goals ?? null) !== trimmedGoals;

      await setupProject(
        decoded,
        level,
        trimmedGoals,
        trimmedCoverImageUrl,
        coverImageStorageKey,
        trimmedCoverImageUrl ? coverImageSource : null,
        trimmedCoverImageUrl ? coverImageSourceUrl : null,
        trimmedCoverImageUrl ? coverImagePhotographer : null,
        trimmedCoverImageUrl ? coverImagePhotographerUrl : null,
      );

      let mindmapError: string | null = null;
      if (!profile?.mind_map || levelChanged || goalsChanged) {
        try {
          const updatedProfile = await generateMindMap(decoded);
          queryClient.setQueryData(["project-profile", decoded], updatedProfile);
        } catch (err) {
          if (err instanceof RateLimitError) {
            mindmapError = `AI is rate-limited (retry in ~${err.retryAfterSeconds}s).`;
          } else {
            mindmapError = err instanceof Error ? err.message : "Mind map generation failed.";
          }
        }
      }
      return { mindmapError };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["project-profile", decoded] });
      await queryClient.invalidateQueries({ queryKey: ["project-profiles"] });
      if (result?.mindmapError) {
        const params = new URLSearchParams();
        params.set("warning", "mindmap_unavailable");
        const sep = destination.includes("?") ? "&" : "?";
        navigate(`${destination}${sep}${params.toString()}`, { replace: true });
      } else {
        navigate(destination, { replace: true });
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Something went wrong. You can still continue to the subject."),
  });

  function handleSkip() {
    navigate(destination, { replace: true });
  }

  function handleCoverFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setCoverUploadError("Please choose a JPEG, PNG, WebP, or GIF image.");
      return;
    }
    coverUploadMutation.mutate(file);
  }

  function handleClearCoverImage() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setCoverImageUrl("");
    setCoverImageStorageKey(null);
    setCoverImageSource(null);
    setCoverImageSourceUrl(null);
    setCoverImagePhotographer(null);
    setCoverImagePhotographerUrl(null);
    setCoverUploadError(null);
  }

  function handleSelectCoverImage(option: ProjectCoverImageOption) {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setCoverImageUrl(option.image_url);
    setCoverImageStorageKey(null);
    setCoverImageSource(option.source);
    setCoverImageSourceUrl(option.source_url);
    setCoverImagePhotographer(option.photographer);
    setCoverImagePhotographerUrl(option.photographer_url);
    setCoverUploadError(null);
  }

  return (
    <div className="flow-page">
      <div className="flow-card setup-card">
        <div className="setup-agent-bubble">
          <div className="setup-agent-avatar">KP</div>
          <div className="setup-agent-text">
            <p>
              Before we dive into <strong>{decoded}</strong>, I'd love to understand where you're
              starting from and what you're hoping to achieve. This helps me pitch the right level
              of questions and build a learning map for you.
            </p>
          </div>
        </div>

        <div className="setup-question">
          <div className="setup-question-label">What's your current level with {decoded}?</div>
          <div className="setup-level-grid">
            {LEVELS.map((l) => (
              <button
                key={l.value}
                className={`setup-level-option ${level === l.value ? "selected" : ""}`}
                onClick={() => setLevel(l.value)}
                type="button"
              >
                <span className="setup-level-label">{l.label}</span>
                <span className="setup-level-desc">{l.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="setup-question">
          <div className="setup-question-label">What are your goals for this subject?</div>
          <textarea
            className="setup-textarea"
            placeholder={`e.g. "Prepare for my database exam", "Build a study plan", "Fill gaps in my knowledge"`}
            rows={3}
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
          />
        </div>

        <div className="setup-question">
          <div className="setup-question-label">Dashboard cover image</div>
          <div className="setup-cover-field">
            {coverImageUrl.trim() ? (
              <img
                src={coverImageUrl.trim()}
                alt={`${decoded} cover preview`}
                className="setup-cover-preview"
              />
            ) : (
              <div className="setup-cover-placeholder">No custom cover yet</div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={handleCoverFileChange}
            />
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className={buttonClass("secondary")}
                disabled={coverUploadMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {coverUploadMutation.isPending
                  ? "Uploading…"
                  : coverImageUrl.trim()
                  ? "Replace image"
                  : "Upload image"}
              </button>
              {coverImageUrl.trim() && (
                <button
                  type="button"
                  className={buttonClass("secondary")}
                  onClick={handleClearCoverImage}
                  disabled={coverUploadMutation.isPending}
                >
                  Remove
                </button>
              )}
            </div>
            {coverUploadError && <p className="error-text">{coverUploadError}</p>}
            <p className="setup-cover-help">
              Upload a JPEG, PNG, WebP, or GIF (max 5 MB), or pick from Pexels below.
            </p>
            <div className="setup-cover-search">
              <div className="setup-cover-search-row">
                <input
                  className="form-input"
                  placeholder={`Search Pexels for ${decoded}`}
                  value={coverSearchQuery}
                  onChange={(e) => setCoverSearchQuery(e.target.value)}
                />
                <button
                  className={buttonClass("secondary")}
                  disabled={coverSearchMutation.isPending || !(coverSearchQuery.trim() || decoded)}
                  onClick={() => coverSearchMutation.mutate()}
                  type="button"
                >
                  {coverSearchMutation.isPending ? "Searching…" : "Search Pexels"}
                </button>
              </div>
              <p className="setup-cover-help">
                Pexels requires attribution when possible. Selected images keep source metadata with the subject.
              </p>
              {coverSearchError && <p className="error-text">{coverSearchError}</p>}
              {coverSearchResults.length > 0 && (
                <div className="setup-cover-results">
                  {coverSearchResults.map((option) => {
                    const isSelected = coverImageUrl === option.image_url;
                    return (
                      <div key={option.id} className={`setup-cover-result ${isSelected ? "selected" : ""}`}>
                        <img src={option.thumbnail_url} alt="" className="setup-cover-result-image" />
                        <div className="setup-cover-result-body">
                          <span className="setup-cover-result-source">{option.source}</span>
                          <span className="setup-cover-result-credit">Photo by {option.photographer}</span>
                          <span className="setup-cover-result-links">
                            <a href={option.photographer_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                              Photographer
                            </a>
                            <a href={option.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                              Photo page
                            </a>
                          </span>
                          <button
                            type="button"
                            className={buttonClass("secondary", "setup-cover-result-select")}
                            onClick={() => handleSelectCoverImage(option)}
                          >
                            {isSelected ? "Selected" : "Use image"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="flow-actions">
          <button className={buttonClass("secondary")} onClick={handleSkip} type="button">
            Skip for now
          </button>
          <button
            className={buttonClass("primary")}
            disabled={setupMutation.isPending || (!level && !goals.trim() && !coverImageUrl.trim())}
            onClick={() => setupMutation.mutate()}
            type="button"
          >
            {setupMutation.isPending ? "Setting up…" : "Set up subject"}
          </button>
        </div>
      </div>
    </div>
  );
}
