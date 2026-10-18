/**
 * ═══════════════════════════════════════════════════════════════
 *  SYNAGOGUE DISPLAY BOARD — script.js
 *
 *  All calculations (Zmanim, Hebrew date) run entirely client-side.
 *  After the initial page load, the app runs FULLY OFFLINE — no
 *  external API calls are made during operation.
 *
 *  Dependencies (CDN, cached after first load):
 *    • kosher-zmanim  – Zmanim calculation + Jewish calendar
 *    • Frank Ruhl Libre – font (CSS)
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   CONFIGURATION
   All tuneable values live here — no magic numbers in the code.
───────────────────────────────────────────────────────────── */
const CONFIG = {
    // Jerusalem, Israel (Western Wall area)
    LATITUDE:       31.7683,
    LONGITUDE:      35.2137,
    ELEVATION:      800,          // metres above sea level
    TIMEZONE:       'Asia/Jerusalem',
    LOCATION_NAME:  'ירושלים',

    // Message display timing
    MESSAGE_INTERVAL_MS: 30_000, // 30 seconds between slides
    FADE_DURATION_MS:       500, // cross-fade duration

    // How long to wait before retrying if kosher-zmanim hasn't loaded yet
    ZMANIM_RETRY_MS: 3_000,
};

/* ─────────────────────────────────────────────────────────────
   HEBREW / JEWISH CALENDAR CONSTANTS
───────────────────────────────────────────────────────────── */
/**
 * Jewish month names (1-indexed, matching JewishCalendar.getJewishMonth()).
 * Nissan = 1 … Adar = 12, Adar II = 13 (leap year only).
 */
const JEWISH_MONTH_NAMES = [
    '',           // 0 – unused
    'ניסן',      // 1
    'אייר',      // 2
    'סיוון',     // 3
    'תמוז',      // 4
    'אב',        // 5
    'אלול',      // 6
    'תשרי',      // 7
    'חשוון',     // 8
    'כסלו',      // 9
    'טבת',       // 10
    'שבט',       // 11
    'אדר',       // 12 – Adar (non-leap) or Adar I (leap)
    "אדר ב'",    // 13 – Adar II (leap year only)
];

const SECULAR_MONTHS = [
    'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
    'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר',
];

const HEBREW_DAY_NAMES = [
    'ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת',
];

/* ─────────────────────────────────────────────────────────────
   APPLICATION STATE
───────────────────────────────────────────────────────────── */
let messagesData        = [];
let currentMessageIndex = 0;

/* ─────────────────────────────────────────────────────────────
   ENTRY POINT
───────────────────────────────────────────────────────────── */
/**
 * Bootstraps the application.
 * Called once when the DOM is ready.
 */
function init() {
    loadMessages();          // fetch messages.json (local — no network needed after first load)
    startClock();            // live HH:MM display, updates every second
    updateDates();           // Hebrew + secular dates
    updateZmanim();          // Zmanim calculation via kosher-zmanim
    scheduleMidnightUpdate();// schedule daily recalculation at midnight
    startMessageCycler();    // start the 30-second message rotation
}

// Call init exactly once when DOM is ready.
// The script tag is at the end of <body>, so readyState is usually 'complete'.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

/* ═══════════════════════════════════════════════════════════════
   CLOCK
═══════════════════════════════════════════════════════════════ */
function startClock() {
    updateClock();
    setInterval(updateClock, 1_000);
}

function updateClock() {
    const now = new Date();
    const h   = String(now.getHours()).padStart(2, '0');
    const m   = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('digitalClock').textContent = `${h}:${m}`;
}

/* ═══════════════════════════════════════════════════════════════
   DATES  (Hebrew + secular)
═══════════════════════════════════════════════════════════════ */
function updateDates() {
    updateHebrewDate();
    updateSecularDate();
}

/** Updates the Hebrew date display using JewishCalendar from kosher-zmanim. */
function updateHebrewDate() {
    const el = document.getElementById('hebrewDate');
    if (!el) return;

    if (typeof KosherZmanim === 'undefined' || !KosherZmanim.JewishCalendar) {
        el.textContent = '(ספריית לוח שנה לא נטענה)';
        return;
    }

    try {
        const jCal = new KosherZmanim.JewishCalendar(new Date());

        const day    = jCal.getJewishDayOfMonth();   // 1–30
        const month  = jCal.getJewishMonth();         // 1–13
        const year   = jCal.getJewishYear();          // e.g. 5786

        const dayStr   = hebrewNumeral(day);
        const monthStr = JEWISH_MONTH_NAMES[month] ?? '?';
        // Drop the millennium (5000) — display only last 3 digits (e.g. תשפ"ו)
        const yearStr  = hebrewNumeral(year % 1000);

        el.textContent = `${dayStr} ב${monthStr} ${yearStr}`;
    } catch (err) {
        console.error('Hebrew date error:', err);
        el.textContent = '(שגיאה בחישוב)';
    }
}

/** Updates the secular (Gregorian) date display in Hebrew. */
function updateSecularDate() {
    const el = document.getElementById('secularDate');
    if (!el) return;

    const today      = new Date();
    const dayName    = HEBREW_DAY_NAMES[today.getDay()];
    const dayOfMonth = today.getDate();
    const monthName  = SECULAR_MONTHS[today.getMonth()];
    const year       = today.getFullYear();

    el.textContent = `יום ${dayName}, ${dayOfMonth} ב${monthName} ${year}`;
}

/**
 * Converts a positive integer to a Hebrew numeral (gematria) string.
 *
 * Special cases handled:
 *   15 → טו  (instead of י"ה, which spells God's name)
 *   16 → טז  (instead of י"ו)
 *
 * Punctuation:
 *   Single letter  → letter + geresh  (e.g.  א' )
 *   Multiple letters → gershayim before the last letter  (e.g.  י"ז )
 *
 * @param   {number} num  Positive integer 1–999
 * @returns {string}      Hebrew numeral string
 */
function hebrewNumeral(num) {
    if (!num || num <= 0) return '';

    const HUNDREDS = ['','ק','ר','ש','ת','תק','תר','תש','תת','תתק'];
    const TENS     = ['','י','כ','ל','מ','נ','ס','ע','פ','צ'];
    const ONES     = ['','א','ב','ג','ד','ה','ו','ז','ח','ט'];

    let n      = num;
    let result = '';

    // Hundreds
    if (n >= 100) {
        result += HUNDREDS[Math.floor(n / 100)];
        n %= 100;
    }

    // Special cases to avoid writing God's name
    if      (n === 15) { result += 'טו'; }
    else if (n === 16) { result += 'טז'; }
    else {
        if (n >= 10) { result += TENS[Math.floor(n / 10)]; n %= 10; }
        if (n  >  0) { result += ONES[n]; }
    }

    // Add geresh / gershayim punctuation
    if (result.length === 0) return '';
    if (result.length === 1) return result + "'";
    return result.slice(0, -1) + '"' + result.slice(-1);
}

/* ═══════════════════════════════════════════════════════════════
   ZMANIM  (Jewish halachic times)

   Uses the kosher-zmanim library (TypeScript port of KosherJava).
   All calculations are done locally — no server calls.
   Location: Jerusalem, Israel  (lat 31.7683, lng 35.2137, alt 800 m)
   Method: Rabbi David Aharon Sofer ("Eitim Lebina")
═══════════════════════════════════════════════════════════════ */
function updateZmanim() {
    if (typeof KosherZmanim === 'undefined') {
        // Library CDN script hasn't executed yet — retry shortly
        console.warn(`kosher-zmanim not ready. Retrying in ${CONFIG.ZMANIM_RETRY_MS / 1000}s…`);
        setTimeout(updateZmanim, CONFIG.ZMANIM_RETRY_MS);
        return;
    }

    try {
        // Build a GeoLocation for Jerusalem
        const geo = new KosherZmanim.GeoLocation(
            CONFIG.LOCATION_NAME,
            CONFIG.LATITUDE,
            CONFIG.LONGITUDE,
            CONFIG.ELEVATION,
            CONFIG.TIMEZONE
        );

        // ComplexZmanimCalendar gives access to all Zmanim opinions
        const cal = new KosherZmanim.ComplexZmanimCalendar(geo);
        cal.setDate(new Date());

        // Calculate Zmanim according to Rabbi David Aharon Sofer ("Eitim Lebina")
        const zmanimMap = {
            zmAlos:       cal.getAlos72Zmanis() || cal.getAlos16Point1Degrees(), // עלות השחר — 72 דק' זמניות
            zmMisheyakir: cal.getMisheyakir10Point2Degrees() || cal.getMisheyakir11Point5Degrees(), // זמן ציצית ותפילין
            zmNetz:       cal.getSunrise(),                                       // הנץ החמה
            zmSofZman:    `${formatTime(cal.getSofZmanShmaMGA())} / ${formatTime(cal.getSofZmanShmaGRA())}`, // מג"א / גר"א
            zmChatzot:    cal.getSolarNoon(),                                     // חצות היום
            zmShkia:      cal.getSunset(),                                        // שקיעת החמה
            zmTzet:       cal.getTzaisGeonim8Point5Degrees() || cal.getTzais(),  // צאת הכוכבים (גאונים)
            zmTzetRT:     cal.getTzais72Zmanis() || cal.getTzais72(),            // צאת הכוכבים (ר"ת)
        };

        // Update DOM
        for (const [id, timeResult] of Object.entries(zmanimMap)) {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = typeof timeResult === 'string' ? timeResult : formatTime(timeResult);
            }
        }

        console.info('Zmanim updated for', new Date().toLocaleDateString('he-IL'));

    } catch (err) {
        console.error('Zmanim calculation failed:', err);
        // Show dash placeholders rather than stale or wrong times
        ['zmAlos','zmMisheyakir','zmNetz','zmSofZman','zmChatzot','zmShkia','zmTzet','zmTzetRT'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '--:--';
        });
    }
}

/**
 * Converts a kosher-zmanim time result to a "HH:MM" string.
 *
 * The library may return different types depending on its version:
 *   • JS Date  (older releases)
 *   • Temporal.ZonedDateTime  (.hour / .minute properties)
 *   • Luxon DateTime  (.toJSDate() method)
 *
 * This function handles all three gracefully.
 *
 * @param   {Date|object|null} timeResult
 * @returns {string}  "HH:MM" or "--:--" if unavailable
 */
function formatTime(timeResult) {
    if (timeResult === null || timeResult === undefined) return '--:--';

    try {
        let h, m;

        if (timeResult instanceof Date) {
            // Standard JS Date
            h = timeResult.getHours();
            m = timeResult.getMinutes();

        } else if (typeof timeResult.hour === 'number' &&
                   typeof timeResult.minute === 'number') {
            // Temporal.ZonedDateTime / PlainDateTime
            h = timeResult.hour;
            m = timeResult.minute;

        } else if (typeof timeResult.toJSDate === 'function') {
            // Luxon DateTime
            const d = timeResult.toJSDate();
            h = d.getHours();
            m = d.getMinutes();

        } else if (timeResult.epochMilliseconds !== undefined) {
            // Temporal with BigInt epoch
            const d = new Date(Number(timeResult.epochMilliseconds));
            h = d.getHours();
            m = d.getMinutes();

        } else {
            console.warn('Unknown zman time type:', typeof timeResult, timeResult);
            return '--:--';
        }

        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    } catch (err) {
        console.error('formatTime error:', err);
        return '--:--';
    }
}

/* ═══════════════════════════════════════════════════════════════
   MIDNIGHT RECALCULATION
   Schedules a one-shot timeout to the next midnight so Zmanim
   and dates refresh automatically without a page reload.
═══════════════════════════════════════════════════════════════ */
function scheduleMidnightUpdate() {
    const now          = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 30, 0); // 30 seconds past midnight (safe margin)
    const msUntilMidnight = nextMidnight - now;

    setTimeout(() => {
        console.info('Midnight — recalculating dates and Zmanim…');
        updateDates();
        updateZmanim();
        scheduleMidnightUpdate(); // schedule for the following night
    }, msUntilMidnight);
}

/* ═══════════════════════════════════════════════════════════════
   MESSAGES  (rotating display cards)
═══════════════════════════════════════════════════════════════ */

/**
 * Fetches messages.json and populates the board.
 * After this one fetch, the app no longer needs network access.
 */
function loadMessages() {
    fetch('messages.json')
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status} – ${res.statusText}`);
            return res.json();
        })
        .then(data => {
            // Apply configurable fields from JSON to the DOM
            applyConfig(data.config ?? {});

            // Store message array (with fallback)
            messagesData = Array.isArray(data.messages) ? data.messages : [];
            if (messagesData.length === 0) {
                messagesData = [{ title: 'ברוכים הבאים', lines: ['בית הכנסת'] }];
            }

            // Set scrolling ticker text
            const ticker = data.scrollingText ?? '';
            if (ticker) {
                document.getElementById('marqueeContent').textContent = ticker;
            }

            // Render the first message immediately
            showMessage(0);
        })
        .catch(err => {
            console.error('Could not load messages.json:', err);
            messagesData = [{ title: 'ברוכים הבאים', lines: ['לוח מודעות בית כנסת'] }];
            showMessage(0);
        });
}

/**
 * Applies the optional "config" block from messages.json to DOM elements.
 * This lets the synagogue admin update names/contacts without touching HTML.
 *
 * @param {object} config  – The config sub-object from messages.json
 */
function applyConfig(config) {
    const fieldMap = {
        synagogueName: 'synagogueName',
        mainTitle:     'mainTitle',
        mainSubtitle:  'mainSubtitle',
        gabaiContact:  'gabaiContact',
    };
    for (const [key, domId] of Object.entries(fieldMap)) {
        if (config[key]) {
            const el = document.getElementById(domId);
            if (el) el.textContent = config[key];
        }
    }
}

/**
 * Starts the automatic 30-second message cycling interval.
 * Each cycle fades out, updates content, then fades back in.
 */
function startMessageCycler() {
    setInterval(advanceMessage, CONFIG.MESSAGE_INTERVAL_MS);
}

/** Advances to the next message with a smooth fade transition. */
function advanceMessage() {
    if (messagesData.length === 0) return;

    const card = document.getElementById('messageCard');

    // Step 1 – fade out
    card.classList.add('fade-out');

    setTimeout(() => {
        // Step 2 – update content while invisible
        currentMessageIndex = (currentMessageIndex + 1) % messagesData.length;
        showMessage(currentMessageIndex);

        // Step 3 – fade back in
        card.classList.remove('fade-out');
    }, CONFIG.FADE_DURATION_MS);
}

/**
 * Renders a message by index into the message card.
 * Also restarts the gold progress bar animation.
 *
 * @param {number} index – Index into messagesData[]
 */
function showMessage(index) {
    if (messagesData.length === 0) return;

    const msg = messagesData[index] ?? messagesData[0];

    // Title
    const titleEl = document.getElementById('messageTitle');
    if (titleEl) titleEl.textContent = msg.title ?? 'הודעה';

    // Body lines — each line becomes a <p> element
    const contentEl = document.getElementById('messageContent');
    if (contentEl) {
        contentEl.innerHTML = '';
        const lines = Array.isArray(msg.lines) ? msg.lines : [];
        lines.forEach(line => {
            const p = document.createElement('p');
            p.textContent = line;
            contentEl.appendChild(p);
        });
    }

    // Restart the countdown progress bar
    restartProgressBar();
}

/**
 * Restarts the CSS scaleX animation on the progress bar by forcing
 * a style recalculation (reflow) between removing and re-applying it.
 */
function restartProgressBar() {
    const bar = document.getElementById('progressBar');
    if (!bar) return;

    bar.style.animation = 'none';
    // Reading offsetHeight forces the browser to flush pending style changes
    void bar.offsetHeight;
    const durationSec = CONFIG.MESSAGE_INTERVAL_MS / 1000;
    bar.style.animation = `progress-deplete ${durationSec}s linear forwards`;
}
