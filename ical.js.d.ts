declare module "ical.js" {
	// ical.js ships a CJS module whose default export is the ICAL namespace
	// object. We import it as a default so esbuild does not tree-shake the
	// named members to `undefined` (which is what happens with
	// `import * as ICAL` for this particular CJS build).
	export interface Component {
		getAllSubcomponents(kind: string): any[];
	}
	export class Event {
		constructor(component: any);
		uid: string;
		summary: string;
		location?: string;
		description?: string;
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
		readonly component: {
			getFirstPropertyValue(name: string): any;
		};
	}
	export class Time {
		static fromJSDate(date: Date, useUTC?: boolean): Time;
		toUnixTime(): number;
		toJSDate(): Date;
		toString(): string;
		isDate: boolean;
	}
	const ICAL: {
		parse(input: string): any;
		Component: typeof Component;
		Event: typeof Event;
		Time: typeof Time;
	};
	export default ICAL;
}
