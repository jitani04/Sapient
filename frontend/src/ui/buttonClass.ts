import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-[0.4rem] whitespace-nowrap rounded-lg px-4 py-[0.6rem] text-[0.875rem] font-semibold no-underline transition-[background,transform,box-shadow,border-color] hover:not-disabled:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent-dark)] text-white shadow-[0_2px_8px_rgba(115,147,179,0.22)] hover:not-disabled:bg-[var(--accent)]",
  secondary:
    "border border-[var(--panel-border)] bg-white text-[var(--text-main)] shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:not-disabled:border-[var(--accent)] hover:not-disabled:text-[var(--accent)]",
  ghost:
    "border border-transparent bg-transparent text-[var(--text-soft)] shadow-none hover:not-disabled:bg-[var(--accent-dim)] hover:not-disabled:text-[var(--accent)] hover:not-disabled:translate-y-0",
  danger:
    "border border-[#c0392b] bg-[#c0392b] text-white hover:not-disabled:border-[#a53124] hover:not-disabled:bg-[#a53124]",
};

export function buttonClass(variant: ButtonVariant = "secondary", extra?: string): string {
  return cn(BASE, VARIANTS[variant], extra);
}
