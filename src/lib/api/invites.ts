import { get, post, put } from "./client";

export function getInvites() {
  return get("/invites");
}

export function createInvite(data: { email: string; requested_document_ids?: string[] }) {
  return post("/invites", data);
}

export function getInviteByToken(token: string) {
  return get(`/invites/${token}`);
}

export function completeInvite(token: string) {
  return put(`/invites/${token}`);
}

export function sendInviteEmail(inviteId: string) {
  return post("/invites/send", { invite_id: inviteId });
}
