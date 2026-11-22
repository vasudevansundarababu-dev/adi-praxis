import { Geist, Geist_Mono, Inter } from 'next/font/google';
import type { Metadata } from 'next';
import mark from '@praxis/shared/brand/praxis-mark-512.png';
import './globals.css';

// Typography (owner, 15 Nov 2026): Inter for body, labels and tables (optical sizing); Geist for headings, titles and
// primary buttons; Geist Mono for numbers, badges, IDs and code. The shared theme maps these variables.
const sans = Inter({ subsets: ['latin'], variable: '--font-praxis', display: 'swap', axes: ['opsz'] });
const display = Geist({ subsets: ['latin'], variable: '--font-forge-display', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-forge-mono', display: 'swap' });
const fontVars = `${sans.variable} ${display.variable} ${mono.variable}`;

export const metadata: Metadata = {
  title: { template: '%s · Authoring · ADI Labs Forge', default: 'Authoring · ADI Labs Forge' },
  icons: { icon: mark.src, apple: mark.src },
};

// Applies the saved theme before paint to avoid a flash. The console defaults to light.
const themeScript = `try{if(localStorage.getItem('praxis-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={fontVars}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">{children}</body>
    </html>
  );
}
