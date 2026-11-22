import { Geist, Geist_Mono, Inter } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import mark from '@praxis/shared/brand/praxis-mark-512.png';
import { Header } from '@/components/header';
import './globals.css';

// Typography (owner, 15 Nov 2026): Inter for body, labels and tables (optical sizing); Geist for headings, titles and
// primary buttons; Geist Mono for numbers, badges, IDs and code. The shared theme maps these variables.
const sans = Inter({ subsets: ['latin'], variable: '--font-praxis', display: 'swap', axes: ['opsz'] });
const display = Geist({ subsets: ['latin'], variable: '--font-forge-display', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-forge-mono', display: 'swap' });
const fontVars = `${sans.variable} ${display.variable} ${mono.variable}`;

export const metadata: Metadata = {
  title: { template: '%s · Authoring · ADI Labs Forge', default: 'Authoring · ADI Labs Forge' },
  applicationName: 'ADI Forge',
  icons: { icon: mark.src, apple: mark.src },
};

export const viewport: Viewport = { themeColor: '#212227', width: 'device-width', initialScale: 1 };

// The candidate sign-in and landing screens default to dark (SPEC: Branding).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${fontVars}`}>
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <Header />
        {children}
      </body>
    </html>
  );
}
