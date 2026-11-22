import { Geist, Geist_Mono, Inter } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import { FAMILY_NAME, PRODUCT_NAME, forge, titleTemplate } from '@praxis/shared/theme';
import appleIcon from '@praxis/shared/brand/apple-touch-icon.png';
import icon from '@praxis/shared/brand/icon-32.png';
import { Header } from '@/components/header';
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
  applicationName: `${PRODUCT_NAME} · ${FAMILY_NAME}`,
  icons: { icon: icon.src, apple: appleIcon.src },
};

export const viewport: Viewport = { themeColor: forge.navy, width: 'device-width', initialScale: 1 };

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
