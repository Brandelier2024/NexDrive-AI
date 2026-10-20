import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OneDrive Media Locator — Find Company Files Instantly",
  description:
    "AI-powered chatbot that helps employees find images, videos, and folders in OneDrive with direct clickable links.",
  keywords: ["OneDrive", "media locator", "RAG chatbot", "file search", "SharePoint"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
