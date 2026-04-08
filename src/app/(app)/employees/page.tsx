"use client";

import { useEffect, useMemo, useState, FormEvent } from "react";
import { useToast } from "@/components/ToastProvider";
import { PaginationBar } from "@/components/PaginationBar";
import { SkeletonTable } from "@/components/Skeleton";
import { useResponsivePageSize } from "@/hooks/useResponsivePageSize";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { useAuth } from "@/contexts/AuthContext";
import { fmtDmy } from "@/lib/dateFormat";
import {
  computePayrollFromGross,
  defaultSalaryBreakup,
  isPfStatutorilyMandatory,
  isWithinEsicGrossCeiling,
} from "@/lib/payrollCalc";
import {
  normalizeDigits,
  normalizePanInput,
  validateEmailField,
  validateIndianMobileDigits,
  validateIndianMobileInteractive,
  validateAadhaarDigits,
  validateAadhaarInteractive,
  validatePanNormalized,
} from "@/lib/employeeValidators";

type Employee = {
  id: string;
  email: string;
  name: string | null;
  role: "super_admin" | "admin" | "hr" | "manager" | "employee";
  employmentStatus: "preboarding" | "current" | "past";
  employeeCode: string;
  phone: string;
  dateOfJoining: string;
  dateOfLeaving?: string;
  ctc?: number | null;
  createdAt: string;
  designation?: string | null;
  departmentName?: string | null;
  divisionName?: string | null;
  shiftName?: string | null;
  /** Preboarding list only: mandatory requested docs done for latest pending invite */
  preboardingDocsComplete?: boolean;
};

export default function EmployeesPage() {
  const { showToast } = useToast();
  const { role } = useAuth();
  const canEditCtc = role === "super_admin" || role === "admin" || role === "hr";
  const isSuperAdmin = role === "super_admin";
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeePage, setEmployeePage] = useState(1);
  const [employeeTotal, setEmployeeTotal] = useState(0);
  const [listRefresh, setListRefresh] = useState(0);
  const pageSize = useResponsivePageSize();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [aadhaarError, setAadhaarError] = useState<string | null>(null);
  const [panError, setPanError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [designationError, setDesignationError] = useState<string | null>(null);
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const [divisionError, setDivisionError] = useState<string | null>(null);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [formRole, setFormRole] = useState<Employee["role"]>("employee");
  const [employmentStatus, setEmploymentStatus] = useState<Employee["employmentStatus"]>("preboarding");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other" | "">("");
  const [designation, setDesignation] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [designationAddPrompt, setDesignationAddPrompt] = useState<string | null>(null);
  const [addingDesignation, setAddingDesignation] = useState(false);
  const [designations, setDesignations] = useState<{ id: string; title: string }[]>([]);
  const [designationOpen, setDesignationOpen] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string; division_id?: string }[]>([]);
  const [divisions, setDivisions] = useState<{ id: string; name: string }[]>([]);
  const [shifts, setShifts] = useState<{ id: string; name: string }[]>([]);
  const [aadhaar, setAadhaar] = useState("");
  const [pan, setPan] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [uanNumber, setUanNumber] = useState("");
  const [pfNumber, setPfNumber] = useState("");
  const [esicNumber, setEsicNumber] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [grossSalary, setGrossSalary] = useState("");
  const [tdsMonthly, setTdsMonthly] = useState("");
  const [pfEligible, setPfEligible] = useState(false);
  const [esicEligible, setEsicEligible] = useState(false);
  const [currentAddressLine1, setCurrentAddressLine1] = useState("");
  const [currentAddressLine2, setCurrentAddressLine2] = useState("");
  const [currentCity, setCurrentCity] = useState("");
  const [currentState, setCurrentState] = useState("");
  const [currentCountry, setCurrentCountry] = useState("");
  const [currentPostalCode, setCurrentPostalCode] = useState("");
  const [permanentSameAsCurrent, setPermanentSameAsCurrent] = useState(false);
  const [permanentAddressLine1, setPermanentAddressLine1] = useState("");
  const [permanentAddressLine2, setPermanentAddressLine2] = useState("");
  const [permanentCity, setPermanentCity] = useState("");
  const [permanentState, setPermanentState] = useState("");
  const [permanentCountry, setPermanentCountry] = useState("");
  const [permanentPostalCode, setPermanentPostalCode] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [password, setPassword] = useState("");
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Employee["employmentStatus"]>("preboarding");
  const [docs, setDocs] = useState<any[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [docsDialogOpen, setDocsDialogOpen] = useState(false);
  const [newDocName, setNewDocName] = useState("");
  const [newDocKind, setNewDocKind] = useState<"upload" | "digital_signature">("upload");
  const [newDocMandatory, setNewDocMandatory] = useState(true);
  const [newDocContent, setNewDocContent] = useState("");
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [editDocId, setEditDocId] = useState<string | null>(null);
  const [editDocName, setEditDocName] = useState("");
  const [editDocKind, setEditDocKind] = useState<"upload" | "digital_signature">("upload");
  const [editDocMandatory, setEditDocMandatory] = useState(true);
  const [editDocContent, setEditDocContent] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);

  const [companyDocs, setCompanyDocs] = useState<any[]>([]);
  const [docsForInviteLoading, setDocsForInviteLoading] = useState(false);
  const [requestedDocIds, setRequestedDocIds] = useState<string[]>([]);

  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsData, setDetailsData] = useState<any>(null);

  const [resendDialogOpen, setResendDialogOpen] = useState(false);
  const [resendTarget, setResendTarget] = useState<Employee | null>(null);
  const [resendDocIds, setResendDocIds] = useState<string[]>([]);
  const [resending, setResending] = useState(false);
  const [detailsSendEmailLoading, setDetailsSendEmailLoading] = useState(false);

  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<Employee | null>(null);
  const [convertConfirmStatus, setConvertConfirmStatus] = useState<"current" | "past">("current");
  const [convertDate, setConvertDate] = useState("");
  const [converting, setConverting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [companyPtMonthly, setCompanyPtMonthly] = useState<number>(200);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(employeePage),
          pageSize: String(pageSize),
          employmentStatus: activeTab,
        });
        const res = await fetch(`/api/employees?${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load employees");
        if (!cancelled) {
          const total = typeof data.total === "number" ? data.total : 0;
          const rows = data.employees ?? [];
          if (rows.length === 0 && total > 0 && employeePage > 1) {
            setEmployeePage(Math.max(1, Math.ceil(total / pageSize)));
          } else {
            setEmployees(rows);
            setEmployeeTotal(total);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load employees");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeePage, activeTab, listRefresh, pageSize]);

  useEffect(() => {
    setEmployeePage(1);
  }, [pageSize]);

  const filteredDesignations = useMemo<{ id: string; title: string }[]>(() => {
    const q = designation.trim().toLowerCase();
    if (!q) return designations.slice(0, 50);
    return designations
      .filter((d) => d.title.toLowerCase().includes(q))
      .slice(0, 50);
  }, [designations, designation]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/company/me");
        const data = await res.json();
        if (res.ok && data?.company && !cancelled) {
          const pt = data.company.professional_tax_monthly ?? data.company.professional_tax_annual ?? 200;
          setCompanyPtMonthly(Number(pt));
        }
      } catch {
        // keep default 200
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsDialogOpen(false);
    }
    if (isDialogOpen) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDialogOpen]);

  /** When gross changes, align PF/ESIC flags with statutory thresholds (PF wage ≤ ₹15k, gross ≤ ₹21k for ESIC). */
  useEffect(() => {
    if (!isDialogOpen) return;
    const g = parseFloat(grossSalary) || 0;
    if (g <= 0) {
      setPfEligible(false);
      setEsicEligible(false);
      return;
    }
    const { hra } = defaultSalaryBreakup(g);
    setPfEligible(isPfStatutorilyMandatory(g, hra));
    setEsicEligible(isWithinEsicGrossCeiling(g));
  }, [grossSalary, isDialogOpen]);

  useEffect(() => {
    if (!isDialogOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const [desRes, depRes, divRes, shiftRes] = await Promise.all([
          fetch("/api/settings/designations"),
          fetch("/api/settings/departments"),
          fetch("/api/settings/divisions"),
          fetch("/api/settings/shifts"),
        ]);
        if (cancelled) return;
        const desData = await desRes.json();
        const depData = await depRes.json();
        const divData = await divRes.json();
        const shiftData = await shiftRes.json();
        if (desRes.ok) setDesignations((desData.designations ?? []).filter((d: any) => d.is_active !== false).map((d: any) => ({ id: d.id, title: d.title })));
        if (depRes.ok) setDepartments((depData.departments ?? []).filter((d: any) => d.is_active !== false).map((d: any) => ({ id: d.id, name: d.name, division_id: d.division_id })));
        if (divRes.ok) setDivisions((divData.divisions ?? []).filter((d: any) => d.is_active !== false).map((d: any) => ({ id: d.id, name: d.name })));
        if (shiftRes.ok) setShifts((shiftData.shifts ?? []).filter((d: any) => d.is_active !== false).map((d: any) => ({ id: d.id, name: d.name })));
      } catch {
        // keep empty
      }
    })();
    return () => { cancelled = true; };
  }, [isDialogOpen]);

  function resetForm() {
    setFormError(null);
    setEmailError(null);
    setPhoneError(null);
    setAadhaarError(null);
    setPanError(null);
    setNameError(null);
    setDesignationError(null);
    setDepartmentError(null);
    setDivisionError(null);
    setShiftError(null);
    setName("");
    setEmail("");
    setFormRole("employee");
    setEmploymentStatus("preboarding");
    setPhone("");
    setGender("");
    setDesignation("");
    setDesignationId("");
    setDepartmentId("");
    setDivisionId("");
    setShiftId("");
    setDesignationAddPrompt(null);
    setAadhaar("");
    setPan("");
    setDateOfBirth("");
    setUanNumber("");
    setPfNumber("");
    setEsicNumber("");
    setDateOfJoining("");
    setGrossSalary("");
    setTdsMonthly("");
    setPfEligible(false);
    setEsicEligible(false);
    setCurrentAddressLine1("");
    setCurrentAddressLine2("");
    setCurrentCity("");
    setCurrentState("");
    setCurrentCountry("");
    setCurrentPostalCode("");
    setPermanentSameAsCurrent(false);
    setPermanentAddressLine1("");
    setPermanentAddressLine2("");
    setPermanentCity("");
    setPermanentState("");
    setPermanentCountry("");
    setPermanentPostalCode("");
    setEmergencyContactName("");
    setEmergencyContactPhone("");
    setBankName("");
    setBankAccountNumber("");
    setBankIfsc("");
    setPassword("");
    setEditUserId(null);
  }

  async function openEdit(userId: string) {
    setFormError(null);
    setEditUserId(userId);
    setIsDialogOpen(true);
    setPrefillLoading(true);
    try {
      const res = await fetch(`/api/employees?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load employee");
      const u = data.employee || {};
      setName(String(u.name ?? ""));
      setEmail(String(u.email ?? ""));
      setFormRole((u.role as any) || "employee");
      setEmploymentStatus((u.employmentStatus as any) || "preboarding");
      setEmployeePage(1);
      setPhone(String(u.phone ?? ""));
      setGender((u.gender as any) || "");
      setDateOfBirth(String(u.dateOfBirth ?? ""));
      setDateOfJoining(String(u.dateOfJoining ?? ""));
      setDesignation(String(u.designation ?? ""));
      setDesignationId(String(u.designationId ?? ""));
      setDepartmentId(String(u.departmentId ?? ""));
      setDivisionId(String(u.divisionId ?? ""));
      setShiftId(String(u.shiftId ?? ""));
      setAadhaar(String(u.aadhaar ?? ""));
      setPan(String(u.pan ?? ""));
      setUanNumber(String(u.uanNumber ?? ""));
      setPfNumber(String(u.pfNumber ?? ""));
      setEsicNumber(String(u.esicNumber ?? ""));
      setCurrentAddressLine1(String(u.currentAddressLine1 ?? ""));
      setCurrentAddressLine2(String(u.currentAddressLine2 ?? ""));
      setCurrentCity(String(u.currentCity ?? ""));
      setCurrentState(String(u.currentState ?? ""));
      setCurrentCountry(String(u.currentCountry ?? ""));
      setCurrentPostalCode(String(u.currentPostalCode ?? ""));
      setPermanentSameAsCurrent(false);
      setPermanentAddressLine1(String(u.permanentAddressLine1 ?? ""));
      setPermanentAddressLine2(String(u.permanentAddressLine2 ?? ""));
      setPermanentCity(String(u.permanentCity ?? ""));
      setPermanentState(String(u.permanentState ?? ""));
      setPermanentCountry(String(u.permanentCountry ?? ""));
      setPermanentPostalCode(String(u.permanentPostalCode ?? ""));
      setEmergencyContactName(String(u.emergencyContactName ?? ""));
      setEmergencyContactPhone(String(u.emergencyContactPhone ?? ""));
      setBankName(String(u.bankName ?? ""));
      setBankAccountNumber(String(u.bankAccountNumber ?? ""));
      setBankIfsc(String(u.bankIfsc ?? ""));
      setGrossSalary(u.grossSalary != null ? String(u.grossSalary) : "");
      setTdsMonthly(u.tds != null ? String(u.tds) : "");
      setPfEligible(Boolean(u.pfEligible));
      setEsicEligible(Boolean(u.esicEligible));
      setPassword("");
      loadCompanyDocsForInvite();
    } catch (e: any) {
      setFormError(e?.message || "Failed to load employee");
      showToast("error", e?.message || "Failed to load employee");
    } finally {
      setPrefillLoading(false);
    }
  }

  const gross = parseFloat(grossSalary) || 0;
  const ptMonthly = companyPtMonthly;
  const {
    ctc: calculatedCtc,
    takeHome: calculatedTakeHome,
    pfEmp: calcPfEmp,
    esicEmp: calcEsicEmp,
  } = computePayrollFromGross(gross, pfEligible, esicEligible, ptMonthly);

  useEffect(() => {
    if (!isDialogOpen) return;
    if (!permanentSameAsCurrent) return;
    setPermanentAddressLine1(currentAddressLine1);
    setPermanentAddressLine2(currentAddressLine2);
    setPermanentCity(currentCity);
    setPermanentState(currentState);
    setPermanentCountry(currentCountry);
    setPermanentPostalCode(currentPostalCode);
  }, [
    isDialogOpen,
    permanentSameAsCurrent,
    currentAddressLine1,
    currentAddressLine2,
    currentCity,
    currentState,
    currentCountry,
    currentPostalCode,
  ]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormLoading(true);
    try {
      const eErr = validateEmailField(email);
      setEmailError(eErr);
      const phoneDigits = normalizeDigits(phone);
      const phErr = validateIndianMobileDigits(phoneDigits);
      setPhoneError(phErr);
      const aDigits = normalizeDigits(aadhaar);
      const ahErr = validateAadhaarDigits(aDigits);
      setAadhaarError(ahErr);
      const panNorm = normalizePanInput(pan);
      const pnErr = validatePanNormalized(panNorm);
      setPanError(pnErr);
      const nameErr = !name.trim() ? "Name is required" : null;
      setNameError(nameErr);
      const designationErr = !designation.trim() ? "Designation is required" : null;
      setDesignationError(designationErr);
      const departmentErr = !departmentId ? "Please select a department" : null;
      setDepartmentError(departmentErr);
      const divisionErr = !divisionId ? "Please select a division" : null;
      setDivisionError(divisionErr);
      const shiftErr = !shiftId ? "Please select a shift" : null;
      setShiftError(shiftErr);
      if (eErr || phErr || ahErr || pnErr || nameErr || designationErr || departmentErr || divisionErr || shiftErr) {
        setFormLoading(false);
        return;
      }
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: formRole,
          employmentStatus,
          phone: phoneDigits,
          dateOfBirth: dateOfBirth || undefined,
          dateOfJoining: dateOfJoining || undefined,
          currentAddressLine1: currentAddressLine1.trim() || undefined,
          currentAddressLine2: currentAddressLine2.trim() || undefined,
          currentCity: currentCity.trim() || undefined,
          currentState: currentState.trim() || undefined,
          currentCountry: currentCountry.trim() || undefined,
          currentPostalCode: currentPostalCode.trim() || undefined,
          permanentAddressLine1: permanentAddressLine1.trim() || undefined,
          permanentAddressLine2: permanentAddressLine2.trim() || undefined,
          permanentCity: permanentCity.trim() || undefined,
          permanentState: permanentState.trim() || undefined,
          permanentCountry: permanentCountry.trim() || undefined,
          permanentPostalCode: permanentPostalCode.trim() || undefined,
          emergencyContactName: emergencyContactName.trim() || undefined,
          emergencyContactPhone: emergencyContactPhone.trim() || undefined,
          bankName: bankName.trim() || undefined,
          bankAccountNumber: bankAccountNumber.trim() || undefined,
          bankIfsc: bankIfsc.trim() || undefined,
          grossSalary: grossSalary.trim() ? parseFloat(grossSalary.trim()) : undefined,
          tds: tdsMonthly.trim() ? parseFloat(tdsMonthly.trim()) : undefined,
          pfEligible,
          esicEligible,
          gender: gender || undefined,
          designation: designation || undefined,
          designationId: designationId || undefined,
          departmentId: departmentId || undefined,
          divisionId: divisionId || undefined,
          shiftId: shiftId || undefined,
          aadhaar: aDigits,
          pan: panNorm,
          uanNumber: uanNumber || undefined,
          pfNumber: pfNumber || undefined,
          esicNumber: esicNumber || undefined,
          ctc: calculatedCtc || undefined,
          password: password.trim() || undefined,
          requestedDocumentIds: requestedDocIds.length ? requestedDocIds : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data?.error || "Failed to add employee");
        setFormLoading(false);
        return;
      }
      setEmployeePage(1);
      setActiveTab(employmentStatus);
      setListRefresh((n) => n + 1);
      if (data.inviteUrl) {
        const link = String(data.inviteUrl);
        try {
          await navigator.clipboard.writeText(link);
          showToast("success", "Invite link copied to clipboard (valid 48 hours)");
        } catch {
          showToast("success", "Employee added. Invite link generated.");
        }
      }
      resetForm();
      setRequestedDocIds([]);
      setIsDialogOpen(false);
    } catch {
      setFormError("Failed to add employee");
    } finally {
      setFormLoading(false);
    }
  }

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editUserId) return;
    setFormError(null);
    setFormLoading(true);
    try {
      const eErr = validateEmailField(email.trim().toLowerCase());
      setEmailError(eErr);
      const phoneDigits = normalizeDigits(phone);
      const phErr = phoneDigits ? validateIndianMobileDigits(phoneDigits) : null;
      setPhoneError(phErr);
      const aDigits = normalizeDigits(aadhaar);
      const ahErr = validateAadhaarDigits(aDigits);
      setAadhaarError(ahErr);
      const panNorm = normalizePanInput(pan);
      const pnErr = validatePanNormalized(panNorm);
      setPanError(pnErr);
      const nameErr = !name.trim() ? "Name is required" : null;
      setNameError(nameErr);
      const designationErr = !designation.trim() ? "Designation is required" : null;
      setDesignationError(designationErr);
      const departmentErr = !departmentId ? "Please select a department" : null;
      setDepartmentError(departmentErr);
      const divisionErr = !divisionId ? "Please select a division" : null;
      setDivisionError(divisionErr);
      const shiftErr = !shiftId ? "Please select a shift" : null;
      setShiftError(shiftErr);
      if (eErr || phErr || ahErr || pnErr || nameErr || designationErr || departmentErr || divisionErr || shiftErr) {
        setFormLoading(false);
        return;
      }

      const res = await fetch("/api/employees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editUserId,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: formRole,
          employmentStatus,
          phone: phoneDigits,
          dateOfBirth: dateOfBirth || undefined,
          dateOfJoining: dateOfJoining || undefined,
          currentAddressLine1: currentAddressLine1.trim() || undefined,
          currentAddressLine2: currentAddressLine2.trim() || undefined,
          currentCity: currentCity.trim() || undefined,
          currentState: currentState.trim() || undefined,
          currentCountry: currentCountry.trim() || undefined,
          currentPostalCode: currentPostalCode.trim() || undefined,
          permanentAddressLine1: permanentAddressLine1.trim() || undefined,
          permanentAddressLine2: permanentAddressLine2.trim() || undefined,
          permanentCity: permanentCity.trim() || undefined,
          permanentState: permanentState.trim() || undefined,
          permanentCountry: permanentCountry.trim() || undefined,
          permanentPostalCode: permanentPostalCode.trim() || undefined,
          emergencyContactName: emergencyContactName.trim() || undefined,
          emergencyContactPhone: emergencyContactPhone.trim() || undefined,
          bankName: bankName.trim() || undefined,
          bankAccountNumber: bankAccountNumber.trim() || undefined,
          bankIfsc: bankIfsc.trim() || undefined,
          grossSalary: grossSalary.trim() ? parseFloat(grossSalary.trim()) : undefined,
          tds: tdsMonthly.trim() ? parseFloat(tdsMonthly.trim()) : undefined,
          pfEligible,
          esicEligible,
          gender: gender || undefined,
          designation: designation || undefined,
          designationId: designationId || undefined,
          departmentId: departmentId || undefined,
          divisionId: divisionId || undefined,
          shiftId: shiftId || undefined,
          aadhaar: aDigits,
          pan: panNorm,
          uanNumber: uanNumber || undefined,
          pfNumber: pfNumber || undefined,
          esicNumber: esicNumber || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to update employee");
      showToast("success", "Employee updated");
      setListRefresh((n) => n + 1);
      setIsDialogOpen(false);
      resetForm();
    } catch (e: any) {
      setFormError(e?.message || "Failed to update employee");
      showToast("error", e?.message || "Failed to update employee");
    } finally {
      setFormLoading(false);
    }
  }

  async function loadDocuments() {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const res = await fetch("/api/company/documents");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load documents");
      setDocs(data.documents || []);
    } catch (e: any) {
      setDocsError(e?.message || "Failed to load documents");
    } finally {
      setDocsLoading(false);
    }
  }

  async function loadCompanyDocsForInvite(): Promise<any[]> {
    setDocsForInviteLoading(true);
    try {
      const res = await fetch("/api/company/documents");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load documents");
      const docs = data.documents || [];
      setCompanyDocs(docs);
      setRequestedDocIds(docs.filter((d: any) => d.is_mandatory).map((d: any) => d.id));
      return docs;
    } catch {
      setCompanyDocs([]);
      setRequestedDocIds([]);
      return [];
    } finally {
      setDocsForInviteLoading(false);
    }
  }

  async function openDetails(employeeId: string) {
    setDetailsDialogOpen(true);
    setDetailsLoading(true);
    setDetailsError(null);
    setDetailsData(null);
    try {
      const res = await fetch(`/api/employees/${employeeId}/onboarding`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load details");
      setDetailsData(data);
    } catch (e: any) {
      setDetailsError(e?.message || "Failed to load details");
    } finally {
      setDetailsLoading(false);
    }
  }

  function closeDetails() {
    setDetailsDialogOpen(false);
    if (activeTab === "preboarding") setListRefresh((n) => n + 1);
  }

  function isInviteSendable(inv: { status?: string; expires_at?: string | null } | null | undefined): boolean {
    if (!inv || inv.status !== "pending") return false;
    if (inv.expires_at && new Date(inv.expires_at) <= new Date()) return false;
    return true;
  }

  function ymdToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function getPastStatus(emp: Employee): "Notice" | "Past" {
    const dol = (emp as any).dateOfLeaving || (emp as any).date_of_leaving || "";
    const dolYmd = typeof dol === "string" ? dol.slice(0, 10) : "";
    if (!dolYmd) return "Past";
    return dolYmd > ymdToday() ? "Notice" : "Past";
  }

  function isOnNotice(emp: Employee): boolean {
    if (emp.employmentStatus !== "current") return false;
    const dol = (emp as any).dateOfLeaving || "";
    const dolYmd = typeof dol === "string" ? dol.slice(0, 10) : "";
    return Boolean(dolYmd) && dolYmd > ymdToday();
  }

  async function revokeNotice(emp: Employee) {
    try {
      setError(null);
      setConverting(true);
      const res = await fetch("/api/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke_notice", userId: emp.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to revoke notice");
      setListRefresh((n) => n + 1);
      showToast("success", "Notice revoked");
    } catch (e: any) {
      showToast("error", e?.message || "Failed to revoke notice");
    } finally {
      setConverting(false);
    }
  }

  async function resendInvite(emp: Employee) {
    setResendTarget(emp);
    // Always refresh company documents for resend dialog
    const docs = await loadCompanyDocsForInvite();

    // Default: mandatory docs (or none if company has no docs)
    const mandatory = (docs || []).filter((d: any) => d.is_mandatory).map((d: any) => d.id);
    setResendDocIds(mandatory.length ? mandatory : []);
    setResendDialogOpen(true);
  }

  async function deleteEmployee(emp: Employee) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/employees?userId=${encodeURIComponent(emp.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to delete employee");
      showToast("success", "Employee deleted");
      setDeleteTarget(null);
      setListRefresh((n) => n + 1);
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  async function convertEmployee(emp: Employee, status: "current" | "past", date: string) {
    try {
      setError(null);
      setConverting(true);
      const res = await fetch("/api/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          status === "current"
            ? { action: "convert_to_current", userId: emp.id, dateOfJoining: date || undefined }
            : { action: "convert_to_past", userId: emp.id, lastWorkingDate: date || undefined }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to convert");
      setListRefresh((n) => n + 1);
      showToast("success", status === "current" ? "Employee moved to Current" : "Employee moved to Past");
    } catch (e: any) {
      showToast("error", e?.message || "Failed to convert");
    } finally {
      setConverting(false);
    }
  }

  async function createDocument(e: FormEvent) {
    e.preventDefault();
    setCreatingDoc(true);
    setDocsError(null);
    try {
      const res = await fetch("/api/company/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newDocName.trim(),
          kind: newDocKind,
          isMandatory: Boolean(newDocMandatory),
          contentText: newDocKind === "digital_signature" ? newDocContent : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create document");
      setNewDocName("");
      setNewDocKind("upload");
      setNewDocMandatory(true);
      setNewDocContent("");
      await loadDocuments();
    } catch (e: any) {
      setDocsError(e?.message || "Failed to create document");
    } finally {
      setCreatingDoc(false);
    }
  }

  function startEditDoc(d: any) {
    setDocsError(null);
    setEditDocId(d.id);
    setEditDocName(d.name || "");
    setEditDocKind((d.kind === "digital_signature" ? "digital_signature" : "upload") as any);
    setEditDocMandatory(Boolean(d.is_mandatory));
    setEditDocContent(d.content_text || "");
  }

  function cancelEditDoc() {
    setEditDocId(null);
    setEditDocName("");
    setEditDocKind("upload");
    setEditDocMandatory(true);
    setEditDocContent("");
  }

  async function saveEditedDoc() {
    if (!editDocId) return;
    setSavingDoc(true);
    setDocsError(null);
    try {
      const res = await fetch("/api/company/documents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editDocId,
          name: editDocName.trim(),
          kind: editDocKind,
          isMandatory: Boolean(editDocMandatory),
          contentText: editDocKind === "digital_signature" ? editDocContent : "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to update document");
      cancelEditDoc();
      await loadDocuments();
      await loadCompanyDocsForInvite();
      showToast("success", "Document updated");
    } catch (e: any) {
      setDocsError(e?.message || "Failed to update document");
    } finally {
      setSavingDoc(false);
    }
  }

  async function deleteCompanyDoc(id: string) {
    setDeletingDoc(true);
    setDocsError(null);
    try {
      const res = await fetch(`/api/company/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error || "Failed to delete document");
      setDeleteDocId(null);
      if (editDocId === id) cancelEditDoc();
      await loadDocuments();
      await loadCompanyDocsForInvite();
      showToast("success", "Document deleted");
    } catch (e: any) {
      setDocsError(e?.message || "Failed to delete document");
    } finally {
      setDeletingDoc(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="page-title">Employees</h1>
        <p className="muted">Manage employees for your company.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setActiveTab("preboarding");
            setEmployeePage(1);
          }}
          className={`btn ${activeTab === "preboarding" ? "btn-primary" : "btn-outline"}`}
        >
          Preboarding
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("current");
            setEmployeePage(1);
          }}
          className={`btn ${activeTab === "current" ? "btn-primary" : "btn-outline"}`}
        >
          Current
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("past");
            setEmployeePage(1);
          }}
          className={`btn ${activeTab === "past" ? "btn-primary" : "btn-outline"}`}
        >
          Past
        </button>
        <div className="flex-1" />
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            setDocsDialogOpen(true);
            loadDocuments();
          }}
        >
          Company documents
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            resetForm();
            loadCompanyDocsForInvite();
            setIsDialogOpen(true);
          }}
        >
          Add employee
        </button>
      </div>

      {designationAddPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close"
            onClick={() => setDesignationAddPrompt(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <p className="text-sm text-slate-700">
              Add &quot;{designationAddPrompt}&quot; to designations?
            </p>
            <p className="mt-1 text-xs text-slate-500">This will add it to the master list for future use.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  setAddingDesignation(true);
                  try {
                    const res = await fetch("/api/settings/designations", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ title: designationAddPrompt }),
                    });
                    const data = await res.json();
                    if (res.ok && data?.designation) {
                      setDesignations((prev) => [...prev, { id: data.designation.id, title: data.designation.title }]);
                      setDesignationId(data.designation.id);
                      setDesignation(data.designation.title);
                      setDesignationAddPrompt(null);
                      showToast("success", "Designation added");
                    } else {
                      showToast("error", data?.error || "Failed to add");
                    }
                  } catch {
                    showToast("error", "Failed to add designation");
                  } finally {
                    setAddingDesignation(false);
                  }
                }}
                disabled={addingDesignation}
                className="btn btn-primary"
              >
                {addingDesignation ? "Adding..." : "Add"}
              </button>
              <button
                type="button"
                onClick={() => setDesignationAddPrompt(null)}
                className="btn btn-outline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close dialog"
            onClick={() => setIsDialogOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 flex w-full max-w-6xl max-h-[95vh] flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{editUserId ? "Edit employee" : "Add employee"}</h2>
                <p className="text-sm text-slate-500">
                  {editUserId ? "Update employee details in your company directory." : "Create an employee in your company directory."}
                </p>
              </div>
              <button type="button" className="btn btn-outline" onClick={() => setIsDialogOpen(false)}>
                Close
              </button>
            </div>

            <form
              noValidate
              onSubmit={editUserId ? handleUpdate : handleCreate}
              className="flex-1 overflow-y-auto p-5"
              style={{ minHeight: "70vh", maxHeight: "calc(95vh - 80px)" }}
            >
              {prefillLoading ? (
                <div className="flex min-h-[60vh] items-center justify-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600" aria-hidden />
                    <p className="text-sm text-slate-600">Loading employee details…</p>
                  </div>
                </div>
              ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(null);
                    }}
                    autoComplete="name"
                    aria-invalid={Boolean(nameError)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                      nameError
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                    }`}
                  />
                  {nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEmail(v);
                      setEmailError(validateEmailField(v));
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                      emailError
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                    }`}
                  />
                  {emailError && <p className="mt-1 text-xs text-red-600">{emailError}</p>}
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Gross salary (monthly)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={grossSalary}
                    onChange={(e) => setGrossSalary(e.target.value)}
                    placeholder="e.g. 25000"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">TDS (monthly)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={tdsMonthly}
                    onChange={(e) => setTdsMonthly(e.target.value)}
                    placeholder="e.g. 500"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">CTC</label>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {calculatedCtc > 0 ? calculatedCtc.toLocaleString("en-IN") : "—"}
                  </div>
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Take home (approx)</label>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {calculatedTakeHome > 0 ? calculatedTakeHome.toLocaleString("en-IN") : "—"}
                  </div>
                  {gross > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Deductions: PT ₹{ptMonthly.toLocaleString("en-IN")}
                      {calcPfEmp > 0 && ` · PF ₹${calcPfEmp.toLocaleString("en-IN")}`}
                      {calcEsicEmp > 0 && ` · ESIC ₹${calcEsicEmp.toLocaleString("en-IN")}`}
                    </p>
                  )}
                </div>
                <div className="md:col-span-1 flex flex-col justify-end gap-1 pb-2">
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={pfEligible}
                        onChange={(e) => setPfEligible(e.target.checked)}
                      />
                      PF eligible
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={esicEligible}
                        onChange={(e) => setEsicEligible(e.target.checked)}
                      />
                      ESIC eligible
                    </label>
                  </div>
                  <p className="text-xs text-slate-500">
                    When you change gross, these update to match thresholds: PF when wage (gross − HRA) ≤ ₹15k; ESIC when gross ≤ ₹21k.
                  </p>
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Role</label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as Employee["role"])}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="hr">HR</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
                  <select
                    value={employmentStatus}
                    onChange={(e) => setEmploymentStatus(e.target.value as Employee["employmentStatus"])}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="preboarding">Preboarding</option>
                    <option value="current">Current</option>
                    <option value="past">Past</option>
                  </select>
                </div>

                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Phone <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, "").slice(0, 10);
                      setPhone(d);
                      if (d.length === 10) setPhoneError(validateIndianMobileDigits(d));
                      else setPhoneError(null);
                    }}
                    onBlur={() => setPhoneError(validateIndianMobileInteractive(normalizeDigits(phone)))}
                    placeholder="10-digit mobile (starts 6–9)"
                    aria-invalid={Boolean(phoneError)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                      phoneError
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                    }`}
                  />
                  {phoneError && <p className="mt-1 text-xs text-red-600">{phoneError}</p>}
                  {!phoneError && phone.length > 0 && phone.length < 10 && (
                    <p className="mt-1 text-xs text-slate-500">{phone.length}/10 digits</p>
                  )}
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Gender</label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value as "male" | "female" | "other" | "")}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Date of joining</label>
                  <DatePickerField value={dateOfJoining} onChange={setDateOfJoining} className="w-full" />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Date of birth</label>
                  <DatePickerField value={dateOfBirth} onChange={setDateOfBirth} className="w-full" />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Designation <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <div className="relative">
                      <input
                        type="text"
                        value={designation}
                        onFocus={() => setDesignationOpen(true)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDesignation(v);
                          setDesignationOpen(true);
                          setDesignationError(null);
                          setDesignationAddPrompt(null);
                          const match = designations.find((d) => d.title.toLowerCase() === v.trim().toLowerCase());
                          setDesignationId(match ? match.id : "");
                        }}
                        onBlur={() => {
                          // Close dropdown first, then consider showing the "add" prompt if not matched.
                          setDesignationOpen(false);
                          const v = designation.trim();
                          if (!v) return;
                          const match = designations.find((d) => d.title.toLowerCase() === v.toLowerCase());
                          if (!match) setDesignationAddPrompt(v);
                          else setDesignationAddPrompt(null);
                        }}
                        placeholder="Select designation"
                        aria-invalid={Boolean(designationError)}
                        className={`w-full appearance-none rounded-lg border px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-1 ${
                          designationError
                            ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                            : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                        }`}
                      />
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setDesignationOpen((v) => !v)}
                        aria-label="Toggle designation list"
                        title="Show designations"
                      >
                        <span className="text-sm">▾</span>
                      </button>
                    </div>

                    {designationOpen && (
                      <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                        {filteredDesignations.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-slate-600">
                            No matches. Type to add a new designation.
                          </div>
                        ) : (
                          <div className="max-h-56 overflow-auto py-1">
                            {filteredDesignations.map((d) => (
                              <button
                                key={d.id}
                                type="button"
                                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                                onMouseDown={(e) => {
                                  // prevent input blur before we set state
                                  e.preventDefault();
                                  setDesignation(d.title);
                                  setDesignationId(d.id);
                                  setDesignationOpen(false);
                                  setDesignationAddPrompt(null);
                                  setDesignationError(null);
                                }}
                              >
                                <span className="truncate">{d.title}</span>
                                {designationId === d.id && <span className="text-emerald-700">✓</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {designationError && <p className="mt-1 text-xs text-red-600">{designationError}</p>}
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Department <span className="text-red-500">*</span></label>
                  <select
                    value={departmentId}
                    onChange={(e) => {
                      setDepartmentId(e.target.value);
                      setDepartmentError(null);
                    }}
                    aria-invalid={Boolean(departmentError)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                      departmentError
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                    }`}
                  >
                    <option value="">Select department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.division_id ? ` (${divisions.find((x) => x.id === d.division_id)?.name ?? ""})` : ""}
                      </option>
                    ))}
                  </select>
                  {departmentError && <p className="mt-1 text-xs text-red-600">{departmentError}</p>}
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Division <span className="text-red-500">*</span></label>
                  <select
                    value={divisionId}
                    onChange={(e) => {
                      setDivisionId(e.target.value);
                      setDivisionError(null);
                    }}
                    aria-invalid={Boolean(divisionError)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                      divisionError
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                    }`}
                  >
                    <option value="">Select division</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  {divisionError && <p className="mt-1 text-xs text-red-600">{divisionError}</p>}
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Shift <span className="text-red-500">*</span></label>
                  <select
                    value={shiftId}
                    onChange={(e) => {
                      setShiftId(e.target.value);
                      setShiftError(null);
                    }}
                    aria-invalid={Boolean(shiftError)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                      shiftError
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                    }`}
                  >
                    <option value="">Select shift</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  {shiftError && <p className="mt-1 text-xs text-red-600">{shiftError}</p>}
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Aadhaar <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={12}
                    value={aadhaar}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, "").slice(0, 12);
                      setAadhaar(d);
                      if (d.length === 12) setAadhaarError(validateAadhaarDigits(d));
                      else setAadhaarError(null);
                    }}
                    onBlur={() => setAadhaarError(validateAadhaarInteractive(normalizeDigits(aadhaar)))}
                    placeholder="12 digits"
                    aria-invalid={Boolean(aadhaarError)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                      aadhaarError
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                    }`}
                  />
                  {aadhaarError && <p className="mt-1 text-xs text-red-600">{aadhaarError}</p>}
                  {!aadhaarError && aadhaar.length > 0 && aadhaar.length < 12 && (
                    <p className="mt-1 text-xs text-slate-500">{aadhaar.length}/12 digits</p>
                  )}
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    PAN <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={pan}
                    onChange={(e) => {
                      setPan(normalizePanInput(e.target.value));
                      setPanError(null);
                    }}
                    placeholder="e.g. ABCDE1234F"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  {panError && <p className="mt-1 text-xs text-red-600">{panError}</p>}
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    UAN <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={uanNumber}
                    onChange={(e) => setUanNumber(e.target.value)}
                    placeholder="If already allotted"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    PF number <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={pfNumber}
                    onChange={(e) => setPfNumber(e.target.value)}
                    placeholder="If already allotted"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">ESIC number</label>
                  <input
                    type="text"
                    value={esicNumber}
                    onChange={(e) => setEsicNumber(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div className="md:col-span-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">Address</h3>
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={permanentSameAsCurrent}
                          onChange={(e) => setPermanentSameAsCurrent(e.target.checked)}
                        />
                        Same as Current Address
                      </label>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Current address</p>
                        <div className="mt-2 grid grid-cols-1 gap-3">
                          <input
                            type="text"
                            value={currentAddressLine1}
                            onChange={(e) => setCurrentAddressLine1(e.target.value)}
                            placeholder="Address line 1"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <input
                            type="text"
                            value={currentAddressLine2}
                            onChange={(e) => setCurrentAddressLine2(e.target.value)}
                            placeholder="Address line 2"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <input
                              type="text"
                              value={currentCity}
                              onChange={(e) => setCurrentCity(e.target.value)}
                              placeholder="City"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <input
                              type="text"
                              value={currentState}
                              onChange={(e) => setCurrentState(e.target.value)}
                              placeholder="State"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <input
                              type="text"
                              value={currentCountry}
                              onChange={(e) => setCurrentCountry(e.target.value)}
                              placeholder="Country"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <input
                              type="text"
                              value={currentPostalCode}
                              onChange={(e) => setCurrentPostalCode(e.target.value)}
                              placeholder="Postal code"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-semibold text-slate-800">Permanent address</p>
                        <div className="mt-2 grid grid-cols-1 gap-3">
                          <input
                            type="text"
                            value={permanentAddressLine1}
                            onChange={(e) => setPermanentAddressLine1(e.target.value)}
                            placeholder="Address line 1"
                            disabled={permanentSameAsCurrent}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50"
                          />
                          <input
                            type="text"
                            value={permanentAddressLine2}
                            onChange={(e) => setPermanentAddressLine2(e.target.value)}
                            placeholder="Address line 2"
                            disabled={permanentSameAsCurrent}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50"
                          />
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <input
                              type="text"
                              value={permanentCity}
                              onChange={(e) => setPermanentCity(e.target.value)}
                              placeholder="City"
                              disabled={permanentSameAsCurrent}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50"
                            />
                            <input
                              type="text"
                              value={permanentState}
                              onChange={(e) => setPermanentState(e.target.value)}
                              placeholder="State"
                              disabled={permanentSameAsCurrent}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50"
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <input
                              type="text"
                              value={permanentCountry}
                              onChange={(e) => setPermanentCountry(e.target.value)}
                              placeholder="Country"
                              disabled={permanentSameAsCurrent}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50"
                            />
                            <input
                              type="text"
                              value={permanentPostalCode}
                              onChange={(e) => setPermanentPostalCode(e.target.value)}
                              placeholder="Postal code"
                              disabled={permanentSameAsCurrent}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">Documents to request (sent in invite)</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Select which company documents this employee must complete. Link is valid for 48 hours.
                    </p>
                    {docsForInviteLoading ? (
                      <p className="muted mt-2">Loading documents...</p>
                    ) : companyDocs.length === 0 ? (
                      <p className="muted mt-2">No company documents configured. Add them from “Company documents”.</p>
                    ) : (
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {companyDocs.map((d: any) => (
                          <label key={d.id} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={requestedDocIds.includes(d.id)}
                              onChange={(e) => {
                                setRequestedDocIds((prev) => {
                                  if (e.target.checked) return Array.from(new Set([...prev, d.id]));
                                  return prev.filter((x) => x !== d.id);
                                });
                              }}
                            />
                            <span>
                              {d.name} <span className="text-slate-500">({d.kind}{d.is_mandatory ? ", mandatory" : ""})</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="md:col-span-4">
                  {formError && <p className="text-sm text-red-600">{formError}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => {
                        resetForm();
                        setIsDialogOpen(false);
                      }}
                      disabled={formLoading}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={formLoading}>
                      {formLoading ? (editUserId ? "Saving..." : "Adding...") : editUserId ? "Save changes" : "Add employee"}
                    </button>
                  </div>
                </div>
              </div>
              )}
            </form>
          </div>
        </div>
      )}

      {docsDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close dialog" onClick={() => setDocsDialogOpen(false)} />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Company documents</h2>
                <p className="text-sm text-slate-500">Define mandatory onboarding documents (upload or digital signature).</p>
              </div>
              <button type="button" className="btn btn-outline" onClick={() => setDocsDialogOpen(false)}>
                Close
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-5 space-y-6">
              <form onSubmit={createDocument} className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Document name</label>
                  <input
                    type="text"
                    required
                    value={newDocName}
                    onChange={(e) => setNewDocName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="Offer Letter / ID Proof / NDA"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Type</label>
                  <select
                    value={newDocKind}
                    onChange={(e) => setNewDocKind(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="upload">Upload</option>
                    <option value="digital_signature">Digital signature</option>
                  </select>
                </div>
                <div className="md:col-span-1 flex items-end">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={newDocMandatory} onChange={(e) => setNewDocMandatory(e.target.checked)} />
                    Mandatory
                  </label>
                </div>
                {newDocKind === "digital_signature" && (
                  <div className="md:col-span-4">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Document text</label>
                    <textarea
                      value={newDocContent}
                      onChange={(e) => setNewDocContent(e.target.value)}
                      className="w-full min-h-[120px] rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      placeholder="Paste document text for signature (offer letter / NDA terms)."
                    />
                  </div>
                )}
                <div className="md:col-span-4">
                  {docsError && <p className="text-sm text-red-600">{docsError}</p>}
                  <button type="submit" className="btn btn-primary" disabled={creatingDoc}>
                    {creatingDoc ? "Saving..." : "Add document"}
                  </button>
                </div>
              </form>

              <div className="card">
                <h3 className="text-base font-semibold text-slate-900">Existing documents</h3>
                {docsLoading ? (
                  <p className="muted mt-2">Loading...</p>
                ) : docs.length === 0 ? (
                  <p className="muted mt-2">No documents configured yet.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Mandatory</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.map((d) => {
                          const isEditing = editDocId === d.id;
                          return (
                            <tr key={d.id} className="border-t border-slate-200 align-top">
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editDocName}
                                    onChange={(e) => setEditDocName(e.target.value)}
                                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                                  />
                                ) : (
                                  d.name
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <select
                                    value={editDocKind}
                                    onChange={(e) => setEditDocKind(e.target.value as any)}
                                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                                  >
                                    <option value="upload">upload</option>
                                    <option value="digital_signature">digital_signature</option>
                                  </select>
                                ) : (
                                  d.kind
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <label className="inline-flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={editDocMandatory}
                                      onChange={(e) => setEditDocMandatory(e.target.checked)}
                                    />
                                    <span>{editDocMandatory ? "Yes" : "No"}</span>
                                  </label>
                                ) : (
                                  d.is_mandatory ? "Yes" : "No"
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {isEditing ? (
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      className="btn btn-outline !min-h-0 !px-2 !py-1 text-xs"
                                      onClick={cancelEditDoc}
                                      disabled={savingDoc}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-primary !min-h-0 !px-2 !py-1 text-xs"
                                      onClick={() => void saveEditedDoc()}
                                      disabled={savingDoc}
                                    >
                                      {savingDoc ? "Saving..." : "Save"}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      className="btn btn-outline !min-h-0 !px-2 !py-1 text-xs"
                                      onClick={() => startEditDoc(d)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-outline !min-h-0 !border-red-300 !px-2 !py-1 text-xs text-red-700"
                                      onClick={() => setDeleteDocId(d.id)}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {editDocId && editDocKind === "digital_signature" && (
                      <div className="mt-3">
                        <label className="mb-1 block text-sm font-medium text-slate-700">Document text</label>
                        <textarea
                          value={editDocContent}
                          onChange={(e) => setEditDocContent(e.target.value)}
                          className="w-full min-h-[120px] rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          placeholder="Paste document text for signature (offer letter / NDA terms)."
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteDocId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close dialog"
            onClick={() => !deletingDoc && setDeleteDocId(null)}
          />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Delete document</h2>
            <p className="mt-2 text-sm text-slate-600">
              Delete this company document? This may affect onboarding and existing invites.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setDeleteDocId(null)} disabled={deletingDoc}>
                Cancel
              </button>
              <button
                type="button"
                className="btn border border-red-600 bg-red-600 text-white hover:bg-red-700"
                disabled={deletingDoc}
                onClick={() => void deleteCompanyDoc(deleteDocId)}
              >
                {deletingDoc ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <SkeletonTable rows={8} columns={10} />
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : employees.length === 0 ? (
          <p className="muted">No employees yet.</p>
        ) : (
          <>
          {employeeTotal > pageSize && (
            <div className="mb-4 md:hidden">
              <PaginationBar
                page={employeePage}
                total={employeeTotal}
                pageSize={pageSize}
                loading={loading}
                onPageChange={setEmployeePage}
              />
            </div>
          )}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[920px] table-fixed border-collapse text-left text-[11px] leading-tight text-slate-800">
              <thead className="text-slate-600">
                <tr>
                  <th className="w-[10%] px-1.5 py-1.5 font-medium whitespace-nowrap">Name</th>
                  <th className="w-[9%] px-1.5 py-1.5 font-medium whitespace-nowrap">Designation</th>
                  <th className="w-[9%] px-1.5 py-1.5 font-medium whitespace-nowrap">Department</th>
                  <th className="w-[8%] px-1.5 py-1.5 font-medium whitespace-nowrap">Shift</th>
                  <th className="w-[7%] px-1.5 py-1.5 font-medium whitespace-nowrap">CTC</th>
                  <th className="w-[18%] px-1.5 py-1.5 font-medium whitespace-nowrap">Email</th>
                  <th className="w-[10%] px-1.5 py-1.5 font-medium whitespace-nowrap">Phone</th>
                  <th className="w-[8%] px-1.5 py-1.5 font-medium whitespace-nowrap">DOJ</th>
                  {activeTab === "past" && (
                    <th className="w-[8%] px-1.5 py-1.5 font-medium whitespace-nowrap">Last working</th>
                  )}
                  {activeTab === "past" && (
                    <th className="w-[8%] px-1.5 py-1.5 font-medium whitespace-nowrap">Status</th>
                  )}
                  {activeTab === "preboarding" && (
                    <th className="w-[13%] px-1.5 py-1.5 font-medium whitespace-nowrap">Actions</th>
                  )}
                  {activeTab === "current" && (
                    <th className="w-[10%] px-1.5 py-1.5 font-medium whitespace-nowrap">Actions</th>
                  )}
                  {activeTab === "past" && (
                    <th className="w-[8%] px-1.5 py-1.5 font-medium whitespace-nowrap">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-t border-slate-200">
                    <td className="max-w-0 px-1.5 py-1 whitespace-nowrap">{e.name || "—"}</td>
                    <td
                      className="max-w-0 truncate px-1.5 py-1"
                      title={e.designation || undefined}
                    >
                      {e.designation || "—"}
                    </td>
                    <td
                      className="max-w-0 truncate px-1.5 py-1"
                      title={e.departmentName || undefined}
                    >
                      {e.departmentName || "—"}
                    </td>
                    <td
                      className="max-w-0 truncate px-1.5 py-1"
                      title={e.shiftName || undefined}
                    >
                      {e.shiftName || "—"}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-1 tabular-nums">
                      {e.ctc != null ? Number(e.ctc).toLocaleString("en-IN") : "—"}
                    </td>
                    <td className="max-w-0 truncate px-1.5 py-1" title={e.email}>
                      {e.email}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-1">{e.phone || "—"}</td>
                    <td className="whitespace-nowrap px-1.5 py-1">{e.dateOfJoining ? fmtDmy(e.dateOfJoining) : "—"}</td>
                    {activeTab === "past" && (
                      <td className="whitespace-nowrap px-1.5 py-1">{(e as any).dateOfLeaving ? fmtDmy((e as any).dateOfLeaving) : "—"}</td>
                    )}
                    {activeTab === "past" && (
                      <td className="whitespace-nowrap px-1.5 py-1">
                        {getPastStatus(e)}
                      </td>
                    )}
                    {activeTab === "preboarding" && (
                      <td className="px-1.5 py-1">
                        <div className="flex flex-nowrap items-center gap-1">
                          <button
                            type="button"
                            className="btn btn-outline !min-h-0 shrink-0 !px-1.5 !py-0.5 !text-[11px] leading-none"
                            onClick={() => openDetails(e.id)}
                            title={
                              e.preboardingDocsComplete
                                ? "All mandatory documents submitted — open details"
                                : "View preboarding"
                            }
                          >
                            {e.preboardingDocsComplete ? (
                              <span
                                className="inline-block size-3.5 shrink-0 rounded-md bg-emerald-600 shadow-sm ring-1 ring-emerald-800/35"
                                aria-hidden
                              />
                            ) : (
                              <span aria-hidden>👁</span>
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline !min-h-0 shrink-0 !px-1.5 !py-0.5 !text-[11px] leading-none"
                            onClick={() => void openEdit(e.id)}
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary !min-h-0 shrink-0 !px-1.5 !py-0.5 !text-[11px] leading-none"
                            onClick={() => {
                              setConvertTarget(e);
                              setConvertConfirmStatus("current");
                              setConvertDate(e.dateOfJoining || new Date().toISOString().slice(0, 10));
                              setConvertDialogOpen(true);
                            }}
                            title="Convert to current"
                          >
                            ✅
                          </button>
                          {isSuperAdmin && (
                            <button
                              type="button"
                              className="btn btn-outline !min-h-0 shrink-0 !border-red-300 !px-1.5 !py-0.5 !text-[11px] leading-none text-red-700"
                              onClick={() => setDeleteTarget(e)}
                              title="Delete employee"
                            >
                              🗑
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                    {activeTab === "current" && (
                      <td className="px-1.5 py-1">
                        <div className="flex flex-nowrap items-center gap-1">
                          <button
                            type="button"
                            className="btn btn-outline !min-h-0 shrink-0 !px-1.5 !py-0.5 !text-[11px] leading-none"
                            onClick={() => openDetails(e.id)}
                            title="View"
                          >
                            👁
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline !min-h-0 shrink-0 !px-1.5 !py-0.5 !text-[11px] leading-none"
                            onClick={() => void openEdit(e.id)}
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline !min-h-0 shrink-0 !px-1.5 !py-0.5 !text-[11px] leading-none"
                            onClick={() => {
                              setConvertTarget(e);
                              setConvertConfirmStatus("past");
                              setConvertDate(new Date().toISOString().slice(0, 10));
                              setConvertDialogOpen(true);
                            }}
                            title="Convert to past"
                          >
                            📴
                          </button>
                          {isSuperAdmin && (
                            <button
                              type="button"
                              className="btn btn-outline !min-h-0 shrink-0 !border-red-300 !px-1.5 !py-0.5 !text-[11px] leading-none text-red-700"
                              onClick={() => setDeleteTarget(e)}
                              title="Delete employee"
                            >
                              🗑
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                    {activeTab === "past" && (
                      <td className="px-1.5 py-1">
                        <div className="flex flex-nowrap items-center gap-1">
                          {isOnNotice(e) ? (
                            <button
                              type="button"
                              className="btn btn-outline !min-h-0 shrink-0 !px-1.5 !py-0.5 !text-[11px] leading-none"
                              onClick={() => revokeNotice(e)}
                              disabled={converting}
                              title="Revoke notice"
                            >
                              ↩
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                          {isSuperAdmin && (
                            <button
                              type="button"
                              className="btn btn-outline !min-h-0 shrink-0 !border-red-300 !px-1.5 !py-0.5 !text-[11px] leading-none text-red-700"
                              onClick={() => setDeleteTarget(e)}
                              title="Delete employee"
                            >
                              🗑
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {employees.map((e) => (
              <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="font-semibold text-slate-900">{e.name || "—"}</p>
                <dl className="mt-3 space-y-2 text-sm text-slate-800">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Designation</dt>
                    <dd className="text-right">{e.designation || "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Department</dt>
                    <dd className="text-right">{e.departmentName || "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Shift</dt>
                    <dd className="text-right">{e.shiftName || "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">CTC</dt>
                    <dd className="text-right tabular-nums">{e.ctc != null ? Number(e.ctc).toLocaleString("en-IN") : "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Email</dt>
                    <dd className="break-all text-right text-xs">{e.email}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Phone</dt>
                    <dd className="text-right tabular-nums">{e.phone || "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">DOJ</dt>
                    <dd className="text-right">{e.dateOfJoining || "—"}</dd>
                  </div>
                  {activeTab === "past" && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Last working</dt>
                      <dd className="text-right">{(e as { dateOfLeaving?: string }).dateOfLeaving || "—"}</dd>
                    </div>
                  )}
                  {activeTab === "past" && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Status</dt>
                      <dd className="text-right">{getPastStatus(e)}</dd>
                    </div>
                  )}
                </dl>
                {activeTab === "preboarding" && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      className="btn btn-outline inline-flex items-center gap-1.5 text-xs"
                      onClick={() => openDetails(e.id)}
                      title={
                        e.preboardingDocsComplete
                          ? "All mandatory documents submitted — open details"
                          : "View preboarding"
                      }
                    >
                      {e.preboardingDocsComplete ? (
                        <span
                          className="inline-block size-3 rounded-md bg-emerald-600 ring-1 ring-emerald-800/35"
                          aria-hidden
                        />
                      ) : null}
                      View
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary text-xs"
                      onClick={() => {
                        setConvertTarget(e);
                        setConvertConfirmStatus("current");
                        setConvertDate(e.dateOfJoining || new Date().toISOString().slice(0, 10));
                        setConvertDialogOpen(true);
                      }}
                    >
                      Convert to current
                    </button>
                    {isSuperAdmin && (
                      <button
                        type="button"
                        className="btn btn-outline border-red-300 text-xs text-red-700"
                        onClick={() => setDeleteTarget(e)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
                {activeTab === "current" && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      className="btn btn-outline text-xs"
                      onClick={() => openDetails(e.id)}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline text-xs"
                      onClick={() => {
                        setConvertTarget(e);
                        setConvertConfirmStatus("past");
                        setConvertDate(new Date().toISOString().slice(0, 10));
                        setConvertDialogOpen(true);
                      }}
                    >
                      Convert to past
                    </button>
                    {isSuperAdmin && (
                      <button
                        type="button"
                        className="btn btn-outline border-red-300 text-xs text-red-700"
                        onClick={() => setDeleteTarget(e)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
                {activeTab === "past" && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    {isOnNotice(e) ? (
                      <button
                        type="button"
                        className="btn btn-outline text-xs"
                        onClick={() => revokeNotice(e)}
                        disabled={converting}
                      >
                        Revoke notice
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                    {isSuperAdmin && (
                      <button
                        type="button"
                        className="btn btn-outline border-red-300 text-xs text-red-700"
                        onClick={() => setDeleteTarget(e)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {employeeTotal > 0 && (
            <div className="mt-3 hidden border-t border-slate-200 pt-3 md:block">
              <PaginationBar
                page={employeePage}
                total={employeeTotal}
                pageSize={pageSize}
                loading={loading}
                onPageChange={setEmployeePage}
              />
            </div>
          )}
          </>
        )}
      </div>

      {detailsDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close dialog" onClick={closeDetails} />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Preboarding details</h2>
                <p className="text-sm text-slate-500">Employee info + submitted documents</p>
              </div>
              <button type="button" className="btn btn-outline" onClick={closeDetails}>
                Close
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-5">
              {detailsLoading ? (
                <p className="muted">Loading...</p>
              ) : detailsError ? (
                <p className="text-sm text-red-600">{detailsError}</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="card">
                      <h3 className="text-base font-semibold text-slate-900">Employee</h3>
                      <div className="mt-2 text-sm text-slate-700 space-y-1">
                        <div>
                          <span className="text-slate-500">Name:</span> {detailsData?.employee?.name || "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">Email:</span> {detailsData?.employee?.email || "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">Phone:</span> {detailsData?.employee?.phone || "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">DOB:</span>{" "}
                          {detailsData?.employee?.date_of_birth ? fmtDmy(detailsData.employee.date_of_birth) : "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">DOJ:</span>{" "}
                          {detailsData?.employee?.date_of_joining ? fmtDmy(detailsData.employee.date_of_joining) : "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">Current address:</span> {detailsData?.employee?.current_address_line1 || "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">Bank:</span>{" "}
                          {detailsData?.employee?.bank_name
                            ? `${detailsData.employee.bank_name}${detailsData?.employee?.bank_account_number ? " (Acct provided)" : ""}`
                            : detailsData?.employee?.bank_account_number
                              ? "Provided"
                              : "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">TDS (monthly):</span>{" "}
                          {detailsData?.payrollMaster?.tds != null ? Number(detailsData.payrollMaster.tds).toLocaleString("en-IN") : "0"}
                        </div>
                      </div>
                    </div>

                    <div className="card">
                      <h3 className="text-base font-semibold text-slate-900">Invite</h3>
                      <div className="mt-2 text-sm text-slate-700 space-y-1">
                        <div>
                          <span className="text-slate-500">Status:</span> {detailsData?.invite?.status || "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">Expires:</span> {detailsData?.invite?.expires_at ? new Date(detailsData.invite.expires_at).toLocaleString() : "-"}
                        </div>
                        <div className="pt-2">
                          <button
                            type="button"
                            className="btn btn-primary text-sm"
                            disabled={
                              detailsSendEmailLoading ||
                              !detailsData?.employee?.id ||
                              !isInviteSendable(detailsData?.invite)
                            }
                            onClick={async () => {
                              const uid = detailsData?.employee?.id;
                              if (!uid) return;
                              setDetailsSendEmailLoading(true);
                              try {
                                const res = await fetch("/api/invites/hrms-send-invite", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ userId: uid }),
                                });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data?.error || "Failed to send email");
                                showToast("success", "Invite email sent");
                              } catch (e: any) {
                                showToast("error", e?.message || "Failed to send email");
                              } finally {
                                setDetailsSendEmailLoading(false);
                              }
                            }}
                          >
                            {detailsSendEmailLoading ? "Sending…" : "Send invite email"}
                          </button>
                          {!isInviteSendable(detailsData?.invite) && (
                            <p className="mt-1.5 text-xs text-slate-500">
                              This employee has no active invite link (or it expired).
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="card mt-4">
                    <h3 className="text-base font-semibold text-slate-900">Documents</h3>
                    {(!detailsData?.documents || detailsData.documents.length === 0) ? (
                      <p className="muted mt-2">No documents requested.</p>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="text-slate-600">
                            <tr>
                              <th className="px-3 py-2">Name</th>
                              <th className="px-3 py-2">Type</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2">File / Signature</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailsData.documents.map((d: any) => {
                              const sub = (detailsData.submissions || []).find((s: any) => s.document_id === d.id);
                              return (
                                <tr key={d.id} className="border-t border-slate-200">
                                  <td className="px-3 py-2">{d.name}</td>
                                  <td className="px-3 py-2">{d.kind}</td>
                                  <td className="px-3 py-2">{sub?.status || "pending"}</td>
                                  <td className="px-3 py-2">
                                    {sub?.file_url ? (
                                      <a className="text-emerald-700 underline" href={sub.file_url} target="_blank" rel="noreferrer">
                                        View file
                                      </a>
                                    ) : sub?.signature_name ? (
                                      <span>Signed by {sub.signature_name}</span>
                                    ) : (
                                      "-"
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {resendDialogOpen && resendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close dialog" onClick={() => setResendDialogOpen(false)} />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Send documents again</h2>
              <p className="text-sm text-slate-500">
                Select documents to request for <span className="font-medium">{resendTarget.email}</span>. Link will be valid for 48 hours.
              </p>
            </div>
            <div className="p-5 space-y-4">
              {companyDocs.length === 0 ? (
                <p className="muted">No company documents configured. Add them from “Company documents”.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {companyDocs.map((d: any) => (
                    <label key={d.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={resendDocIds.includes(d.id)}
                        onChange={(e) => {
                          setResendDocIds((prev) => {
                            if (e.target.checked) return Array.from(new Set([...prev, d.id]));
                            return prev.filter((x) => x !== d.id);
                          });
                        }}
                      />
                      <span>
                        {d.name} <span className="text-slate-500">({d.kind}{d.is_mandatory ? ", mandatory" : ""})</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-outline" onClick={() => setResendDialogOpen(false)} disabled={resending}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={resending}
                  onClick={async () => {
                    if (!resendTarget) return;
                    setResending(true);
                    try {
                      const res = await fetch("/api/invites", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          email: resendTarget.email,
                          userId: resendTarget.id,
                          requestedDocumentIds: resendDocIds,
                          sendEmail: true,
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data?.error || "Failed to resend invite");
                      const link = `${window.location.origin}/invite/${data.invite.token}`;
                      if (data.emailSent) {
                        showToast("success", "New invite link emailed (valid 48 hours)");
                      } else if (data.emailError) {
                        try {
                          await navigator.clipboard.writeText(link);
                          showToast("success", `Link copied — email not sent (${data.emailError})`);
                        } catch {
                          showToast("error", `Invite created but email failed: ${data.emailError}`);
                        }
                      } else {
                        try {
                          await navigator.clipboard.writeText(link);
                          showToast("success", "Invite link copied to clipboard (valid 48 hours)");
                        } catch {
                          showToast("success", "Invite link generated (valid 48 hours)");
                        }
                      }
                      setResendDialogOpen(false);
                    } catch (e: any) {
                      setError(e?.message || "Failed to resend invite");
                      showToast("error", e?.message || "Failed to resend invite");
                    } finally {
                      setResending(false);
                    }
                  }}
                >
                  {resending ? "Sending..." : "Send link"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close dialog"
            onClick={() => !deleting && setDeleteTarget(null)}
          />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Delete employee</h2>
            <p className="mt-2 text-sm text-slate-600">
              Permanently remove <span className="font-medium">{deleteTarget.name || deleteTarget.email}</span> from the company?
              This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </button>
              <button
                type="button"
                className="btn border border-red-600 bg-red-600 text-white hover:bg-red-700"
                disabled={deleting}
                onClick={() => void deleteEmployee(deleteTarget)}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {convertDialogOpen && convertTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close dialog" onClick={() => setConvertDialogOpen(false)} />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Convert employee</h2>
              <p className="text-sm text-slate-500">
                Convert <span className="font-medium">{convertTarget.email}</span> to{" "}
                <span className="font-medium">{convertConfirmStatus === "current" ? "Current" : "Past"}</span>.
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">New status</label>
                <select
                  value={convertConfirmStatus}
                  onChange={(e) => setConvertConfirmStatus(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="current">Current (default)</option>
                  <option value="past">Past</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {convertConfirmStatus === "current" ? "Date of joining" : "Last working date"}
                </label>
                <DatePickerField value={convertDate} onChange={setConvertDate} required className="w-full" />
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-outline" onClick={() => setConvertDialogOpen(false)} disabled={converting}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={converting}
                  onClick={async () => {
                    if (!convertTarget) return;
                    setConvertDialogOpen(false);
                    await convertEmployee(convertTarget, convertConfirmStatus, convertDate);
                  }}
                >
                  {converting ? "Converting..." : convertConfirmStatus === "current" ? "Convert to Current" : "Convert to Past"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

