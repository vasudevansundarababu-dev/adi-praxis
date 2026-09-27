import type { Metadata, Viewport } from 'next';
import mark from '@praxis/shared/brand/praxis-mark-512.png';
import './globals.css';

export const metadata: Metadata = {
  title: { template: '%s · ADI Praxis', default: 'ADI Praxis' },
  applicationName: 'ADI Praxis',
  icons: { icon: mark.src, apple: mark.src },
};

export const viewport: Viewport = { themeColor: '#212227', width: 'device-width', initialScale: 1 };

// The candidate sign-in and landing screens default to dark (SPEC: Branding).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
