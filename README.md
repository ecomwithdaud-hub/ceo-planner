# Zepra — Founder Command Center

A calm, browser-based command center for founders, developers, and busy teams. Plan your day, protect focus time, track priorities, and get loose thoughts out of your head.

## Features

- **Daily schedule** — Review a sample time-blocked day, switch dates, and add your own blocks.
- **Today’s priorities** — Add tasks, mark them complete, and remove them as plans change.
- **Focus room** — Run 25-minute focus sessions, 5-minute short breaks, and 15-minute long breaks.
- **Brain dump** — Capture notes with an automatic word count.
- **Personal workspace** — Save tasks, schedule blocks, notes, focus totals, and theme preference in your browser’s local storage.
- **Responsive layout** — Use the planner on desktop, tablet, or mobile.
- **Light and dark themes** — Switch themes with the control in the top bar.

## Run locally

No build step or package installation is required.

1. Clone or download the repository.
2. Open `index.html` in a browser, or open the project folder in VS Code and launch `index.html` with the Live Server extension.

## Deploy to Vercel

1. Import this repository into [Vercel](https://vercel.com/).
2. Keep the default project settings; this is a static site with no build command required.
3. Deploy.

## Data and privacy

Planner data is stored in the browser using `localStorage`. It is local to that browser and device; clearing site data or switching browsers will remove or hide the saved planner data. The app does not include a server-side account or cloud sync.

## Project files

- `index.html` — App structure and page content.
- `styles.css` — Responsive layout, components, and themes.
- `app.js` — Planner interactions, timer, and local persistence.
