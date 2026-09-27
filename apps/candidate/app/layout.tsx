import { Plus_Jakarta_Sans } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import mark from '@praxis/shared/brand/praxis-mark-512.png';
import { Header } from '@/components/header';
import './globals.css';

const font = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-praxis', display: 'swap' });

export const metadata: Metadata = {
  title: { template: '%s · ADI Praxis', default: 'ADI Praxis' },
  applicationName: 'ADI Praxis',
  icons: { icon: mark.src, apple: mark.src },
};

export const viewport: Viewport = { themeColor: '#212227', width: 'device-width', initialScale: 1 };

// The candidate sign-in and landing screens default to dark (SPEC: Branding).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${font.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <Header />
        {children}
      </body>
    </html>
  );
}
