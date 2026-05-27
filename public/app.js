'use strict';

const API_URL   = '/api/weather';
const WS_URL    = `ws://${location.host}/ws/sensors`;
const POLL_MS   = 5 * 60 * 1000;

let timeOffset = 0; // ms difference: server clock vs TV clock

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
    const now  = new Date(Date.now() + timeOffset);
    let   h    = now.getHours();
    const m    = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    $('clock').textContent      = `${h}:${m}`;
    $('clock-ampm').textContent = ampm;
    $('header-date').textContent =
        `${DAY_NAMES[now.getDay()]}, ${MONTH_NAMES[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function buildSparkline(temps, precips) {
    if (!temps || temps.length < 2) return '';
    const W = 100, H = 36;
    const TEMP_TOP = 2, TEMP_BOT = 28;
    const PREC_BOT = 34, PREC_MAX_H = 8, PREC_MIN_H = 1.5;
    const n      = temps.length;
    const xStep  = W / (n - 1);
    const tMin   = Math.min(...temps);
    const tMax   = Math.max(...temps);
    const tRange = tMax - tMin || 1;

    const tempPts = temps.map((t, i) => {
        const x = (i * xStep).toFixed(1);
        const y = (TEMP_TOP + (TEMP_BOT - TEMP_TOP) * (1 - (t - tMin) / tRange)).toFixed(1);
        return `${x},${y}`;
    }).join(' ');

    let precipSvg = '';
    if (precips && precips.length === n) {
        const pts   = precips.map((p, i) =>
            `${(i * xStep).toFixed(1)},${(PREC_BOT - Math.max((p / 100) * PREC_MAX_H, PREC_MIN_H)).toFixed(1)}`
        ).join(' ');
        const lastX = ((n - 1) * xStep).toFixed(1);
        precipSvg = `<polygon points="0,${PREC_BOT} ${pts} ${lastX},${PREC_BOT}" fill="rgba(79,195,247,0.3)"/>`;
    }

    return `<svg class="fc-sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${precipSvg}<polyline points="${tempPts}" fill="none" stroke="#ffb74d" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
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
    const today = new Date(Date.now() + timeOffset).toISOString().slice(0, 10);

    $('forecast-cards').innerHTML = forecast.days.map((day, i) => {
        const d       = new Date(day.date + 'T12:00:00');
        const dayName = i === 0 ? 'Today' : DAY_NAMES[d.getDay()];
        const isToday = day.date === today;

        const precip = day.precip_prob != null ? `${day.precip_prob}%` : '--';
        const wind   = day.wind_max   != null ? `${Math.round(day.wind_max)} mph` : '--';

        let pressureHtml;
        if (i === 0 || day.pressure_mean == null) {
            pressureHtml = day.pressure_mean != null ? `${Math.round(day.pressure_mean)} hPa` : '--';
        } else {
            const prev  = forecast.days[i - 1].pressure_mean;
            const delta = prev != null ? Math.round(day.pressure_mean) - Math.round(prev) : null;
            if (delta == null) {
                pressureHtml = '--';
            } else if (delta === 0) {
                pressureHtml = `<span class="fc-pressure-flat">0 hPa</span>`;
            } else if (delta > 0) {
                pressureHtml = `<span class="fc-pressure-up">+${delta} hPa</span>`;
            } else {
                pressureHtml = `<span class="fc-pressure-down">${delta} hPa</span>`;
            }
        }

        const sparkline = buildSparkline(
            day.hourly && day.hourly.temperature,
            day.hourly && day.hourly.precip_prob
        );
        return `<div class="fc-card${isToday ? ' fc-card--today' : ''}">
            <div class="fc-day">${dayName}</div>
            <div class="fc-temps">
                <span class="fc-high">${Math.round(day.temp_max)}°</span>
                <span class="fc-low">${Math.round(day.temp_min)}°</span>
            </div>
            <dl class="fc-stats">
                <dt>Precip</dt><dd>${precip}</dd>
                <dt>Wind</dt><dd>${wind}</dd>
                <dt>Pressure</dt><dd>${pressureHtml}</dd>
            </dl>
            ${sparkline}
        </div>`;
    }).join('');
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function poll() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.serverTime) {
            timeOffset = new Date(data.serverTime).getTime() - Date.now();
        }
        renderCurrent(data.weather, data.aqi);
        renderForecast(data.forecast);
        $('last-updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
        console.error('Weather fetch failed:', e);
    }
}

// ── Sensor WebSocket ─────────────────────────────────────────────────────

const SENSOR_STALE_MS = 5 * 60 * 1000;
const sensorLastSeen  = {}; // cardId → timestamp

let sensorWS = null;

function handleSensorMessage(data) {
    if (!data.topic || !data.fields) return;
    const cardId = 'sc-' + data.topic.replace(/[^a-zA-Z0-9]/g, '-');
    let card = document.getElementById(cardId);
    if (!card) {
        card = document.createElement('div');
        card.className = 'sensor-card';
        card.id = cardId;
        $('sensor-cards').appendChild(card);
    }
    sensorLastSeen[cardId] = Date.now();
    card.classList.remove('sensor-card--stale');
    const f  = data.fields;
    const t  = f.temperature;
    const h  = f.humidity;
    const b  = f.battery;
    const tr = (t.max - t.min).toFixed(1);
    const hr = (h.max - h.min).toFixed(1);
    card.innerHTML =
        `<div class="sensor-name">${data.friendly_name}</div>` +
        `<dl class="sensor-stats">` +
        `<dt>Temp</dt><dd>${t.median.toFixed(1)}° <small>±${tr}</small></dd>` +
        `<dt>Humid</dt><dd>${h.median.toFixed(1)}% <small>±${hr}</small></dd>` +
        `<dt>Battery</dt><dd>${b.median}%</dd>` +
        `</dl>`;
}

function checkSensorStaleness() {
    const now = Date.now();
    Object.keys(sensorLastSeen).forEach(function (cardId) {
        var card = document.getElementById(cardId);
        if (!card) return;
        if (now - sensorLastSeen[cardId] >= SENSOR_STALE_MS) {
            card.classList.add('sensor-card--stale');
        }
    });
}

function connectSensorWS() {
    if (sensorWS && sensorWS.readyState < 2) return;
    sensorWS = new WebSocket(WS_URL);
    sensorWS.addEventListener('message', function (evt) {
        try {
            handleSensorMessage(JSON.parse(evt.data));
        } catch (e) {
            console.error('Sensor WS parse error:', e);
        }
    });
    sensorWS.addEventListener('close', function () {
        setTimeout(connectSensorWS, 5000);
    });
    sensorWS.addEventListener('error', function () {
        // close event will fire and trigger reconnect
    });
}

// ── Init ──────────────────────────────────────────────────────────────────

setInterval(updateClock, 1000);
updateClock();

poll();
setInterval(poll, POLL_MS);

connectSensorWS();
setInterval(checkSensorStaleness, 30 * 1000);
