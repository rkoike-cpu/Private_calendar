const GRID_START_HOUR = 7;
const GRID_END_HOUR = 22;
const ROW_HEIGHT = 44; // px per hour, must match --row-height in style.css
const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

let allEvents = [];
let viewMode = "week"; // "day" | "week" | "month"
let currentDate = startOfDay(new Date()); // 表示の基準日

document.getElementById("sync-google").addEventListener("click", syncGoogle);
document.getElementById("prev-nav").addEventListener("click", () => changeDate(-1));
document.getElementById("next-nav").addEventListener("click", () => changeDate(1));

for (const btn of document.querySelectorAll("#view-toggle button")) {
  btn.addEventListener("click", () => {
    viewMode = btn.dataset.view;
    render();
  });
}

document.getElementById("add-event-btn").addEventListener("click", openAddEventDialog);
document.getElementById("cancel-add-event").addEventListener("click", () => {
  document.getElementById("add-event-dialog").close();
});
document.getElementById("add-event-form").addEventListener("submit", submitAddEvent);

render(); // 初期表示
loadWeather();

// ---------- 予定追加 ----------

function openAddEventDialog() {
  const form = document.getElementById("add-event-form");
  form.reset();
  form.date.value = formatDateInput(currentDate);
  document.getElementById("add-event-dialog").showModal();
}

async function submitAddEvent(e) {
  e.preventDefault();
  const form = e.target;
  const summary = form.summary.value.trim();
  const date = form.date.value;
  const startTime = form.start.value;
  const endTime = form.end.value;
  if (!summary || !date || !startTime || !endTime) return;

  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${date}T${endTime}:00`);
  if (end <= start) {
    alert("終了時刻は開始時刻より後にしてください。");
    return;
  }

  const status = document.getElementById("status");
  status.textContent = "予定を追加中...";

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary,
        start: start.toISOString(),
        end: end.toISOString(),
      }),
    });

    if (!res.ok) {
      status.textContent = `予定の追加に失敗しました (status: ${res.status})`;
      return;
    }

    const created = await res.json();
    allEvents.push(created);
    document.getElementById("add-event-dialog").close();
    render();
    status.textContent = "予定を追加しました";
  } finally {
    submitBtn.disabled = false;
  }
}

function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------- 同期 ----------

async function syncGoogle() {
  const status = document.getElementById("status");
  status.textContent = "同期中...";

  const res = await fetch("/api/sync/google", { method: "POST" });
  if (!res.ok) {
    status.textContent = `同期に失敗しました (status: ${res.status})`;
    return;
  }

  allEvents = await res.json();
  render();
  status.textContent = `最終同期: ${new Date().toLocaleTimeString("ja-JP")}`;
}

// ---------- ナビゲーション ----------

// サーバー側が取得するのは「今月の前後1ヶ月(暦月)」なので、
// currentDate がその範囲を超えないようにする。
function getDataBounds() {
  const today = new Date();
  const minDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const maxDate = new Date(today.getFullYear(), today.getMonth() + 2, 0); // 来月末日
  return { minDate, maxDate };
}

function changeDate(delta) {
  const next = new Date(currentDate);
  if (viewMode === "day") next.setDate(next.getDate() + delta);
  else if (viewMode === "week") next.setDate(next.getDate() + delta * 7);
  else next.setMonth(next.getMonth() + delta);

  const { minDate, maxDate } = getDataBounds();
  if (next < minDate || next > maxDate) return;

  currentDate = next;
  render();
}

function render() {
  updateViewToggle();
  updateNavLabel();
  updateNavButtons();

  const gridEl = document.getElementById("calendar");
  const monthEl = document.getElementById("calendar-month");

  if (viewMode === "month") {
    gridEl.hidden = true;
    monthEl.hidden = false;
    renderMonthView(currentDate);
  } else {
    gridEl.hidden = false;
    monthEl.hidden = true;
    const days = viewMode === "day" ? [new Date(currentDate)] : buildWeekDays(currentDate);
    renderHeader(days);
    renderTimeColumn();
    renderDayColumns(days, allEvents);
  }
}

function updateViewToggle() {
  for (const btn of document.querySelectorAll("#view-toggle button")) {
    btn.classList.toggle("active", btn.dataset.view === viewMode);
  }
}

function updateNavLabel() {
  const label = document.getElementById("nav-label");
  if (viewMode === "day") {
    label.textContent = `${currentDate.getMonth() + 1}/${currentDate.getDate()}(${DAY_LABELS[currentDate.getDay()]})`;
  } else if (viewMode === "week") {
    const days = buildWeekDays(currentDate);
    label.textContent = `${days[0].getMonth() + 1}/${days[0].getDate()} 〜 ${days[6].getMonth() + 1}/${days[6].getDate()}`;
  } else {
    label.textContent = `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月`;
  }
}

function updateNavButtons() {
  const { minDate, maxDate } = getDataBounds();
  const prevDate = new Date(currentDate);
  const nextDate = new Date(currentDate);
  if (viewMode === "day") {
    prevDate.setDate(prevDate.getDate() - 1);
    nextDate.setDate(nextDate.getDate() + 1);
  } else if (viewMode === "week") {
    prevDate.setDate(prevDate.getDate() - 7);
    nextDate.setDate(nextDate.getDate() + 7);
  } else {
    prevDate.setMonth(prevDate.getMonth() - 1);
    nextDate.setMonth(nextDate.getMonth() + 1);
  }

  document.getElementById("prev-nav").disabled = prevDate < minDate;
  document.getElementById("next-nav").disabled = nextDate > maxDate;
}

// ---------- 日表示 / 週表示(時間軸グリッド) ----------

function buildWeekDays(anchor) {
  const sunday = new Date(anchor);
  sunday.setDate(sunday.getDate() - sunday.getDay());

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

function renderHeader(days) {
  const header = document.getElementById("cal-header");
  header.innerHTML = "";

  const timeHeader = document.createElement("div");
  timeHeader.className = "cal-time-header";
  header.appendChild(timeHeader);

  const today = startOfDay(new Date());

  for (const day of days) {
    const el = document.createElement("div");
    el.className = "cal-day-header";
    if (day.getTime() === today.getTime()) {
      el.classList.add("today");
    }
    el.textContent = `${day.getMonth() + 1}/${day.getDate()}(${DAY_LABELS[day.getDay()]})`;
    header.appendChild(el);
  }
}

function renderTimeColumn() {
  const col = document.getElementById("cal-time-col");
  col.innerHTML = "";
  col.style.height = `${(GRID_END_HOUR - GRID_START_HOUR) * ROW_HEIGHT}px`;

  for (let hour = GRID_START_HOUR; hour <= GRID_END_HOUR; hour++) {
    const label = document.createElement("div");
    label.className = "cal-time-label";
    label.style.top = `${(hour - GRID_START_HOUR) * ROW_HEIGHT}px`;
    label.textContent = `${hour}:00`;
    col.appendChild(label);
  }
}

function renderDayColumns(days, events) {
  const container = document.getElementById("cal-days");
  container.innerHTML = "";

  const colHeight = (GRID_END_HOUR - GRID_START_HOUR) * ROW_HEIGHT;
  const columns = days.map(() => {
    const col = document.createElement("div");
    col.className = "cal-day-col";
    col.style.height = `${colHeight}px`;
    container.appendChild(col);
    return col;
  });

  const eventsByDay = days.map(() => []);
  for (const event of events) {
    const dayIndex = dayIndexOf(days, new Date(event.Start));
    if (dayIndex === -1) continue;
    eventsByDay[dayIndex].push(event);
  }

  eventsByDay.forEach((dayEvents, dayIndex) => {
    for (const item of layoutOverlappingEvents(dayEvents)) {
      columns[dayIndex].appendChild(buildEventElement(item.event, item.start, item.end, item.col, item.colCount));
    }
  });

  addNowLine(days, columns);
}

// 同じ日の予定同士で時間帯が重なっている場合、横に並べて表示できるよう
// 各予定に列番号(col)と、その重なりグループの列数(colCount)を割り当てる。
function layoutOverlappingEvents(events) {
  const items = events
    .map((event) => ({ event, start: new Date(event.Start), end: new Date(event.End) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // 連続して重なり合う予定を1つのグループにまとめる
  const groups = [];
  let group = [];
  let groupEnd = null;
  for (const item of items) {
    if (group.length === 0 || item.start < groupEnd) {
      group.push(item);
      groupEnd = groupEnd === null || item.end > groupEnd ? item.end : groupEnd;
    } else {
      groups.push(group);
      group = [item];
      groupEnd = item.end;
    }
  }
  if (group.length > 0) groups.push(group);

  const result = [];
  for (const g of groups) {
    // 各予定を、直前の予定が終わっている最初の列に割り当てる(貪欲法)
    const columnEndTimes = [];
    for (const item of g) {
      let col = columnEndTimes.findIndex((endTime) => endTime <= item.start);
      if (col === -1) {
        col = columnEndTimes.length;
        columnEndTimes.push(item.end);
      } else {
        columnEndTimes[col] = item.end;
      }
      item.col = col;
    }
    const colCount = columnEndTimes.length;
    for (const item of g) {
      result.push({ ...item, colCount });
    }
  }
  return result;
}

function dayIndexOf(days, date) {
  const d = startOfDay(date);
  return days.findIndex((day) => day.getTime() === d.getTime());
}

function buildEventElement(event, start, end, col = 0, colCount = 1) {
  const gridStartMin = GRID_START_HOUR * 60;
  const gridEndMin = GRID_END_HOUR * 60;

  const startMin = clamp(start.getHours() * 60 + start.getMinutes(), gridStartMin, gridEndMin);
  const endMin = clamp(end.getHours() * 60 + end.getMinutes(), gridStartMin, gridEndMin);

  const top = ((startMin - gridStartMin) / 60) * ROW_HEIGHT;
  const height = Math.max(((endMin - startMin) / 60) * ROW_HEIGHT, 18);

  const widthPct = 100 / colCount;
  const leftPct = col * widthPct;

  const el = document.createElement("div");
  el.className = "cal-event";
  el.style.top = `${top}px`;
  el.style.height = `${height}px`;
  el.style.left = `calc(${leftPct}% + 2px)`;
  el.style.width = `calc(${widthPct}% - 4px)`;
  el.textContent = `${formatTime(start)} ${event.Summary}`;

  attachPopover(el, event.Summary, `${formatTime(start)}〜${formatTime(end)}`);

  return el;
}

function addNowLine(days, columns) {
  const now = new Date();
  const todayIndex = dayIndexOf(days, now);
  if (todayIndex === -1) return;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const gridStartMin = GRID_START_HOUR * 60;
  const gridEndMin = GRID_END_HOUR * 60;
  if (nowMin < gridStartMin || nowMin > gridEndMin) return;

  const line = document.createElement("div");
  line.className = "cal-now-line";
  line.style.top = `${((nowMin - gridStartMin) / 60) * ROW_HEIGHT}px`;
  columns[todayIndex].appendChild(line);
}

// ---------- 月表示 ----------

function renderMonthView(anchor) {
  const container = document.getElementById("calendar-month");
  container.innerHTML = "";

  for (const label of DAY_LABELS) {
    const el = document.createElement("div");
    el.className = "cal-month-dow";
    el.textContent = label;
    container.appendChild(el);
  }

  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const eventsByDate = groupEventsByDate(allEvents);
  const today = startOfDay(new Date());

  for (let i = 0; i < 42; i++) {
    const day = new Date(gridStart);
    day.setDate(day.getDate() + i);

    const cell = document.createElement("div");
    cell.className = "cal-month-cell";
    if (day.getMonth() !== anchor.getMonth()) cell.classList.add("outside");
    if (day.getTime() === today.getTime()) cell.classList.add("today");

    const dayNum = document.createElement("div");
    dayNum.className = "cal-month-daynum";
    dayNum.textContent = day.getDate();
    cell.appendChild(dayNum);

    const dayEvents = eventsByDate.get(dateKey(day)) || [];
    const maxShown = 3;
    for (const event of dayEvents.slice(0, maxShown)) {
      const start = new Date(event.Start);
      const end = new Date(event.End);
      const el = document.createElement("div");
      el.className = "cal-month-event";
      el.textContent = `${formatTime(start)} ${event.Summary}`;
      attachPopover(el, event.Summary, `${formatTime(start)}〜${formatTime(end)}`);
      cell.appendChild(el);
    }
    if (dayEvents.length > maxShown) {
      const more = document.createElement("div");
      more.className = "cal-month-more";
      more.textContent = `+${dayEvents.length - maxShown}件`;
      cell.appendChild(more);
    }

    container.appendChild(cell);
  }
}

function groupEventsByDate(events) {
  const map = new Map();
  for (const event of events) {
    const key = dateKey(new Date(event.Start));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(event);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.Start) - new Date(b.Start));
  }
  return map;
}

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// ---------- 天気 ----------

async function loadWeather() {
  const strip = document.getElementById("weather-strip");
  strip.textContent = "読み込み中...";

  const res = await fetch("/api/weather/today");
  if (!res.ok) {
    strip.textContent = "天気の取得に失敗しました";
    return;
  }

  const forecast = await res.json();
  renderWeather(forecast.hourly || []);
}

function renderWeather(hourly) {
  const strip = document.getElementById("weather-strip");
  strip.innerHTML = "";

  const nowHour = new Date().getHours();

  for (const point of hourly) {
    const pointHour = new Date(point.time).getHours();

    const el = document.createElement("div");
    el.className = "weather-hour";
    if (pointHour === nowHour) {
      el.classList.add("now");
    }
    el.innerHTML = `
      <div class="hour">${pointHour}時</div>
      <div class="emoji">${weatherEmoji(point.weatherCode)}</div>
      <div class="temp">${Math.round(point.tempC)}℃</div>
      <div class="humidity">${Math.round(point.humidityPct)}%</div>
    `;
    strip.appendChild(el);
  }
}

function weatherEmoji(code) {
  if (code === 0) return "☀️";
  if ([1, 2, 3].includes(code)) return "⛅";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
  if ([61, 63, 65, 66, 67].includes(code)) return "🌧️";
  if ([71, 73, 75, 77].includes(code)) return "🌨️";
  if ([80, 81, 82].includes(code)) return "🌧️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "❓";
}

// ---------- ポップオーバー ----------

// 要素にカーソルを乗せると、件名・時間を拡大表示するポップオーバーを出す。
function attachPopover(el, title, timeText) {
  el.addEventListener("mouseenter", () => showEventPopover(el, title, timeText));
  el.addEventListener("mouseleave", hideEventPopover);
}

function showEventPopover(anchorEl, title, timeText) {
  const popover = document.getElementById("event-popover");
  popover.querySelector(".popover-title").textContent = title;
  popover.querySelector(".popover-time").textContent = timeText;
  popover.hidden = false;

  const rect = anchorEl.getBoundingClientRect();
  popover.style.left = `${rect.right + 8}px`;
  popover.style.top = `${rect.top}px`;

  // 画面端をはみ出す場合は位置を調整する
  const popRect = popover.getBoundingClientRect();
  if (popRect.right > window.innerWidth) {
    popover.style.left = `${Math.max(rect.left - popRect.width - 8, 4)}px`;
  }
  if (popRect.bottom > window.innerHeight) {
    popover.style.top = `${Math.max(window.innerHeight - popRect.height - 8, 4)}px`;
  }
}

function hideEventPopover() {
  document.getElementById("event-popover").hidden = true;
}

// ---------- ユーティリティ ----------

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(date) {
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}
