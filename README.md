# Google Calendar Importer

A simple and light-weighted google calendar importer, allow injecting the events / tasks of a day automatically to your daily notes, or import it to anywhere with a command.

## Features

- 🗓️ **Automatic Daily Notes Integration**: Automatically inject calendar events when opening daily notes
![auto-ezgif com-video-to-gif-converter](https://github.com/user-attachments/assets/a921e481-df5f-47ab-abc6-3f5ced347e40)

- 📝 **Manual Import Command**: Insert calendar blocks anywhere in your notes with a simple command
  ![command-ezgif com-video-to-gif-converter](https://github.com/user-attachments/assets/33cffa31-51cb-4518-ab88-559549c6cf74)

- 🎯 **Date-Specific Imports**: Choose any date to import events for that specific day
- 🔄 **Live Calendar Blocks**: Uses markdown code blocks as configuration that render your calendar events as you want
- 🔐 **No OAuth**: Uses Google Calendar's read-only "secret address in iCal format" — no Google Cloud project, no client ID, no token refresh.

## Requirements

- Obsidian v0.15.0 or later
- Desktop version of Obsidian (plugin is desktop-only)
- A Google Calendar and its secret iCal address (Settings → Integrate calendar)

## Setup

This plugin reads your calendar through Google's **secret address in iCal format** — a read-only URL Google publishes per calendar. No Google Cloud project, no OAuth consent screen, no client ID or secret.

### 1. Get your secret iCal address

1. Open [Google Calendar](https://calendar.google.com/) on the web
2. Go to **Settings** → select the calendar you want to show
3. Scroll to **Integrate calendar** and copy the **Secret address in iCal format** (it ends in `/basic.ics`)

The URL is a credential: anyone who has it can read that calendar, so keep it private. Regenerate it in Google Calendar settings if it ever leaks.

### 2. Plugin Configuration

1. Open Obsidian Settings → Community Plugins → **Google Calendar Importer**
2. Paste the secret iCal address into **Secret iCal address**
3. Toggle **Enable for Daily Notes** to auto-insert calendar blocks when opening daily notes
4. Adjust the timed / all-day event format templates if you like

Events load the next time a calendar block renders.


## Installation

### From Obsidian Community Plugins (Recommended)
*[When available in the community plugin directory]*

1. Open Obsidian Settings
2. Go to Community Plugins and disable Safe Mode
3. Click Browse and search for "Google Calendar Importer"
4. Install and enable the plugin

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/lexafaxine/google-calendar-importer/releases)
2. Extract the files to `VaultFolder/.obsidian/plugins/google-calendar-importer/`
3. Reload Obsidian and enable the plugin in settings

### Development Installation

1. Clone this repository into your `.obsidian/plugins/` folder:
   ```bash
   git clone https://github.com/lexafaxine/google-calendar-importer.git
   ```
2. Navigate to the plugin folder and install dependencies:
   ```bash
   cd google-calendar-importer
   npm install
   ```
3. Build the plugin:
   ```bash
   npm run build
   ```
4. Enable the plugin in Obsidian settings

## Development

### Prerequisites

- Node.js v16 or later
- npm or yarn

### Building

```bash
# Install dependencies
npm install

# Development build (watch mode)
npm run dev

# Production build
npm run build
```

### Code Structure

- `main.ts` - Main plugin class and core functionality
- `googleCalendarAPI.ts` - iCal feed fetching and parsing (recurring + override expansion) via `ical.js`
- `codeBlockProcessor.ts` - Markdown code block processor for rendering
- `dateInputModal.ts` - Modal for selecting dates

## Privacy & Security

- The plugin reads your calendar through Google's read-only secret iCal URL
- No OAuth tokens are stored; the URL itself is the only credential, kept in Obsidian's plugin data
- Calendar data is fetched on demand and cached in memory for ~30 seconds
- The plugin cannot write to your calendar — the iCal feed is read-only by design

## Troubleshooting

### Calendar Not Loading

- Check the secret iCal address is pasted correctly (it must end in `/basic.ics`)
- Verify you copied the *secret address in iCal format*, not the public one
- Regenerate the address in Google Calendar settings if it stops working

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you find this plugin useful, consider supporting the development:

- ⭐ Star this repository
- 🐛 Report issues on [GitHub](https://github.com/lexafaxine/google-calendar-importer/issues)
- 💡 Suggest new features

## Changelog

### v1.2.0
- **Replaced OAuth with Google Calendar's read-only secret iCal address.**
- No Google Cloud project, client ID/secret, or token refresh required.
- Removed Google Tasks (the iCal feed carries events only).
- Recurring events and one-off overrides (moved / cancelled instances) are now expanded locally with `ical.js`.

### v1.0.0
- Initial release
- Basic Google Calendar integration
- Daily notes automation
- Manual calendar block insertion
- OAuth 2.0 authentication

---

**Author**: [lexafaxine](https://github.com/lexafaxine)
