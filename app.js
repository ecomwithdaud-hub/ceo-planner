(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const STORAGE_KEY = "zepra-command-center-v1";

  const initialState = {
    tasks: [],
    blocks: [
      { time: "08:30", title: "Morning reset", detail: "Coffee, journal & set your intention", category: "RITUAL" },
      { time: "09:00", title: "Deep work: Q4 product roadmap", detail: "Your most important work, distraction-free", category: "DEEP WORK" },
      { time: "11:00", title: "Team stand-up", detail: "Product & engineering · 30 min", category: "MEETING" },
      { time: "13:30", title: "Client sync — Acme Co.", detail: "Review the launch plan", category: "CLIENT" },
      { time: "15:00", title: "Build & ship", detail: "Protect this time for focused making", category: "DEEP WORK" }
    ],
    notes: "",
    focusMinutes: 0,
    completedSessions: 0,
    theme: "light"
  };

  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return { ...initialState };
      return {
        ...initialState,
        ...saved,
        tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
        blocks: Array.isArray(saved.blocks) ? saved.blocks : initialState.blocks,
        notes: typeof saved.notes === "string" ? saved.notes : ""
      };
    } catch (error) {
      console.error("Could not load your saved planner data.", error);
      return { ...initialState };
    }
  }

  let state = readState();
  let mode = "focus";
  const durations = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
  let secondsRemaining = durations[mode];
  let timerInterval = null;
  let toastTimeout = null;
  let currentDay = new Date();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $("#save-status").textContent = "Saved on this device";
    } catch (error) {
      $("#save-status").textContent = "Couldn’t save — check device storage";
      console.error("Could not save your planner data.", error);
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2400);
  }

  function renderDate() {
    $("#today-date").textContent = new Intl.DateTimeFormat(undefined, {
      weekday: "long", month: "long", day: "numeric"
    }).format(new Date()).toUpperCase();
  }

  function renderDays() {
    const strip = $("#day-strip");
    const start = new Date(currentDay);
    const dayOfWeek = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dayOfWeek);
    strip.replaceChildren();
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const button = document.createElement("button");
      button.className = `day-button${day.toDateString() === currentDay.toDateString() ? " selected" : ""}`;
      button.type = "button";
      button.innerHTML = `<span>${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day).toUpperCase()}</span><strong>${day.getDate()}</strong>`;
      button.setAttribute("aria-label", new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(day));
      button.setAttribute("aria-pressed", String(day.toDateString() === currentDay.toDateString()));
      button.addEventListener("click", () => {
        currentDay = day;
        renderDays();
        renderSchedule();
      });
      strip.append(button);
    }
  }

  function renderSchedule() {
    const list = $("#schedule-list");
    list.replaceChildren();
    if (currentDay.toDateString() !== new Date().toDateString()) {
      const empty = document.createElement("p");
      empty.className = "schedule-empty";
      empty.textContent = "A fresh page for this day. Add a block when you’re ready.";
      list.append(empty);
      return;
    }
    if (state.blocks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "schedule-empty";
      empty.textContent = "No blocks planned yet. Add one to give your day some shape.";
      list.append(empty);
      return;
    }
    [...state.blocks].sort((a, b) => a.time.localeCompare(b.time)).forEach((block) => {
      const item = document.createElement("article");
      item.className = "schedule-item";
      const time = document.createElement("time");
      time.className = "schedule-time";
      time.textContent = formatTime(block.time);
      const dot = document.createElement("span");
      dot.className = "schedule-dot";
      const details = document.createElement("div");
      details.className = "schedule-details";
      const titleRow = document.createElement("div");
      titleRow.className = "schedule-title-row";
      const title = document.createElement("span");
      title.className = "schedule-title";
      title.textContent = block.title;
      const tag = document.createElement("span");
      tag.className = "schedule-tag";
      tag.textContent = block.category || "BLOCK";
      const subtitle = document.createElement("p");
      subtitle.className = "schedule-subtitle";
      subtitle.textContent = block.detail || "Time set aside for what matters.";
      titleRow.append(title, tag);
      details.append(titleRow, subtitle);
      item.append(time, dot, details);
      list.append(item);
    });
  }

  function formatTime(value) {
    const [hours, minutes] = value.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  function renderTasks() {
    const list = $("#task-list");
    list.replaceChildren();
    state.tasks.forEach((task) => {
      const item = document.createElement("li");
      item.className = `task-item${task.completed ? " completed" : ""}`;
      const checkbox = document.createElement("input");
      checkbox.className = "task-check";
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(task.completed);
      checkbox.setAttribute("aria-label", `Mark "${task.text}" ${task.completed ? "incomplete" : "complete"}`);
      checkbox.addEventListener("change", () => {
        task.completed = checkbox.checked;
        saveState();
        renderTasks();
      });
      const text = document.createElement("span");
      text.className = "task-text";
      text.textContent = task.text;
      const remove = document.createElement("button");
      remove.className = "task-delete";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Delete "${task.text}"`);
      remove.addEventListener("click", () => {
        state.tasks = state.tasks.filter((entry) => entry.id !== task.id);
        saveState();
        renderTasks();
      });
      item.append(checkbox, text, remove);
      list.append(item);
    });
    const total = state.tasks.length;
    const completed = state.tasks.filter((task) => task.completed).length;
    $("#task-count").textContent = `${total} ${total === 1 ? "task" : "tasks"}`;
    $("#task-stat").innerHTML = `${completed} <small>/ ${total}</small>`;
    $("#progress-stat").innerHTML = `${total ? Math.round(completed / total * 100) : 0}<small>%</small>`;
    $("#progress-bar").style.width = `${total ? completed / total * 100 : 0}%`;
    $("#empty-tasks").classList.toggle("visible", total === 0);
  }

  function addTask(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    state.tasks.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: trimmed, completed: false });
    saveState();
    renderTasks();
  }

  function updateTimerDisplay() {
    const minutes = Math.floor(secondsRemaining / 60).toString().padStart(2, "0");
    const seconds = (secondsRemaining % 60).toString().padStart(2, "0");
    $("#timer-display").textContent = `${minutes}:${seconds}`;
    const elapsed = durations[mode] - secondsRemaining;
    const circumference = 2 * Math.PI * 88;
    $("#timer-progress").style.strokeDasharray = String(circumference);
    $("#timer-progress").style.strokeDashoffset = String(circumference * elapsed / durations[mode]);
    $("#timer-caption").textContent = mode === "focus" ? "TIME TO FOCUS" : mode === "short" ? "SHORT BREAK" : "LONG BREAK";
  }

  function setMode(nextMode) {
    mode = nextMode;
    secondsRemaining = durations[mode];
    window.clearInterval(timerInterval);
    timerInterval = null;
    $$(".mode-button").forEach((button) => button.classList.toggle("selected", button.dataset.mode === mode));
    $("#timer-start").innerHTML = "<span>▶</span> Start focus";
    updateTimerDisplay();
  }

  function finishTimer() {
    window.clearInterval(timerInterval);
    timerInterval = null;
    const completedMode = mode;
    if (completedMode === "focus") {
      state.focusMinutes = (Number(state.focusMinutes) || 0) + 25;
      state.completedSessions = (Number(state.completedSessions) || 0) + 1;
      saveState();
      renderStats();
      showToast("Focus session complete. Take a breath — you earned it.");
    } else {
      showToast("Break complete. Ready when you are.");
    }
    setMode(completedMode === "focus" ? "short" : "focus");
  }

  function renderStats() {
    $("#focus-stat").innerHTML = `${Number(state.focusMinutes) || 0} <small>min</small>`;
  }

  function startTimer() {
    if (timerInterval) {
      window.clearInterval(timerInterval);
      timerInterval = null;
      $("#timer-start").innerHTML = "<span>▶</span> Resume";
      return;
    }
    $("#timer-start").innerHTML = "<span>Ⅱ</span> Pause";
    timerInterval = window.setInterval(() => {
      secondsRemaining -= 1;
      updateTimerDisplay();
      if (secondsRemaining <= 0) finishTimer();
    }, 1000);
  }

  function addScheduleBlock() {
    if (currentDay.toDateString() !== new Date().toDateString()) {
      currentDay = new Date();
      renderDays();
      renderSchedule();
    }
    const row = document.createElement("form");
    row.className = "schedule-add-row";
    row.innerHTML = '<label class="visually-hidden" for="block-time">Block time</label><input id="block-time" type="time" value="16:00" required><label class="visually-hidden" for="block-title">Block title</label><input id="block-title" type="text" maxlength="70" placeholder="Name this time block" required><button type="submit">Add</button>';
    $("#schedule-list").append(row);
    const titleInput = $("#block-title");
    titleInput.focus();
    row.addEventListener("submit", (event) => {
      event.preventDefault();
      const title = titleInput.value.trim();
      const time = $("#block-time").value;
      if (!title || !time) return;
      state.blocks.push({ time, title, detail: "Time set aside for what matters.", category: "BLOCK" });
      saveState();
      renderSchedule();
      showToast("Time block added to your day.");
    });
  }

  function setTheme(theme) {
    state.theme = theme;
    document.body.classList.toggle("dark", theme === "dark");
    saveState();
  }

  function initBrainDump() {
    const input = $("#brain-input");
    input.value = state.notes;
    let saveTimeout;
    const updateCount = () => {
      const words = input.value.trim() ? input.value.trim().split(/\s+/).length : 0;
      $("#word-count").textContent = `${words} ${words === 1 ? "word" : "words"}`;
    };
    updateCount();
    input.addEventListener("input", () => {
      updateCount();
      $("#save-status").textContent = "Saving…";
      window.clearTimeout(saveTimeout);
      saveTimeout = window.setTimeout(() => {
        state.notes = input.value;
        saveState();
      }, 350);
    });
  }

  $("#task-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#task-input");
    if (!input.value.trim()) {
      input.focus();
      return;
    }
    addTask(input.value);
    input.value = "";
    input.focus();
  });
  $("#add-task-top").addEventListener("click", () => {
    $("#task-input").focus();
    $("#task-input").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#add-block-button").addEventListener("click", addScheduleBlock);
  $("#timer-start").addEventListener("click", startTimer);
  $("#timer-reset").addEventListener("click", () => {
    window.clearInterval(timerInterval);
    timerInterval = null;
    secondsRemaining = durations[mode];
    $("#timer-start").innerHTML = "<span>▶</span> Start focus";
    updateTimerDisplay();
  });
  $("#timer-skip").addEventListener("click", () => {
    setMode(mode === "focus" ? "short" : "focus");
  });
  $$(".mode-button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  $("#theme-toggle").addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));

  renderDate();
  renderDays();
  renderSchedule();
  renderTasks();
  renderStats();
  updateTimerDisplay();
  initBrainDump();
  document.body.classList.toggle("dark", state.theme === "dark");
})();
