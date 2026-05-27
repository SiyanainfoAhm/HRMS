import type { ReactNode } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata = {
  title: "CIRT HRMS ",
  description: "Human Resource Management System for CIRT HRMS",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontSans.variable}>
      <body className="min-h-screen min-h-[100dvh] font-sans">
        <main className="min-h-0 min-w-0">{children}</main>
      </body>
    </html>
  );
}
