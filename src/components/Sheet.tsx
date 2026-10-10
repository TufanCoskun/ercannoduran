"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "./Icons";

/** Bottom sheet on mobile, centered dialog on desktop. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
  light,
  label,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** Light scrim + shorter panel: keeps the playing video visible behind the sheet. */
  light?: boolean;
  /** Accessible name when there is no visible title. */
  label?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.activeElement as HTMLElement | null;
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label ?? (typeof title === "string" ? title : undefined)}>
      <button
        type="button"
        aria-label="Kapat"
        className={`animate-fade-in absolute inset-0 ${light ? "bg-black/25" : "bg-black/70 backdrop-blur-sm"}`}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`animate-sheet-in sm:animate-fade-in relative ${light ? "max-h-[72dvh]" : "max-h-[88dvh]"} w-full overflow-y-auto rounded-t-3xl border border-line bg-ink-2/95 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl outline-none backdrop-blur-xl thin-scrollbar sm:rounded-3xl ${wide ? "sm:max-w-xl" : "sm:max-w-md"}`}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15 sm:hidden" />
        {title !== undefined && (
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 place-items-center rounded-full bg-white/5 text-zinc-300 hover:bg-white/10"
              aria-label="Kapat"
            >
              <XIcon size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
