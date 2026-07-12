import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "SVG to 3D — Turn any SVG into interactive 3D",
  description: "Turn any SVG into interactive 3D objects. Animate and export as 4K image or video. 100% free, no account or subscription needed.",
  metadataBase: new URL("https://github.com/Taha-Mahmoud789/3dsvg"),
  openGraph: {
    title: "SVG to 3D — Turn any SVG into interactive 3D",
    description: "Turn any SVG into interactive 3D objects. Animate and export as 4K image or video. 100% free, no account or subscription needed.",
    url: "https://github.com/Taha-Mahmoud789/3dsvg",
    siteName: "SVG to 3D",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SVG to 3D — Turn any SVG into interactive 3D",
    description: "Turn any SVG into interactive 3D objects. Animate and export as 4K image or video. 100% free, no account or subscription needed.",
  },
  keywords: ["3d", "svg", "react", "three.js", "embed", "webgl", "pixel art", "text to 3d", "svg to 3d", "free"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <TooltipProvider delayDuration={700}>{children}</TooltipProvider>
        <Analytics />
      </body>
    </html>
  );
}
