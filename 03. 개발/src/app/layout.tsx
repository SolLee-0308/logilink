import type { Metadata } from "next";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import localFont from "next/font/local";
import "@/styles/tokens.css";
import "@/styles/globals.css";

const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  weight: "45 920",
  display: "swap",
  variable: "--font-pretendard",
});

const sora = Sora({
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
  variable: "--font-sora",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: { default: "LogiLink", template: "%s · LogiLink" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${pretendard.variable} ${sora.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
