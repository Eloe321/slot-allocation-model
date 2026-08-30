import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Slot allocation inspector',
  description:
    'A live inspector for a partitioned-capacity allocation engine: the tree, the netting divergence, and the waterfall.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
