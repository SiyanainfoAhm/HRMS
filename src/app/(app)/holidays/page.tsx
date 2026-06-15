import { redirect } from "next/navigation";

export default function HolidaysPage() {
  redirect("/payroll?tab=master");
}
