import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Depths",
  description: "On-chain roguelike dungeon di Monad. Makin dalam, makin kaya.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
