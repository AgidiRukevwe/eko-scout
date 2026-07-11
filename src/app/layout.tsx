import './globals.css';

export const metadata = {
  title: 'Adera',
  description: 'Clean slate for Adera UI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-white text-zinc-900 antialiased">{children}</body>
    </html>
  );
}
