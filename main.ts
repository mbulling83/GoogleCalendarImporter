import { App, Editor, Notice, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, moment } from 'obsidian';
import { GoogleCalendarAPI, GoogleCalendarCredentials, CalendarData } from './googleCalendarAPI';
import { createCodeBlockProcessor } from './codeBlockProcessor';
import { DateInputModal } from './dateInputModal';

interface GoogleCalendarImporterSettings {
	enabledForDailyNotes: boolean;
	icsUrl: string;
	eventFormat: string;
	allDayFormat: string;
}

const DEFAULT_SETTINGS: GoogleCalendarImporterSettings = {
	enabledForDailyNotes: true,
	icsUrl: '',
	eventFormat: '- {start} - {end}: {title}',
	allDayFormat: '- All day: {title}',
}

export default class GoogleCalendarImporter extends Plugin {
	settings: GoogleCalendarImporterSettings;
	private googleCalendarAPI: GoogleCalendarAPI;

	async onload() {
		await this.loadSettings();

		this.registerEvent(
			this.app.workspace.on('file-open', async (file) => {
				if (file && this.settings.enabledForDailyNotes && this.isDailyNote(file)) {
					// Wait for the view to switch to the new file before inserting
					setTimeout(async () => {
						await this.insertCalendarBlock(file);
					}, 100);
				}
			})
		);

		this.addCommand({
			id: 'insert-google-calendar-block',
			name: 'Insert Google Calendar block',
			editorCheckCallback: (checking, editor, ctx) => {
				if (ctx instanceof MarkdownView && ctx.file) {
					if (!checking) {
						const file = ctx.file;
						new DateInputModal(this.app, (date: string) => {
							this.insertCalendarBlock(file, date, true);
						}).open();
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'insert-calendar-events-as-text',
			name: 'Insert calendar events as text',
			editorCheckCallback: (checking, editor, ctx) => {
				if (ctx instanceof MarkdownView && ctx.file) {
					if (!checking) {
						const file = ctx.file;
						const dateFromFile = this.extractDateFromFilename(file);
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

		this.registerMarkdownCodeBlockProcessor(
			"google-calendar",
			createCodeBlockProcessor(() => this.googleCalendarAPI)
		);

		this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));
	}

	onunload() {
		if (this.googleCalendarAPI) {
			this.googleCalendarAPI.cleanup();
		}
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

	isDailyNote(file: TFile): boolean {
		const dailyNotesFormat = /\d{4}-\d{2}-\d{2}/;
		return dailyNotesFormat.test(file.basename);
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

	async insertCalendarBlock(file: TFile, customDate?: string, isFromCommand?: boolean) {
		const todayDate = moment().format('YYYY-MM-DD');

		const dateString = isFromCommand
			? (customDate || todayDate)
			: (customDate || this.extractDateFromFilename(file) || todayDate);
		const displayDate = dateString;

		const calendarBlock = `
\`\`\`google-calendar
{
  "date": "${displayDate}",
  "refreshInterval": 60,
  "showEvents": true,
  "title": "📅 Calendar for ${displayDate}"
}
\`\`\``;

		const leaf = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (leaf && leaf.editor && leaf.file === file) {
			const content = leaf.editor.getValue();

			// Check if google-calendar block already exists
			if (content.includes('```google-calendar') && !isFromCommand) {
				return; // Don't insert duplicate blocks
			}

			leaf.editor.setValue(content + calendarBlock);
			leaf.editor.setCursor(leaf.editor.lastLine(), 0);
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

		new Setting(containerEl)
			.setName('Enable for daily notes')
			.setDesc('Automatically insert calendar block when opening daily notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enabledForDailyNotes)
				.onChange(async (value) => {
					this.plugin.settings.enabledForDailyNotes = value;
					await this.plugin.saveSettings();
				}));

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
						? 'Events will load from your Google Calendar the next time a calendar block renders.'
						: 'Paste your secret iCal address above to start importing events.',
					cls: 'setting-item-description',
				});
			});
	}
}
