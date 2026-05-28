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

function sortSensorCards() {
    const container = $('sensor-cards');
    Array.from(container.children)
        .sort((a, b) => {
            const nameA = (a.querySelector('.sensor-name') || {}).textContent || '';
            const nameB = (b.querySelector('.sensor-name') || {}).textContent || '';
            return nameA.localeCompare(nameB);
        })
        .forEach(card => container.appendChild(card));
}

function handleSensorMessage(data) {
    if (!data.topic || !data.fields) return;
    const cardId = 'sc-' + data.topic.replace(/[^a-zA-Z0-9]/g, '-');
    let card = document.getElementById(cardId);
    const isNew = !card;
    if (isNew) {
        card = document.createElement('div');
        card.className = 'sensor-card';
        card.id = cardId;
        $('sensor-cards').appendChild(card);
        assignSensorColor(data.topic);
        fetchSensorTrend(data.topic);
    }
    sensorLastSeen[cardId] = Date.now();
    card.classList.remove('sensor-card--stale');
    const f  = data.fields;
    const t  = f.temperature;
    const h  = f.humidity;
    const b  = f.battery;
    const tr = (t.max - t.min).toFixed(1);
    const hr = (h.max - h.min).toFixed(1);
    const color = sensorColors[data.topic];
    card.innerHTML =
        `<div class="sensor-name"><span class="sensor-color-dot" style="background:${color}"></span>${data.friendly_name}</div>` +
        `<dl class="sensor-stats">` +
        `<dt>Temp</dt><dd>${t.median.toFixed(1)}° <small>±${tr}</small></dd>` +
        `<dt>Humid</dt><dd>${h.median.toFixed(1)}% <small>±${hr}</small></dd>` +
        `<dt>Battery</dt><dd>${b.median}%</dd>` +
        `</dl>`;
    if (isNew) sortSensorCards();
}

// ── Sensor Trend Chart ───────────────────────────────────────────────────

const SENSOR_COLORS = [
    '#4fc3f7',  // cyan
    '#ff8a65',  // orange
    '#a5d6a7',  // green
    '#ce93d8',  // purple
    '#fff176',  // yellow
    '#ef9a9a',  // red
    '#80cbc4',  // teal
];

const sensorColors    = {};  // topic → color
const sensorTrendData = {};  // topic → [{ ts, median }]
let   colorIndex      = 0;

const TREND_MS = 48 * 60 * 60 * 1000;

function assignSensorColor(topic) {
    if (!sensorColors[topic]) {
        sensorColors[topic] = SENSOR_COLORS[colorIndex % SENSOR_COLORS.length];
        colorIndex++;
    }
    return sensorColors[topic];
}

function parseTrendCSV(text) {
    return text.trim().split('\n')
        .map(function (line) {
            var parts     = line.split(',');
            var medianStr = parts[0];
            var tsStr     = parts[3];
            var ts        = new Date(tsStr).getTime();
            if (isNaN(ts)) return null;
            var median = medianStr === 'null' ? null : parseFloat(medianStr);
            return { ts: ts, median: isNaN(median) ? null : median };
        })
        .filter(Boolean);
}

async function fetchSensorTrend(topic) {
    try {
        const res = await fetch('/api/sensor/' + topic + '/temperature');
        if (!res.ok) return;
        const text = await res.text();
        sensorTrendData[topic] = parseTrendCSV(text);
        renderSensorTrendChart();
    } catch (e) {
        console.error('Trend fetch failed:', topic, e);
    }
}

function renderSensorTrendChart() {
    const wrap = $('sensor-trend-wrap');
    if (!wrap) return;

    const W = 600, H = 120;
    const PT = 8, PR = 8, PB = 8, PL = 8;
    const now  = Date.now() + timeOffset;
    const tMin = now - TREND_MS;

    // Compute global Y range across all sensors
    let yMin = Infinity, yMax = -Infinity;
    Object.values(sensorTrendData).forEach(function (rows) {
        rows.forEach(function (r) {
            if (r.median !== null) {
                if (r.median < yMin) yMin = r.median;
                if (r.median > yMax) yMax = r.median;
            }
        });
    });

    if (!isFinite(yMin)) { wrap.innerHTML = ''; return; }

    const yPad  = Math.max((yMax - yMin) * 0.12, 1);
    const yLow  = yMin - yPad;
    const yHigh = yMax + yPad;

    const sx = function (x) { return PL + (x - tMin) / (now - tMin) * (W - PL - PR); };
    const sy = function (y) { return PT + (1 - (y - yLow) / (yHigh - yLow)) * (H - PT - PB); };

    const parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">');

    // Vertical grid lines every 6 hours
    for (let h = 0; h <= 48; h += 6) {
        const x = sx(now - h * 3600000).toFixed(1);
        parts.push('<line x1="' + x + '" y1="' + PT + '" x2="' + x + '" y2="' + (H - PB) + '" stroke="#2a2a2a" stroke-width="1"/>');
    }

    // One set of polyline segments per sensor
    Object.keys(sensorTrendData).forEach(function (topic) {
        const rows  = sensorTrendData[topic];
        const color = sensorColors[topic] || '#888888';
        const inWin = rows.filter(function (r) { return r.ts >= tMin && r.ts <= now; });

        let seg     = [];
        let wasNull = false;
        const breakMarkers = [];  // SVG coords {x,y} where continuity broke or resumed

        function flush(dueToBreak) {
            if (seg.length >= 2) {
                const pts = seg.map(function (r) {
                    return sx(r.ts).toFixed(1) + ',' + sy(r.median).toFixed(1);
                }).join(' ');
                parts.push('<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>');
            }
            if (dueToBreak && seg.length >= 1) {
                const last = seg[seg.length - 1];
                breakMarkers.push({ x: sx(last.ts), y: sy(last.median) });
            }
            seg = [];
        }

        inWin.forEach(function (r) {
            if (r.median === null) {
                flush(true);
                wasNull = true;
            } else {
                if (wasNull) {
                    breakMarkers.push({ x: sx(r.ts), y: sy(r.median) });
                    wasNull = false;
                }
                seg.push(r);
            }
        });
        flush(false);

        // Draw break markers as small × crosses
        const S = 3;
        breakMarkers.forEach(function (m) {
            const x = m.x.toFixed(1), y = m.y.toFixed(1);
            const x0 = (m.x - S).toFixed(1), x1 = (m.x + S).toFixed(1);
            const y0 = (m.y - S).toFixed(1), y1 = (m.y + S).toFixed(1);
            parts.push('<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y1 + '" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round"/>');
            parts.push('<line x1="' + x1 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + y1 + '" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round"/>');
        });
    });

    parts.push('</svg>');
    wrap.innerHTML = parts.join('');
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

async function loadSensors() {
    try {
        const res = await fetch('/api/sensors');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        Object.values(data).forEach(handleSensorMessage);
    } catch (e) {
        console.error('Sensor initial load failed:', e);
    }
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

loadSensors();
connectSensorWS();
setInterval(checkSensorStaleness, 30 * 1000);
setInterval(function () {
    Object.keys(sensorTrendData).forEach(fetchSensorTrend);
}, 10 * 60 * 1000);
