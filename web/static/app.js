const GRID_START_HOUR = 7;
const GRID_END_HOUR = 22;
const ROW_HEIGHT = 44; // px per hour, must match --row-height in style.css
const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 予定の色分けカテゴリ。key="" がデフォルト(未分類)で、これまで通りの青色になる。
// この色分けはこのアプリの画面表示だけのもので、Googleカレンダー本体には影響しない。
const CATEGORIES = [
  { key: "", label: "仕事", color: "#4a86e8" },
  { key: "personal", label: "プライベート", color: "#34a853" },
  { key: "important", label: "重要", color: "#e04141" },
  { key: "travel", label: "移動", color: "#a142f4" },
];

function categoryColor(key) {
  const found = CATEGORIES.find((c) => c.key === (key || ""));
  return found ? found.color : CATEGORIES[0].color;
}

let allEvents = [];
let viewMode = "week"; // "day" | "week" | "month"
let currentDate = startOfDay(new Date()); // 表示の基準日
let editingEventId = null; // 編集中の予定ID(nullなら新規追加)

document.getElementById("sync-google").addEventListener("click", syncGoogle);
document.getElementById("prev-nav").addEventListener("click", () => changeDate(-1));
document.getElementById("next-nav").addEventListener("click", () => changeDate(1));

for (const btn of document.querySelectorAll("#view-toggle button")) {
  btn.addEventListener("click", () => {
    viewMode = btn.dataset.view;
    render();
  });
}

document.getElementById("add-event-btn").addEventListener("click", () => openEventDialog(null));
document.getElementById("cancel-add-event").addEventListener("click", () => {
  document.getElementById("add-event-dialog").close();
});
document.getElementById("add-event-form").addEventListener("submit", submitEventForm);
document.getElementById("delete-event-btn").addEventListener("click", deleteEditingEvent);
document.getElementById("notify-btn").addEventListener("click", toggleNotifications);
document.getElementById("todo-form").addEventListener("submit", submitTodo);
document.getElementById("add-event-form").location.addEventListener("input", updateLocationMapLink);

// 場所の入力内容に応じて、Googleマップで検索するリンクの表示・リンク先を更新する。
// APIキー不要のシンプルな検索URLを使うので、地図の埋め込みや経路検索はできないが、
// タップすればGoogleマップアプリが開く。
function updateLocationMapLink() {
  const location = document.getElementById("add-event-form").location.value.trim();
  const link = document.getElementById("location-map-link");
  if (!location) {
    link.hidden = true;
    return;
  }
  link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
  link.hidden = false;
}

initCategorySelect();
render(); // 初期表示
loadWeather();
initNotifyButton();
loadTasks();

// 現在時刻を示す赤い線は再描画時にしか更新されないため、
// 何も操作しなくても実際の時刻に追従するよう1分ごとに再描画する。
setInterval(render, 60 * 1000);

// ---------- ToDo ----------

async function loadTasks() {
  const res = await fetch("/api/tasks");
  if (!res.ok) return;
  const tasks = await res.json();
  renderTasks(tasks || []);
}

function renderTasks(tasks) {
  const list = document.getElementById("todo-list");
  list.innerHTML = "";

  for (const task of tasks) {
    const li = document.createElement("li");
    li.className = "todo-item" + (task.Done ? " done" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.Done;
    checkbox.addEventListener("change", () => toggleTaskDone(task.ID, checkbox.checked));

    const title = document.createElement("span");
    title.className = "todo-title";
    title.textContent = task.Title;

    li.appendChild(checkbox);
    li.appendChild(title);

    if (task.DueDate) {
      const due = document.createElement("span");
      due.className = "todo-due";
      due.textContent = task.DueDate;
      li.appendChild(due);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "todo-delete";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", () => deleteTask(task.ID));
    li.appendChild(deleteBtn);

    list.appendChild(li);
  }
}

async function submitTodo(e) {
  e.preventDefault();
  const titleInput = document.getElementById("todo-title");
  const dueInput = document.getElementById("todo-due");

  const title = titleInput.value.trim();
  if (!title) return;

  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, dueDate: dueInput.value }),
  });
  if (!res.ok) return;

  titleInput.value = "";
  dueInput.value = "";
  loadTasks();
}

async function toggleTaskDone(id, done) {
  await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });
  loadTasks();
}

async function deleteTask(id) {
  await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
  loadTasks();
}

function initCategorySelect() {
  const select = document.getElementById("category-select");
  for (const category of CATEGORIES) {
    const option = document.createElement("option");
    option.value = category.key;
    option.textContent = category.label;
    select.appendChild(option);
  }
}

// ---------- 通知(プッシュ通知) ----------

async function initNotifyButton() {
  const btn = document.getElementById("notify-btn");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    btn.hidden = true; // 非対応ブラウザ(iPhoneの一部バージョンなど)では隠す
    return;
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  const existing = await registration.pushManager.getSubscription();
  btn.classList.toggle("active", !!existing);
}

async function toggleNotifications() {
  const btn = document.getElementById("notify-btn");
  const status = document.getElementById("status");
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();

  if (existing) {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: existing.endpoint }),
    });
    await existing.unsubscribe();
    btn.classList.remove("active");
    status.textContent = "通知をオフにしました";
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    status.textContent = "通知が許可されませんでした";
    return;
  }

  const res = await fetch("/api/push/vapid-public-key");
  const { publicKey } = await res.json();

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });

  btn.classList.add("active");
  status.textContent = "通知をオンにしました(予定の10分前に届きます)";
}

// VAPID公開鍵(base64url文字列)をpushManager.subscribeが要求するUint8Arrayに変換する。
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ---------- 予定の追加・編集・削除 ----------

// event が null なら新規追加、指定されていれば編集モードでダイアログを開く。
function openEventDialog(event) {
  editingEventId = event ? event.ID : null;

  const form = document.getElementById("add-event-form");
  form.reset();

  document.getElementById("add-event-title").textContent = event ? "予定を編集" : "予定を追加";
  document.getElementById("submit-event-btn").textContent = event ? "更新" : "追加";
  document.getElementById("delete-event-btn").hidden = !event;

  if (event) {
    const start = new Date(event.Start);
    const end = new Date(event.End);
    form.summary.value = event.Summary;
    form.date.value = formatDateInput(start);
    form.start.value = formatTimeInput(start);
    form.end.value = formatTimeInput(end);
    form.location.value = event.Location || "";
    form.category.value = event.Category || "";
  } else {
    form.date.value = formatDateInput(currentDate);
    form.category.value = "";
  }

  updateLocationMapLink();
  hideFormError();
  document.getElementById("add-event-dialog").showModal();

  // showModal()はブラウザが自動で最初の入力欄(タイトル)へフォーカスを当てるため、
  // スマホではダイアログを開いた瞬間にキーボードが出てしまう。フォーカスを外して防ぐ。
  document.activeElement?.blur();
}

function showFormError(message) {
  const el = document.getElementById("event-form-error");
  el.textContent = message;
  el.hidden = false;
}

function hideFormError() {
  const el = document.getElementById("event-form-error");
  el.hidden = true;
}

async function submitEventForm(e) {
  e.preventDefault();
  const form = e.target;
  const summary = form.summary.value.trim();
  const date = form.date.value;
  const startTime = form.start.value;
  const endTime = form.end.value;
  const category = form.category.value;
  const location = form.location.value.trim();
  if (!summary || !date || !startTime || !endTime) return;

  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${date}T${endTime}:00`);
  if (end <= start) {
    alert("終了時刻は開始時刻より後にしてください。");
    return;
  }

  const status = document.getElementById("status");
  const isEditing = editingEventId !== null;
  status.textContent = isEditing ? "予定を更新中..." : "予定を追加中...";
  hideFormError();

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    if (isEditing) {
      await submitEditingEvent(editingEventId, summary, location, start, end, category, status);
    } else {
      await submitNewEvent(summary, location, start, end, category, status);
    }
  } finally {
    submitBtn.disabled = false;
  }
}

async function submitNewEvent(summary, location, start, end, category, status) {
  const res = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary, location, start: start.toISOString(), end: end.toISOString() }),
  });

  if (!res.ok) {
    const message = await res.text();
    showFormError(message || `追加に失敗しました (status: ${res.status})`);
    status.textContent = "";
    return;
  }

  const saved = await res.json();
  saved.Category = category;

  const categoryRes = await fetch(`/api/events/${encodeURIComponent(saved.ID)}/category`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category }),
  });

  allEvents.push(saved);
  document.getElementById("add-event-dialog").close();
  render();
  status.textContent = categoryRes.ok ? "予定を追加しました" : "予定は追加しましたが、カテゴリの保存に失敗しました";
}

// 色分け(カテゴリ)はこのアプリ内だけの情報でGoogle側に影響しないため、
// 件名・時間の更新が(主催者でない等の理由で)失敗しても、色の変更だけは必ず試みる。
async function submitEditingEvent(eventId, summary, location, start, end, category, status) {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary, location, start: start.toISOString(), end: end.toISOString() }),
  });

  let saved = null;
  let updateFailedMessage = null;
  if (res.ok) {
    saved = await res.json();
  } else {
    updateFailedMessage = (await res.text()) || `更新に失敗しました (status: ${res.status})`;
  }

  const categoryRes = await fetch(`/api/events/${encodeURIComponent(eventId)}/category`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category }),
  });

  allEvents = allEvents.map((ev) => {
    if (ev.ID !== eventId) return ev;
    return saved ? { ...saved, Category: category } : { ...ev, Category: category };
  });
  render();

  if (updateFailedMessage) {
    showFormError(`${updateFailedMessage}(色の変更は${categoryRes.ok ? "反映しました" : "失敗しました"})`);
    status.textContent = "";
    return;
  }

  document.getElementById("add-event-dialog").close();
  status.textContent = categoryRes.ok ? "予定を更新しました" : "予定は更新しましたが、カテゴリの保存に失敗しました";
}

async function deleteEditingEvent() {
  if (editingEventId === null) return;
  if (!confirm("この予定を削除しますか?")) return;

  const status = document.getElementById("status");
  status.textContent = "予定を削除中...";
  hideFormError();

  const res = await fetch(`/api/events/${encodeURIComponent(editingEventId)}`, { method: "DELETE" });
  if (!res.ok) {
    const message = await res.text();
    showFormError(message || `削除に失敗しました (status: ${res.status})`);
    status.textContent = "";
    return;
  }

  allEvents = allEvents.filter((ev) => ev.ID !== editingEventId);
  document.getElementById("add-event-dialog").close();
  render();
  status.textContent = "予定を削除しました";
}

function formatTimeInput(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
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
  el.style.background = categoryColor(event.Category);
  el.textContent = `${formatTime(start)} ${event.Summary}`;

  attachPopover(el, event.Summary, `${formatTime(start)}〜${formatTime(end)}`, event.Location);
  el.addEventListener("click", () => openEventDialog(event));

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
      el.style.background = categoryColor(event.Category);
      el.textContent = `${formatTime(start)} ${event.Summary}`;
      attachPopover(el, event.Summary, `${formatTime(start)}〜${formatTime(end)}`, event.Location);
      el.addEventListener("click", () => openEventDialog(event));
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
      <div class="emoji">${weatherEmoji(point.condition)}</div>
      <div class="temp">${Math.round(point.tempC)}℃</div>
      <div class="humidity">${Math.round(point.humidityPct)}%</div>
    `;
    strip.appendChild(el);
  }
}

function weatherEmoji(condition) {
  switch (condition) {
    case "clear":
      return "☀️";
    case "partly-cloudy":
      return "⛅";
    case "cloudy":
      return "☁️";
    case "fog":
      return "🌫️";
    case "rain":
      return "🌧️";
    case "snow":
      return "🌨️";
    case "thunder":
      return "⛈️";
    default:
      return "❓";
  }
}

// ---------- ポップオーバー ----------

// 要素にカーソルを乗せると、件名・時間・場所を拡大表示するポップオーバーを出す。
function attachPopover(el, title, timeText, location) {
  el.addEventListener("mouseenter", () => showEventPopover(el, title, timeText, location));
  el.addEventListener("mouseleave", hideEventPopover);
}

function showEventPopover(anchorEl, title, timeText, location) {
  const popover = document.getElementById("event-popover");
  popover.querySelector(".popover-title").textContent = title;
  popover.querySelector(".popover-time").textContent = timeText;

  const locationEl = popover.querySelector(".popover-location");
  if (location) {
    locationEl.textContent = `📍 ${location}`;
    locationEl.hidden = false;
  } else {
    locationEl.hidden = true;
  }

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
