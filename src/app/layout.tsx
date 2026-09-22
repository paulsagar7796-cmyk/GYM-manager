import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistrar } from "./service-worker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gym Manager",
  description:
    "Mobile gym management dashboard for members, renewals, plans, and affiliate revenue.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Gym Manager",
  },
  other: {
    // Next emits the standardised `mobile-web-app-capable`, which iOS only
    // began honouring recently. The apple-prefixed tag is what older iPhones
    // read to launch from the home screen without Safari's chrome.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#f3f5f7] text-slate-900">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
