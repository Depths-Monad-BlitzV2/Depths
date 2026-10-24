import type { Metadata } from "next";
import { Silkscreen } from "next/font/google";
import "./globals.css";

// Font pixel untuk judul dan angka besar (UI_UX §2), SIL OFL (lihat public/CREDITS.md)
const silkscreen = Silkscreen({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-silkscreen" });

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
    <html lang="id" className={silkscreen.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
