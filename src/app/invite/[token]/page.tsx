"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ToastProvider, useToast } from "@/components/ToastProvider";

type Doc = {
  id: string;
  name: string;
  kind: "upload" | "digital_signature";
  is_mandatory: boolean;
  content_text?: string | null;
};

type Submission = {
  id: string;
  document_id: string;
  status: string;
  file_url?: string | null;
  signature_name?: string | null;
};

function InvitePageInner() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<any>(null);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  const [password, setPassword] = useState("");
  const [completing, setCompleting] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [currentAddressLine1, setCurrentAddressLine1] = useState("");
  const [currentCity, setCurrentCity] = useState("");
  const [currentState, setCurrentState] = useState("");
  const [currentCountry, setCurrentCountry] = useState("");
  const [currentPostalCode, setCurrentPostalCode] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");

  const bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || "photomedia";

  function sanitizeSegment(s: string): string {
    return (s || "")
      .trim()
      .replace(/[\/\\]+/g, "-")
      .replace(/[^\w\s.\-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "_")
      .slice(0, 64);
  }

  const byDocId = useMemo(() => {
    const m = new Map<string, Submission>();
    for (const s of submissions) m.set(s.document_id, s);
    return m;
  }, [submissions]);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/invites/${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load invite");
      setInvite(data.invite);
      setDocuments(data.documents || []);
      setSubmissions(data.submissions || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load invite");
      showToast("error", e?.message || "Failed to load invite");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submitUpload(documentId: string, fileUrl: string) {
    setError(null);
    const res = await fetch(`/api/invites/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit_document", documentId, fileUrl }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error || "Failed to submit document");
      showToast("error", data?.error || "Failed to submit document");
      return;
    }
    showToast("success", "Document submitted");
    await refresh();
  }

  async function uploadToStorage(document: Doc, file: File): Promise<string> {
    const userId = String(invite?.user_id || "unknown");
    const employeeName = sanitizeSegment(name) || "Employee";
    const employeeFolder = `${employeeName}${userId}`;
    const category = document.kind === "upload" ? "upload" : "esign";
    const docFolder = sanitizeSegment(document.name) || "Document";
    const ext = (file.name.split(".").pop() || "").slice(0, 10);
    const safeBase = docFolder;
    const finalFileName = ext ? `${safeBase}.${ext}` : safeBase;
    const path = `HRMS/${employeeFolder}/${category}/${docFolder}/${Date.now()}_${finalFileName}`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error("Failed to get public URL");
    return data.publicUrl;
  }

  async function uploadSignatureReceipt(document: Doc, signatureName: string): Promise<string> {
    const userId = String(invite?.user_id || "unknown");
    const employeeName = sanitizeSegment(name) || "Employee";
    const employeeFolder = `${employeeName}${userId}`;
    const docFolder = sanitizeSegment(document.name) || "Document";
    const receiptText = `Document: ${document.name}\nSigned by: ${signatureName}\nSigned at: ${new Date().toISOString()}\nEmail: ${invite?.email || ""}\n`;
    const blob = new Blob([receiptText], { type: "text/plain" });
    const receiptName = `${docFolder}_SIGNATURE_RECEIPT.txt`;
    const path = `HRMS/${employeeFolder}/esign/${docFolder}/${Date.now()}_${receiptName}`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, blob, { upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error("Failed to get public URL");
    return data.publicUrl;
  }

  async function submitSignature(documentId: string, signatureName: string) {
    setError(null);
    const doc = documents.find((d) => d.id === documentId);
    let receiptUrl = "";
    try {
      if (doc) receiptUrl = await uploadSignatureReceipt(doc, signatureName);
    } catch {
      // best-effort; still store signature metadata in DB
    }
    const res = await fetch(`/api/invites/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit_document", documentId, signatureName, fileUrl: receiptUrl || undefined }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error || "Failed to sign document");
      showToast("error", data?.error || "Failed to sign document");
      return;
    }
    showToast("success", "Document signed");
    await refresh();
  }

  async function complete() {
    setCompleting(true);
    setError(null);
    try {
      const requiredMissing: string[] = [];
      if (!name.trim()) requiredMissing.push("Full name");
      if (!phone.trim()) requiredMissing.push("Phone");
      if (!dateOfBirth.trim()) requiredMissing.push("Date of birth");
      if (!dateOfJoining.trim()) requiredMissing.push("Date of joining");
      if (!currentAddressLine1.trim()) requiredMissing.push("Current address");
      if (!currentCity.trim()) requiredMissing.push("City");
      if (!currentState.trim()) requiredMissing.push("State");
      if (!currentCountry.trim()) requiredMissing.push("Country");
      if (!currentPostalCode.trim()) requiredMissing.push("Postal code");
      if (!bankAccountNumber.trim()) requiredMissing.push("Bank account number");
      if (!bankIfsc.trim()) requiredMissing.push("IFSC");
      if (requiredMissing.length) throw new Error(`Please fill all required fields: ${requiredMissing.join(", ")}`);

      const res = await fetch(`/api/invites/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          password,
          profile: {
            name,
            phone,
            dateOfBirth,
            dateOfJoining,
            currentAddressLine1,
            currentCity,
            currentState,
            currentCountry,
            currentPostalCode,
            bankAccountNumber,
            bankIfsc,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to complete onboarding");
      showToast("success", "Onboarding completed. Your account is now active.");
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to complete onboarding");
      showToast("error", e?.message || "Failed to complete onboarding");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Employee onboarding</h1>
        <p className="muted">Complete the mandatory documents to activate your account.</p>
      </div>

      {loading && (
        <div className="card">
          <p className="muted">Loading...</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Invite</h2>
            <p className="text-sm text-slate-500">{invite?.email || "-"}</p>
          </div>
          <span className="text-sm text-slate-600">Status: {invite?.status || "-"}</span>
        </div>
      </div>

      <div className="card">
        <h2 className="text-base font-semibold text-slate-900">Mandatory documents</h2>
        {documents.length === 0 ? (
          <p className="muted mt-2">No documents configured for this company.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {documents
              .filter((d) => d.is_mandatory)
              .map((d) => {
                const s = byDocId.get(d.id);
                const done = s && (s.status === "submitted" || s.status === "signed" || s.status === "approved");
                return (
                  <div key={d.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-900">{d.name}</div>
                        <div className="text-sm text-slate-500">Type: {d.kind}</div>
                      </div>
                      <div className={`text-sm ${done ? "text-emerald-700" : "text-slate-600"}`}>{done ? "Completed" : "Pending"}</div>
                    </div>

                    {d.kind === "upload" ? (
                      <UploadBox
                        disabled={!!done}
                        initialValue={s?.file_url ?? ""}
                        onSubmit={(url) => submitUpload(d.id, url)}
                        onUpload={async (file) => {
                          if (!invite?.id) throw new Error("Invite not loaded");
                          return await uploadToStorage(d, file);
                        }}
                      />
                    ) : (
                      <SignatureBox
                        disabled={!!done}
                        contentText={d.content_text ?? ""}
                        initialValue={s?.signature_name ?? ""}
                        onSubmit={(name) => submitSignature(d.id, name)}
                      />
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="text-base font-semibold text-slate-900">Your details</h2>
        <p className="text-sm text-slate-500 mt-1">Complete your information (visible to HR/Admin).</p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
            <input
              type="text"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Date of birth</label>
            <input
              type="date"
              required
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Date of joining</label>
            <input
              type="date"
              required
              value={dateOfJoining}
              onChange={(e) => setDateOfJoining(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Current address</label>
            <input
              type="text"
              required
              value={currentAddressLine1}
              onChange={(e) => setCurrentAddressLine1(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">City</label>
            <input
              type="text"
              required
              value={currentCity}
              onChange={(e) => setCurrentCity(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">State</label>
            <input
              type="text"
              required
              value={currentState}
              onChange={(e) => setCurrentState(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Country</label>
            <input
              type="text"
              required
              value={currentCountry}
              onChange={(e) => setCurrentCountry(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Postal code</label>
            <input
              type="text"
              required
              value={currentPostalCode}
              onChange={(e) => setCurrentPostalCode(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Bank account number</label>
            <input
              type="text"
              required
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">IFSC</label>
            <input
              type="text"
              required
              value={bankIfsc}
              onChange={(e) => setBankIfsc(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

          <div className="card">
            <h2 className="text-base font-semibold text-slate-900">Activate account</h2>
            <p className="text-sm text-slate-500 mt-1">Set your password and complete onboarding.</p>
            <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Minimum 8 characters"
                />
              </div>
              <button type="button" className="btn btn-primary" onClick={complete} disabled={completing}>
                {completing ? "Activating..." : "Complete onboarding"}
              </button>
            </div>
          </div>
    </section>
  );
}

export default function InvitePage() {
  return (
    <ToastProvider>
      <InvitePageInner />
    </ToastProvider>
  );
}

function UploadBox({
  disabled,
  initialValue,
  onSubmit,
  onUpload,
}: {
  disabled: boolean;
  initialValue: string;
  onSubmit: (url: string) => void;
  onUpload: (file: File) => Promise<string>;
}) {
  const [url, setUrl] = useState(initialValue);
  const [uploading, setUploading] = useState(false);
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-end">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Upload file</label>
        <input
          type="file"
          disabled={disabled || uploading}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true);
            try {
              const publicUrl = await onUpload(file);
              setUrl(publicUrl);
            } finally {
              setUploading(false);
            }
          }}
        />
        <div className="mt-2">
          <label className="mb-1 block text-sm font-medium text-slate-700">File URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={disabled || uploading}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-100"
          placeholder="Will auto-fill after upload (or paste URL)"
        />
        </div>
      </div>
      <button type="button" className="btn btn-outline" disabled={disabled || uploading || !url.trim()} onClick={() => onSubmit(url.trim())}>
        {uploading ? "Uploading..." : "Submit"}
      </button>
    </div>
  );
}

function SignatureBox({
  disabled,
  contentText,
  initialValue,
  onSubmit,
}: {
  disabled: boolean;
  contentText: string;
  initialValue: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialValue);
  return (
    <div className="mt-3 space-y-2">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">
        {contentText || "Document text not provided by company."}
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Type your full name to sign</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-100"
            placeholder="Full name"
          />
        </div>
        <button type="button" className="btn btn-outline" disabled={disabled || !name.trim()} onClick={() => onSubmit(name.trim())}>
          Sign
        </button>
      </div>
    </div>
  );
}

