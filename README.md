# Quarter Hour

A Chrome extension that limits selected websites to 15 minutes during a rolling one-hour window.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `chromescreentime`.
5. Open the Quarter Hour extension popup, add one domain per line, and turn on **Protection active**.

Use domains such as `youtube.com`, not full page URLs. Subdomains are included automatically.

## How it works

- Only time while a protected site is in the active tab is counted.
- Each domain has its own rolling one-hour allowance.
- After 15 minutes, the site is replaced by a local “Time’s up” page.
- Usage entries expire naturally after one hour.
- Once protection is active, changing the site list, turning protection off, or resetting timers requires starting a five-minute unlock countdown.
- The extension stores its settings and usage data locally in Chrome extension storage.
