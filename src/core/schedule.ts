/** Parse "HH:MM" (24-hour). Returns null if invalid. */
export function parseTime(hhmm: string): { h: number; m: number } | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return { h, m: min };
}

/** The most recent scheduled time at or before `now`, in local time. */
export function lastScheduled(now: Date, hhmm: string): Date | null {
	const t = parseTime(hhmm);
	if (!t) return null;
	const d = new Date(now);
	d.setHours(t.h, t.m, 0, 0);
	if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
	return d;
}

/**
 * Due when the latest scheduled time has passed since the last run.
 * This covers both "it's the time now" and the catch-up when Obsidian was closed at that time.
 */
export function isDue(now: Date, hhmm: string, lastRunIso: string | null): boolean {
	const due = lastScheduled(now, hhmm);
	if (!due) return false;
	if (!lastRunIso) return true;
	const last = new Date(lastRunIso);
	if (Number.isNaN(last.getTime())) return true;
	return last.getTime() < due.getTime();
}
