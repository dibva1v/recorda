/* app.js — shared API wrapper, nav renderer, and per-page logic */

// ─── Field lists (used in multiple places) ─────────────────────────────────
const STUDENT_FIELDS = [
  "student_number",
  "first_name",
  "last_name",
  "email",
  "phone",
  "date_of_birth",
  "gender",
  "department_id",
  "year_level",
  "enrollment_date",
  "status",
  "address",
];

// ─── API wrapper ───────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...opts,
  });

  if (res.status === 401) {
    const onLogin =
      location.pathname === "/" || location.pathname.endsWith("/index.html");
    if (!onLogin) location.href = "/index.html";
    throw new Error("Unauthenticated");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return node;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString();
}

function showToast(msg, kind = "success") {
  const div = el("div", { class: `alert ${kind}`, text: msg });
  Object.assign(div.style, {
    position: "fixed",
    top: "70px",
    right: "20px",
    zIndex: "999",
  });
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2600);
}

function fillDeptSelect(select, depts, valueKey = "code") {
  for (const d of depts) {
    select.appendChild(
      el("option", {
        value: String(d[valueKey]),
        text: `${d.code} — ${d.name}`,
      }),
    );
  }
}

// ─── Nav + auth (shared by every authenticated page) ───────────────────────
async function renderNav(activePage) {
  let me;
  try {
    me = await api("/auth/me");
  } catch {
    return;
  }

  const links = [
    ["dashboard", "dashboard.html", "Dashboard"],
    ["students", "students.html", "Student Records"],
    ["register", "register.html", "Register Student"],
    ["departments", "departments.html", "Departments"],
    ["settings", "settings.html", "Settings"],
  ];

  document.body.prepend(
    el("nav", { class: "nav" }, [
      el("a", { href: "dashboard.html", class: "brand" }, [
        el("img", { src: "./logo.png", alt: "" }),
        el("span", { text: "Recorda" }),
      ]),
      ,
      ...links.map(([key, href, label]) =>
        el("a", {
          href,
          class: key === activePage ? "active" : "",
          text: label,
        }),
      ),
      el("span", { class: "spacer" }),
      el("span", { class: "who", text: me.full_name }),
      el("button", {
        class: "secondary small",
        text: "Logout",
        onclick: async () => {
          await api("/auth/logout", { method: "POST" });
          location.href = "/index.html";
        },
      }),
    ]),
  );

  try {
    const prefs = await api("/settings");
    if (prefs.theme)
      document.documentElement.setAttribute("data-theme", prefs.theme);
  } catch {}

  return me;
}

// ─── initLogin ─────────────────────────────────────────────────────────────
async function initLogin() {
  try {
    await api("/auth/me");
    location.href = "/dashboard.html";
    return;
  } catch {}

  const form = document.getElementById("login-form");
  const errBox = document.getElementById("login-error");
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.textContent = "";
    submitBtn.disabled = true;

    const username = form.username.value.trim();
    const password = form.password.value;

    if (!username || !password) {
      errBox.textContent = "Enter username and password.";
      submitBtn.disabled = false;
      return;
    }

    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      location.href = "/dashboard.html";
    } catch (err) {
      errBox.textContent = err.message;
      submitBtn.disabled = false;
    }
  });
}

// ─── initDashboard ─────────────────────────────────────────────────────────
async function initDashboard() {
  await renderNav("dashboard");
  const summary = await api("/dashboard/summary");

  document.getElementById("stat-total").textContent = summary.totalStudents;
  document.getElementById("stat-active").textContent = summary.activeStudents;
  document.getElementById("stat-depts").textContent = summary.totalDepartments;
  document.getElementById("stat-month").textContent = summary.thisMonth;

  const tbody = document.querySelector("#recent-table tbody");
  tbody.replaceChildren();

  if (summary.recent.length === 0) {
    tbody.appendChild(
      el(
        "tr",
        {},
        el("td", {
          colspan: 5,
          class: "muted",
          text: "No registrations yet.",
        }),
      ),
    );
    return;
  }

  for (const s of summary.recent) {
    tbody.appendChild(
      el("tr", {}, [
        el("td", { text: s.student_number }),
        el("td", { text: `${s.first_name} ${s.last_name}` }),
        el("td", { text: s.department_code || "—" }),
        el("td", { text: formatDate(s.created_at) }),
      ]),
    );
  }
}

// ─── initStudents ──────────────────────────────────────────────────────────
async function initStudents() {
  await renderNav("students");

  const params = new URLSearchParams(location.search);
  const state = {
    search: params.get("search") || "",
    department: params.get("department") || "",
    status: params.get("status") || "",
    page: Number(params.get("page")) || 1,
  };

  const depts = await api("/departments");
  const deptSelect = document.getElementById("filter-dept");
  const searchInput = document.getElementById("filter-search");
  const statusSelect = document.getElementById("filter-status");

  fillDeptSelect(deptSelect, depts);
  deptSelect.value = state.department;
  searchInput.value = state.search;
  statusSelect.value = state.status;

  function qsOf() {
    const qs = new URLSearchParams();
    if (state.search) qs.set("search", state.search);
    if (state.department) qs.set("department", state.department);
    if (state.status) qs.set("status", state.status);
    qs.set("page", state.page);
    return qs;
  }

  async function load() {
    const qs = qsOf();
    const data = await api(`/students?${qs}`);
    const tbody = document.querySelector("#students-table tbody");
    tbody.replaceChildren();

    if (data.students.length === 0) {
      tbody.appendChild(
        el(
          "tr",
          {},
          el("td", {
            colspan: 6,
            class: "muted",
            text: "No students found.",
          }),
        ),
      );
    }

    for (const s of data.students) {
      tbody.appendChild(
        el("tr", {}, [
          el("td", { text: s.student_number }),
          el("td", { text: `${s.first_name} ${s.last_name}` }),
          el("td", { text: s.department_code || "—" }),
          el("td", { text: s.year_level || "—" }),
          el(
            "td",
            {},
            el("span", { class: `badge ${s.status}`, text: s.status }),
          ),
          el("td", {}, [
            el("button", {
              class: "small secondary",
              text: "View",
              onclick: () => showStudent(s.id),
            }),
            " ",
            el("a", {
              class: "btn small",
              href: `register.html?id=${s.id}`,
              text: "Edit",
            }),
          ]),
        ]),
      );
    }

    renderPagination(data);
    history.replaceState(null, "", `students.html?${qs}`);
  }

  function renderPagination(data) {
    const wrap = document.getElementById("pagination");
    wrap.replaceChildren();
    const total = Math.max(1, Math.ceil(data.total / data.limit));
    if (total <= 1) return;
    for (let i = 1; i <= total; i++) {
      wrap.appendChild(
        el("button", {
          class: i === data.page ? "active" : "",
          text: String(i),
          onclick: () => {
            state.page = i;
            load();
          },
        }),
      );
    }
  }

  async function showStudent(id) {
    const s = await api(`/students/${id}`);
    const rows = [
      ["Student #", s.student_number],
      ["Name", `${s.first_name} ${s.last_name}`],
      ["Email", s.email],
      ["Phone", s.phone || "—"],
      ["Date of Birth", formatDate(s.date_of_birth)],
      ["Gender", s.gender || "—"],
      [
        "Department",
        s.department_name ? `${s.department_code} — ${s.department_name}` : "—",
      ],
      ["Year Level", s.year_level || "—"],
      ["Enrollment", formatDate(s.enrollment_date)],
      ["Status", s.status],
      ["Address", s.address || "—"],
      ["Registered", formatDate(s.created_at)],
    ];

    const modal = el("div", { class: "modal-backdrop" }, [
      el("div", { class: "modal" }, [
        el("h3", { text: "Student Details" }),
        ...rows.map(([k, v]) =>
          el("div", { class: "detail-row" }, [
            el("span", { class: "k", text: k }),
            el("span", { text: String(v) }),
          ]),
        ),
        el("div", { class: "actions" }, [
          el("button", {
            class: "secondary",
            text: "Close",
            onclick: () => modal.remove(),
          }),
          el("a", {
            class: "btn",
            href: `register.html?id=${s.id}`,
            text: "Edit",
          }),
        ]),
      ]),
    ]);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
  }

  function resetAndLoad(patch) {
    Object.assign(state, patch, { page: 1 });
    load();
  }

  document.getElementById("filter-form").addEventListener("submit", (e) => {
    e.preventDefault();
    resetAndLoad({
      search: searchInput.value.trim(),
      department: deptSelect.value,
      status: statusSelect.value,
    });
  });
  deptSelect.addEventListener("change", () =>
    resetAndLoad({ department: deptSelect.value }),
  );
  statusSelect.addEventListener("change", () =>
    resetAndLoad({ status: statusSelect.value }),
  );

  await load();
}

// ─── initRegister ──────────────────────────────────────────────────────────
async function initRegister() {
  await renderNav("register");

  const id = new URLSearchParams(location.search).get("id");
  const form = document.getElementById("student-form");
  const title = document.getElementById("form-title");
  const errBox = document.getElementById("form-error");
  const submitBtn = form.querySelector('button[type="submit"]');

  const depts = await api("/departments");
  fillDeptSelect(form.department_id, depts, "id");

  if (id) {
    title.textContent = "Edit Student";
    const s = await api(`/students/${id}`);
    for (const key of STUDENT_FIELDS) {
      if (form[key] != null && s[key] != null) form[key].value = s[key];
    }
    if (s.department_id) form.department_id.value = String(s.department_id);
  } else {
    const year = new Date().getFullYear();
    const all = await api("/students?page=1");
    form.student_number.value = `STU-${year}-${String(all.total + 1).padStart(4, "0")}`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.textContent = "";
    submitBtn.disabled = true;

    const payload = {};
    for (const key of STUDENT_FIELDS) {
      const v = form[key].value;
      payload[key] = v === "" ? null : v;
    }
    if (payload.department_id)
      payload.department_id = Number(payload.department_id);
    if (payload.year_level) payload.year_level = Number(payload.year_level);

    try {
      if (id) {
        await api(`/students/${id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        showToast("Student updated");
      } else {
        await api("/students", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        showToast("Student registered");
      }
      setTimeout(() => (location.href = "/students.html"), 700);
    } catch (err) {
      errBox.textContent = err.message;
      submitBtn.disabled = false;
    }
  });
}

// ─── initDepartments ───────────────────────────────────────────────────────
async function initDepartments() {
  await renderNav("departments");
  const grid = document.getElementById("dept-grid");
  grid.replaceChildren();

  const depts = await api("/departments");
  for (const d of depts) {
    grid.appendChild(
      el(
        "div",
        {
          class: "dept-card",
          onclick: () =>
            (location.href = `students.html?department=${encodeURIComponent(d.code)}`),
        },
        [
          el("div", { class: "code", text: d.code }),
          el("div", { class: "name", text: d.name }),
          el("div", { class: "head", text: d.head || "No head assigned" }),
          el("div", {
            class: "count",
            text: `${d.student_count} student${d.student_count === 1 ? "" : "s"}`,
          }),
        ],
      ),
    );
  }
}

// ─── initSettings ──────────────────────────────────────────────────────────
async function initSettings() {
  const me = await renderNav("settings");
  const form = document.getElementById("settings-form");
  const success = document.getElementById("settings-success");
  const errBox = document.getElementById("settings-error");

  document.getElementById("profile-name").textContent = me.full_name;
  document.getElementById("profile-username").textContent = me.username;

  const prefs = await api("/settings");
  form.rows_per_page.value = prefs.rows_per_page || "10";
  form.theme.value = prefs.theme || "light";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.textContent = "";
    success.textContent = "";
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({
          rows_per_page: form.rows_per_page.value,
          theme: form.theme.value,
          default_department: defaultDept.value,
        }),
      });
      document.documentElement.setAttribute("data-theme", form.theme.value);
      success.textContent = "Settings saved.";
      setTimeout(() => (success.textContent = ""), 2500);
    } catch (err) {
      errBox.textContent = err.message;
    }
  });
}
