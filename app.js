(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const THEME_KEY = "zepra-theme";
  const supabase = window.supabaseClient;

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

  function createInitialState() {
    return {
      ...initialState,
      tasks: [],
      blocks: initialState.blocks.map((block) => ({ ...block })),
      theme: readTheme()
    };
  }

  function readTheme() {
    try {
      return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    } catch (error) {
      console.error("Could not load your theme preference.", error);
      return "light";
    }
  }

  let state = createInitialState();
  let mode = "focus";
  const durations = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
  let secondsRemaining = durations[mode];
  let timerInterval = null;
  let toastTimeout = null;
  let currentDay = new Date();
  let monthCursor = new Date(currentDay.getFullYear(), currentDay.getMonth(), 1);
  let activeUser = null;
  let syncReady = false;
  let isSaving = false;
  let saveRevision = 0;
  let savedRevision = 0;
  let authLoadGeneration = 0;
  let pendingSave = null;
  let savedDateKeys = new Set();
  let proposedPlan = null;
  let proposedDateKey = null;
  let brainSaveTimeout = null;
  let brainDumpBound = false;
  let failedDate = new Date();

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateFromKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function saveState() {
    if (!syncReady || !activeUser) return;
    saveRevision += 1;
    $("#save-status").textContent = "Syncing to your account…";
    pendingSave = {
      revision: saveRevision,
      userId: activeUser.id,
      planDate: dateKey(currentDay),
      snapshot: {
        tasks: state.tasks.map((task) => ({ ...task })),
        blocks: state.blocks.map((block) => ({ ...block })),
        notes: state.notes,
        focusMinutes: Number(state.focusMinutes) || 0,
        completedSessions: Number(state.completedSessions) || 0
      }
    };
    void flushStateToCloud();
  }

  async function flushStateToCloud() {
    if (!syncReady || !activeUser) return false;
    if (isSaving) {
      while (isSaving) await new Promise((resolve) => window.setTimeout(resolve, 20));
      if (pendingSave && syncReady) return flushStateToCloud();
      return savedRevision === saveRevision;
    }
    isSaving = true;
    let succeeded = true;
    while (pendingSave && syncReady && activeUser) {
      const currentSave = pendingSave;
      const { revision, userId, planDate, snapshot } = currentSave;
      const payload = {
        user_id: userId,
        plan_date: planDate,
        tasks: snapshot.tasks,
        schedule: snapshot.blocks,
        brain_dump: snapshot.notes,
        focus_minutes: snapshot.focusMinutes,
        completed_sessions: snapshot.completedSessions,
        updated_at: new Date().toISOString()
      };
      let error;
      try {
        ({ error } = await supabase
          .from("user_planner_days")
          .upsert(payload, { onConflict: "user_id,plan_date" }));
      } catch (requestError) {
        $("#save-status").textContent = "Cloud sync failed — your latest changes may not be saved";
        console.error("Could not reach Supabase to sync planner data.", requestError);
        showToast("Could not reach cloud storage. Check your connection and try changing something again.");
        succeeded = false;
        break;
      }
      if (error) {
        $("#save-status").textContent = "Cloud sync failed — your latest changes may not be saved";
        console.error("Could not sync planner data to Supabase.", error);
        showToast("Cloud sync failed. Check your connection and try changing something again.");
        succeeded = false;
        break;
      }
      if (activeUser && activeUser.id === userId) {
        savedRevision = revision;
        savedDateKeys.add(planDate);
        if (dateKey(currentDay) === planDate) $("#save-status").textContent = "Synced to your account";
        if (pendingSave === currentSave) pendingSave = null;
        renderCalendar();
      }
    }
    isSaving = false;
    return succeeded && savedRevision === saveRevision;
  }

  function renderProfile(user) {
    const email = user.email || "Signed-in user";
    const initial = email.charAt(0).toUpperCase() || "Z";
    $(".avatar").textContent = initial;
    $("#profile-name").textContent = email;
    $("#profile-caption").textContent = "Personal workspace";
    $("#profile-email").textContent = email;
    $(".top-avatar").textContent = initial;
    $(".top-avatar").setAttribute("title", email);
  }

  function renderPlanner() {
    renderDate();
    renderDays();
    renderSchedule();
    renderTasks();
    renderStats();
    initBrainDump();
    renderCalendar();
    document.body.classList.toggle("dark", state.theme === "dark");
    $("#save-status").textContent = "Synced to your account";
    $("#cloud-loading").hidden = true;
    $("#cloud-retry-button").hidden = true;
    document.body.classList.remove("session-loading");
  }

  async function activateUser(user) {
    activeUser = user;
    renderProfile(user);
    await loadDay(currentDay, false);
    await loadSavedDateKeys(monthCursor);
  }

  async function loadDay(date, flushCurrent = true) {
    if (!activeUser) return false;
    if (flushCurrent) flushBrainDump();
    if (flushCurrent && syncReady && !(await flushStateToCloud())) {
      showToast("Your current day could not be synced. Try again before switching dates.");
      return false;
    }
    const generation = ++authLoadGeneration;
    syncReady = false;
    failedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    $("#cloud-loading-message").textContent = `Loading ${new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date)}…`;
    $("#cloud-retry-button").hidden = true;
    $("#cloud-loading").hidden = false;
    let data;
    let error;
    const selectedKey = dateKey(date);
    try {
      ({ data, error } = await supabase
        .from("user_planner_days")
        .select("tasks, schedule, brain_dump, focus_minutes, completed_sessions")
        .eq("user_id", activeUser.id)
        .eq("plan_date", selectedKey)
        .maybeSingle());
    } catch (requestError) {
      if (generation !== authLoadGeneration) return false;
      console.error("Could not reach Supabase to load this day.", requestError);
      $("#cloud-loading-message").textContent = "Could not reach your cloud planner.";
      $("#cloud-retry-button").hidden = false;
      showToast("Could not reach cloud storage. Check your connection and try again.");
      return false;
    }
    if (generation !== authLoadGeneration) return false;
    if (error) {
      console.error("Could not load this day from Supabase.", error);
      $("#cloud-loading-message").textContent = "Could not load this day. Confirm the planner-days table is set up.";
      $("#cloud-retry-button").hidden = false;
      showToast("Could not load this day. Check the Supabase setup and try again.");
      return false;
    }
    currentDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    state = createInitialState();
    if (selectedKey !== dateKey(new Date())) state.blocks = [];
    if (data) {
      state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      state.blocks = Array.isArray(data.schedule) ? data.schedule : [];
      state.notes = typeof data.brain_dump === "string" ? data.brain_dump : "";
      state.focusMinutes = Number(data.focus_minutes) || 0;
      state.completedSessions = Number(data.completed_sessions) || 0;
      savedDateKeys.add(selectedKey);
    }
    savedRevision = saveRevision;
    pendingSave = null;
    syncReady = true;
    renderPlanner();
    return true;
  }

  async function loadSavedDateKeys(month) {
    if (!activeUser) return;
    const first = dateKey(new Date(month.getFullYear(), month.getMonth(), 1));
    const last = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    let data;
    let error;
    try {
      ({ data, error } = await supabase
        .from("user_planner_days")
        .select("plan_date")
        .eq("user_id", activeUser.id)
        .gte("plan_date", first)
        .lte("plan_date", last));
    } catch (requestError) {
      console.error("Could not reach Supabase to load calendar history.", requestError);
      showToast("Could not load saved-day markers for the calendar.");
      return;
    }
    if (error) {
      console.error("Could not load calendar history from Supabase.", error);
      showToast("Could not load saved-day markers for the calendar.");
      return;
    }
    data.forEach((record) => savedDateKeys.add(record.plan_date));
    renderCalendar();
  }

  async function initializeAuth() {
    if (!window.supabaseConfigured || !supabase) {
      window.location.replace("auth.html?setup=missing");
      return;
    }
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.replace("auth.html");
    });
    let data;
    let error;
    try {
      ({ data, error } = await supabase.auth.getSession());
    } catch (requestError) {
      console.error("Could not reach Supabase to check your session.", requestError);
      window.location.replace("auth.html");
      return;
    }
    if (error) {
      console.error("Could not check your Supabase session.", error);
      window.location.replace("auth.html");
      return;
    }
    if (!data.session) {
      window.location.replace("auth.html");
      return;
    }
    await activateUser(data.session.user);
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2400);
  }

  function renderDate() {
    const todayKey = dateKey(new Date());
    const selectedKey = dateKey(currentDay);
    const isToday = selectedKey === todayKey;
    const label = selectedKey < todayKey ? "HISTORY" : "UPCOMING";
    const formatted = new Intl.DateTimeFormat(undefined, {
      weekday: "long", month: "long", day: "numeric"
    }).format(currentDay).toUpperCase();
    const isTomorrow = selectedKey === dateKey(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1));
    $("#today-date").textContent = isToday ? formatted : `${formatted} · ${label}`;
    const dateLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(currentDay);
    $("#schedule-heading").textContent = isToday ? "Today’s schedule" : isTomorrow ? "Tomorrow’s schedule" : `${dateLabel} schedule`;
    $("#tasks-heading").textContent = isToday ? "Today’s priorities" : isTomorrow ? "Tomorrow’s priorities" : `${dateLabel} priorities`;
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
        void loadDay(day);
      });
      strip.append(button);
    }
  }

  function renderSchedule() {
    const list = $("#schedule-list");
    list.replaceChildren();
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
      const actions = document.createElement("div");
      actions.className = "schedule-actions";
      const edit = document.createElement("button");
      edit.className = "schedule-action";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.setAttribute("aria-label", `Edit ${block.title}`);
      edit.addEventListener("click", () => editScheduleBlock(state.blocks.indexOf(block), item));
      const remove = document.createElement("button");
      remove.className = "schedule-action delete";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Delete ${block.title}`);
      remove.addEventListener("click", () => {
        state.blocks = state.blocks.filter((entry) => entry !== block);
        saveState();
        renderSchedule();
      });
      actions.append(edit, remove);
      titleRow.append(title, tag);
      titleRow.append(actions);
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
      const edit = document.createElement("button");
      edit.className = "task-edit";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.setAttribute("aria-label", `Edit "${task.text}"`);
      edit.addEventListener("click", () => editTask(task, item));
      item.append(checkbox, text, edit, remove);
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

  function editTask(task, item) {
    item.replaceChildren();
    const form = document.createElement("form");
    form.className = "task-edit-form";
    const input = document.createElement("input");
    input.type = "text";
    input.value = task.text;
    input.maxLength = 160;
    input.setAttribute("aria-label", "Edit task");
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", renderTasks);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) {
        input.focus();
        return;
      }
      task.text = text.slice(0, 160);
      saveState();
      renderTasks();
    });
    form.append(input, save, cancel);
    item.append(form);
    input.focus();
    input.select();
  }

  function editScheduleBlock(index, row) {
    const existing = state.blocks[index];
    if (!existing) return;
    const form = document.createElement("form");
    form.className = "schedule-edit-form";
    const time = document.createElement("input");
    time.type = "time";
    time.value = existing.time;
    time.required = true;
    time.setAttribute("aria-label", "Block time");
    const title = document.createElement("input");
    title.type = "text";
    title.value = existing.title;
    title.maxLength = 120;
    title.required = true;
    title.setAttribute("aria-label", "Block title");
    const detail = document.createElement("input");
    detail.type = "text";
    detail.value = existing.detail || "";
    detail.maxLength = 240;
    detail.setAttribute("aria-label", "Block details");
    const category = document.createElement("input");
    category.type = "text";
    category.value = existing.category || "BLOCK";
    category.maxLength = 32;
    category.setAttribute("aria-label", "Block category");
    const actions = document.createElement("div");
    actions.className = "schedule-edit-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", renderSchedule);
    actions.append(save, cancel);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!time.value || !title.value.trim()) {
        title.focus();
        return;
      }
      state.blocks[index] = {
        time: time.value,
        title: title.value.trim(),
        detail: detail.value.trim(),
        category: category.value.trim().toUpperCase() || "BLOCK"
      };
      saveState();
      renderSchedule();
    });
    form.append(time, title, detail, category, actions);
    row.replaceChildren(form);
    title.focus();
    title.select();
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
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      console.error("Could not save your theme preference.", error);
      showToast("Your theme changed, but the preference could not be saved on this device.");
    }
  }

  function initBrainDump() {
    const input = $("#brain-input");
    input.value = state.notes;
    const updateCount = () => {
      const words = input.value.trim() ? input.value.trim().split(/\s+/).length : 0;
      $("#word-count").textContent = `${words} ${words === 1 ? "word" : "words"}`;
    };
    updateCount();
    if (brainDumpBound) return;
    brainDumpBound = true;
    input.addEventListener("input", () => {
      updateCount();
      $("#save-status").textContent = "Saving…";
      window.clearTimeout(brainSaveTimeout);
      brainSaveTimeout = window.setTimeout(() => {
        state.notes = input.value;
        saveState();
      }, 350);
    });
  }

  function flushBrainDump() {
    window.clearTimeout(brainSaveTimeout);
    if (state.notes === $("#brain-input").value) return;
    state.notes = $("#brain-input").value;
    saveState();
  }

  function renderCalendar() {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    $("#calendar-month-label").textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(monthCursor);
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const grid = $("#calendar-grid");
    grid.replaceChildren();
    for (let cell = 0; cell < 42; cell += 1) {
      const dayNumber = cell - startOffset + 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-day";
      if (dayNumber < 1 || dayNumber > daysInMonth) {
        button.disabled = true;
        button.setAttribute("aria-hidden", "true");
      } else {
        const date = new Date(year, month, dayNumber);
        const key = dateKey(date);
        button.textContent = String(dayNumber);
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-label", new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(date));
        button.setAttribute("aria-pressed", String(key === dateKey(currentDay)));
        if (key === dateKey(currentDay)) button.classList.add("selected");
        if (key === dateKey(new Date())) button.classList.add("today");
        if (savedDateKeys.has(key)) button.classList.add("has-data");
        button.addEventListener("click", async () => {
          $("#calendar-dialog").close();
          await loadDay(date);
        });
      }
      grid.append(button);
    }
  }

  function moveCalendarMonth(amount) {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + amount, 1);
    renderCalendar();
    void loadSavedDateKeys(monthCursor);
  }

  function openCalendar() {
    monthCursor = new Date(currentDay.getFullYear(), currentDay.getMonth(), 1);
    renderCalendar();
    void loadSavedDateKeys(monthCursor);
    $("#calendar-dialog").showModal();
  }

  function formatPlanDate(date) {
    return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date);
  }

  function validateGeneratedPlan(value) {
    if (!value || !Array.isArray(value.schedule) || !Array.isArray(value.tasks)) {
      throw new Error("The planner returned an invalid plan. Please try generating it again.");
    }
    if (value.schedule.length > 16 || value.tasks.length > 30) {
      throw new Error("The generated plan is too large to apply safely.");
    }
    const schedule = value.schedule.map((block) => {
      if (!block || !/^([01]\d|2[0-3]):[0-5]\d$/.test(block.time) || typeof block.title !== "string" || !block.title.trim()) {
        throw new Error("The generated plan contains an invalid time block. Please try again.");
      }
      return {
        time: block.time,
        title: block.title.trim().slice(0, 120),
        detail: typeof block.detail === "string" ? block.detail.trim().slice(0, 240) : "",
        category: typeof block.category === "string" ? block.category.trim().slice(0, 32).toUpperCase() : "PLAN"
      };
    }).sort((a, b) => a.time.localeCompare(b.time));
    const tasks = value.tasks.map((task) => {
      const text = typeof task === "string" ? task : task && task.text;
      if (typeof text !== "string" || !text.trim()) throw new Error("The generated plan contains an invalid task.");
      return { text: text.trim().slice(0, 160), completed: false };
    });
    return { schedule, tasks };
  }

  function renderPlanPreview(plan, targetDate) {
    proposedPlan = plan;
    proposedDateKey = dateKey(targetDate);
    $("#plan-preview-title").textContent = formatPlanDate(targetDate);
    $("#plan-block-count").textContent = `${plan.schedule.length} time blocks`;
    const list = $("#plan-preview-list");
    list.replaceChildren();
    plan.schedule.forEach((block) => {
      const item = document.createElement("article");
      item.className = "plan-preview-item";
      const time = document.createElement("time");
      time.textContent = formatTime(block.time);
      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = block.title;
      const subtitle = document.createElement("span");
      subtitle.textContent = block.detail || block.category;
      detail.append(title, subtitle);
      item.append(time, detail);
      list.append(item);
    });
    const taskList = $("#plan-preview-tasks");
    taskList.replaceChildren();
    if (plan.tasks.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No tasks suggested.";
      taskList.append(empty);
    } else {
      plan.tasks.forEach((task) => {
        const item = document.createElement("li");
        item.textContent = task.text;
        taskList.append(item);
      });
    }
    $("#plan-preview").hidden = false;
  }

  async function generateEveningPlan(event) {
    event.preventDefault();
    const summary = $("#evening-summary").value.trim();
    const tasks = $("#evening-tasks").value.split(/\r?\n/).map((task) => task.trim()).filter(Boolean);
    const constraints = $("#evening-constraints").value.trim();
    if (!summary) {
      $("#evening-summary").focus();
      return;
    }
    const button = $("#generate-plan-button");
    button.disabled = true;
    button.textContent = "Planning your day…";
    $("#evening-status").textContent = "Sending your wrap-up securely to the planning assistant…";
    $("#evening-status").className = "auth-message evening-status";
    $("#plan-preview").hidden = true;
    proposedPlan = null;
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    try {
      const { data, error } = await supabase.functions.invoke("plan-evening", {
        body: { summary, tasks, constraints, target_date: dateKey(targetDate) }
      });
      if (error) {
        console.error("Evening planning function returned an error.", error);
        throw new Error(error.message || "The planning assistant could not create a plan.");
      }
      renderPlanPreview(validateGeneratedPlan(data), targetDate);
      $("#evening-status").textContent = "Review the draft, then apply it when it looks right.";
      $("#evening-status").classList.add("success");
    } catch (error) {
      console.error("Could not generate an evening plan.", error);
      $("#evening-status").textContent = error.message || "Could not generate a plan. Check your connection and try again.";
      $("#evening-status").classList.add("error");
    } finally {
      button.disabled = false;
      button.textContent = "✧ Generate tomorrow’s plan";
    }
  }

  async function applyEveningPlan() {
    if (!proposedPlan) return;
    const targetDate = dateFromKey(proposedDateKey);
    const plan = proposedPlan;
    if (!(await loadDay(targetDate))) {
      $("#evening-status").textContent = "Could not load tomorrow’s planner record. The plan was not applied.";
      $("#evening-status").classList.add("error");
      return;
    }
    state.blocks = plan.schedule;
    const existingTasks = new Set(state.tasks.map((task) => task.text.toLocaleLowerCase()));
    plan.tasks.forEach((task) => {
      const normalizedText = task.text.toLocaleLowerCase();
      if (!existingTasks.has(normalizedText)) {
        state.tasks.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...task });
        existingTasks.add(normalizedText);
      }
    });
    saveState();
    renderDays();
    renderSchedule();
    renderTasks();
    $("#evening-dialog").close();
    showToast("Tomorrow’s plan is in your schedule.");
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
  $("#open-calendar-button").addEventListener("click", openCalendar);
  $("#calendar-previous").addEventListener("click", () => moveCalendarMonth(-1));
  $("#calendar-next").addEventListener("click", () => moveCalendarMonth(1));
  $("#calendar-today").addEventListener("click", async () => {
    const today = new Date();
    $("#calendar-dialog").close();
    if (await loadDay(today)) {
      monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
      renderCalendar();
    }
  });
  $("#cloud-retry-button").addEventListener("click", () => void loadDay(failedDate, false));
  $("#open-evening-plan-button").addEventListener("click", () => {
    $("#evening-dialog").showModal();
    $("#evening-summary").focus();
  });
  $("#evening-plan-form").addEventListener("submit", generateEveningPlan);
  $("#apply-plan-button").addEventListener("click", () => void applyEveningPlan());
  $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  $$(".planner-dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));
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
  $("#profile-menu-button").addEventListener("click", () => {
    const button = $("#profile-menu-button");
    const menu = $("#profile-dropdown");
    const isOpen = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!isOpen));
    menu.hidden = isOpen;
  });
  document.addEventListener("click", (event) => {
    if (!$("#profile").contains(event.target)) {
      $("#profile-menu-button").setAttribute("aria-expanded", "false");
      $("#profile-dropdown").hidden = true;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      $("#profile-menu-button").setAttribute("aria-expanded", "false");
      $("#profile-dropdown").hidden = true;
    }
  });
  $("#sign-out-button").addEventListener("click", async () => {
    $("#sign-out-button").disabled = true;
    let error;
    try {
      ({ error } = await supabase.auth.signOut());
    } catch (requestError) {
      $("#sign-out-button").disabled = false;
      console.error("Could not reach Supabase to sign out.", requestError);
      showToast("Could not reach Supabase to sign out. Please try again.");
      return;
    }
    if (error) {
      $("#sign-out-button").disabled = false;
      console.error("Could not sign out of Supabase.", error);
      showToast("Could not sign out. Please try again.");
      return;
    }
    window.location.replace("auth.html");
  });

  renderDate();
  updateTimerDisplay();
  document.body.classList.toggle("dark", state.theme === "dark");
  void initializeAuth();
})();
