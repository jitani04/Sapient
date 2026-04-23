import { ReactNode } from "react";

type MarkdownSegment =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "code"; value: string };

function pushText(segments: MarkdownSegment[], value: string) {
  if (!value) return;
  const last = segments.at(-1);
  if (last?.type === "text") {
    last.value += value;
    return;
  }
  segments.push({ type: "text", value });
}

function parseInlineMarkdown(input: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let index = 0;

  while (index < input.length) {
    if (input.startsWith("**", index)) {
      const end = input.indexOf("**", index + 2);
      if (end > index + 2) {
        segments.push({ type: "strong", value: input.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }

    if (input[index] === "`") {
      const end = input.indexOf("`", index + 1);
      if (end > index + 1) {
        segments.push({ type: "code", value: input.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    pushText(segments, input[index]);
    index += 1;
  }

  return segments;
}

export function MarkdownText({ children, className }: { children: string; className?: string }) {
  const nodes: ReactNode[] = parseInlineMarkdown(children).map((segment, index) => {
    if (segment.type === "strong") {
      return <strong key={index}>{segment.value}</strong>;
    }
    if (segment.type === "code") {
      return <code className="msg-inline-code" key={index}>{segment.value}</code>;
    }
    return segment.value;
  });

  return <div className={className}>{nodes}</div>;
}
