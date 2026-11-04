"use client";

import { ActivityEntriesView } from "./ActivityEntriesView";

/**
 * The Activity Log: one record per action, with a View Details modal that lists only what changed.
 * The per-employee records written before the change tracking stay in the database and behind their
 * endpoints (/activity-logs, /activity-logs/{id}), but they no longer have a tab here.
 */
export function ActivityLogScreen() {
  return <ActivityEntriesView />;
}
