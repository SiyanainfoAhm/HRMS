import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "HRMS",
  description: "HRMS application for employees, managers, HR, admin and super admin",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen min-h-[100dvh] bg-slate-50 text-slate-900 antialiased">
        <main className="min-h-0 min-w-0">{children}</main>
      </body>
    </html>
  );
}

