# BeagleBone Black Dashboard — Project Outline

## Overview

A lightweight, always-on dashboard displayed fullscreen on an LG WebOS TV. The frontend is plain HTML/CSS/JS served as static files from Node-RED. Node-RED handles all backend work — API polling, data transformation, serving the UI, and **driving the display by commanding the TV's built-in browser over the network**.

**Display strategy (revised):** Rather than rendering locally on the BeagleBone (Chromium on a minimal X server over HDMI), the dashboard is displayed by the **TV's own built-in WebOS browser**, pointed at the Node-RED endpoint. The BeagleBone is now a pure backend + control plane: it serves data and tells the TV what to show via the LG WebOS API. This sidesteps the BBB's weak GPU, the X/LCDC scanout problems, and the eMMC disk-space pressure from X-related packages.

## Why the strategy changed

The original plan ran Chromium in kiosk mode on a minimal Xorg server, output over micro-HDMI. This was abandoned after extended troubleshooting:

- **X scanout never reached this TV.** X rendered correctly internally (confirmed via screenshot), and `xrandr` reported a valid 1920x1080 mode, but pixels never reached the panel — even a bare `xsetroot -solid red` root-window test showed nothing. The kernel framebuffer console (boot text, penguin, Beagle logo) *did* display, proving the HDMI hardware path works; the failure was specifically in the kernel-framebuffer → X-scanout handoff.
- **glamor failed → software rendering only.** `glamor initialization failed` in the Xorg log left rendering on llvmpipe with no shadow framebuffer, a likely contributor to the missing scanout.
- **Consistent mode-negotiation pattern across displays.** The dashboard rendered fine on a small (~400x600) monitor, showed a half-width (~945px) window on a 1920x1080 monitor, and never displayed on this TV — pointing at unstable X mode negotiation rather than a Chromium or hardware fault.
- **Disk pressure.** The eMMC reached ~97% utilization, partly from installing X/Chromium-related packages. Removing the local-rendering stack relieves this.

The WebOS browser, by contrast, displayed the dashboard on this TV on the first attempt.

## Hardware

- BeagleBone Black (non-wireless variant)
- USB WiFi dongle for network connectivity
- LG WebOS TV (model MCR66570509), controlled over the network

## Software Stack

| Component | Role |
|---|---|
| Debian 11 (Bullseye) on eMMC | Operating System |
| Node-RED | Backend, API polling, static file server, TV control plane |
| LG WebOS browser (on TV) | Frontend display |
| systemd | Service management for Node-RED |

**Removed from the stack:** Chromium, Xorg (minimal, no DE), `xinit`/`startx`, `unclutter`, the `kiosk.service` local-rendering pipeline. These are no longer needed and can be uninstalled to recover eMMC space.

## Directory Structure

```
/var/lib/node-red/.node-red/
├── flows.json           # Node-RED flows (backend logic + TV control)
├── settings.js          # Node-RED configuration
└── public/              # Static frontend files served by Node-RED
    ├── index.html       # Main dashboard page
    ├── style.css        # Styles
    └── app.js           # Frontend JS (fetches data from Node-RED API endpoints)
```

## Architecture

```
Open-Meteo API
      │
      ▼
Node-RED (port 1880)
  ├── Polls weather API every 5 minutes
  ├── Stores parsed data in flow variables
  ├── Exposes data via HTTP endpoint (GET /api/weather)
  ├── Serves static frontend files from /public/
  └── Controls TV via LG WebOS API (power, input, browser launch, keepalive)
            │
            ▼ (ssap:// WebSocket command launches browser at the URL)
      LG WebOS Browser (on TV)
      loads http://<bbb-ip>:1880/home
      polls /api/weather
      updates DOM
```

## TV Control (LG WebOS API)

The TV is controlled over the network via the WebOS SSAP WebSocket protocol (the same channel already in use for power and input switching):

- **Power on** — Wake-on-LAN (network stack is down in standby)
- **Power off** — `ssap://system/turnOff` over WebSocket
- **Input switching** — `ssap://tv/switchInput`
- **Launch dashboard browser** — `ssap://system.launcher/launch` with the browser app ID and a `target` URL pointing at `http://<bbb-ip>:1880/home`
- **State detection** — ping the TV before sending commands; if offline, send WoL first

## WebOS Browser — Known Challenges & Caveats

The TV's built-in browser is convenient but is **not designed for kiosk / always-on use**. These behaviors need to be designed around:

- **App lifecycle / eviction.** WebOS aggressively manages memory and may suspend or kill the browser app after inactivity, on input switches, or overnight. "Launch once and walk away" is unreliable. **Mitigation:** a Node-RED keepalive that periodically re-asserts the browser launch (and/or checks foreground app state) and relaunches if the dashboard isn't showing.
- **Dated rendering engine.** The WebOS browser runs an older WebKit build, behind desktop Chrome. Confirmed issue: the 7-day forecast cards stack **vertically** instead of horizontally — a flexbox/grid layout not being honored. **Mitigation:** conservative, well-supported CSS (vendor-prefixed `-webkit-` flex properties or a more defensive layout); avoid relying on newer CSS features (`gap`, newer grid syntax) without fallbacks.
- **Unknown JavaScript ceiling.** It is not yet established which modern JS/Web APIs the engine supports. As dashboard richness grows (calendar module, etc.), features may hit an engine wall. **Mitigation:** keep the frontend conservative; test new capabilities early on the actual TV; consider transpilation/polyfills if needed.
- **No true kiosk mode.** Browser chrome (address bar, cursor) appears on launch. Observed to **auto-hide after ~10 seconds**, which is acceptable for this use case, but there is no native fullscreen-kiosk lock.
- **Painful dev loop on-device.** No DevTools equivalent; iterating CSS/JS requires sitting in front of the TV. **Mitigation:** develop and iterate primarily in VS Code / desktop Chrome, then validate the conservative-compatibility subset against the TV periodically rather than per-change.

## Frontend (index.html / app.js)

- Polls `http://<bbb-ip>:1880/api/weather` on load and every 5 minutes
- **Current conditions panel:** temperature, humidity, wind speed, barometric pressure, precipitation probability, cloud cover, UV index, AQI
- **7-day forecast panel:** one card per day showing high/low temp, precipitation probability, max wind speed, mean barometric pressure
- No external dependencies — plain JS `fetch()`, CSS custom properties for theming
- Designed for TV display: large text, high contrast, readable from across a room
- **New constraint:** CSS/JS must target the WebOS WebKit engine, not just desktop Chrome (see caveats above)

## Planned Dashboard Modules

- [x] Weather — current conditions
- [x] Weather — 7-day forecast
- [ ] CSS compatibility pass for WebOS browser (fix forecast-row layout)
- [ ] WebOS browser launch + keepalive flow in Node-RED
- [ ] Calendar (Google Calendar API)
- [ ] Additional modules TBD

## Key Configuration

**Node-RED static file serving** — in `settings.js`:
```javascript
httpStatic: '/var/lib/node-red/.node-red/public',
```

**TV browser launch** — via Node-RED WebOS node / SSAP command:
```
ssap://system.launcher/launch
  → browser app, target: http://<bbb-ip>:1880/home
```

**Boot / display sequence (revised):**
1. systemd starts `nodered.service` (runs as `node-red` user)
2. Node-RED polls APIs and serves the dashboard + `/api/weather`
3. Node-RED (on a schedule or trigger) ensures the TV is on (WoL if needed) and on the correct input
4. Node-RED launches the WebOS browser at `http://<bbb-ip>:1880/home`
5. Keepalive flow periodically re-asserts the browser launch to survive WebOS eviction

## Network

- WiFi via USB dongle, configured with `wpa_supplicant`
- SSH access: `ssh debian@<ip>`
- Node-RED editor: `http://<ip>:1880`
- Cockpit admin UI: `http://<ip>:9090`
- Dashboard (from network or TV): `http://<ip>:1880/home`

## Housekeeping / Follow-ups

- **Recover eMMC space (~97% full):** uninstall Chromium, Xorg, `xinit`, `unclutter`; remove `kiosk.service`, `~/kiosk.sh`, `~/.xinitrc`, and any `/etc/X11/xorg.conf.d` drop-ins created during X troubleshooting.
- Keep the X/Chromium approach documented here as a fallback in case WebOS browser limitations prove blocking down the line.
