import './globals.css';

export const metadata = {
  title: 'EkoScout',
  description: 'Clean slate for EkoScout UI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-zinc-950 text-zinc-50 antialiased">{children}</body>
    </html>
  );
}
