import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { QuickAdd } from '@/components/quick-add';

export const metadata: Metadata = {
  title: 'Nihongo Hub',
  description: 'A personal Japanese learning workspace — reader, SRS, oral studio, islands and progress.',
};

/**
 * Sets the theme before first paint so a light-mode reload never flashes dark.
 */
const THEME_SCRIPT = `
try {
  var stored = localStorage.getItem('nihongo-theme');
  if (stored === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.setAttribute('data-theme', 'dark');
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'dark');
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
        <QuickAdd />
      </body>
    </html>
  );
}
