/**
 * Workspace "persona" — which of the three roles the user is acting as right
 * now. Unlike the legacy Firebase role claim, this is NOT a gate: anyone can
 * switch to any persona (small shared-device clinic). It only drives which tab
 * the role-switcher jumps to. Persisted to localStorage so it survives
 * navigation and reloads.
 */
export type Persona = "typist" | "radiologist" | "print";

export const PERSONAS: { value: Persona; label: string; home: string }[] = [
  { value: "typist", label: "Typist", home: "/capture" },
  { value: "radiologist", label: "Radiologist", home: "/review" },
  { value: "print", label: "Print staff", home: "/queue" },
];

const KEY = "rrg.persona.v1";

function isPersona(v: string | null): v is Persona {
  return v === "typist" || v === "radiologist" || v === "print";
}

export function loadPersona(): Persona {
  if (typeof window === "undefined") return "typist";
  try {
    const v = localStorage.getItem(KEY);
    if (isPersona(v)) return v;
  } catch {
    /* ignore */
  }
  return "typist";
}

export function savePersona(p: Persona): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* ignore */
  }
}

export function personaHome(p: Persona): string {
  return PERSONAS.find((x) => x.value === p)?.home ?? "/capture";
}

export function personaLabel(p: Persona): string {
  return PERSONAS.find((x) => x.value === p)?.label ?? "Typist";
}
