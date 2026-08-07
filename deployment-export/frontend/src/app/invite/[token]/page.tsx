import { redirect } from "next/navigation";

export default function InviteTokenPage() {
  redirect("/auth/login");
}
