import { useCallback, useEffect, useRef, useState } from 'react';

/** Text-to-speech with sentence-level control (pause/resume/repeat/speed). Uses the browser's built-in voices. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!؟?!:؛\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export function useSpeech(lang: 'ar' | 'en', rate: number, voiceName: string | null) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [index, setIndex] = useState(0);
  const queue = useRef<string[]>([]);
  const idx = useRef(0);
  const rateRef = useRef(rate);
  const started = useRef<number>(0);
  const onDone = useRef<((seconds: number) => void) | null>(null);
  rateRef.current = rate;

  const pickVoice = useCallback(() => {
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => v.name === voiceName) ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang)) ?? null;
  }, [lang, voiceName]);

  const speakAt = useCallback(
    (i: number) => {
      if (!supported) return;
      window.speechSynthesis.cancel();
      if (i >= queue.current.length) {
        setState('idle');
        onDone.current?.((Date.now() - started.current) / 1000);
        return;
      }
      idx.current = i;
      setIndex(i);
      const u = new SpeechSynthesisUtterance(queue.current[i]);
      u.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = rateRef.current;
      u.onend = () => {
        if (idx.current === i) speakAt(i + 1);
      };
      window.speechSynthesis.speak(u);
      setState('playing');
    },
    [lang, pickVoice, supported],
  );

  const play = useCallback(
    (text: string, done?: (seconds: number) => void) => {
      queue.current = splitSentences(text);
      onDone.current = done ?? null;
      started.current = Date.now();
      speakAt(0);
    },
    [speakAt],
  );
  const pause = () => {
    window.speechSynthesis.pause();
    setState('paused');
  };
  const resume = () => {
    window.speechSynthesis.resume();
    setState('playing');
  };
  const stop = useCallback(() => {
    if (!supported) return;
    idx.current = -1;
    window.speechSynthesis.cancel();
    setState('idle');
  }, [supported]);
  const repeat = () => speakAt(Math.max(0, idx.current));
  const back = () => speakAt(Math.max(0, idx.current - 1));

  useEffect(() => () => stop(), [stop]);
  return { supported, state, index, total: queue.current.length, current: queue.current[index] ?? '', play, pause, resume, stop, repeat, back };
}

/** Speech recognition (dictation / voice commands). */
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: (e: any) => void; onend: () => void; onerror: (e: any) => void };

export function useDictation(lang: 'ar' | 'en', onFinal: (text: string) => void) {
  const Ctor: (new () => Rec) | undefined = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const rec = useRef<Rec | null>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const start = useCallback(() => {
    if (!Ctor) return false;
    const r = new Ctor();
    r.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e: any) => {
      let fin = '';
      let tmp = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else tmp += e.results[i][0].transcript;
      }
      setInterim(tmp);
      if (fin.trim()) cb.current(fin.trim());
    };
    r.onend = () => {
      setListening(false);
      setInterim('');
    };
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
    return true;
  }, [Ctor, lang]);
  const stop = useCallback(() => rec.current?.stop(), []);
  return { supported: !!Ctor, listening, interim, start, stop };
}
