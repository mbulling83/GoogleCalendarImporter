<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { GoogleCalendarAPI } from "../googleCalendarAPI";
  import type { Query } from "../Injector/Query";
  export let getApi: () => GoogleCalendarAPI;
  export let query: Query;

  let loading = false;
  let error: string | null = null;
  let isConfigError = false;
  let events: any[] = [];
  let autoRefreshInterval: number | null = null;

  // Default values
  $: displayDate = query.date || getTodayString();
  $: refreshInterval = query.refreshInterval ?? 60;
  $: showEvents = query.showEvents ?? true;
  $: title = query.title || `📅 Calendar for ${displayDate}`;

  $: if (getApi) {
    fetchCalendarData();
  }

  onMount(() => {
    if (refreshInterval > 0) {
      autoRefreshInterval = window.setInterval(
        fetchCalendarData,
        refreshInterval * 1000
      );
    }
  });

  onDestroy(() => {
    if (autoRefreshInterval !== null) {
      clearInterval(autoRefreshInterval);
    }
  });

  function getTodayString(): string {
    return new Date().toISOString().split('T')[0];
  }

  function formatTime(dateTimeString: string): string {
    const date = new Date(dateTimeString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function isAllDayEvent(event: any): boolean {
    return event.start?.date && event.end?.date && !event.start?.dateTime && !event.end?.dateTime;
  }

  async function fetchCalendarData() {
    if (loading) return;

    loading = true;
    error = null;
    isConfigError = false;

    try {
      const api = getApi();
      if (!api) {
        throw new Error("Google Calendar API not initialized");
      }

      const calendarData = await api.getCalendarDataForDate(displayDate);
      if (!calendarData) {
        throw new Error("Failed to fetch calendar data. Please check your iCal URL.");
      }
      events = showEvents && calendarData.events ? calendarData.events.items || [] : [];
    } catch (err) {
      if (err instanceof Error && err.name === 'ConfigurationError') {
        isConfigError = true;
        error = 'Add your Google Calendar secret iCal address in Settings → Google Calendar Importer.';
      } else {
        error = err instanceof Error ? err.message : "Unknown error occurred";
      }
      events = [];
    } finally {
      loading = false;
    }
  }
</script>

<div class="google-calendar-display">
  <div class="calendar-header">
    <h4>{title}</h4>
    <button
      class="refresh-button"
      on:click={fetchCalendarData}
      disabled={loading}
      title="Refresh calendar data"
    >
      {loading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if error}
    {#if isConfigError}
      <div class="calendar-auth-error">
        <div class="auth-error-icon">🔗</div>
        <div class="auth-error-content">
          <strong>No iCal feed configured</strong>
          <p>{error}</p>
        </div>
      </div>
    {:else}
      <div class="calendar-error">
        <strong>Error:</strong> {error}
      </div>
    {/if}
  {:else if events.length > 0}
    <div class="calendar-content">
      <h5>📅 Events</h5>
      <ul class="events-list">
        {#each events as event}
          {#if event.summary && (event.start?.dateTime || event.start?.date)}
            <li class="event-item">
              {#if isAllDayEvent(event)}
                <strong>All Day</strong>: {event.summary}
              {:else if event.start?.dateTime && event.end?.dateTime}
                <strong>{formatTime(event.start.dateTime)} - {formatTime(event.end.dateTime)}</strong>: {event.summary}
              {/if}
            </li>
          {/if}
        {/each}
      </ul>
    </div>
  {:else if !loading}
    <div class="calendar-empty">
      No events found for {displayDate}
    </div>
  {/if}

  {#if loading}
    <div class="calendar-loading">
      Loading calendar data...
    </div>
  {/if}
</div>

<style>
  .google-calendar-display {
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 12px;
    margin: 8px 0;
    background: var(--background-secondary);
  }

  .calendar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .calendar-header h4 {
    margin: 0;
    color: var(--text-normal);
  }

  .refresh-button {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    padding: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .refresh-button:hover {
    background: var(--interactive-accent-hover);
  }

  .refresh-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .calendar-content {
    color: var(--text-normal);
    line-height: 1.5;
  }

  .calendar-content h5 {
    margin: 12px 0 8px 0;
    color: var(--text-accent);
    font-weight: 600;
  }

  .events-list {
    margin: 0 0 16px 0;
    padding-left: 16px;
  }

  .event-item {
    margin-bottom: 4px;
    color: var(--text-normal);
  }

  .calendar-error {
    color: var(--text-error);
    background: var(--background-modifier-error);
    padding: 8px;
    border-radius: 4px;
  }

  .calendar-auth-error {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: var(--background-modifier-error);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 10px 12px;
  }

  .auth-error-icon {
    font-size: 18px;
    flex-shrink: 0;
    line-height: 1.4;
  }

  .auth-error-content strong {
    display: block;
    color: var(--text-error);
    margin-bottom: 2px;
  }

  .auth-error-content p {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.9em;
  }

  .calendar-empty {
    color: var(--text-muted);
    font-style: italic;
    text-align: center;
    padding: 16px;
  }

  .calendar-loading {
    color: var(--text-muted);
    text-align: center;
    padding: 8px;
  }
</style>
