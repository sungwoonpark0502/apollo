import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDateTime, STRINGS, type InvokeRes } from '@apollo/shared';
import { debounce } from '../../lib/debounce';
import { useFormatInit } from '../../lib/useLive';

type CaptureType = 'note' | 'todo' | 'reminder';
type Classification = InvokeRes<'capture.classify'>;

/**
 * F4 Quick Capture: single input, live type chip, Tab cycles, Enter saves,
 * Esc closes. 150ms check morph on success; 2px shake on empty. Zero LLM.
 */
export function CaptureApp(): React.JSX.Element {
  useFormatInit();
  const [text, setText] = useState('');
  const [cls, setCls] = useState<Classification | null>(null);
  const [override, setOverride] = useState<CaptureType | null>(null); // Tab override
  const [status, setStatus] = useState<'idle' | 'saved' | 'shake'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  const classify = useMemo(
    () => debounce((t: string) => {
      void window.apollo.call('capture.classify', { text: t }).then((c) => {
        setCls(c);
        setOverride((o) => (o === 'reminder' && !c.reminderAvailable ? null : o)); // drop stale reminder override
      });
    }, 50),
    [],
  );

  useEffect(() => {
    classify(text);
  }, [text, classify]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const activeType: CaptureType = override ?? cls?.suggestedType ?? 'note';
  const reminderAvailable = cls?.reminderAvailable ?? false;

  const chipLabel =
    activeType === 'reminder'
      ? STRINGS.quickCapture.chipReminder(shortWhen(cls?.reminderIso ?? null))
      : activeType === 'todo'
        ? STRINGS.quickCapture.chipTodo
        : STRINGS.quickCapture.chipNote;

  const save = (): void => {
    if (!text.trim()) {
      setStatus('shake');
      setTimeout(() => setStatus('idle'), 300);
      return;
    }
    const payload =
      activeType === 'reminder'
        ? { text: cls?.texts.reminder ?? text.trim(), type: 'reminder' as const, ...(cls?.reminderIso ? { reminderIso: cls.reminderIso } : {}) }
        : activeType === 'todo'
          ? { text: cls?.texts.todo ?? text.trim(), type: 'todo' as const }
          : { text: cls?.texts.note ?? text, type: 'note' as const };
    void window.apollo.call('capture.submit', payload).then(() => {
      setStatus('saved');
      setTimeout(() => window.close(), 150); // 150ms check morph then close
    });
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      save();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      window.close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const cycle: CaptureType[] = reminderAvailable ? ['note', 'todo', 'reminder'] : ['note', 'todo'];
      const i = cycle.indexOf(activeType);
      setOverride(cycle[(i + 1) % cycle.length] ?? 'note');
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-3)',
        height: '100vh',
        padding: '0 var(--sp-4)',
        animation: status === 'shake' ? 'apollo-shake 0.25s' : 'none',
      }}
    >
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={STRINGS.quickCapture.placeholder}
        style={{
          flex: 1,
          fontSize: 'var(--fs-title)',
          fontFamily: 'var(--font-sans)',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--text-1)',
        }}
      />
      <span
        style={{
          flexShrink: 0,
          fontSize: 'var(--fs-caption)',
          padding: 'var(--sp-1) var(--sp-3)',
          borderRadius: 'var(--radius-ctl)',
          background: status === 'saved' ? 'var(--success)' : 'var(--accent-soft)',
          color: status === 'saved' ? '#fff' : 'var(--accent)',
          transition: 'all var(--dur) var(--ease)',
        }}
      >
        {status === 'saved' ? '✓' : chipLabel}
      </span>
      <style>{`
        @keyframes apollo-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
      `}</style>
    </div>
  );
}

function shortWhen(iso: string | null): string {
  if (!iso) return '';
  return fmtDateTime(new Date(iso).getTime(), { dateStyle: 'weekday-date' });
}
