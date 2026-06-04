import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EkoScout | Lagos Hyperlocal Living-Condition Assistant",
  description: "Ask what living anywhere in Lagos is actually like. Get practical insights about internet reliability, flooding, traffic, power, and noise before house hunting.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
