declare module "ical.js" {
	// ical.js is used for parsing only; we touch a small, stable subset of its
	// API surface. Keep this loose to avoid coupling the build to its types.
	export function parse(input: string): any;
	export class Component {
		constructor(jCal: any);
		getAllSubcomponents(kind: string): any[];
	}
	export class Event {
		constructor(component: any);
		uid: string;
		summary: string;
		location?: string;
		description?: string;
		status?: string;
		recurrenceId: any | null;
		startDate: any;
		endDate: any;
		isRecurring(): boolean;
		iterator(startTime: any): any;
		getOccurrenceDetails(occurrence: any): {
			recurrenceId: any;
			startDate: any;
			endDate: any;
			item: any;
		};
	}
	export class Time {
		static fromJSDate(date: Date, useUTC?: boolean): Time;
		toUnixTime(): number;
		toJSDate(): Date;
		toString(): string;
		isDate: boolean;
	}
}
