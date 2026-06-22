import { calendar_v3, google } from "googleapis";
import { OAuthServer, OAuthCredentials } from "./oauthServer";
import { Credentials } from "google-auth-library";

export class AuthenticationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AuthenticationError';
	}
}

function isAuthError(error: unknown): boolean {
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		if (
			msg.includes('invalid_grant') ||
			msg.includes('invalid credentials') ||
			msg.includes('token has been expired') ||
			msg.includes('unauthorized') ||
			msg.includes('unauthenticated')
		) return true;
	}
	const status = (error as any)?.response?.status ?? (error as any)?.code;
	return status === 401 || status === 403;
}

export interface GoogleCalendarCredentials {
	clientId: string;
	clientSecret: string;
	accessToken?: string;
	refreshToken?: string;
}

export interface CalendarData {
	events: calendar_v3.Schema$Events | null;
}

export class GoogleCalendarAPI {
	private credentials: GoogleCalendarCredentials;
	private calendar: calendar_v3.Calendar;
	private oauthServer: OAuthServer;
	private onTokensUpdated?: (tokens: Credentials) => void;

	constructor(
		credentials: GoogleCalendarCredentials,
		onTokensUpdated?: (tokens: Credentials) => void
	) {
		this.credentials = credentials;
		this.oauthServer = new OAuthServer();
		this.onTokensUpdated = onTokensUpdated;
		this.initializeAPI();
	}

	private initializeAPI() {
		const auth = new google.auth.OAuth2(
			this.credentials.clientId,
			this.credentials.clientSecret,
			"http://localhost:8080/callback"
		);

		if (this.credentials.accessToken) {
			auth.setCredentials({
				access_token: this.credentials.accessToken,
				refresh_token: this.credentials.refreshToken,
			});

			// Set up automatic token refresh
			auth.on("tokens", (tokens) => {
				if (tokens.refresh_token) {
					this.credentials.refreshToken = tokens.refresh_token;
				}
				if (tokens.access_token) {
					this.credentials.accessToken = tokens.access_token;
				}
				// Notify that tokens have been updated
				this.onTokensUpdated?.(tokens);
			});
		}

		this.calendar = google.calendar({ version: "v3", auth });
	}

	async getEventsForDate(
		date: string
	): Promise<calendar_v3.Schema$Events | null> {
		try {
			if (!this.credentials.clientId || !this.credentials.clientSecret) {
				throw new Error(
					"Google Calendar API credentials not configured"
				);
			}

			const startOfDay = new Date(date);
			startOfDay.setHours(0, 0, 0, 0);

			const endOfDay = new Date(date);
			endOfDay.setHours(23, 59, 59, 999);

			const response = await this.calendar.events.list({
				calendarId: "primary",
				timeMin: startOfDay.toISOString(),
				timeMax: endOfDay.toISOString(),
				singleEvents: true,
				orderBy: "startTime",
			});

			return response.data;
		} catch (error) {
			if (isAuthError(error)) {
				throw new AuthenticationError('Google Calendar authorization has expired. Please re-authorize in plugin settings.');
			}
			console.error("Error fetching calendar events:", error);
			return null;
		}
	}

	async getCalendarDataForDate(date: string): Promise<CalendarData | null> {
		try {
			const events = await this.getEventsForDate(date);
			return { events };
		} catch (error) {
			if (error instanceof AuthenticationError) throw error;
			return null;
		}
	}

	async startOAuthFlow(): Promise<Credentials> {
		try {
			const oauthCredentials: OAuthCredentials = {
				clientId: this.credentials.clientId,
				clientSecret: this.credentials.clientSecret,
			};

			const tokens = await this.oauthServer.startOAuthFlow(
				oauthCredentials
			);
			return tokens;
		} catch (error) {
			console.error("OAuth flow error:", error);
			throw error;
		}
	}

	cleanup(): void {
		this.oauthServer.cleanup();
	}
}
