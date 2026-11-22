import { Geist, Geist_Mono, Inter } from 'next/font/google';
import type { Metadata } from 'next';
import { titleTemplate } from '@praxis/shared/theme';
import appleIcon from '@praxis/shared/brand/apple-touch-icon.png';
import icon from '@praxis/shared/brand/icon-32.png';
import './globals.css';

// Typography (owner, 15 Nov 2026): Inter for body, labels and tables (optical sizing); Geist for headings, titles and
// primary buttons; Geist Mono for numbers, badges, IDs and code. The shared theme maps these variables.
const sans = Inter({ subsets: ['latin'], variable: '--font-praxis', display: 'swap', axes: ['opsz'] });
const display = Geist({ subsets: ['latin'], variable: '--font-forge-display', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-forge-mono', display: 'swap' });
const fontVars = `${sans.variable} ${display.variable} ${mono.variable}`;

export const metadata: Metadata = {
  // Browser tab: "<Page> · Authoring · ADI Labs Forge"; icons made from the shield (BRANDING.md, 22 Nov 2026).
  title: titleTemplate,
  icons: { icon: icon.src, apple: appleIcon.src },
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
