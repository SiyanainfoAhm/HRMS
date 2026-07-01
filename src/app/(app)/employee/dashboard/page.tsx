"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminRole } from "@/lib/roles";
import { EmployeeDashboard } from "@/components/employee/EmployeeDashboard";
import { AppPageLoader } from "@/components/ui/AppPageLoader";

export default function EmployeeDashboardPage() {
  const { role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (role && isAdminRole(role)) {
      router.replace("/payroll/master");
    }
  }, [role, router]);

  if (role && isAdminRole(role)) {
    return <AppPageLoader message="Redirecting…" submessage="Please wait…" />;
  }

  return <EmployeeDashboard />;
}
