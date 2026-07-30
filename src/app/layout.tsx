import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "MapSocial — Wallet Social Map",
  description: "Connect your wallet and meet real on-chain users on the map",
};

// App-like viewport for mobile wallet in-app browsers: edge-to-edge with
// safe-area support, no focus zoom (the map has its own zoom control).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#04060d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
