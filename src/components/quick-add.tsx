'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';

/**
 * Global quick-add (Cmd/Ctrl+K): log an error, add an SRS card, or drop a note
 * into the Reader from anywhere in the app.
 */
export function QuickAdd() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [attempted, setAttempted] = useState('');
  const [corrected, setCorrected] = useState('');
  const [category, setCategory] = useState('particle');

  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [reading, setReading] = useState('');

  const [note, setNote] = useState('');
  const [noteTitle, setNoteTitle] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const flash = (message: string) => {
    setStatus(message);
    setTimeout(() => setStatus(null), 2500);
  };

  async function submitError() {
    if (!attempted.trim() || !corrected.trim()) return;
    setBusy(true);
    await fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempted, corrected, category, source_activity: 'manual', createCard: true }),
    });
    setBusy(false);
    setAttempted('');
    setCorrected('');
    flash('Error logged with a production card.');
    router.refresh();
  }

  async function submitCard() {
    if (!front.trim() || !back.trim()) return;
    setBusy(true);
    await fetch('/api/srs/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        front,
        back,
        reading: reading || null,
        source: 'manual',
        source_label: 'Quick add',
      }),
    });
    setBusy(false);
    setFront('');
    setBack('');
    setReading('');
    flash('Card added to the SRS queue.');
    router.refresh();
  }

  async function submitNote() {
    if (!note.trim()) return;
    setBusy(true);
    const response = await fetch('/api/reader/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: note, title: noteTitle || 'Quick note', save: true }),
    });
    const data = await response.json();
    setBusy(false);
    setNote('');
    setNoteTitle('');
    setOpen(false);
    if (data.textId) router.push(`/reader?text=${data.textId}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick add</DialogTitle>
          <DialogDescription>Capture something without leaving the page you are on.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="error">
          <TabsList>
            <TabsTrigger value="error">Error</TabsTrigger>
            <TabsTrigger value="card">SRS card</TabsTrigger>
            <TabsTrigger value="note">Text note</TabsTrigger>
          </TabsList>

          <TabsContent value="error" className="space-y-3">
            <Textarea
              className="jp"
              placeholder="What I tried to say…"
              value={attempted}
              onChange={(event) => setAttempted(event.target.value)}
            />
            <Textarea
              className="jp"
              placeholder="The corrected version…"
              value={corrected}
              onChange={(event) => setCorrected(event.target.value)}
            />
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="particle">particle</option>
              <option value="conjugation">conjugation</option>
              <option value="register">register</option>
              <option value="word_choice">word choice</option>
              <option value="pitch">pitch</option>
              <option value="other">other</option>
            </Select>
            <Button onClick={submitError} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Log error + create card
            </Button>
          </TabsContent>

          <TabsContent value="card" className="space-y-3">
            <Input className="jp" placeholder="Front (Japanese)" value={front} onChange={(e) => setFront(e.target.value)} />
            <Input className="jp" placeholder="Reading (optional)" value={reading} onChange={(e) => setReading(e.target.value)} />
            <Input placeholder="Back (meaning)" value={back} onChange={(e) => setBack(e.target.value)} />
            <Button onClick={submitCard} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add card
            </Button>
          </TabsContent>

          <TabsContent value="note" className="space-y-3">
            <Input placeholder="Title (optional)" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
            <Textarea
              className="jp min-h-[120px]"
              placeholder="Japanese text to analyse later…"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <Button onClick={submitNote} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save and open in Reader
            </Button>
          </TabsContent>
        </Tabs>

        {status ? <p className="mt-3 text-sm text-emerald-400">{status}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
