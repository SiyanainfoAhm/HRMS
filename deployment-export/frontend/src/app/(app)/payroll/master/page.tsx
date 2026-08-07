"use client";

import { useAuth } from "@/contexts/AuthContext";
import { PayrollMasterScreen } from "@/components/payroll/PayrollMasterScreen";
import { isAdminRole } from "@/lib/roles";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function PayrollMasterPage() {
  const { role } = useAuth();
  const router = useRouter();
  const canManage = isAdminRole(role);

  useEffect(() => {
    if (!canManage) {
      router.replace("/employee/dashboard");
    }
  }, [canManage, router]);

  if (!canManage) {
    return null;
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="page-title">Payroll Master</h1>
        <p className="muted">Manage employee salary structures and payroll master data.</p>
      </div>
      <PayrollMasterScreen canManage />
    </section>
  );
}
