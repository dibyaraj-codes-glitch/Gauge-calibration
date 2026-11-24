(() => {
  "use strict";

  const STORAGE_KEY = "gaugetrack-data-v1";
  const ORGANIZATION_STORAGE_KEY = "gaugetrack-organizations-v1";
  const DUE_SOON_DAYS = 30;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { organizations: [], activeOrganizationId: "", gauges: [], activities: [], scanner: null, scanHandled: false };
  const viewTitles = { dashboard: "Overview", registry: "Gauge registry", scanner: "QR scanner", activity: "Borrowing", product: "Product passport" };

  function localDateString(date = new Date()) {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return adjusted.toISOString().slice(0, 10);
  }

  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) || localDateString(date) !== value ? null : date;
  }

  function dayDifference(dateText) {
    const date = parseDate(dateText);
    if (!date) return null;
    return Math.round((date - parseDate(localDateString()) ) / 86400000);
  }

  function formatDate(dateText) {
    const date = parseDate(dateText);
    return date ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date) : "—";
  }

  function formatDateTime(dateText) {
    const date = new Date(dateText);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function statusFor(gauge) {
    const days = dayDifference(gauge.nextCalibrationDate);
    if (days === null || days < 0) return { key: "overdue", label: "Overdue", days };
    if (days <= DUE_SOON_DAYS) return { key: "due-soon", label: "Due soon", days };
    return { key: "calibrated", label: "Calibrated", days };
  }

  function hasPublicAppUrl() {
    return window.location.protocol === "https:" &&
      !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  }

  function makeOrganization(name, gauges = [], activities = []) {
    return { id: createId(), name, gauges, activities };
  }

  function activeOrganization() {
    return state.organizations.find((organization) => organization.id === state.activeOrganizationId);
  }

  function loadActiveOrganization() {
    const organization = activeOrganization();
    state.gauges = organization ? organization.gauges : [];
    state.activities = organization ? organization.activities : [];
  }

  function readStoredData(stored) {
    try {
      const organizationData = localStorage.getItem(ORGANIZATION_STORAGE_KEY);
      if (organizationData) {
        const saved = JSON.parse(organizationData);
        if (!saved || saved.version !== 1 || !Array.isArray(saved.organizations) || !saved.organizations.length ||
            new Set(saved.organizations.map((organization) => organization && organization.id)).size !== saved.organizations.length ||
            saved.organizations.some((organization) =>
              !organization || typeof organization.id !== "string" || !organization.id ||
              typeof organization.name !== "string" || !organization.name.trim() ||
              !Array.isArray(organization.gauges) || !Array.isArray(organization.activities))) {
          throw new Error("The saved organization data has an unexpected format.");
        }
        state.organizations = saved.organizations;
        state.activeOrganizationId = state.organizations.some((organization) => organization.id === saved.activeOrganizationId)
          ? saved.activeOrganizationId
          : state.organizations[0].id;
      } else {
        const legacyData = localStorage.getItem(STORAGE_KEY);
        const saved = legacyData ? JSON.parse(legacyData) : { gauges: [], activities: [] };
        if (!saved || !Array.isArray(saved.gauges) || !Array.isArray(saved.activities)) {
          throw new Error("The saved GaugeTrack data has an unexpected format.");
        }
        const organization = makeOrganization("My workspace", saved.gauges, saved.activities);
        state.organizations = [organization];
        state.activeOrganizationId = organization.id;
      }
      loadActiveOrganization();
      return { gauges: state.gauges, activities: state.activities };
    } catch (error) {
      showToast(`Could not load saved data: ${error.message}`, true);
      const organization = makeOrganization("My workspace");
      state.organizations = [organization];
      state.activeOrganizationId = organization.id;
    }
    loadActiveOrganization();
    return { gauges: state.gauges, activities: state.activities };
  }

  function persist() {
    try {
      const organization = activeOrganization();
      if (!organization) throw new Error("The active organization could not be found.");
      organization.gauges = state.gauges;
      organization.activities = state.activities;
      localStorage.setItem(ORGANIZATION_STORAGE_KEY, JSON.stringify({
        version: 1,
        activeOrganizationId: state.activeOrganizationId,
        organizations: state.organizations
      }));
      const savedStatus = $(".system-status");
      if (savedStatus) savedStatus.innerHTML = `<i></i> SAVED LOCALLY`;
      return true;
    } catch (error) {
      showToast(`Could not save your changes: ${error.message}`, true);
      return false;
    }
  }

  function renderOrganizationSwitcher() {
    const select = $("#organization-select");
    const organization = activeOrganization();
    select.innerHTML = state.organizations.map((item) =>
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`
    ).join("");
    if (organization) {
      select.value = organization.id;
      $("#active-org-initials").textContent = organization.name.trim().charAt(0).toUpperCase();
      $("#dashboard-org-name").textContent = organization.name;
      $("#workspace-label").textContent = organization.name;
    }
  }

  function renderOrganizationManager() {
    const organization = activeOrganization();
    const list = state.organizations.map((item) => `
      <article class="organization-card${item.id === state.activeOrganizationId ? " active" : ""}">
        <span class="organization-avatar" aria-hidden="true">${escapeHtml(item.name.trim().charAt(0).toUpperCase())}</span>
        <span class="organization-card-copy"><strong>${escapeHtml(item.name)}</strong><small>${item.gauges.length} ${item.gauges.length === 1 ? "instrument" : "instruments"}</small></span>
        ${item.id === state.activeOrganizationId
          ? `<span class="organization-current">CURRENT</span>`
          : `<button class="button button-outline button-small" type="button" data-organization-select="${escapeHtml(item.id)}">Switch</button>`}
        ${state.organizations.length > 1
          ? `<button class="organization-delete" type="button" data-organization-delete="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)} organization">Delete</button>`
          : ""}
      </article>
    `).join("");
    $("#modal-content").innerHTML = `
      <div class="organization-manager">
        <p>Each organization keeps its own instrument register and activity log in this browser.</p>
        <div class="organization-list">${list}</div>
        <form class="organization-create-form" id="create-organization-form" novalidate>
          <label for="new-organization-name">Create an organization</label>
          <div class="organization-create-row">
            <input id="new-organization-name" name="name" maxlength="80" required placeholder="e.g. Northside Laboratory">
            <button class="button button-primary" type="submit">Create</button>
          </div>
          <div class="modal-error hidden" role="alert"></div>
        </form>
        <p class="form-note">Organization workspaces are local to this browser. They are not login accounts and do not sync between people or devices.</p>
        <div class="modal-actions"><button type="button" class="button button-outline close-modal">Done</button></div>
      </div>
    `;
    $("#modal-title").textContent = "Organizations";
    $("#modal-eyebrow").textContent = organization ? "LOCAL WORKSPACES" : "ORGANIZATIONS";
  }

  function openOrganizationManager() {
    showModal("Organizations", "LOCAL WORKSPACES", "");
    renderOrganizationManager();
  }

  function switchOrganization(id) {
    const organization = state.organizations.find((item) => item.id === id);
    if (!organization || id === state.activeOrganizationId) return;
    const previousId = state.activeOrganizationId;
    state.activeOrganizationId = id;
    loadActiveOrganization();
    if (!persist()) {
      state.activeOrganizationId = previousId;
      loadActiveOrganization();
      renderOrganizationSwitcher();
      return;
    }
    renderOrganizationSwitcher();
    renderAll();
    if (!$("#modal-backdrop").classList.contains("hidden")) renderOrganizationManager();
    showToast(`Switched to ${organization.name}.`);
  }

  function createOrganization(name, form) {
    const organizationName = name.trim();
    if (!organizationName) {
      const error = $(".modal-error", form);
      error.textContent = "Enter an organization name.";
      error.classList.remove("hidden");
      return;
    }
    if (state.organizations.some((item) => item.name.trim().toLowerCase() === organizationName.toLowerCase())) {
      const error = $(".modal-error", form);
      error.textContent = "An organization with that name already exists.";
      error.classList.remove("hidden");
      return;
    }
    const previousId = state.activeOrganizationId;
    const organization = makeOrganization(organizationName);
    state.organizations.push(organization);
    state.activeOrganizationId = organization.id;
    loadActiveOrganization();
    if (!persist()) {
      state.organizations = state.organizations.filter((item) => item.id !== organization.id);
      state.activeOrganizationId = previousId;
      loadActiveOrganization();
      renderOrganizationSwitcher();
      return;
    }
    renderOrganizationSwitcher();
    renderAll();
    renderOrganizationManager();
    showToast(`${organizationName} organization created.`);
  }

  function deleteOrganization(id) {
    const organization = state.organizations.find((item) => item.id === id);
    if (!organization || state.organizations.length <= 1) return;
    const recordCount = organization.gauges.length;
    const confirmed = window.confirm(
      `Delete "${organization.name}" and its ${recordCount} instrument${recordCount === 1 ? "" : "s"} and activity history? This cannot be undone.`
    );
    if (!confirmed) return;

    const previousOrganizations = state.organizations;
    const previousActiveId = state.activeOrganizationId;
    state.organizations = state.organizations.filter((item) => item.id !== id);
    if (previousActiveId === id) state.activeOrganizationId = state.organizations[0].id;
    loadActiveOrganization();
    if (!persist()) {
      state.organizations = previousOrganizations;
      state.activeOrganizationId = previousActiveId;
      loadActiveOrganization();
      renderOrganizationSwitcher();
      return;
    }
    renderOrganizationSwitcher();
    renderAll();
    renderOrganizationManager();
    showToast(`${organization.name} organization deleted.`);
  }

  function downloadFile(filename, contents, type) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        // Use the browser-compatible fallback below when clipboard permission is denied.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard access was denied by the browser.");
  }

  function exportBackup() {
    const backup = {
      format: "gaugetrack-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      organization: activeOrganization().name,
      gauges: state.gauges,
      activities: state.activities
    };
    downloadFile(`gaugetrack-backup-${localDateString()}.json`, JSON.stringify(backup, null, 2), "application/json");
    showToast("Full equipment and activity backup downloaded.");
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const headings = ["Gauge ID", "Tool Name", "Serial Number", "Category", "Last Calibration Date", "Next Calibration Date", "Calibration Status", "Location", "Availability", "Borrower", "Department", "Expected Return"];
    const rows = state.gauges.map((gauge) => [
      gauge.id, gauge.name, gauge.serialNumber, gauge.category, gauge.lastCalibrationDate, gauge.nextCalibrationDate,
      statusFor(gauge).label, gauge.location, gauge.checkout ? "Checked out" : "Available",
      gauge.checkout?.borrower || "", gauge.checkout?.department || "", gauge.checkout?.expectedReturnDate || ""
    ]);
    const csv = [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadFile(`gaugetrack-equipment-${localDateString()}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
    showToast(`CSV report downloaded with ${state.gauges.length} equipment records.`);
  }

  function validateBackup(data) {
    if (!data || data.format !== "gaugetrack-backup" || data.version !== 1 ||
        !Array.isArray(data.gauges) || !Array.isArray(data.activities)) return null;
    const gauges = [];
    const ids = new Set();
    for (const raw of data.gauges) {
      const profile = validateProfile({ ...raw, format: "gaugetrack-passport", version: 1 });
      if (!profile || ids.has(profile.id.toLowerCase())) return null;
      ids.add(profile.id.toLowerCase());
      let checkout = null;
      if (raw.checkout != null) {
        const record = raw.checkout;
        if (typeof record.borrower !== "string" || !record.borrower.trim() ||
            typeof record.department !== "string" || !record.department.trim() ||
            !parseDate(record.expectedReturnDate) || Number.isNaN(new Date(record.checkedOutAt).getTime())) return null;
        checkout = {
          borrower: record.borrower.trim(),
          department: record.department.trim(),
          expectedReturnDate: record.expectedReturnDate,
          checkedOutAt: record.checkedOutAt
        };
      }
      gauges.push({ ...profile, checkout });
    }

    const activities = [];
    for (const raw of data.activities) {
      if (!raw || !["checkout", "return", "register", "update", "calibration"].includes(raw.type) ||
          typeof raw.gaugeId !== "string" || !raw.gaugeId.trim() ||
          typeof raw.name !== "string" || typeof raw.borrower !== "string" ||
          Number.isNaN(new Date(raw.date).getTime())) return null;
      activities.push({
        id: typeof raw.id === "string" ? raw.id : createId(),
        type: raw.type,
        gaugeId: raw.gaugeId,
        name: raw.name,
        borrower: raw.borrower,
        department: typeof raw.department === "string" ? raw.department : "",
        expectedReturnDate: parseDate(raw.expectedReturnDate) ? raw.expectedReturnDate : "",
        condition: typeof raw.condition === "string" ? raw.condition : "",
        notes: typeof raw.notes === "string" ? raw.notes : "",
        date: raw.date
      });
    }
    return { gauges, activities };
  }

  async function restoreBackup(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const restored = validateBackup(data);
      if (!restored) throw new Error("The file is not a valid GaugeTrack backup or contains invalid equipment records.");
      if (!window.confirm(`Restore ${restored.gauges.length} equipment records and ${restored.activities.length} activity records? This replaces the data in your account's active organization.`)) return;
      const previous = snapshotState();
      state.gauges = restored.gauges;
      state.activities = restored.activities;
      if (!persist()) {
        restoreState(previous);
        return;
      }
      renderAll();
      showToast(`Restored ${state.gauges.length} equipment records and ${state.activities.length} activity records.`);
    } catch (error) {
      showToast(`Backup restore failed: ${error.message}`, true);
    } finally {
      $("#backup-file").value = "";
    }
  }

  function snapshotState() {
    return {
      gauges: state.gauges.map((gauge) => ({ ...gauge, checkout: gauge.checkout ? { ...gauge.checkout } : null })),
      activities: state.activities.map((item) => ({ ...item }))
    };
  }

  function restoreState(snapshot) {
    state.gauges = snapshot.gauges;
    state.activities = snapshot.activities;
  }

  function showToast(message, isError = false) {
    const region = $("#toast-region");
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " error" : ""}`;
    toast.textContent = message;
    region.append(toast);
    window.setTimeout(() => toast.remove(), 3500);
  }

  function changeView(name) {
    if (!viewTitles[name]) return;
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}-view`));
    $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === name));
    $("#breadcrumb-current").textContent = viewTitles[name];
    if (name === "registry") renderRegistry();
    if (name === "activity") {
      renderBorrowings();
      renderActivity();
    }
    if (name !== "scanner" && state.scanner) stopScanner();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openQuickSearch() {
    renderQuickSearch("");
    $("#quick-search-backdrop").classList.remove("hidden");
    $("#quick-search-input").value = "";
    $("#quick-search-input").focus();
  }

  function closeQuickSearch() {
    $("#quick-search-backdrop").classList.add("hidden");
    $("#open-quick-search").focus();
  }

  function renderQuickSearch(query) {
    const root = $("#quick-search-results");
    const term = query.trim().toLowerCase();
    const actions = [
      { key: "scan", icon: "⌗", title: "Scan equipment", subtitle: "Open camera or scan a QR image", shortcut: "SCAN" },
      { key: "due", icon: "◷", title: "Calibration due", subtitle: "Find due-soon and overdue gauges", shortcut: "DUE" },
      { key: "borrowed", icon: "↩", title: "Check-ins due", subtitle: "View checked-out equipment", shortcut: "OUT" },
      { key: "activity", icon: "↔", title: "Activity log", subtitle: "Review registrations, calibration, and loans", shortcut: "LOG" }
    ];
    const actionMarkup = actions.filter((action) => !term || `${action.title} ${action.subtitle}`.toLowerCase().includes(term))
      .map((action) => `<button class="quick-result" data-quick="${action.key}"><span class="quick-result-icon">${action.icon}</span><span><strong>${action.title}</strong><small>${action.subtitle}</small></span><kbd>${action.shortcut}</kbd></button>`);
    const gaugeMarkup = state.gauges.filter((gauge) => [gauge.id, gauge.name, gauge.serialNumber, gauge.category, gauge.location, gauge.checkout?.borrower]
      .some((value) => String(value || "").toLowerCase().includes(term)))
      .slice(0, 8)
      .map((gauge) => `<button class="quick-result" data-quick="details" data-id="${escapeHtml(gauge.id)}"><span class="quick-result-icon gauge-result-icon">⌖</span><span><strong>${escapeHtml(gauge.name)}</strong><small>${escapeHtml(gauge.id)} · ${escapeHtml(gauge.serialNumber)} · ${statusFor(gauge).label}${gauge.checkout ? ` · With ${escapeHtml(gauge.checkout.borrower)}` : ""}</small></span><kbd>OPEN</kbd></button>`);
    root.innerHTML = `${actionMarkup.length ? `<div class="quick-results-label">${term ? "ACTIONS" : "QUICK ACTIONS"}</div>${actionMarkup.join("")}` : ""}${gaugeMarkup.length ? `<div class="quick-results-label">EQUIPMENT</div>${gaugeMarkup.join("")}` : ""}${!actionMarkup.length && !gaugeMarkup.length ? `<div class="quick-no-results">No matches. Try a gauge ID, serial number, borrower, or location.</div>` : ""}`;
    root.querySelector(".quick-result")?.classList.add("selected");
  }

  function runQuickAction(key, id = "") {
    if (key === "scan") {
      closeQuickSearch();
      return changeView("scanner");
    }
    if (key === "activity") {
      closeQuickSearch();
      return changeView("activity");
    }
    if (key === "due" || key === "borrowed") {
      closeQuickSearch();
      changeView("registry");
      $("#registry-search").value = "";
      $("#status-filter").value = key === "due" ? "action-needed" : "borrowed";
      renderRegistry();
      return;
    }
    if (key === "details" && id) {
      closeQuickSearch();
      const gauge = gaugeById(id);
      if (gauge) openDetails(gauge);
    }
  }

  function moveQuickSelection(direction) {
    const options = $$(".quick-result", $("#quick-search-results"));
    if (!options.length) return;
    const current = options.findIndex((option) => option.classList.contains("selected"));
    const next = (current + direction + options.length) % options.length;
    options.forEach((option, index) => option.classList.toggle("selected", index === next));
    options[next].scrollIntoView({ block: "nearest" });
  }

  function gaugeById(id) {
    return state.gauges.find((gauge) => gauge.id.toLowerCase() === String(id).trim().toLowerCase());
  }

  function statusMarkup(gauge) {
    const status = statusFor(gauge);
    return `<span class="status status-${status.key}">${status.label}</span>`;
  }

  const counterAnimations = new WeakMap();

  function animateCounter(element, target) {
    const previousFrame = counterAnimations.get(element);
    if (previousFrame) window.cancelAnimationFrame(previousFrame);

    const start = Number(element.textContent) || 0;
    if (start === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.textContent = target;
      return;
    }

    const startedAt = performance.now();
    const duration = 450;
    const update = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const easedProgress = 1 - (1 - progress) ** 3;
      element.textContent = Math.round(start + (target - start) * easedProgress);
      if (progress < 1) {
        counterAnimations.set(element, window.requestAnimationFrame(update));
      } else {
        counterAnimations.delete(element);
      }
    };
    counterAnimations.set(element, window.requestAnimationFrame(update));
  }

  function equipmentMarkup(gauge) {
    return `<div class="equipment-cell"><span class="equipment-icon">⌖</span><span><strong>${escapeHtml(gauge.name)}</strong><small>SN ${escapeHtml(gauge.serialNumber)}</small></span></div>`;
  }

  function renderDashboard() {
    const total = state.gauges.length;
    const overdue = state.gauges.filter((gauge) => statusFor(gauge).key === "overdue").length;
    const dueSoon = state.gauges.filter((gauge) => statusFor(gauge).key === "due-soon").length;
    const calibrated = state.gauges.filter((gauge) => statusFor(gauge).key === "calibrated").length;
    const borrowed = state.gauges.filter((gauge) => gauge.checkout).length;
    animateCounter($("#stat-total"), total);
    animateCounter($("#stat-calibrated"), calibrated);
    animateCounter($("#stat-due"), dueSoon + overdue);
    animateCounter($("#stat-borrowed"), borrowed);
    $("#overdue-caption").textContent = `${overdue} overdue`;
    $("#quick-due-count").textContent = `${dueSoon + overdue} need attention`;
    $("#quick-borrowed-count").textContent = `${borrowed} currently borrowed`;
    $("#chart-total").textContent = `${total} ${total === 1 ? "instrument" : "instruments"}`;
    $("#chart-calibrated").textContent = calibrated;
    $("#chart-due-soon").textContent = dueSoon;
    $("#chart-overdue").textContent = overdue;
    $("#calibration-chart").setAttribute(
      "aria-label",
      total ? `Calibration status: ${calibrated} calibrated, ${dueSoon} due soon, ${overdue} overdue` : "No equipment records in this workspace"
    );
    $("#calibration-chart").innerHTML = [
      ["calibrated", calibrated],
      ["due-soon", dueSoon],
      ["overdue", overdue]
    ].map(([status, count]) =>
      `<span class="calibration-segment ${status}" style="width:${total ? count / total * 100 : 0}%"></span>`
    ).join("");

    const ordered = [...state.gauges].sort((a, b) => {
      const rank = { overdue: 0, "due-soon": 1, calibrated: 2 };
      return rank[statusFor(a).key] - rank[statusFor(b).key] || (dayDifference(a.nextCalibrationDate) ?? 0) - (dayDifference(b.nextCalibrationDate) ?? 0);
    }).slice(0, 5);
    $("#dashboard-equipment-body").innerHTML = ordered.map((gauge) => {
      const days = dayDifference(gauge.nextCalibrationDate);
      const sub = days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? "Due today" : `In ${days} days`;
      return `<tr><td>${equipmentMarkup(gauge)}</td><td><span class="id-code">${escapeHtml(gauge.id)}</span></td><td><span class="date-value">${formatDate(gauge.nextCalibrationDate)}</span><span class="date-sub">${sub}</span></td><td>${statusMarkup(gauge)}</td><td><div class="row-actions"><button class="row-action" data-action="details" data-id="${escapeHtml(gauge.id)}" title="View details" aria-label="View ${escapeHtml(gauge.name)} details">↗</button></div></td></tr>`;
    }).join("");
    $("#dashboard-empty").classList.toggle("hidden", total > 0);
    $(".equipment-panel .table-wrap").classList.toggle("hidden", total === 0);
    renderRecentActivity();
    renderMockOptions();
  }

  function renderRegistry() {
    const search = ($("#registry-search").value || "").trim().toLowerCase();
    const filter = $("#status-filter").value;
    const gauges = state.gauges.filter((gauge) => {
      const matchesSearch = [gauge.id, gauge.name, gauge.serialNumber, gauge.category, gauge.location].some((value) => String(value).toLowerCase().includes(search));
      const matchesFilter = filter === "all" ||
        filter === "borrowed" && Boolean(gauge.checkout) ||
        filter === "action-needed" && statusFor(gauge).key !== "calibrated" ||
        ["calibrated", "due-soon", "overdue"].includes(filter) && statusFor(gauge).key === filter;
      return matchesSearch && matchesFilter;
    }).sort((a, b) => a.name.localeCompare(b.name));
    $("#registry-count").textContent = `${gauges.length} ${gauges.length === 1 ? "item" : "items"}`;
    $("#registry-body").innerHTML = gauges.map((gauge) => {
      const days = dayDifference(gauge.nextCalibrationDate);
      const sub = days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? "Due today" : `In ${days} days`;
      const checkoutAction = gauge.checkout
        ? `<button class="row-action" data-action="return" data-id="${escapeHtml(gauge.id)}" title="Check in" aria-label="Check in ${escapeHtml(gauge.name)}">↩</button>`
        : `<button class="row-action" data-action="checkout" data-id="${escapeHtml(gauge.id)}" title="Check out" aria-label="Check out ${escapeHtml(gauge.name)}">↗</button>`;
      return `<tr><td>${equipmentMarkup(gauge)}</td><td><span class="id-code">${escapeHtml(gauge.id)}</span>${gauge.checkout ? `<span class="date-sub">With ${escapeHtml(gauge.checkout.borrower)}</span>` : ""}</td><td>${escapeHtml(gauge.category)}</td><td><span class="date-value">${formatDate(gauge.nextCalibrationDate)}</span><span class="date-sub">${sub}</span></td><td>${escapeHtml(gauge.location)}</td><td>${statusMarkup(gauge)}</td><td><div class="row-actions"><button class="row-action" data-action="details" data-id="${escapeHtml(gauge.id)}" title="QR and details" aria-label="View ${escapeHtml(gauge.name)} QR and details">⌗</button><button class="row-action" data-action="calibrate" data-id="${escapeHtml(gauge.id)}" title="Record calibration" aria-label="Record calibration for ${escapeHtml(gauge.name)}">✓</button><button class="row-action" data-action="edit" data-id="${escapeHtml(gauge.id)}" title="Edit equipment" aria-label="Edit ${escapeHtml(gauge.name)}">✎</button>${checkoutAction}<button class="row-action danger-action" data-action="delete" data-id="${escapeHtml(gauge.id)}" title="Remove equipment" aria-label="Remove ${escapeHtml(gauge.name)}">×</button></div></td></tr>`;
    }).join("");
    $("#registry-empty").classList.toggle("hidden", gauges.length !== 0);
    $(".registry-panel .table-wrap").classList.toggle("hidden", gauges.length === 0);
  }

  function renderRecentActivity() {
    const items = state.activities.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    const labels = { checkout: "Checked out", return: "Returned", register: "Registered", update: "Profile updated", calibration: "Calibrated" };
    $("#dashboard-activity").innerHTML = items.length ? items.map((item) => `
      <div class="recent-item"><span class="recent-symbol ${item.type === "return" || item.type === "register" || item.type === "calibration" ? "return" : ""}">${item.type === "return" || item.type === "calibration" ? "✓" : item.type === "checkout" ? "↗" : "✎"}</span><div class="recent-description"><strong>${labels[item.type] || "Updated"}</strong> ${escapeHtml(item.name)}<span class="recent-date">${escapeHtml(item.borrower || "GaugeTrack")} · ${formatDateTime(item.date)}</span></div></div>
    `).join("") : `<div class="recent-item"><span class="recent-symbol">·</span><div class="recent-description">No recent equipment activity<span class="recent-date">Check out a gauge to get started</span></div></div>`;
  }

  function renderActivity() {
    const search = ($("#activity-search").value || "").trim().toLowerCase();
    const filter = $("#activity-filter").value;
    const events = state.activities.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).filter((item) => {
      return (filter === "all" || item.type === filter) &&
        [item.name, item.gaugeId, item.borrower, item.department, item.condition, item.notes].some((value) => String(value || "").toLowerCase().includes(search));
    });
    $("#activity-count").textContent = `${events.length} ${events.length === 1 ? "event" : "events"}`;
    $("#activity-body").innerHTML = events.map((item) => {
      const isReturn = item.type === "return";
      const labels = { checkout: "Checked out", return: "Returned", register: "Registered", update: "Profile updated", calibration: "Calibrated" };
      const who = isReturn && item.condition ? `${item.borrower} · ${item.condition}` :
        item.type === "checkout" ? `${item.borrower}${item.department ? ` · ${item.department}` : ""}` :
          `${item.borrower || "GaugeTrack"}${item.department ? ` · ${item.department}` : ""}${item.notes ? ` · ${item.notes}` : ""}`;
      const statusClass = item.type === "checkout" ? "status-due-soon" : "status-calibrated";
      return `<tr><td><span class="status ${statusClass}">${labels[item.type] || "Updated"}</span></td><td>${equipmentMarkup({ name: item.name, serialNumber: item.gaugeId })}</td><td>${escapeHtml(who)}</td><td>${formatDate(item.expectedReturnDate)}</td><td>${formatDateTime(item.date)}</td></tr>`;
    }).join("");
    $("#activity-empty").classList.toggle("hidden", events.length !== 0);
    $(".registry-panel .table-wrap", $("#activity-view")).classList.toggle("hidden", events.length === 0);
  }

  function renderBorrowings() {
    const borrowed = state.gauges
      .filter((gauge) => gauge.checkout)
      .sort((a, b) => new Date(b.checkout.checkedOutAt) - new Date(a.checkout.checkedOutAt));
    $("#borrowing-count").textContent = `${borrowed.length} ${borrowed.length === 1 ? "item" : "items"}`;
    $("#borrowing-body").innerHTML = borrowed.map((gauge) => {
      const checkout = gauge.checkout;
      const overdue = parseDate(checkout.expectedReturnDate) < parseDate(localDateString());
      return `<tr><td>${equipmentMarkup(gauge)}<span class="date-sub">${escapeHtml(gauge.id)}</span></td><td><strong class="borrower-name">${escapeHtml(checkout.borrower)}</strong></td><td>${escapeHtml(checkout.department)}</td><td><span class="date-value">${formatDateTime(checkout.checkedOutAt)}</span></td><td><span class="date-value">${formatDate(checkout.expectedReturnDate)}</span></td><td><span class="status ${overdue ? "status-overdue" : "status-due-soon"}">${overdue ? "Overdue" : "Borrowed"}</span></td><td><button class="button button-outline button-small borrowing-return" data-action="return" data-id="${escapeHtml(gauge.id)}">Check in</button></td></tr>`;
    }).join("");
    $("#borrowing-empty").classList.toggle("hidden", borrowed.length !== 0);
    $(".borrowing-panel .table-wrap").classList.toggle("hidden", borrowed.length === 0);
  }

  function renderMockOptions() {
    const select = $("#mock-qr-select");
    const previous = select.value;
    select.innerHTML = state.gauges.length
      ? `<option value="">Select a sample gauge...</option>${state.gauges.map((gauge) => `<option value="${escapeHtml(gauge.id)}">${escapeHtml(gauge.id)} · ${escapeHtml(gauge.name)} · ${statusFor(gauge).label}</option>`).join("")}`
      : `<option value="">Load sample data to get started</option>`;
    if (state.gauges.some((gauge) => gauge.id === previous)) select.value = previous;
  }

  function renderAll() {
    renderDashboard();
    renderRegistry();
    renderBorrowings();
    renderActivity();
  }

  function qrPayload(gauge) {
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.set("passport", encodeProfile(gauge));
    return url.href;
  }

  function encodeProfile(gauge) {
    const bytes = new TextEncoder().encode(JSON.stringify(passportProfile(gauge)));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function makeQr(target, gauge, size = 130) {
    target.replaceChildren();
    if (!window.QRCode) {
      target.textContent = "QR library did not load. Check your internet connection and reload.";
      target.classList.add("qr-error");
      return false;
    }
    target.classList.remove("qr-error");
    const qrText = hasPublicAppUrl() ? qrPayload(gauge) : JSON.stringify(passportProfile(gauge));
    new window.QRCode(target, { text: qrText, width: size, height: size, correctLevel: window.QRCode.CorrectLevel.M });
    return true;
  }

  function passportProfile(gauge) {
    return {
      format: "gaugetrack-passport",
      version: 1,
      id: gauge.id,
      name: gauge.name,
      organizationName: gauge.organizationName || activeOrganization()?.name || "",
      serialNumber: gauge.serialNumber,
      category: gauge.category,
      lastCalibrationDate: gauge.lastCalibrationDate,
      nextCalibrationDate: gauge.nextCalibrationDate,
      location: gauge.location
    };
  }

  function showModal(title, eyebrow, content) {
    $("#modal-title").textContent = title;
    $("#modal-eyebrow").textContent = eyebrow;
    $("#modal-content").innerHTML = content;
    $("#modal-backdrop").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    const firstField = $("#modal-content input, #modal-content select");
    if (firstField) firstField.focus();
  }

  function closeModal() {
    $("#modal-backdrop").classList.add("hidden");
    document.body.style.overflow = "";
  }

  function openNewEquipmentForm() {
    const today = localDateString();
    const nextYear = localDateString(new Date(Date.now() + 365 * 86400000));
    let id;
    do {
      id = `G-${Math.floor(100000 + Math.random() * 900000)}`;
    } while (state.gauges.some((gauge) => gauge.id.toLowerCase() === id.toLowerCase()));
    showModal("Add device", "REGISTER EQUIPMENT", `
      <form class="modal-form" id="add-equipment-form" novalidate>
        <div class="form-grid">
          <div class="form-field"><label for="new-gauge-id">Device ID *</label><input id="new-gauge-id" name="id" required maxlength="40" value="${escapeHtml(id)}"></div>
          <div class="form-field"><label for="new-gauge-name">Device name *</label><input id="new-gauge-name" name="name" required maxlength="80" placeholder="e.g. Digital micrometer"></div>
          <div class="form-field"><label for="new-serial-number">Serial number *</label><input id="new-serial-number" name="serialNumber" required maxlength="60" placeholder="e.g. DM-88421"></div>
          <div class="form-field"><label for="new-gauge-category">Category *</label><input id="new-gauge-category" name="category" required maxlength="50" placeholder="e.g. Dimensional"></div>
          <div class="form-field"><label for="new-last-calibration">Last calibration *</label><input id="new-last-calibration" name="lastCalibrationDate" type="date" required max="${today}" value="${today}"></div>
          <div class="form-field"><label for="new-next-calibration">Next calibration *</label><input id="new-next-calibration" name="nextCalibrationDate" type="date" required min="${today}" value="${nextYear}"></div>
          <div class="form-field full"><label for="new-gauge-location">Location *</label><input id="new-gauge-location" name="location" required maxlength="80" placeholder="e.g. Quality lab"></div>
        </div>
        <p class="form-note">After saving, a QR passport will be created for this device. You can edit the device ID before saving.</p>
        <div class="modal-error hidden" role="alert"></div>
        <div class="modal-actions"><button type="button" class="button button-outline close-modal">Cancel</button><button type="submit" class="button button-primary">Add device &amp; create QR</button></div>
      </form>
    `);
  }

  function handleNewEquipmentSubmit(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const id = data.id.trim();
    const name = data.name.trim();
    const serialNumber = data.serialNumber.trim();
    const category = data.category.trim();
    const location = data.location.trim();
    const lastDate = parseDate(data.lastCalibrationDate);
    const nextDate = parseDate(data.nextCalibrationDate);
    if (!id || !name || !serialNumber || !category || !location || !lastDate || !nextDate) {
      return setFormError(form, "Complete all fields with valid dates before saving.");
    }
    if (state.gauges.some((gauge) => gauge.id.toLowerCase() === id.toLowerCase())) {
      return setFormError(form, `Device ID "${id}" is already registered.`);
    }
    if (lastDate > parseDate(localDateString())) return setFormError(form, "The last calibration date cannot be in the future.");
    if (nextDate < lastDate) return setFormError(form, "The next calibration date cannot be earlier than the last calibration date.");

    const previous = snapshotState();
    const gauge = {
      id,
      name,
      serialNumber,
      category,
      lastCalibrationDate: data.lastCalibrationDate,
      nextCalibrationDate: data.nextCalibrationDate,
      location,
      checkout: null
    };
    state.gauges.push(gauge);
    state.activities.push({
      id: createId(), type: "register", gaugeId: gauge.id, name: gauge.name,
      borrower: activeOrganization().name, notes: "Device added manually", date: new Date().toISOString()
    });
    if (!persist()) {
      restoreState(previous);
      return;
    }
    renderAll();
    const qrReady = openDetails(gauge);
    showToast(
      qrReady ? `${gauge.name} added. Its QR passport is ready.` : `${gauge.name} was added, but its QR could not be generated.`,
      !qrReady
    );
  }

  function openCheckoutForm(gauge) {
    const today = localDateString();
    const suggestedReturn = localDateString(new Date(Date.now() + 7 * 86400000));
    showModal("Check out equipment", "BORROW TOOL", `
      <form class="modal-form" id="checkout-form" data-id="${escapeHtml(gauge.id)}" novalidate>
        <div class="detail-item"><small>Equipment</small><strong>${escapeHtml(gauge.name)} · ${escapeHtml(gauge.id)}</strong></div>
        <div class="form-grid" style="margin-top:15px">
          <div class="form-field"><label for="borrower">Borrower name *</label><input id="borrower" name="borrower" required maxlength="80" placeholder="e.g. Alex Morgan"></div>
          <div class="form-field"><label for="department">Department *</label><input id="department" name="department" required maxlength="60" placeholder="e.g. Production"></div>
          <div class="form-field full"><label for="expected-return">Expected return date *</label><input id="expected-return" name="expectedReturnDate" type="date" min="${today}" value="${suggestedReturn}" required></div>
        </div>
        <div class="modal-error hidden" role="alert"></div>
        <div class="modal-actions"><button type="button" class="button button-outline close-modal">Cancel</button><button type="submit" class="button button-primary">Confirm check-out</button></div>
      </form>
    `);
  }

  function openEditForm(gauge) {
    showModal("Edit equipment", "UPDATE ASSET", `
      <form class="modal-form" id="edit-gauge-form" data-id="${escapeHtml(gauge.id)}" novalidate>
        <div class="form-grid">
          <div class="form-field"><label for="edit-gauge-id">Gauge ID *</label><input id="edit-gauge-id" name="id" required maxlength="40" value="${escapeHtml(gauge.id)}"></div>
          <div class="form-field"><label for="edit-gauge-name">Tool name *</label><input id="edit-gauge-name" name="name" required maxlength="80" value="${escapeHtml(gauge.name)}"></div>
          <div class="form-field"><label for="edit-serial-number">Serial number *</label><input id="edit-serial-number" name="serialNumber" required maxlength="60" value="${escapeHtml(gauge.serialNumber)}"></div>
          <div class="form-field"><label for="edit-gauge-category">Category *</label><input id="edit-gauge-category" name="category" required maxlength="50" value="${escapeHtml(gauge.category)}"></div>
          <div class="form-field"><label for="edit-last-calibration">Last calibration *</label><input id="edit-last-calibration" name="lastCalibrationDate" type="date" required max="${localDateString()}" value="${escapeHtml(gauge.lastCalibrationDate)}"></div>
          <div class="form-field"><label for="edit-next-calibration">Next calibration *</label><input id="edit-next-calibration" name="nextCalibrationDate" type="date" required value="${escapeHtml(gauge.nextCalibrationDate)}"></div>
          <div class="form-field full"><label for="edit-gauge-location">Location *</label><input id="edit-gauge-location" name="location" required maxlength="80" value="${escapeHtml(gauge.location)}"></div>
        </div>
        ${gauge.checkout ? `<p class="form-note">Currently checked out to ${escapeHtml(gauge.checkout.borrower)}. Editing asset details will not change the checkout record.</p>` : ""}
        <div class="modal-error hidden" role="alert"></div>
        <div class="modal-actions"><button type="button" class="button button-outline close-modal">Cancel</button><button type="submit" class="button button-primary">Save changes</button></div>
      </form>
    `);
  }

  function handleEditSubmit(form) {
    const gauge = gaugeById(form.dataset.id);
    if (!gauge) return setFormError(form, "This equipment could not be found. Close this dialog and refresh the registry.");
    const data = Object.fromEntries(new FormData(form).entries());
    const id = data.id.trim();
    const lastDate = parseDate(data.lastCalibrationDate);
    const nextDate = parseDate(data.nextCalibrationDate);
    if (!id || !data.name.trim() || !data.serialNumber.trim() || !data.category.trim() || !data.location.trim() || !lastDate || !nextDate) {
      return setFormError(form, "Complete all fields with valid dates before saving.");
    }
    if (id !== gauge.id && gaugeById(id)) return setFormError(form, `Gauge ID "${id}" is already registered.`);
    if (lastDate > parseDate(localDateString())) return setFormError(form, "The last calibration date cannot be in the future.");
    if (nextDate < lastDate) return setFormError(form, "The next calibration date cannot be earlier than the last calibration date.");

    const previous = snapshotState();
    Object.assign(gauge, {
      id,
      name: data.name.trim(),
      serialNumber: data.serialNumber.trim(),
      category: data.category.trim(),
      lastCalibrationDate: data.lastCalibrationDate,
      nextCalibrationDate: data.nextCalibrationDate,
      location: data.location.trim()
    });
    state.activities.push({
      id: createId(), type: "update", gaugeId: gauge.id, name: gauge.name,
      borrower: activeOrganization().name, notes: "Equipment profile edited", date: new Date().toISOString()
    });
    if (!persist()) {
      restoreState(previous);
      return;
    }
    closeModal();
    renderAll();
    showToast(`${gauge.name} details updated.`);
  }

  function deleteGauge(gauge) {
    if (gauge.checkout) {
      showToast("Check in this equipment before removing it from the register.", true);
      return;
    }
    if (!window.confirm(`Remove ${gauge.name} (${gauge.id}) from the equipment register? Existing activity history will be kept.`)) return;
    const previous = snapshotState();
    state.gauges = state.gauges.filter((item) => item.id !== gauge.id);
    if (!persist()) {
      restoreState(previous);
      return;
    }
    renderAll();
    showToast(`${gauge.name} removed. Its activity history was kept.`);
  }

  function openReturnForm(gauge) {
    showModal("Check in equipment", "RETURN TOOL", `
      <form class="modal-form" id="return-form" data-id="${escapeHtml(gauge.id)}" novalidate>
        <div class="detail-item"><small>Checked out to</small><strong>${escapeHtml(gauge.checkout.borrower)} · ${escapeHtml(gauge.name)}</strong></div>
        <div class="form-field" style="margin-top:15px"><label for="return-condition">Condition on return *</label><select id="return-condition" name="condition" required><option value="">Select condition...</option><option>Good</option><option>Needs inspection</option><option>Damaged</option></select></div>
        <div class="form-field" style="margin-top:13px"><label for="return-notes">Notes (optional)</label><textarea id="return-notes" name="notes" maxlength="300" placeholder="Add an inspection note if needed"></textarea></div>
        <div class="modal-error hidden" role="alert"></div>
        <div class="modal-actions"><button type="button" class="button button-outline close-modal">Cancel</button><button type="submit" class="button button-primary">Confirm return</button></div>
      </form>
    `);
  }

  function openCalibrationForm(gauge) {
    showModal("Record calibration", "CALIBRATION EVENT", `
      <form class="modal-form" id="calibration-form" data-id="${escapeHtml(gauge.id)}" novalidate>
        <div class="detail-item"><small>Equipment</small><strong>${escapeHtml(gauge.name)} · ${escapeHtml(gauge.id)}</strong></div>
        <div class="form-grid" style="margin-top:15px">
          <div class="form-field"><label for="calibrated-on">Calibration date *</label><input id="calibrated-on" name="calibratedOn" type="date" required max="${localDateString()}" value="${localDateString()}"></div>
          <div class="form-field"><label for="next-calibration-date">Next due date *</label><input id="next-calibration-date" name="nextCalibrationDate" type="date" required min="${localDateString()}"></div>
          <div class="form-field"><label for="calibration-provider">Calibration provider</label><input id="calibration-provider" name="provider" maxlength="80" placeholder="Lab or technician"></div>
          <div class="form-field"><label for="calibration-certificate">Certificate / reference</label><input id="calibration-certificate" name="certificate" maxlength="80" placeholder="Certificate number"></div>
        </div>
        <div class="modal-error hidden" role="alert"></div>
        <div class="modal-actions"><button type="button" class="button button-outline close-modal">Cancel</button><button type="submit" class="button button-primary">Save calibration record</button></div>
      </form>
    `);
  }

  function handleCalibrationSubmit(form) {
    const gauge = gaugeById(form.dataset.id);
    if (!gauge) return setFormError(form, "This equipment could not be found. Close this dialog and refresh the registry.");
    const data = Object.fromEntries(new FormData(form).entries());
    const calibrationDate = parseDate(data.calibratedOn);
    const nextDate = parseDate(data.nextCalibrationDate);
    if (!calibrationDate || !nextDate) return setFormError(form, "Enter valid calibration and next-due dates.");
    if (calibrationDate > parseDate(localDateString())) return setFormError(form, "Calibration date cannot be in the future.");
    if (nextDate <= calibrationDate) return setFormError(form, "The next due date must be after the calibration date.");

    const previous = snapshotState();
    gauge.lastCalibrationDate = data.calibratedOn;
    gauge.nextCalibrationDate = data.nextCalibrationDate;
    state.activities.push({
      id: createId(),
      type: "calibration",
      gaugeId: gauge.id,
      name: gauge.name,
      borrower: activeOrganization().name,
      department: data.provider.trim(),
      expectedReturnDate: data.nextCalibrationDate,
      condition: "Passed",
      notes: data.certificate.trim() ? `Certificate ${data.certificate.trim()}` : "Calibration recorded",
      date: new Date().toISOString()
    });
    if (!persist()) {
      restoreState(previous);
      return;
    }
    closeModal();
    renderAll();
    showToast(`${gauge.name} calibration recorded. Next due ${formatDate(gauge.nextCalibrationDate)}.`);
  }

  function openDetails(gauge) {
    const linkDisabled = hasPublicAppUrl() ? "" : `disabled title="Publish GaugeTrack to HTTPS to enable product links"`;
    showModal("Equipment details", "QR LABEL", `
      <div class="gauge-detail">
        <div class="detail-qr" id="detail-qr" aria-label="Equipment QR code"></div>
        <div class="qr-link-status ${window.location.protocol === "file:" ? "warning" : "ready"}">
          ${!hasPublicAppUrl()
            ? "<strong>Device profile QR</strong><span>This QR contains the equipment details. Open GaugeTrack on another device and scan it to add the device there. Publish the app to HTTPS if you want the QR to open a website link directly.</span>"
            : "<strong>Ready for other devices</strong><span>This QR opens the product passport on this GaugeTrack website. Anyone scanning it can see these equipment details.</span>"}
        </div>
        <div class="detail-grid">
          <div class="detail-item"><small>Organization</small><strong>${escapeHtml(gauge.organizationName || activeOrganization()?.name || "Not specified")}</strong></div>
          <div class="detail-item"><small>Gauge ID</small><strong>${escapeHtml(gauge.id)}</strong></div>
          <div class="detail-item"><small>Calibration</small><strong>${statusFor(gauge).label} · ${formatDate(gauge.nextCalibrationDate)}</strong></div>
          <div class="detail-item"><small>Tool / serial</small><strong>${escapeHtml(gauge.name)} · ${escapeHtml(gauge.serialNumber)}</strong></div>
          <div class="detail-item"><small>Category / location</small><strong>${escapeHtml(gauge.category)} · ${escapeHtml(gauge.location)}</strong></div>
        </div>
        <p class="form-note">The QR contains a snapshot of this profile. Scan it with GaugeTrack to add the device to another browser. Recreate the QR after changing device details.</p>
        <div class="modal-actions">
          ${gauge.checkout ? `<button class="button button-outline" data-action="return" data-id="${escapeHtml(gauge.id)}">Check in</button>` : `<button class="button button-outline" data-action="checkout" data-id="${escapeHtml(gauge.id)}">Check out</button>`}
          <button class="button button-outline" data-action="copy-product-link" data-id="${escapeHtml(gauge.id)}" ${linkDisabled}>Copy product link</button>
          <button class="button button-outline" data-action="download-qr" data-id="${escapeHtml(gauge.id)}">Download QR</button>
          <button class="button button-outline" data-action="print" data-id="${escapeHtml(gauge.id)}">Print QR label</button>
          <button class="button button-primary close-modal">Done</button>
        </div>
      </div>
    `);
    return makeQr($("#detail-qr"), gauge, 320);
  }

  function setFormError(form, message) {
    const error = $(".modal-error", form);
    error.textContent = message;
    error.classList.remove("hidden");
  }

  function handleCheckoutSubmit(form) {
    const gauge = gaugeById(form.dataset.id);
    if (!gauge) return setFormError(form, "This equipment could not be found. Close this dialog and refresh the registry.");
    if (gauge.checkout) return setFormError(form, "This equipment has already been checked out.");
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.borrower.trim() || !data.department.trim() || !parseDate(data.expectedReturnDate)) {
      return setFormError(form, "Enter a borrower, department, and a valid expected return date.");
    }
    if (parseDate(data.expectedReturnDate) < parseDate(localDateString())) {
      return setFormError(form, "Expected return date cannot be in the past.");
    }
    const previous = snapshotState();
    const checkedOutAt = new Date().toISOString();
    gauge.checkout = { borrower: data.borrower.trim(), department: data.department.trim(), expectedReturnDate: data.expectedReturnDate, checkedOutAt };
    state.activities.push({
      id: createId(), type: "checkout", gaugeId: gauge.id, name: gauge.name, borrower: gauge.checkout.borrower,
      department: gauge.checkout.department, expectedReturnDate: gauge.checkout.expectedReturnDate, date: checkedOutAt
    });
    if (!persist()) {
      restoreState(previous);
      return;
    }
    closeModal();
    renderAll();
    showToast(`${gauge.name} checked out to ${gauge.checkout.borrower}.`);
  }

  function handleReturnSubmit(form) {
    const gauge = gaugeById(form.dataset.id);
    if (!gauge || !gauge.checkout) return setFormError(form, "This equipment is not currently checked out.");
    const data = Object.fromEntries(new FormData(form).entries());
    if (!["Good", "Needs inspection", "Damaged"].includes(data.condition)) {
      return setFormError(form, "Choose the equipment condition before confirming the return.");
    }
    const previous = snapshotState();
    const returnedAt = new Date().toISOString();
    state.activities.push({
      id: createId(), type: "return", gaugeId: gauge.id, name: gauge.name, borrower: gauge.checkout.borrower,
      department: gauge.checkout.department, expectedReturnDate: gauge.checkout.expectedReturnDate,
      condition: data.condition, notes: data.notes.trim(), date: returnedAt
    });
    gauge.checkout = null;
    if (!persist()) {
      restoreState(previous);
      return;
    }
    closeModal();
    renderAll();
    showToast(`${gauge.name} returned in ${data.condition.toLowerCase()} condition.`);
  }

  function createId() {
    return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function loadSamples() {
    if (!window.GaugeSampleData || typeof window.GaugeSampleData.make !== "function") {
      showToast("Sample data is unavailable. Reload the page and try again.", true);
      return;
    }
    const previous = snapshotState();
    const samples = window.GaugeSampleData.make();
    for (const sample of samples) {
      if (!gaugeById(sample.id)) state.gauges.push(sample);
    }
    const borrowedSample = samples.find((gauge) => gauge.checkout);
    const borrowedGauge = borrowedSample && gaugeById(borrowedSample.id);
    if (borrowedGauge?.checkout && !state.activities.some((item) => item.type === "checkout" && item.gaugeId === borrowedSample.id)) {
      state.activities.push({
        id: createId(), type: "checkout", gaugeId: borrowedSample.id, name: borrowedSample.name,
        borrower: borrowedGauge.checkout.borrower, department: borrowedGauge.checkout.department,
        expectedReturnDate: borrowedGauge.checkout.expectedReturnDate, date: borrowedGauge.checkout.checkedOutAt
      });
    }
    if (!persist()) {
      restoreState(previous);
      return;
    }
    renderAll();
    showToast("Sample gauges are ready. Explore the different calibration statuses.");
  }

  function printLabel(gauge) {
    const qr = $("#product-view.active #product-passport-qr") || $("#detail-qr");
    const canvas = qr && $("canvas", qr);
    const image = qr && $("img", qr);
    const dataUrl = canvas ? canvas.toDataURL("image/png") : image ? image.src : "";
    if (!dataUrl) {
      showToast("The QR code is not ready to print. Check the QR library connection.", true);
      return;
    }
    const printWindow = window.open("", "_blank", "width=500,height=550");
    if (!printWindow) {
      showToast("Allow pop-ups to open the printable QR label.", true);
      return;
    }
    printWindow.document.write(`<!doctype html><html><head><title>QR Label - ${escapeHtml(gauge.id)}</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:30px;color:#172b3b}.label{border:1px dashed #9aa8ae;display:inline-block;padding:20px;min-width:220px}img{width:160px;height:160px}h1{font-size:18px;margin:9px 0 4px}p{font-size:12px;margin:4px}</style></head><body><main class="label"><img src="${dataUrl}" alt="QR code for ${escapeHtml(gauge.id)}"><h1>${escapeHtml(gauge.name)}</h1><p>${escapeHtml(gauge.id)} · SN ${escapeHtml(gauge.serialNumber)}</p><p>Next calibration: ${formatDate(gauge.nextCalibrationDate)}</p></main><script>window.onload=()=>window.print()<\/script></body></html>`);
    printWindow.document.close();
  }

  function currentProductLink(gauge) {
    return qrPayload(gauge);
  }

  async function copyProductLink(gauge) {
    if (!hasPublicAppUrl()) {
      showToast("Publish GaugeTrack to a public HTTPS website first. A local QR will not open on other devices.", true);
      return;
    }
    try {
      await copyTextToClipboard(currentProductLink(gauge));
      showToast("Product passport link copied. Anyone with the link can see this profile.");
    } catch (error) {
      showToast(`Could not copy the product link: ${error.message}`, true);
    }
  }

  function downloadQr(gauge) {
    const container = $("#product-view.active #product-passport-qr") || $("#detail-qr");
    const canvas = container && $("canvas", container);
    const image = container && $("img", container);
    const dataUrl = canvas ? canvas.toDataURL("image/png") : image ? image.src : "";
    if (!dataUrl) {
      showToast("The QR image is not ready yet. Check the QR library connection.", true);
      return;
    }
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${gauge.id}-product-passport.png`;
    link.click();
  }

  function openProductPassport(gauge, message) {
    changeView("product");
    renderProductPassport(gauge, message);
  }

  function decodeProfile(rawText) {
    let raw = String(rawText || "").trim();
    try {
      if (raw.startsWith("GT|")) raw = raw.slice(3);
      if (raw.startsWith("{")) return JSON.parse(raw);
      const url = new URL(raw, window.location.href);
      const encodedQuery = url.searchParams.get("passport") || url.searchParams.get("product");
      if (encodedQuery) {
        const base64 = encodedQuery.replace(/-/g, "+").replace(/_/g, "/");
        const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes));
      }
      const fragment = new URLSearchParams(url.hash.slice(1));
      const encoded = fragment.get("product") || fragment.get("import");
      if (!encoded) return null;
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  function validateProfile(profile) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
    if (profile.format !== "gaugetrack-passport" || profile.version !== 1) return null;
    const required = ["id", "name", "serialNumber", "category", "location"];
    if (required.some((key) => typeof profile[key] !== "string" || !profile[key].trim())) return null;
    if (profile.organizationName !== undefined &&
        (typeof profile.organizationName !== "string" || profile.organizationName.length > 80)) return null;
    if (profile.id.length > 40 || profile.name.length > 80 || profile.serialNumber.length > 60 ||
        profile.category.length > 50 || profile.location.length > 80) return null;
    const lastDate = parseDate(profile.lastCalibrationDate);
    const nextDate = parseDate(profile.nextCalibrationDate);
    if (!lastDate || !nextDate || lastDate > parseDate(localDateString()) || nextDate < lastDate) return null;
    return {
      id: profile.id.trim(),
      name: profile.name.trim(),
      organizationName: typeof profile.organizationName === "string" ? profile.organizationName.trim() : "",
      serialNumber: profile.serialNumber.trim(),
      category: profile.category.trim(),
      lastCalibrationDate: profile.lastCalibrationDate,
      nextCalibrationDate: profile.nextCalibrationDate,
      location: profile.location.trim()
    };
  }

  function scannedId(rawText) {
    const text = String(rawText || "").trim();
    try {
      const url = new URL(text, window.location.href);
      const fragment = new URLSearchParams(url.hash.slice(1));
      if (fragment.has("gauge")) return fragment.get("gauge");
      if (url.searchParams.has("gauge")) return url.searchParams.get("gauge");
    } catch {
      const hashMatch = text.match(/(?:^#|[#&])gauge=([^&]+)/);
      if (hashMatch) return decodeURIComponent(hashMatch[1]);
    }
    if (/^[A-Za-z0-9._-]{1,40}$/.test(text)) return text;
    return null;
  }

  function saveScannedProfile(profile) {
    const existing = gaugeById(profile.id);
    const changed = !existing || ["name", "organizationName", "serialNumber", "category", "lastCalibrationDate", "nextCalibrationDate", "location"]
      .some((key) => existing[key] !== profile[key]);
    if (!changed) {
      return { gauge: existing, message: "Equipment passport opened. No profile changes were needed." };
    }
    const previous = snapshotState();
    if (existing) Object.assign(existing, profile);
    else state.gauges.push({ ...profile, checkout: null });
    state.activities.push({
      id: createId(),
      type: existing ? "update" : "register",
      gaugeId: profile.id,
      name: profile.name,
      borrower: "QR passport",
      notes: existing ? "Profile refreshed from QR" : "Registered from QR passport",
      date: new Date().toISOString()
    });
    if (!persist()) {
      restoreState(previous);
      return { gauge: null, message: "The QR profile was read, but the equipment could not be saved in this browser." };
    }
    renderAll();
    return {
      gauge: gaugeById(profile.id),
      message: existing ? "Equipment details updated from its QR passport." : "Equipment registered from its QR passport."
    };
  }

  function renderProductPassport(gauge, message) {
    const hostingWarning = !hasPublicAppUrl()
      ? `<div class="passport-hosting-warning"><strong>Profile QR is available in this preview</strong><span>This QR carries the device details and can be scanned from another GaugeTrack browser. Publish the app to HTTPS if you want the QR to open this product page directly.</span></div>`
      : "";
    const linkDisabled = hasPublicAppUrl() ? "" : `disabled title="Publish GaugeTrack to HTTPS to enable product links"`;
    $("#product-passport-content").innerHTML = `
      <div class="passport-topbar">
        <a class="passport-brand" href="#" data-view="dashboard"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>Gauge<span>Track</span></a>
        <span class="passport-secure"><i></i> EQUIPMENT PASSPORT</span>
      </div>
      <section class="passport-hero">
        <div class="passport-heading">
          <div class="eyebrow">PRODUCT DETAIL <span class="eyebrow-line"></span></div>
          <h1>${escapeHtml(gauge.name)}</h1>
          <p>Equipment passport · <span class="id-code">${escapeHtml(gauge.id)}</span></p>
          ${statusMarkup(gauge)}
          <span class="passport-availability">Borrowing status and checkout history are not shared by this product QR.</span>
        </div>
        <div class="passport-qr-wrap">
          <div class="passport-qr" id="product-passport-qr" aria-label="QR code for this product"></div>
          <span>SCAN TO OPEN THIS PASSPORT</span>
        </div>
      </section>
      ${hostingWarning}
      <section class="passport-card">
        <div class="passport-card-heading"><div><div class="eyebrow">EQUIPMENT PROFILE</div><h2>Product details</h2></div><span class="passport-update">${escapeHtml(message)}</span></div>
        <div class="passport-details">
          <div><small>ORGANIZATION</small><strong>${escapeHtml(gauge.organizationName || activeOrganization()?.name || "Not specified")}</strong></div>
          <div><small>GAUGE ID</small><strong>${escapeHtml(gauge.id)}</strong></div>
          <div><small>SERIAL NUMBER</small><strong>${escapeHtml(gauge.serialNumber)}</strong></div>
          <div><small>CATEGORY</small><strong>${escapeHtml(gauge.category)}</strong></div>
          <div><small>LOCATION</small><strong>${escapeHtml(gauge.location)}</strong></div>
          <div><small>LAST CALIBRATION</small><strong>${formatDate(gauge.lastCalibrationDate)}</strong></div>
          <div><small>NEXT CALIBRATION</small><strong>${formatDate(gauge.nextCalibrationDate)}</strong></div>
        </div>
        <div class="passport-notice"><span>ⓘ</span><p>This QR contains a snapshot of the equipment profile. Scanning saves the profile to this device. Borrowing and return history remain in each browser and are not shared.</p></div>
        <div class="passport-actions">
          <button class="button button-primary" data-action="product-registry" data-id="${escapeHtml(gauge.id)}">Open in my GaugeTrack</button>
          <button class="button button-outline" data-action="copy-product-link" data-id="${escapeHtml(gauge.id)}" ${linkDisabled}>Copy product link</button>
          <button class="button button-outline" data-action="download-qr" data-id="${escapeHtml(gauge.id)}">Download QR image</button>
        </div>
      </section>
      <footer class="passport-footer">GAUGETRACK · CALIBRATION &amp; TOOL CONTROL <span>Scan the QR code to reopen this product passport.</span></footer>
    `;
    makeQr($("#product-passport-qr"), gauge, 320);
  }

  function handleScannedQr(rawText) {
    const decoded = decodeProfile(rawText);
    if (decoded) {
      const profile = validateProfile(decoded);
      if (!profile) {
        return { gauge: null, message: "This QR contains equipment data, but its profile is incomplete or invalid." };
      }
      return { ...saveScannedProfile(profile), isProfile: true };
    }

    const id = scannedId(rawText);
    const gauge = id ? gaugeById(id) : null;
    return {
      gauge,
      message: gauge
        ? "Gauge found in this browser's equipment registry."
        : "This QR has no full equipment profile. A gauge ID alone cannot provide equipment details."
    };
  }

  function showLookupResult(gauge, message = "") {
    const result = $("#lookup-result");
    result.classList.remove("hidden");
    if (!gauge) {
      result.innerHTML = `<h3>Could not register equipment</h3><p>${escapeHtml(message || "No complete equipment profile was found in that QR code.")}</p>`;
      return;
    }
    result.innerHTML = `<h3>${escapeHtml(gauge.name)} <span class="id-code">${escapeHtml(gauge.id)}</span></h3><p>${escapeHtml(message || "Equipment found.")}</p><p><strong>Organization:</strong> ${escapeHtml(gauge.organizationName || activeOrganization()?.name || "Not specified (legacy QR)")}</p><p>Serial: ${escapeHtml(gauge.serialNumber)} · ${escapeHtml(gauge.category)}</p><p>Location: ${escapeHtml(gauge.location)}</p><p>Next calibration: ${formatDate(gauge.nextCalibrationDate)} · ${statusMarkup(gauge)}</p><p>${gauge.checkout ? `Checked out to ${escapeHtml(gauge.checkout.borrower)} (due ${formatDate(gauge.checkout.expectedReturnDate)})` : "Available to check out"}</p><button class="button button-outline button-small" data-action="details" data-id="${escapeHtml(gauge.id)}">View QR label and details</button>`;
  }

  async function startScanner() {
    $("#scanner-error").classList.add("hidden");
    if (!window.Html5Qrcode) {
      $("#scanner-error").textContent = "The scanner library did not load. Check your internet connection and reload.";
      $("#scanner-error").classList.remove("hidden");
      return;
    }
    if (!state.scanner) state.scanner = new window.Html5Qrcode("qr-reader");
    state.scanHandled = false;
    try {
      await state.scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 220, height: 220 } }, (text) => {
        if (state.scanHandled) return;
        state.scanHandled = true;
        const result = handleScannedQr(text);
        if (result.gauge && result.isProfile) openProductPassport(result.gauge, result.message);
        else showLookupResult(result.gauge, result.message);
        showToast(result.message, !result.gauge);
        if (!result.isProfile) stopScanner();
      }, () => {});
      $("#start-scanner").disabled = true;
      $("#stop-scanner").disabled = false;
    } catch (error) {
      $("#scanner-error").textContent = `Could not start the camera: ${error.message || error}. Check camera permission and use HTTPS or localhost.`;
      $("#scanner-error").classList.remove("hidden");
    }
  }

  async function stopScanner() {
    if (!state.scanner || !state.scanner.isScanning) return;
    try {
      await state.scanner.stop();
      $("#start-scanner").disabled = false;
      $("#stop-scanner").disabled = true;
      state.scanner.clear();
    } catch (error) {
      $("#scanner-error").textContent = `Could not stop the camera cleanly: ${error.message || error}`;
      $("#scanner-error").classList.remove("hidden");
    }
  }

  function handleFileScan(file) {
    if (!file) return;
    if (!window.Html5Qrcode) {
      showToast("The scanner library did not load. Check your internet connection.", true);
      return;
    }
    const reader = new window.Html5Qrcode("qr-reader");
    reader.scanFile(file, true).then((text) => {
      const result = handleScannedQr(text);
      if (result.gauge && result.isProfile) openProductPassport(result.gauge, result.message);
      else showLookupResult(result.gauge, result.message);
      showToast(result.message, !result.gauge);
    }).catch((error) => {
      showToast(`Could not read a QR code from that image: ${error}`, true);
    }).finally(() => reader.clear());
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.view) return changeView(target.dataset.view);
    if (target.classList.contains("close-modal")) return closeModal();
    if (target.id === "manage-organizations") return openOrganizationManager();
    if (target.dataset.organizationSelect) return switchOrganization(target.dataset.organizationSelect);
    if (target.dataset.organizationDelete) return deleteOrganization(target.dataset.organizationDelete);
    if (target.id === "open-quick-search") return openQuickSearch();
    if (target.id === "add-equipment") return openNewEquipmentForm();
    if (target.dataset.quick) return runQuickAction(target.dataset.quick, target.dataset.id);
    if (target.id === "export-csv") return exportCsv();
    if (target.id === "backup-json") return exportBackup();
    if (target.id === "restore-json") return $("#backup-file").click();
    if (target.id === "load-samples" || target.id === "registry-load-samples") return loadSamples();
    if (target.id === "demo-steps-toggle") {
      const steps = $("#demo-steps");
      const hidden = steps.classList.toggle("hidden");
      target.innerHTML = hidden ? "Show demo steps <span>⌄</span>" : "Hide demo steps <span>⌃</span>";
      return;
    }
    if (target.id === "lookup-mock") {
      const id = $("#mock-qr-select").value;
      return id ? showLookupResult(gaugeById(id)) : showLookupResult(null);
    }
    if (target.id === "start-scanner") return startScanner();
    if (target.id === "stop-scanner") return stopScanner();
    if (target.dataset.action) {
      const gauge = gaugeById(target.dataset.id);
      if (!gauge) return showToast("Equipment was not found. Refresh the page and try again.", true);
      if (target.dataset.action === "details") return openDetails(gauge);
      if (target.dataset.action === "calibrate") return openCalibrationForm(gauge);
      if (target.dataset.action === "edit") return openEditForm(gauge);
      if (target.dataset.action === "delete") return deleteGauge(gauge);
      if (target.dataset.action === "checkout") return openCheckoutForm(gauge);
      if (target.dataset.action === "return") return openReturnForm(gauge);
      if (target.dataset.action === "print") return printLabel(gauge);
      if (target.dataset.action === "copy-product-link") return copyProductLink(gauge);
      if (target.dataset.action === "download-qr") return downloadQr(gauge);
      if (target.dataset.action === "product-registry") {
        changeView("registry");
        $("#registry-search").value = gauge.id;
        renderRegistry();
        return;
      }
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form.matches("#add-equipment-form, #edit-gauge-form, #checkout-form, #return-form, #calibration-form, #create-organization-form")) return;
    event.preventDefault();
    const formId = form.getAttribute("id");
    if (formId === "create-organization-form") return createOrganization(String(new FormData(form).get("name") || ""), form);
    if (formId === "add-equipment-form") handleNewEquipmentSubmit(form);
    if (formId === "edit-gauge-form") handleEditSubmit(form);
    if (formId === "calibration-form") handleCalibrationSubmit(form);
    if (formId === "checkout-form") handleCheckoutSubmit(form);
    if (formId === "return-form") handleReturnSubmit(form);
  });

  $("#modal-backdrop").addEventListener("click", (event) => {
    if (event.target.id === "modal-backdrop") closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#modal-backdrop").classList.contains("hidden")) closeModal();
    if (event.key === "Escape" && !$("#quick-search-backdrop").classList.contains("hidden")) closeQuickSearch();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openQuickSearch();
    }
    if (event.key === "/" && !event.ctrlKey && !event.metaKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) &&
        $("#quick-search-backdrop").classList.contains("hidden")) {
      event.preventDefault();
      openQuickSearch();
    }
    if (!$("#quick-search-backdrop").classList.contains("hidden")) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveQuickSelection(1);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveQuickSelection(-1);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const selected = $(".quick-result.selected", $("#quick-search-results"));
        if (selected) runQuickAction(selected.dataset.quick, selected.dataset.id);
      }
    }
  });
  $("#quick-search-input").addEventListener("input", (event) => renderQuickSearch(event.target.value));
  $("#quick-search-backdrop").addEventListener("click", (event) => {
    if (event.target.id === "quick-search-backdrop") closeQuickSearch();
  });
  $("#registry-search").addEventListener("input", renderRegistry);
  $("#status-filter").addEventListener("change", renderRegistry);
  $("#activity-search").addEventListener("input", renderActivity);
  $("#activity-filter").addEventListener("change", renderActivity);
  $("#organization-select").addEventListener("change", (event) => switchOrganization(event.target.value));
  $("#mock-qr-select").addEventListener("change", () => $("#lookup-result").classList.add("hidden"));
  $("#qr-file").addEventListener("change", (event) => handleFileScan(event.target.files[0]));
  $("#backup-file").addEventListener("change", (event) => restoreBackup(event.target.files[0]));
  const storedData = readStoredData();
  state.gauges = storedData.gauges;
  state.activities = storedData.activities;
  renderOrganizationSwitcher();
  $("#today-label").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());
  renderAll();

  const urlQuery = new URLSearchParams(window.location.search);
  const urlFragment = new URLSearchParams(window.location.hash.slice(1));
  if (urlQuery.has("passport") || urlQuery.has("product") || urlFragment.has("product") || urlFragment.has("import")) {
    const result = handleScannedQr(window.location.href);
    if (result.gauge && result.isProfile) openProductPassport(result.gauge, result.message);
    else {
      changeView("scanner");
      showLookupResult(result.gauge, result.message);
    }
    showToast(result.message, !result.gauge);
  } else if (urlFragment.has("gauge")) {
    const found = gaugeById(urlFragment.get("gauge"));
    if (found) {
      changeView("scanner");
      $("#mock-qr-select").value = found.id;
      showLookupResult(found);
    }
  }
})();
