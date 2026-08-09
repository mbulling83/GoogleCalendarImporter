import * as ICAL from "ical.js";
import { requestUrl } from "obsidian";

/**
 * Read-only Google Calendar access through the "secret address in iCal format"
 * that Google publishes per-calendar in Calendar settings → Integrate calendar.
 *
 * No OAuth, no client ID, no refresh tokens. The URL is itself the credential,
 * and it is read-only — Google will not let anyone write through it. That makes
 * it the elegant fit for a plugin whose only job is to *show* today's events.
 */

export class ConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigurationError";
	}
}

export interface GoogleCalendarCredentials {
	icsUrl: string;
}

export interface CalendarEvent {
	uid?: string;
	summary: string;
	location?: string;
	description?: string;
	start: { date?: string; dateTime?: string };
	end: { date?: string; dateTime?: string };
}

export interface CalendarData {
	events: { items: CalendarEvent[] } | null;
}

/** Override occurrences that land this far outside the queried day are still
 *  caught, so a meeting moved onto/off of the target day shows correctly. */
const EXPANSION_PADDING_DAYS = 7;
/** Short-lived in-memory cache so the auto-refresh timer does not hammer Google. */
const CACHE_TTL_MS = 30_000;

export class GoogleCalendarAPI {
	private credentials: GoogleCalendarCredentials;
	private cache: { url: string; text: string; at: number } | null = null;

	constructor(credentials: GoogleCalendarCredentials) {
		this.credentials = credentials;
	}

	async getCalendarDataForDate(date: string): Promise<CalendarData | null> {
		if (!this.credentials.icsUrl) {
			throw new ConfigurationError(
				"No iCal feed configured. Add your Google Calendar secret address in Settings → Google Calendar Importer."
			);
		}

		try {
			const icsText = await this.fetchICS();
			const items = this.extractEventsForDate(icsText, date);
			return { events: { items } };
		} catch (error) {
			if (error instanceof ConfigurationError) throw error;
			const message = error instanceof Error ? error.message : "Unknown error";
			console.error("ICS calendar fetch/parse error:", error);
			throw new Error(`Failed to load calendar: ${message}`);
		}
	}

	cleanup(): void {
		// Nothing to tear down — no server, no token refresh loop.
	}

	private async fetchICS(): Promise<string> {
		const now = Date.now();
		if (
			this.cache &&
			this.cache.url === this.credentials.icsUrl &&
			now - this.cache.at < CACHE_TTL_MS
		) {
			return this.cache.text;
		}

		// Obsidian's requestUrl routes through the main process, so it is not bound
		// by the renderer's CORS policy. The renderer's own fetch() is blocked by
		// Google's calendar server, which sends no Access-Control-Allow-Origin
		// header (app://obsidian.md is not a web origin it will allow).
		const res = await requestUrl({
			url: this.credentials.icsUrl,
			method: "GET",
		});
		if (res.status >= 400) {
			throw new Error(`HTTP ${res.status}`);
		}
		const text = res.text;
		this.cache = { url: this.credentials.icsUrl, text, at: now };
		return text;
	}

	private extractEventsForDate(icsText: string, date: string): CalendarEvent[] {
		const jcal = ICAL.parse(icsText);
		const root = new ICAL.Component(jcal);
		const vevents = root.getAllSubcomponents("vevent");

		const baseEvents: any[] = [];
		// uid -> recurrenceId(unix) -> override Event
		const overrides: Map<string, Map<number, any>> = new Map();

		for (const v of vevents) {
			const ev = new ICAL.Event(v);
			if (ev.recurrenceId) {
				// An override is kept even when STATUS:CANCELLED: it marks a single
				// instance as deleted, so the base iteration must find it to skip
				// that occurrence.
				const uid = ev.uid ?? "";
				if (!overrides.has(uid)) overrides.set(uid, new Map());
				overrides.get(uid)!.set(ev.recurrenceId.toUnixTime(), ev);
			} else {
				// A base event cancelled as a whole is a deleted series/event.
				if (this.statusOf(ev) === "CANCELLED") continue;
				baseEvents.push(ev);
			}
		}

		const [dayStart, dayEnd] = this.dayBounds(date);
		const rangeStart = ICAL.Time.fromJSDate(
			new Date(dayStart.getTime() - EXPANSION_PADDING_DAYS * 86400_000)
		);
		const rangeEnd = ICAL.Time.fromJSDate(
			new Date(dayEnd.getTime() + EXPANSION_PADDING_DAYS * 86400_000)
		);
		const rangeStartUnix = rangeStart.toUnixTime();
		const rangeEndUnix = rangeEnd.toUnixTime();

		const collected: CalendarEvent[] = [];
		const handled = new Set<string>();

		for (const base of baseEvents) {
			const uid = base.uid ?? "";
			const overrideMap = overrides.get(uid) ?? new Map<number, any>();

			if (base.isRecurring()) {
				// Seed the expansion with the real DTSTART: ical.js's RecurExpansion
				// treats the seed as the recurrence anchor, so passing our query
				// window instead would shift every occurrence to midnight.
				const iter = base.iterator(base.startDate);
				let occurrence: any;
				let guard = 0;
				while ((occurrence = iter.next())) {
					if (occurrence.toUnixTime() > rangeEndUnix) break;
					const key = occurrence.toUnixTime();
					const override = overrideMap.get(key);
					if (override) {
						handled.add(`${uid}:${key}`);
						if (this.statusOf(override) === "CANCELLED") continue;
						if (key < rangeStartUnix) continue;
						collected.push(this.eventFromTimes(override));
						continue;
					}
					if (key < rangeStartUnix) continue;
					const details = base.getOccurrenceDetails(occurrence);
					collected.push(this.eventFromTimes(details.item, details.startDate, details.endDate));
					if (++guard > 100000) break; // defensive cap for pathological feeds
				}
			} else {
				collected.push(this.eventFromTimes(base));
			}
		}

		// Overrides whose base occurrence was not inside the expansion window
		// (e.g. a one-off reschedule dragged onto the target day) still need to
		// surface; skip anything already handled above.
		for (const [uid, map] of overrides) {
			for (const [key, override] of map) {
				if (handled.has(`${uid}:${key}`)) continue;
				if (this.statusOf(override) === "CANCELLED") continue;
				collected.push(this.eventFromTimes(override));
			}
		}

		return collected.filter((e) => this.overlapsDay(e, dayStart, dayEnd));
	}

	/** ical.js does not surface STATUS as a property on `Event`; read it from the
	 *  underlying component instead. */
	private statusOf(ev: any): string | null {
		return ev.component?.getFirstPropertyValue?.("status") ?? null;
	}

	/** Normalise an ical.js Event (or a generated occurrence) into the
	 *  `{ summary, start, end }` shape the renderer already expects. */
	private eventFromTimes(
		ev: any,
		start?: any,
		end?: any
	): CalendarEvent {
		const startDate = start ?? ev.startDate;
		const endDate = end ?? ev.endDate;
		const allDay = !!startDate.isDate;

		return {
			uid: ev.uid,
			summary: ev.summary ?? "",
			location: ev.location,
			description: ev.description,
			start: allDay
				? { date: startDate.toString() }
				: { dateTime: startDate.toJSDate().toISOString() },
			end: allDay
				? { date: endDate.toString() }
				: { dateTime: endDate.toJSDate().toISOString() },
		};
	}

	private dayBounds(date: string): [Date, Date] {
		const [y, m, d] = date.split("-").map(Number);
		const start = new Date(y, m - 1, d, 0, 0, 0, 0);
		const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
		return [start, end];
	}

	private overlapsDay(e: CalendarEvent, dayStart: Date, dayEnd: Date): boolean {
		const start = e.start.dateTime
			? new Date(e.start.dateTime)
			: e.start.date
			? this.parseDateOnly(e.start.date)
			: null;
		const end = e.end.dateTime
			? new Date(e.end.dateTime)
			: e.end.date
			? this.parseDateOnly(e.end.date)
			: null;
		if (!start || !end) return false;
		// iCal DATE-only end is exclusive, so this is correct for all-day spans.
		return end > dayStart && start < dayEnd;
	}

	private parseDateOnly(s: string): Date {
		const [y, m, d] = s.split("-").map(Number);
		return new Date(y, m - 1, d, 0, 0, 0, 0);
	}
}
