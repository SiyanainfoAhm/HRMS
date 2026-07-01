/** Download payslip DOM node as PDF (same logic as profile pay tab). */
export async function downloadPayslipPdf(
  element: HTMLElement | null,
  options?: { userName?: string; month?: string; year?: string },
): Promise<void> {
  if (!element) return;

  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = canvas.width;
  const imgHeight = canvas.height;
  const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight) * 0.95;
  const imgX = (pdfWidth - imgWidth * ratio) / 2;
  const imgY = 5;

  pdf.addImage(imgData, "PNG", imgX, imgY, imgWidth * ratio, imgHeight * ratio);

  const namePart =
    (options?.userName || "Employee").replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-") || "Employee";
  const monthStr = (options?.month || String(new Date().getMonth() + 1)).padStart(2, "0");
  const yearStr = options?.year || String(new Date().getFullYear());
  pdf.save(`Salary-Slip-${namePart}-${monthStr}-${yearStr}.pdf`);
}
