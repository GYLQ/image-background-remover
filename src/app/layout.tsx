import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BG Remover - Remove Image Background',
  description: 'Remove image background instantly - no signup required.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
