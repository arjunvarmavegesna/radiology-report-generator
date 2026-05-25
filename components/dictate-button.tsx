"use client";

import { toast } from "sonner";
import { useDictation } from "@/lib/use-dictation";
import { cn } from "@/lib/utils";

/** Mic button that streams dictated speech into a field via `onAppend`.
 *  Pulses red while recording; toasts a fallback where unsupported. */
export function DictateButton({
  onAppend,
  label = "Dictate",
  className,
}: {
  onAppend: (text: string) => void;
  label?: string;
  className?: string;
}) {
  const { supported, recording, toggle } = useDictation(onAppend);

  function handleClick() {
    if (!supported) {
      toast.error(
        "Voice input isn't supported in this browser — type the notes instead.",
      );
      return;
    }
    toggle();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
        recording
          ? "animate-pulse border-[#FCA5A5] bg-[#FEE2E2] text-[#7F1D1D]"
          : "border-border bg-secondary text-primary hover:bg-accent",
        className,
      )}
    >
      <span aria-hidden>{"\u{1F3A4}"}</span>
      {recording ? "Stop recording" : label}
    </button>
  );
}
