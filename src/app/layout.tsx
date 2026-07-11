import './globals.css';
import { Geist } from 'next/font/google';
import { Newsreader } from 'next/font/google';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
});

export const metadata = {
  title: 'Adera',
  description: 'Local intelligence for every Lagos neighbourhood',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${geist.variable} ${newsreader.variable}`}>
      <body className={`h-full bg-white text-zinc-900 antialiased ${geist.className}`}>
        {children}
      </body>
    </html>
  );
}
