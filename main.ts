import { App, Editor, Notice, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, moment } from 'obsidian';
import { GoogleCalendarAPI, GoogleCalendarCredentials, CalendarData } from './googleCalendarAPI';
import { Credentials } from "google-auth-library";
import { createCodeBlockProcessor } from './codeBlockProcessor';
import { DateInputModal } from './dateInputModal';

interface GoogleCalendarImporterSettings {
	enabledForDailyNotes: boolean;
	googleClientId: string;
	googleClientSecret: string;
	googleAccessToken: string;
	googleRefreshToken: string;
	eventFormat: string;
	allDayFormat: string;
}

const DEFAULT_SETTINGS: GoogleCalendarImporterSettings = {
	enabledForDailyNotes: true,
	googleClientId: '',
	googleClientSecret: '',
	googleAccessToken: '',
	googleRefreshToken: '',
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
		this.initializeGoogleCalendarAPI(); // TODO: reload authenticate info real time rather than after loadSettings.
	}

	private initializeGoogleCalendarAPI() {
		const credentials: GoogleCalendarCredentials = {
			clientId: this.settings.googleClientId,
			clientSecret: this.settings.googleClientSecret,
			accessToken: this.settings.googleAccessToken,
			refreshToken: this.settings.googleRefreshToken
		};

		const onTokensUpdated = async (tokens: Credentials) => {
			if (tokens.access_token) {
				this.settings.googleAccessToken = tokens.access_token;
			}
			if (tokens.refresh_token) {
				this.settings.googleRefreshToken = tokens.refresh_token;
			}
			await this.saveSettings();
		};

		this.googleCalendarAPI = new GoogleCalendarAPI(credentials, onTokensUpdated);
	}

	async handleGoogleAuth() {
		if (!this.settings.googleClientId || !this.settings.googleClientSecret) {
			new Notice('Please enter your Google Client ID and Client Secret first.');
			return;
		}

		// Clear any existing tokens so the OAuth flow starts fresh
		this.settings.googleAccessToken = '';
		this.settings.googleRefreshToken = '';
		this.initializeGoogleCalendarAPI();

		new Notice('Opening Google authorization page...');

		try {
			// Use the local loopback redirect flow (oauthServer.ts). Google's OAuth 2.0
			// policy permits http://localhost redirects for Desktop-app clients, but not
			// custom URI schemes like obsidian://.
			const tokens = await this.googleCalendarAPI.startOAuthFlow();

			if (tokens.access_token && tokens.refresh_token) {
				this.settings.googleAccessToken = tokens.access_token;
				this.settings.googleRefreshToken = tokens.refresh_token;
				await this.saveSettings();
				this.initializeGoogleCalendarAPI();
				new Notice('Google Calendar authorized successfully.');
			} else {
				new Notice('Authorization incomplete — no tokens received. Please try again.');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Google Calendar authorization failed: ${message}`, 10000);
			console.error('Error during OAuth flow:', error);
		}
	}

	async logout() {
		this.settings.googleAccessToken = '';
		this.settings.googleRefreshToken = '';
		await this.saveSettings();
		this.initializeGoogleCalendarAPI();
		new Notice('Signed out of Google Calendar.');
	}

	async saveSettings() {
		await this.saveData(this.settings);
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
				new Notice('Failed to fetch calendar data. Check your credentials.');
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

		containerEl.createEl('h3', {text: 'Google Calendar API'});

		// OAuth client setup instructions
		const setupInstructions = containerEl.createEl('div', { cls: 'google-calendar-setup-instructions' });
		setupInstructions.createEl('p', {
			text: 'In Google Cloud Console (APIs & Services → Credentials), create an OAuth 2.0 Client ID of type "Desktop app". Desktop-app clients allow the local loopback redirect this plugin uses — no redirect URI needs to be registered manually.',
		});
		setupInstructions.createEl('p', {
			text: 'Make sure the project\'s OAuth consent screen is your own and that your Google account is added as a Test user. Then paste that client\'s ID and secret below.',
			cls: 'google-calendar-setup-note',
		});

		new Setting(containerEl)
			.setName('Google client ID')
			.setDesc('OAuth 2.0 client ID from Google Cloud console')
			.addText(text => text
				.setPlaceholder('Enter your Google client ID')
				.setValue(this.plugin.settings.googleClientId)
				.onChange(async (value) => {
					this.plugin.settings.googleClientId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Google client secret')
			.setDesc('OAuth 2.0 client secret from Google Cloud Console')
			.addText(text => text
				.setPlaceholder('Enter your Google client secret')
				.setValue(this.plugin.settings.googleClientSecret)
				.onChange(async (value) => {
					this.plugin.settings.googleClientSecret = value;
					await this.plugin.saveSettings();
				}));

		const isAuthorized = !!(this.plugin.settings.googleAccessToken && this.plugin.settings.googleRefreshToken);

		const authStatusDesc = isAuthorized
			? 'Your Google Calendar account is connected.'
			: 'Not connected. Enter your Client ID and Secret above, then click Authorize.';

		new Setting(containerEl)
			.setName('Authorization status')
			.setDesc(isAuthorized ? '✓ Authorized' : '✗ Not authorized')
			.then(setting => {
				setting.descEl.style.color = isAuthorized
					? 'var(--color-green)'
					: 'var(--text-muted)';
				setting.descEl.createEl('div', { text: authStatusDesc, cls: 'setting-item-description' });
			});

		new Setting(containerEl)
			.setName(isAuthorized ? 'Re-authorize' : 'Authorize Google Calendar')
			.setDesc(isAuthorized
				? 'Re-connect your Google account (e.g. if authorization has expired)'
				: 'Connect your Google Calendar account')
			.addButton(button => {
				button
					.setButtonText(isAuthorized ? 'Re-authorize' : 'Authorize')
					.onClick(async () => {
						await this.plugin.handleGoogleAuth();
						this.display();
					});
				if (!isAuthorized) button.setCta();
			});

		if (isAuthorized) {
			new Setting(containerEl)
				.setName('Sign out')
				.setDesc('Disconnect your Google Calendar account and clear stored tokens')
				.addButton(button => button
					.setButtonText('Sign out')
					.setWarning()
					.onClick(async () => {
						await this.plugin.logout();
						this.display();
					}));
		}
	}
}
