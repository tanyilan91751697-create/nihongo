'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpenText, Layers, Mic, Map, AlertTriangle, LineChart, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Progress', icon: LineChart },
  { href: '/reader', label: 'Reader', icon: BookOpenText },
  { href: '/srs', label: 'SRS', icon: Layers },
  { href: '/studio', label: 'Oral Studio', icon: Mic },
  { href: '/islands', label: 'Islands', icon: Map },
  { href: '/errors', label: 'Error Log', icon: AlertTriangle },
];

export function Sidebar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const stored = (localStorage.getItem('nihongo-theme') as 'dark' | 'light' | null) ?? 'dark';
    setTheme(stored);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('nihongo-theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="px-5 py-6">
        <Link href="/" className="block">
          <div className="font-jp text-xl font-semibold tracking-wide">日本語ハブ</div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Nihongo Hub</div>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-primary/15 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-border p-3">
        <button
          type="button"
          onClick={toggleTheme}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <p className="px-3 pb-1 text-[11px] leading-relaxed text-muted-foreground">
          <kbd className="rounded border border-border px-1">⌘K</kbd> quick add
        </p>
      </div>
    </aside>
  );
}
