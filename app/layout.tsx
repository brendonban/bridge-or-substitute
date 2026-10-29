import "./site.css";
import Script from "next/script";
import type { Metadata, Viewport } from "next";
import { D3_SRC } from "./d3src";

export const metadata: Metadata = {
  title: "Bridge or Substitute",
  description:
    "A three-study research program at Universiti Malaya on AI companions, self-compassion and help-seeking among Malaysian men.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Script src={D3_SRC} strategy="beforeInteractive" />
      </body>
    </html>
  );
}
