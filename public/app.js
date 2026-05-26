'use strict';

const API_URL   = '/api/weather';
const POLL_MS   = 5 * 60 * 1000;

const DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

const AQI_LEVELS = [
    { max: 50,       label: 'Good',         bg: '#4caf50', fg: '#000' },
    { max: 100,      label: 'Moderate',     bg: '#ffeb3b', fg: '#000' },
    { max: 150,      label: 'USG',          bg: '#ff9800', fg: '#000' },
    { max: 200,      label: 'Unhealthy',    bg: '#f44336', fg: '#fff' },
    { max: 300,      label: 'V.Unhealthy',  bg: '#9c27b0', fg: '#fff' },
    { max: Infinity, label: 'Hazardous',    bg: '#7b1fa2', fg: '#fff' },
];

function aqiInfo(value) {
    return AQI_LEVELS.find(l => value <= l.max) || AQI_LEVELS[AQI_LEVELS.length - 1];
}

function $(id) {
    return document.getElementById(id);
}

// ── Clock ────────────────────────────────────────────────────────────────────

function updateClock() {
    const now  = new Date();
    let   h    = now.getHours();
    const m    = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    $('clock').textContent      = `${h}:${m}`;
    $('clock-ampm').textContent = ampm;
    $('header-date').textContent =
        `${DAY_NAMES[now.getDay()]}, ${MONTH_NAMES[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

// ── Render helpers ───────────────────────────────────────────────────────────

function renderCurrent(weather, aqi) {
    if (!weather) return;
    $('temperature').textContent = Math.round(weather.temperature);
    $('humidity').textContent    = `${weather.humidity}%`;
    $('wind-speed').textContent  = `${Math.round(weather.wind_speed)} mph`;
    $('pressure').textContent    = `${Math.round(weather.pressure)} hPa`;
    $('precip-prob').textContent = `${weather.precipitation_probability}%`;
    $('cloud-cover').textContent = `${weather.cloud_cover}%`;
    $('uv-index').textContent    = weather.uv_index;

    if (aqi) {
        $('pm25').textContent = `${aqi.pm2_5} µg/m³`;
        const info  = aqiInfo(aqi.us_aqi);
        const badge = $('aqi-badge');
        badge.textContent        = `AQI ${aqi.us_aqi} · ${info.label}`;
        badge.style.background   = info.bg;
        badge.style.color        = info.fg;
    }
}

function renderForecast(forecast) {
    if (!forecast || !forecast.days) return;
    const today = new Date().toISOString().slice(0, 10);

    $('forecast-cards').innerHTML = forecast.days.map((day, i) => {
        const d       = new Date(day.date + 'T12:00:00');
        const dayName = i === 0 ? 'Today' : DAY_NAMES[d.getDay()];
        const isToday = day.date === today;

        const precip   = day.precip_prob   != null ? `${day.precip_prob}%`                    : '--';
        const wind     = day.wind_max      != null ? `${Math.round(day.wind_max)} mph`        : '--';
        const pressure = day.pressure_mean != null ? `${Math.round(day.pressure_mean)} hPa`  : '--';

        return `<div class="fc-card${isToday ? ' fc-card--today' : ''}">
            <div class="fc-day">${dayName}</div>
            <div class="fc-temps">
                <span class="fc-high">${Math.round(day.temp_max)}°</span>
                <span class="fc-low">${Math.round(day.temp_min)}°</span>
            </div>
            <dl class="fc-stats">
                <dt>Precip</dt><dd>${precip}</dd>
                <dt>Wind</dt><dd>${wind}</dd>
                <dt>Pressure</dt><dd>${pressure}</dd>
            </dl>
        </div>`;
    }).join('');
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function poll() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        renderCurrent(data.weather, data.aqi);
        renderForecast(data.forecast);
        $('last-updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
        console.error('Weather fetch failed:', e);
    }
}

// ── Init ─────────────────────────────────────────────────────────────────────

setInterval(updateClock, 1000);
updateClock();

poll();
setInterval(poll, POLL_MS);
