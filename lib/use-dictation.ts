"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web Speech API dictation hook. The Speech Recognition types aren't in the
 * default DOM lib, so a minimal shape is declared here. `onAppend` is called
 * with each finalized chunk of transcript (interim results are not pushed, to
 * avoid flicker in the bound textarea). Degrades gracefully where unsupported.
 */
interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEvent {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechResult };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation(onAppend: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const onAppendRef = useRef(onAppend);
  onAppendRef.current = onAppend;

  useEffect(() => {
    setSupported(getCtor() !== null);
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const toggle = useCallback(() => {
    if (recording) {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-IN";
    rec.onresult = (e) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += `${r[0].transcript} `;
      }
      if (finalText.trim()) onAppendRef.current(finalText.trim());
    };
    rec.onerror = (ev) => {
      // "no-speech"/"aborted" are normal pauses — ignore silently.
      if (ev.error === "no-speech" || ev.error === "aborted") return;
    };
    rec.onend = () => {
      setRecording(false);
      recRef.current = null;
    };
    recRef.current = rec;
    try {
      rec.start();
      setRecording(true);
    } catch {
      setRecording(false);
    }
  }, [recording]);

  return { supported, recording, toggle };
}
