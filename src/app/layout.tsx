import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "HRMS",
  description: "HRMS application for employees, managers, HR, admin and super admin"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <main>{children}</main>
      </body>
    </html>
  );
}

