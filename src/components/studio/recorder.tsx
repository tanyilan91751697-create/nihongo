'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * MediaRecorder wrapper.
 *
 * Owns the microphone stream and hands back a webm Blob when a take stops.
 * The stream is released on unmount so the browser's recording indicator does
 * not stay lit after leaving the page.
 */
export type RecorderState = 'idle' | 'recording' | 'error';

export function useRecorder(onComplete: (blob: Blob, durationSec: number) => void) {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = streamRef.current ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const duration = (Date.now() - startedAtRef.current) / 1000;
        setState('idle');
        if (blob.size) completeRef.current(blob, duration);
      };
      recorder.start();
      recorderRef.current = recorder;
      setState('recording');
    } catch (err) {
      setState('error');
      setError(
        (err as Error).name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow it in the browser and try again.'
          : (err as Error).message,
      );
    }
  }, []);

  useEffect(
    () => () => {
      recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  return { state, error, start, stop };
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
