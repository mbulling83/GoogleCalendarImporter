import { App, Editor, Notice, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, moment } from 'obsidian';
import { GoogleCalendarAPI, GoogleCalendarCredentials, CalendarData } from './googleCalendarAPI';
import { DateInputModal } from './dateInputModal';

interface GoogleCalendarImporterSettings {
	icsUrl: string;
	eventFormat: string;
	allDayFormat: string;
}

const DEFAULT_SETTINGS: GoogleCalendarImporterSettings = {
	icsUrl: '',
	eventFormat: '- {start} - {end}: {title}',
	allDayFormat: '- All day: {title}',
}

export default class GoogleCalendarImporter extends Plugin {
	settings: GoogleCalendarImporterSettings;
	private googleCalendarAPI: GoogleCalendarAPI;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'insert-calendar-events-as-text',
			name: 'Insert calendar events as text',
			editorCheckCallback: (checking, editor, ctx) => {
				if (ctx instanceof MarkdownView && ctx.file) {
					if (!checking) {
						const dateFromFile = this.extractDateFromFilename(ctx.file);
						new DateInputModal(this.app, (date: string) => {
							const targetDate = date || dateFromFile || moment().format('YYYY-MM-DD');
							this.insertCalendarAsText(editor, targetDate);
						}).open();
					}
					return true;
				}
				return false;
			}
		});

		this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.initializeGoogleCalendarAPI();
	}

	private initializeGoogleCalendarAPI() {
		const credentials: GoogleCalendarCredentials = {
			icsUrl: this.settings.icsUrl,
		};
		this.googleCalendarAPI = new GoogleCalendarAPI(credentials);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.initializeGoogleCalendarAPI();
	}

	private extractDateFromFilename(file: TFile): string {
		const dateMatch = file.basename.match(/\d{4}-\d{2}-\d{2}/);
		return dateMatch ? dateMatch[0] : '';
	}

	private formatTime(dateTimeString: string): string {
		const date = new Date(dateTimeString);
		return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
	}

	private formatTime12(dateTimeString: string): string {
		const date = new Date(dateTimeString);
		return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
	}

	private applyFormat(template: string, vars: Record<string, string>): string {
		return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
	}

	private formatCalendarData(data: CalendarData): string {
		const lines: string[] = [];

		if (data.events?.items) {
			for (const event of data.events.items) {
				if (!event.summary) continue;

				const isAllDay = event.start?.date && !event.start?.dateTime;
				if (isAllDay) {
					lines.push(this.applyFormat(this.settings.allDayFormat, {
						title: event.summary,
					}));
				} else if (event.start?.dateTime && event.end?.dateTime) {
					lines.push(this.applyFormat(this.settings.eventFormat, {
						title: event.summary,
						start: this.formatTime(event.start.dateTime),
						end: this.formatTime(event.end.dateTime),
						start12: this.formatTime12(event.start.dateTime),
						end12: this.formatTime12(event.end.dateTime),
					}));
				}
			}
		}

		return lines.join('\n');
	}

	async insertCalendarAsText(editor: Editor, date: string) {
		new Notice(`Fetching calendar for ${date}...`);
		try {
			const data = await this.googleCalendarAPI.getCalendarDataForDate(date);
			if (!data) {
				new Notice('Failed to fetch calendar data. Check your iCal URL.');
				return;
			}
			const text = this.formatCalendarData(data);
			if (!text) {
				new Notice(`No events found for ${date}.`);
				return;
			}
			const cursor = editor.getCursor();
			editor.replaceRange(text + '\n', cursor);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Failed to fetch calendar: ${message}`, 10000);
		}
	}
}

class GoogleCalendarSettingTab extends PluginSettingTab {
	plugin: GoogleCalendarImporter;

	constructor(app: App, plugin: GoogleCalendarImporter) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h3', {text: 'Event format'});

		new Setting(containerEl)
			.setName('Timed event format')
			.setDesc('Template for timed events. Variables: {start}, {end}, {start12}, {end12}, {title}')
			.addText(text => text
				.setPlaceholder('- {start} - {end}: {title}')
				.setValue(this.plugin.settings.eventFormat)
				.onChange(async (value) => {
					this.plugin.settings.eventFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('All-day event format')
			.setDesc('Template for all-day events. Variables: {title}')
			.addText(text => text
				.setPlaceholder('- All day: {title}')
				.setValue(this.plugin.settings.allDayFormat)
				.onChange(async (value) => {
					this.plugin.settings.allDayFormat = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', {text: 'Google Calendar feed'});

		// Setup instructions for the secret iCal address
		const setupInstructions = containerEl.createEl('div', { cls: 'google-calendar-setup-instructions' });
		setupInstructions.createEl('p', {
			text: 'In Google Calendar on the web, open Settings → the calendar you want to show → Integrate calendar. Copy the "Secret address in iCal format". Paste it below — this plugin is read-only, so the secret URL is all it needs. No Google Cloud project, no OAuth, no client ID.',
		});
		setupInstructions.createEl('p', {
			text: 'The URL is treated as a credential: anyone who has it can read that calendar. Keep it private, and regenerate it in Google Calendar settings if it leaks.',
			cls: 'google-calendar-setup-note',
		});

		new Setting(containerEl)
			.setName('Secret iCal address')
			.setDesc('The "Secret address in iCal format" from Google Calendar → Integrate calendar')
			.addText(text => text
				.setPlaceholder('https://calendar.google.com/calendar/ical/.../basic.ics')
				.setValue(this.plugin.settings.icsUrl)
				.onChange(async (value) => {
					this.plugin.settings.icsUrl = value.trim();
					await this.plugin.saveSettings();
				}));

		const isConfigured = !!this.plugin.settings.icsUrl;

		new Setting(containerEl)
			.setName('Feed status')
			.setDesc(isConfigured ? '✓ iCal feed configured' : '✗ Not configured')
			.then(setting => {
				setting.descEl.style.color = isConfigured
					? 'var(--color-green)'
					: 'var(--text-muted)';
				setting.descEl.createEl('div', {
					text: isConfigured
						? 'Run the "Insert calendar events as text" command to import a day\'s events.'
						: 'Paste your secret iCal address above to start importing events.',
					cls: 'setting-item-description',
				});
			});
	}
}
