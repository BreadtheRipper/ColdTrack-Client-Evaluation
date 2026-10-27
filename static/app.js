const LOOKUP_LABELS = {
  product_line: "Freezer Brand",
  equipment_type: "Equipment description / type",
  equipment_brand: "Manufacturer",
  model: "Model",
  area: "Area",
  province: "Province",
  technician: "Technician",
};

const state = {
  csrf: "",
  user: null,
  lookups: {},
  stores: [],
  selectedStore: null,
  selectedFreezerId: null,
  importBatchId: null,
  currentPage: "inventory",
  equipmentPage: 1,
  equipmentTotal: 0,
  sidebarCollapsed: localStorage.getItem("coldtrack-sidebar-collapsed") === "true",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const today = () => new Date().toISOString().slice(0, 10);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = collapsed;
  $("#app-shell").classList.toggle("sidebar-collapsed", collapsed);
  const toggle = $("#sidebar-toggle");
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", collapsed ? "Show navigation sidebar" : "Hide navigation sidebar");
  localStorage.setItem("coldtrack-sidebar-collapsed", String(collapsed));
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && typeof options.body !== "string" && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.body);
  }
  if (options.method && options.method !== "GET" && url !== "/api/login") {
    headers.set("X-CSRF-Token", state.csrf);
  }
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    if (response.status === 401 && url !== "/api/login") showLogin();
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  if (data.csrf_token) state.csrf = data.csrf_token;
  return data;
}

function showLogin(message = "") {
  state.user = null;
  $("#app-shell").hidden = true;
  $("#login-screen").hidden = false;
  $("#login-error").textContent = message;
}

function showApplication(user) {
  state.user = user;
  $("#login-screen").hidden = true;
  $("#app-shell").hidden = false;
  $("#account-name").textContent = user.display_name;
  $("#account-role").textContent = user.role;
  $("#user-avatar").textContent = (user.display_name || "U").trim().charAt(0).toUpperCase();
  $$(".admin-only").forEach(button => { button.hidden = user.role !== "admin"; });
  loadWorkspace().catch(showError);
}

function showError(error) {
  window.alert(error.message || String(error));
}

function fillSelect(select, values, placeholder, selected = "") {
  if (!select) return;
  const previous = selected || select.value;
  select.replaceChildren(new Option(placeholder, ""));
  (values || []).forEach(item => {
    const value = typeof item === "string" ? item : item.value;
    const option = new Option(value, value);
    if (typeof item === "object" && item.parent_value) option.dataset.parentValue = item.parent_value;
    select.add(option);
  });
  if (previous && [...select.options].some(option => option.value === previous)) {
    select.value = previous;
  }
}

function lookupValues(field) {
  return state.lookups[field] || [];
}

function populateManagedSelect(select, field, placeholder, selected = "") {
  fillSelect(select, lookupValues(field), placeholder, selected);
}

function updateProvinceSelect(select, area, selected = "") {
  if (!select) return;
  const provinces = lookupValues("province").filter(item => area && item.parent_value === area);
  fillSelect(select, provinces, area ? "Select province" : "Select an area first", selected);
}

async function loadLookups() {
  state.lookups = await api("/api/lookups");
  for (const field of ["technician", "product_line", "equipment_brand", "model"]) {
    populateManagedSelect($(`#report-${field}`), field, `All ${LOOKUP_LABELS[field].toLowerCase()}s`);
  }
  for (const field of ["product_line", "equipment_type", "equipment_brand", "model", "technician"]) {
    populateManagedSelect(
      $(`#add-service-form [name="${field}"]`),
      field,
      `Select ${LOOKUP_LABELS[field].toLowerCase()}`,
    );
  }
  for (const formSelector of ["#equipment-form", "#add-freezer-form"]) {
    for (const field of ["product_line", "equipment_type", "equipment_brand", "model"]) {
      populateManagedSelect(
        $(`${formSelector} [name="${field}"]`),
        field,
        `Select ${LOOKUP_LABELS[field].toLowerCase()}`,
      );
    }
  }
  for (const selector of [
    "#store-info-form [name=area]",
    "#add-service-form [name=new_store_area]",
  ]) {
    populateManagedSelect($(selector), "area", "Select area");
  }
  updateProvinceSelect($("#store-info-form [name=province]"), $("#store-info-form [name=area]").value);
  updateProvinceSelect($("#add-service-form [name=new_store_province]"), $("#add-service-form [name=new_store_area]").value);
  fillSelect(
    $("#lookup-field"),
    Object.entries(LOOKUP_LABELS).map(([value, label]) => ({ value, label })),
    "Select a list",
  );
  [...$("#lookup-field").options].forEach(option => {
    const item = Object.entries(LOOKUP_LABELS).find(([value]) => value === option.value);
    if (item) option.textContent = item[1];
  });
  renderLookupAdmin();
}

async function loadWorkspace() {
  await loadLookups();
  await Promise.all([loadStores(), loadSummary()]);
  if (state.user.role === "admin") await loadAdminData();
}

async function loadSummary() {
  const [stores, report] = await Promise.all([
    api("/api/stores"),
    api("/api/reports/services"),
  ]);
  $("#asset-total").textContent = stores.total.toLocaleString();
  $("#transit-total").textContent = stores.items.reduce((total, store) => total + store.freezer_count, 0).toLocaleString();
  $("#service-total").textContent = report.total_services.toLocaleString();
}

function storeOptionMarkup(stores, selectedId = "") {
  return `<option value="">Choose a store</option>${stores.map(store => `
    <option value="${store.id}" ${String(store.id) === String(selectedId) ? "selected" : ""}>
      ${escapeHtml(store.store_name)} · ${escapeHtml(store.business_address)}
    </option>`).join("")}`;
}

async function loadStores() {
  const params = new URLSearchParams({ search: $("#store-search").value.trim() });
  const result = await api(`/api/stores?${params}`);
  state.stores = result.items;
  const reportStores = params.get("search") ? (await api("/api/stores")).items : result.items;
  const reportStore = $("#report-store");
  if (reportStore) {
    const selectedStore = reportStore.value;
    fillSelect(
      reportStore,
      reportStores.map(store => ({
        value: store.id,
        label: `${store.store_name} · ${store.business_address || "Address not recorded"}`,
      })),
      "All stores",
      selectedStore,
    );
    [...reportStore.options].forEach(option => {
      const store = reportStores.find(item => String(item.id) === option.value);
      if (store) option.textContent = `${store.store_name} · ${store.business_address || "Address not recorded"}`;
    });
  }
  $("#asset-total").textContent = result.total.toLocaleString();
  $("#transit-total").textContent = result.items.reduce((total, store) => total + store.freezer_count, 0).toLocaleString();
  $("#store-rows").innerHTML = result.items.map(store => `
    <tr>
      <td><span class="cell-primary">${escapeHtml(store.store_name)}</span></td>
      <td>${escapeHtml(store.business_address || "Address not recorded")}</td>
      <td>${escapeHtml([store.area, store.province].filter(Boolean).join(" · ") || "—")}</td>
      <td><span class="cell-primary">${escapeHtml(store.manager || "—")}</span><span class="cell-secondary">${escapeHtml(store.contact || "—")}</span><span class="cell-secondary">Sales Rep: ${escapeHtml(store.sales_rep || "—")}</span></td>
      <td><span class="count-badge">${store.freezer_count} freezers</span></td>
      <td>${escapeHtml(store.latest_service || "—")}</td>
      <td><button class="row-action" data-open-store="${store.id}">View store</button></td>
    </tr>`).join("");
  $("#store-empty").hidden = result.items.length > 0;
}

async function loadEquipment() {
  const params = new URLSearchParams({
    search: $("#equipment-search").value.trim(),
    current_only: "1",
    page: String(state.equipmentPage),
    per_page: "100",
    sort: "serial_number",
  });
  const result = await api(`/api/assets?${params}`);
  state.equipmentTotal = result.total;
  $("#equipment-rows").innerHTML = result.items.map(asset => {
    const location = asset.store_name
      ? [asset.store_name, asset.business_address, asset.area, asset.province].filter(Boolean).join(" · ")
      : asset.status === "in_transit" ? "In transit" : "Unassigned stock";
    return `<tr>
      <td><span class="cell-primary">${escapeHtml(asset.product_line || "—")}</span><span class="cell-secondary">${escapeHtml(asset.equipment_type || "Equipment type not recorded")}</span></td>
      <td><span class="cell-primary">${escapeHtml(asset.equipment_brand || "—")}</span><span class="cell-secondary">${escapeHtml(asset.model || "Model not recorded")}</span></td>
      <td>${escapeHtml(asset.serial_number || "—")}</td>
      <td>${escapeHtml(location)}</td>
      <td><span class="status-pill ${escapeHtml(asset.status)}">${escapeHtml(asset.status.replaceAll("_", " "))}</span></td>
      <td>${asset.service_count}</td>
      <td><button class="row-action" data-open-equipment-history="${asset.id}">Service history</button></td>
    </tr>`;
  }).join("");
  $("#equipment-empty").hidden = result.items.length > 0;
  const first = result.total ? (result.page - 1) * result.per_page + 1 : 0;
  const last = Math.min(result.page * result.per_page, result.total);
  $("#equipment-page-summary").textContent = `Showing ${first}–${last} of ${result.total} current unit(s)`;
  $("#equipment-previous").disabled = result.page <= 1;
  $("#equipment-next").disabled = last >= result.total;
}

async function openStore(storeId) {
  const result = await api(`/api/stores/${storeId}`);
  state.selectedStore = result.store;
  $("#store-dialog-title").textContent = result.store.store_name;
  $("#store-dialog-address").textContent = [
    result.store.business_address,
    result.store.area,
    result.store.province,
  ].filter(Boolean).join(" · ");
  $("#store-info-form").elements.store_name.value = result.store.store_name;
  $("#store-info-form").elements.business_address.value = result.store.business_address;
  $("#store-info-form").elements.area.value = result.store.area;
  updateProvinceSelect($("#store-info-form").elements.province, result.store.area, result.store.province);
  $("#store-info-form").elements.manager.value = result.store.manager;
  $("#store-info-form").elements.contact.value = result.store.contact;
  $("#store-info-form").elements.sales_rep.value = result.store.sales_rep || "";
  $("#store-info-form").elements.notes.value = result.store.notes || "";
  $("#store-freezer-list").innerHTML = result.freezers.length ? result.freezers.map(freezer => `
    <button class="store-freezer-card" data-open-freezer="${freezer.id}">
      <span class="freezer-card-heading">${escapeHtml([freezer.product_line, freezer.equipment_type].filter(Boolean).join(" · ") || "Freezer")}</span>
      <span>${escapeHtml([freezer.equipment_brand, freezer.model].filter(Boolean).join(" · ") || "Equipment details not recorded")}</span>
      <span class="cell-secondary">Serial ${escapeHtml(freezer.serial_number || "not recorded")} · ${freezer.service_count} service visit(s)</span>
      <span class="latest-service"><strong>Latest service:</strong> ${escapeHtml(freezer.latest_service || "None recorded")}${freezer.latest_technician ? ` · ${escapeHtml(freezer.latest_technician)}` : ""}</span>
      ${freezer.latest_service_details ? `<span class="latest-service-details">${escapeHtml(freezer.latest_service_details)}</span>` : ""}
    </button>`).join("") : '<div class="empty-state">No current freezers are recorded at this store. Add a freezer to record its location, or add a service visit.</div>';
  showStoreDialogView("freezers");
  $("#freezer-history-view").hidden = true;
  if (!$("#store-dialog").open) $("#store-dialog").showModal();
}

function showStoreDialogView(view) {
  $("#store-freezer-view").hidden = view !== "freezers";
  $("#store-info-view").hidden = view !== "info";
  $$(".dialog-tab").forEach(button => button.classList.toggle("active", button.dataset.storeTab === view));
}

async function openFreezerHistory(assetId) {
  const result = await api(`/api/assets/${assetId}`);
  state.selectedFreezerId = assetId;
  $("#store-freezer-view").hidden = true;
  $("#store-info-view").hidden = true;
  $("#freezer-history-view").hidden = false;
  $("#freezer-history-title").textContent = [
    result.asset.equipment_brand,
    result.asset.model,
    result.asset.equipment_type,
  ].filter(Boolean).join(" · ") || "Freezer";
  $("#freezer-history-subtitle").textContent = `Serial ${result.asset.serial_number || "not recorded"} at ${state.selectedStore.store_name}`;
  $("#freezer-service-history").innerHTML = result.services.length ? result.services.map(service => `
    <article class="history-card">
      <strong>${escapeHtml(service.service_date)} · ${escapeHtml(service.technician)}</strong>
      ${service.repairs ? `<p><b>Repairs:</b> ${escapeHtml(service.repairs)}</p>` : ""}
      ${service.parts ? `<p><b>Parts:</b> ${escapeHtml(service.parts)}</p>` : ""}
      ${service.notes ? `<p><b>Notes:</b> ${escapeHtml(service.notes)}</p>` : ""}
      <small>Recorded by ${escapeHtml(service.created_by_name || "Unknown")} · <button class="row-action" data-edit-service="${service.id}" data-asset-id="${assetId}">Edit</button></small>
    </article>`).join("") : '<div class="empty-state">No service history is recorded for this freezer at this store.</div>';
  $("#move-freezer-form").hidden = true;
  $("#move-freezer-form").elements.store_id.innerHTML = storeOptionMarkup(
    state.stores.filter(store => store.id !== state.selectedStore.id),
  );
  $("#move-freezer-form").elements.effective_date.value = today();
}

async function populateFreezerOptions(storeId) {
  const select = $("#add-service-form").elements.asset_id;
  if (!storeId) {
    fillSelect(select, [], "Choose a store first");
    return;
  }
  const result = await api(`/api/stores/${storeId}`);
  const label = freezer => [
    freezer.product_line,
    freezer.equipment_brand,
    freezer.model,
    freezer.serial_number ? `Serial ${freezer.serial_number}` : "",
  ].filter(Boolean).join(" · ");
  select.replaceChildren(new Option("Choose a freezer", ""));
  result.freezers.forEach(freezer => select.add(new Option(label(freezer), freezer.id)));
}

async function openServiceDialog(storeId = "") {
  const form = $("#add-service-form");
  form.reset();
  $("#add-service-error").textContent = "";
  $("#service-dialog h2").textContent = "Add service";
  form.querySelector('[type="submit"]').textContent = "Save service";
  form.elements.store_id.disabled = false;
  form.elements.asset_id.disabled = false;
  form.elements.store_id.required = true;
  form.elements.asset_id.required = false;
  form.elements.product_line.required = false;
  form.elements.equipment_type.required = false;
  $("#new-store-fields").hidden = true;
  $("#new-freezer-fields").hidden = true;
  $("#existing-freezer-label").hidden = false;
  $("#new-store-toggle").checked = false;
  $("#new-store-toggle").closest("label").hidden = false;
  $("#new-freezer-toggle").checked = false;
  $("#new-freezer-toggle").disabled = false;
  $("#new-freezer-toggle").closest("label").hidden = false;
  form.elements.store_id.innerHTML = storeOptionMarkup(state.stores, storeId);
  form.elements.service_date.value = today();
  await populateFreezerOptions(storeId);
  $("#service-dialog").showModal();
}

async function openEquipmentDialog() {
  const form = $("#equipment-form");
  form.reset();
  $("#equipment-error").textContent = "";
  $("#equipment-dialog").showModal();
}

async function openAddFreezerDialog() {
  const form = $("#add-freezer-form");
  form.reset();
  $("#add-freezer-error").textContent = "";
  const result = await api("/api/assets?available=1&per_page=500&sort=serial_number");
  const select = form.elements.asset_id;
  select.replaceChildren(new Option(
    result.items.length ? "Choose unassigned equipment" : "No unassigned equipment available",
    "",
  ));
  result.items.forEach(asset => {
    const label = [
      asset.product_line,
      asset.equipment_type,
      asset.equipment_brand,
      asset.model,
      asset.serial_number ? `Serial ${asset.serial_number}` : "",
    ].filter(Boolean).join(" · ");
    select.add(new Option(label, asset.id));
  });
  $("#store-new-freezer-fields").hidden = true;
  select.disabled = false;
  select.required = true;
  form.elements.equipment_type.required = false;
  $("#add-freezer-dialog").showModal();
}

async function editService(serviceId, assetId) {
  const result = await api(`/api/assets/${assetId}`);
  const service = result.services.find(item => item.id === Number(serviceId));
  if (!service) throw new Error("Service visit not found.");
  await openServiceDialog(result.asset.store_id);
  const form = $("#add-service-form");
  form.elements.service_id.value = service.id;
  form.elements.asset_id.value = result.asset.id;
  form.elements.store_id.disabled = true;
  $("#existing-freezer-label").hidden = false;
  $("#existing-freezer-label").querySelector("select").disabled = true;
  form.elements.store_id.required = false;
  form.elements.asset_id.required = false;
  $("#new-store-toggle").closest("label").hidden = true;
  $("#new-freezer-toggle").closest("label").hidden = true;
  for (const field of ["service_date", "technician", "repairs", "parts", "notes"]) {
    form.elements[field].value = service[field] || "";
  }
  form.querySelector('[type="submit"]').textContent = "Save service changes";
  $("#service-dialog h2").textContent = "Edit service";
}

function renderServiceReportRow(row) {
  return `<tr class="service-report-row" tabindex="0" role="button" data-open-service-report="${row.asset_id}"
      aria-label="Open service report for serial ${escapeHtml(row.serial_number || "not recorded")}">
    <td>${escapeHtml(row.technician)}</td><td>${escapeHtml(row.product_line || "—")}</td>
    <td><span class="cell-primary">${escapeHtml(row.equipment_brand || "—")}</span><span class="cell-secondary">${escapeHtml(row.model || "—")}</span></td>
    <td>${escapeHtml(row.serial_number || "—")}</td><td>${escapeHtml(row.store_name || "—")}</td>
    <td><span class="count-badge">${row.service_count}</span></td><td>${escapeHtml(row.latest_service || "—")}</td></tr>`;
}

async function loadServiceReport() {
  const params = new URLSearchParams();
  ["store_id", "technician", "product_line", "equipment_brand", "model"].forEach(field => {
    const selector = field === "store_id" ? "#report-store" : `#report-${field}`;
    const value = $(selector).value;
    if (value) params.set(field, value);
  });
  const serialNumber = $("#report-serial-number").value.trim();
  if (serialNumber) params.set("serial_number", serialNumber);
  const result = await api(`/api/reports/services?${params}`);
  $("#report-total").textContent = `${result.total_services.toLocaleString()} services`;
  $("#report-rows").innerHTML = result.items.map(renderServiceReportRow).join("");
  $("#report-empty").hidden = result.items.length > 0;
}

async function openServiceReport(assetId) {
  const result = await api(`/api/reports/services/${assetId}`);
  const asset = result.asset;
  $("#service-report-title").textContent = [
    asset.product_line,
    asset.equipment_brand,
    asset.model,
    asset.equipment_type,
  ].filter(Boolean).join(" · ") || "Freezer service report";
  $("#service-report-subtitle").textContent = `Serial ${asset.serial_number || "not recorded"} · ${result.services.length} service visit(s) across all recorded locations`;
  $("#service-report-history").innerHTML = result.services.length ? result.services.map(service => `
    <article class="history-card">
      <strong>${escapeHtml(service.service_date)} · ${escapeHtml(service.technician)}</strong>
      <span class="cell-secondary">${escapeHtml(service.store_name || "Store not recorded")} · ${escapeHtml(service.business_address || "Address not recorded")}</span>
      ${service.repairs ? `<p><b>Repairs:</b> ${escapeHtml(service.repairs)}</p>` : ""}
      ${service.parts ? `<p><b>Parts:</b> ${escapeHtml(service.parts)}</p>` : ""}
      ${service.notes ? `<p><b>Notes:</b> ${escapeHtml(service.notes)}</p>` : ""}
      <small>Recorded by ${escapeHtml(service.created_by_name || "Unknown")}</small>
    </article>`).join("") : '<div class="empty-state">No service visits are recorded for this freezer.</div>';
  $("#service-report-dialog").showModal();
}

function showPage(page) {
  if (page === "admin" && state.user.role !== "admin") return;
  state.currentPage = page;
  $$(".page").forEach(section => { section.hidden = section.id !== `${page}-page`; });
  $$(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.page === page));
  $("#page-crumb").textContent = ({ inventory: "STORES", equipment: "EQUIPMENT", imports: "IMPORT DATA", reports: "SERVICE REPORT", admin: "ADMINISTRATION" })[page];
  if (page === "equipment") loadEquipment().catch(showError);
  if (page === "reports") loadServiceReport().catch(showError);
  if (page === "imports") loadImportApprovals().catch(showError);
  if (page === "admin") loadAdminData().catch(showError);
}

async function loadAdminData() {
  if (state.user.role !== "admin") return;
  await Promise.all([
    loadAdminUsers(),
    loadAdminLookups(),
    loadVariants(),
    loadAudit(),
    loadImportApprovals(),
    loadBackups(),
  ]);
}

async function loadAdminUsers() {
  const result = await api("/api/admin/users");
  $("#user-list").innerHTML = result.items.map(user => `
    <div class="admin-list-item">
      <div><strong>${escapeHtml(user.display_name)} <span class="role-pill">${escapeHtml(user.role)}</span></strong><small>${escapeHtml(user.username)} · ${user.active ? "Active" : "Inactive"}</small></div>
      <div class="user-actions">
        <select data-user-role="${user.id}" aria-label="Role for ${escapeHtml(user.username)}"><option value="staff" ${user.role === "staff" ? "selected" : ""}>Staff</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option></select>
        <button class="button button-quiet" data-reset-user="${user.id}">Reset password</button>
        <button class="button ${user.active ? "button-danger" : "button-quiet"}" data-toggle-user="${user.id}" data-active="${user.active ? 1 : 0}">${user.active ? "Disable" : "Enable"}</button>
      </div>
    </div>`).join("");
}

async function loadImportApprovals() {
  if (state.user.role !== "admin") return;
  const result = await api("/api/admin/import-requests");
  $("#import-approval-list").innerHTML = result.items.length ? result.items.map(item => `
    <div class="admin-list-item">
      <div><strong>${escapeHtml(LOOKUP_LABELS[item.field] || item.field)}: ${escapeHtml(item.value)}</strong><small>${escapeHtml(item.file_name)} · requested by ${escapeHtml(item.requested_by || "unknown")} · ${escapeHtml(item.created_at)}</small></div>
      <div><button class="button button-primary" data-approve-import-value="${item.id}">Approve</button> <button class="button button-danger" data-reject-import-value="${item.id}">Reject batch</button></div>
    </div>`).join("") : '<div class="empty-state">No import values are waiting for approval.</div>';
}

async function loadAdminLookups() {
  const result = await api("/api/admin/lookups");
  state.adminLookups = result.items;
  renderLookupAdmin();
}

function renderLookupAdmin() {
  const field = $("#lookup-field")?.value;
  const items = (state.adminLookups || []).filter(item => item.field === field);
  const parentLabel = $("#lookup-parent-label");
  parentLabel.hidden = field !== "province";
  $("#lookup-parent").required = field === "province";
  $("#lookup-parent").disabled = field !== "province";
  populateManagedSelect($("#lookup-parent"), "area", "Select area");
  $("#lookup-list").innerHTML = items.length ? items.map(item => {
    const canEdit = true;
    const areas = (state.adminLookups || []).filter(option => option.field === "area");
    const parentSelect = item.field === "province" ? `
      <select data-lookup-parent="${item.id}" aria-label="Area for ${escapeHtml(item.value)}">
        ${areas.map(area => `<option value="${escapeHtml(area.value)}" ${area.value === item.parent_value ? "selected" : ""}>${escapeHtml(area.value)}${area.active ? "" : " (inactive)"}</option>`).join("")}
      </select>` : "";
    return `<div class="admin-list-item ${item.active ? "" : "inactive"}">
      <div class="managed-value">
        ${canEdit ? `<input data-lookup-value="${item.id}" value="${escapeHtml(item.value)}" aria-label="Rename ${escapeHtml(LOOKUP_LABELS[item.field])}" placeholder="Rename value">` : `<strong>${escapeHtml(item.value)}</strong>`}
        <small>${escapeHtml(item.parent_value || item.source)} · ${item.active ? "Active" : "Inactive"}</small>
      </div>
      ${canEdit ? `<div class="managed-value-actions">${parentSelect}<button class="button button-quiet" data-save-lookup="${item.id}">Save changes</button><button class="button ${item.active ? "button-danger" : "button-quiet"}" data-toggle-lookup="${item.id}" data-active="${item.active ? 1 : 0}">${item.active ? "Deactivate" : "Restore"}</button></div>` : ""}
    </div>`;
  }).join("") : '<div class="empty-state">No values in this list yet.</div>';
}

async function loadBackups() {
  if (state.user.role !== "admin") return;
  const result = await api("/api/admin/backups");
  $("#backup-schedule-form").elements.time.value = result.backup_time;
  $("#backup-list").innerHTML = result.backups.length ? result.backups.map(backup => `
    <div class="admin-list-item">
      <div><strong>${escapeHtml(backup.filename)}</strong><small>${escapeHtml(backup.created_at)} · ${(backup.size / 1024 / 1024).toFixed(2)} MB</small></div>
      <button class="button button-quiet" data-download-backup="${escapeHtml(backup.filename)}">Download</button>
    </div>`).join("") : '<div class="empty-state">No backups created yet.</div>';
}

async function loadVariants() {
  const result = await api("/api/admin/variants");
  $("#variant-list").innerHTML = result.items.length ? result.items.map(item => `
    <div class="variant-item">
      <div class="variant-values"><strong>${escapeHtml(LOOKUP_LABELS[item.field])}</strong><br>${escapeHtml(item.left)} <span>↔</span> ${escapeHtml(item.right)} <small>(${Math.round(item.similarity * 100)}%)</small></div>
      <div><button class="button button-quiet" data-merge-source="${item.right_id}" data-merge-target="${item.left_id}">Keep left</button> <button class="button button-quiet" data-merge-source="${item.left_id}" data-merge-target="${item.right_id}">Keep right</button></div>
    </div>`).join("") : '<div class="empty-state">No close variants found in the active lists.</div>';
}

async function loadAudit() {
  const result = await api("/api/admin/audit?limit=200");
  $("#audit-rows").innerHTML = result.items.map(item => {
    let detail = "";
    try {
      detail = item.after_json || item.before_json || "";
      if (detail) detail = JSON.stringify(JSON.parse(detail));
    } catch {
      detail = item.after_json || item.before_json || "";
    }
    return `<tr><td>${escapeHtml(item.created_at)}</td><td>${escapeHtml(item.actor)}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.entity_type)} #${escapeHtml(item.entity_id)}</td><td><span class="audit-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</span></td></tr>`;
  }).join("");
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function renderSheetChoices(sheets) {
  const defaultSheets = new Set(["SUNDAYS", "FLAVORITE", "GUILTLESS", "UNBRANDED"]);
  $("#sheet-selection").hidden = false;
  $("#sheet-selection").innerHTML = `<span class="sheet-selection-title">Select sheets</span><div class="sheet-checkboxes">${sheets.map(sheet => `
    <label class="sheet-choice"><input type="checkbox" name="sheets" value="${escapeHtml(sheet)}" ${sheets.length === 1 || defaultSheets.has(sheet) ? "checked" : ""}>${escapeHtml(sheet)}${["EXPORT", "SHIPMENT"].includes(sheet) ? " · optional" : ""}</label>`).join("")}</div>`;
  $("#preview-import-button").disabled = !$("#sheet-selection input:checked");
  $$("#sheet-selection input").forEach(input => input.addEventListener("change", () => {
    $("#preview-import-button").disabled = !$("#sheet-selection input:checked");
  }));
}

function importLookupControl(field, rowIndex, currentValue, sourceValue = "") {
  const values = lookupValues(field);
  const approved = values.some(item => item.value === currentValue);
  const selected = approved ? currentValue : "";
  const options = values.map(item => `
    <option value="${escapeHtml(item.value)}" ${item.value === selected ? "selected" : ""}>${escapeHtml(item.value)}</option>
  `).join("");
  const customValue = !approved && currentValue ? currentValue : "";
  return `<select data-row-field="${field}" data-row-index="${rowIndex}" ${currentValue && !approved ? "required" : ""}>
      <option value="">Choose ${escapeHtml(LOOKUP_LABELS[field].toLowerCase())}</option>
      ${options}
      <option value="__new__">Add value as new entry…</option>
    </select>
    <input class="import-new-value" data-row-new-value="${field}" data-row-index="${rowIndex}"
      value="${escapeHtml(customValue)}" placeholder="New ${escapeHtml(LOOKUP_LABELS[field].toLowerCase())}" hidden>
    ${sourceValue && !approved ? `<small class="import-source-value">Source: ${escapeHtml(sourceValue)}</small>` : ""}`;
}

function importAreaControl(rowIndex, value, sourceValue = "") {
  const values = lookupValues("area");
  const approved = values.some(item => item.value === value);
  return `<select data-row-field="area" data-row-index="${rowIndex}">
      <option value="">Choose area</option>
      ${values.map(item => `<option value="${escapeHtml(item.value)}" ${item.value === value && approved ? "selected" : ""}>${escapeHtml(item.value)}</option>`).join("")}
    </select>
    ${sourceValue && !approved ? `<small class="import-source-value">Source: ${escapeHtml(sourceValue)}</small>` : ""}`;
}

function importProvinceControl(rowIndex, area, value, sourceValue = "") {
  const areaApproved = lookupValues("area").some(item => item.value === area);
  const provinces = lookupValues("province").filter(item => areaApproved && item.parent_value === area);
  const approved = provinces.some(item => item.value === value);
  return `<select data-row-field="province" data-row-index="${rowIndex}" ${areaApproved ? "" : "disabled"}>
      <option value="">${areaApproved ? "Choose province" : "Choose area first"}</option>
      ${provinces.map(item => `<option value="${escapeHtml(item.value)}" ${item.value === value && approved ? "selected" : ""}>${escapeHtml(item.value)}</option>`).join("")}
    </select>
    ${sourceValue && !approved ? `<small class="import-source-value">Source: ${escapeHtml(sourceValue)}</small>` : ""}`;
}

function renderImportReview(result) {
  state.importBatchId = result.batch_id;
  $("#import-review-panel").hidden = false;
  $("#import-summary").textContent = `${result.record_count.toLocaleString()} equipment rows from ${result.sheets.join(", ")} in ${result.file_name}.`;
  const review = result.review;
  const initialIncompleteCount = review.location_warnings?.length || 0;
  $("#import-unknown-values").innerHTML = `
    <section class="import-review-section import-grid-section">
      <div class="import-review-heading">
        <div><h3>Review imported rows</h3><p class="muted">Edit each row in place. Geography dropdowns are linked; new freezer values require admin approval.</p></div>
        <span class="count-badge">${result.record_count.toLocaleString()} rows</span>
      </div>
      <div class="import-table-wrap"><table class="import-table">
        <thead><tr><th>Source</th><th>Store / customer</th><th>Business address</th><th>Area</th><th>Province</th><th>Manager</th><th>Contact</th><th>Sales Rep</th><th>Equipment description</th><th>Freezer Brand</th><th>Manufacturer</th><th>Model</th><th>Serial number</th><th>Delivery date</th></tr></thead>
        <tbody id="import-rows">${(result.rows || []).map((row, index) => {
          const values = row.values;
          return `<tr data-import-row="${index}" data-source-sheet="${escapeHtml(row.source_sheet)}" data-source-row="${row.source_row}">
            <td><strong>${escapeHtml(row.source_sheet)} · ${row.source_row}</strong>${row.source_location ? `<small>Source location: ${escapeHtml(row.source_location)}</small>` : ""}</td>
            <td><input data-row-field="store_name" value="${escapeHtml(values.store_name)}" aria-label="Store name, ${escapeHtml(row.source_sheet)} row ${row.source_row}"></td>
            <td><input data-row-field="business_address" value="${escapeHtml(values.business_address)}" aria-label="Business address, ${escapeHtml(row.source_sheet)} row ${row.source_row}"></td>
            <td>${importAreaControl(index, values.area, values.area)}</td>
            <td>${importProvinceControl(index, values.area, values.province, values.province)}</td>
            <td><input data-row-field="manager" value="${escapeHtml(values.manager)}" aria-label="Manager, ${escapeHtml(row.source_sheet)} row ${row.source_row}"></td>
            <td><input data-row-field="contact" value="${escapeHtml(values.contact)}" aria-label="Contact, ${escapeHtml(row.source_sheet)} row ${row.source_row}"></td>
            <td><input data-row-field="sales_rep" value="${escapeHtml(values.sales_rep)}" aria-label="Sales representative, ${escapeHtml(row.source_sheet)} row ${row.source_row}"></td>
            <td>${importLookupControl("equipment_type", index, values.equipment_type, values.equipment_type)}</td>
            <td>${importLookupControl("product_line", index, values.product_line, values.product_line)}</td>
            <td>${importLookupControl("equipment_brand", index, values.equipment_brand, values.equipment_brand)}</td>
            <td>${importLookupControl("model", index, values.model, values.model)}</td>
            <td><input data-row-field="serial_number" value="${escapeHtml(values.serial_number)}" aria-label="Serial number, ${escapeHtml(row.source_sheet)} row ${row.source_row}"></td>
            <td><input type="date" data-row-field="delivery_date" value="${escapeHtml(values.delivery_date)}" aria-label="Delivery date, ${escapeHtml(row.source_sheet)} row ${row.source_row}">
              ${row.source_date ? `<small class="import-source-value">Unparsed source: ${escapeHtml(row.source_date)}</small><label class="import-date-blank"><input type="checkbox" data-row-date-blank> Leave blank</label>` : ""}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
      ${initialIncompleteCount ? `<p class="muted import-incomplete-note">${initialIncompleteCount.toLocaleString()} source row(s) have a missing Area or Province. Fill them in, or acknowledge that they should remain blank.</p>` : ""}
      <label class="inline-check import-location-ack"><input id="acknowledge-missing-locations" type="checkbox"> I reviewed the rows without a complete Area and Province and want to keep them blank.</label>
    </section>`;
  $("#import-location-questions").innerHTML = "";
  $("#import-date-warnings").innerHTML = review.date_warnings?.length
    ? `<p class="muted">Dates that could not be read are marked in the rows. Enter a date or select “Leave blank.”</p>`
    : "";
  $("#import-review-badge").textContent = `${result.record_count.toLocaleString()} rows`;
}

async function previewSelectedWorkbook() {
  const file = $("#import-file").files[0];
  if (!file) throw new Error("Choose a workbook first.");
  const form = new FormData();
  form.append("workbook", file);
  $$("#sheet-selection input:checked").forEach(input => form.append("sheets", input.value));
  const result = await api("/api/imports/preview", { method: "POST", body: form });
  if (result.sheets && !result.batch_id) {
    renderSheetChoices(result.sheets);
    if (!result.sheets.length) throw new Error("No importable inventory sheets were found.");
    return;
  }
  renderImportReview(result);
}

async function submitImportReview() {
  const invalidControl = $$("#import-rows [required]").find(control => !control.checkValidity());
  if (invalidControl) {
    invalidControl.reportValidity();
    throw new Error("Choose an approved dropdown value or request the source value as a new entry.");
  }
  const rows = $$("#import-rows [data-import-row]").map(row => {
    const values = {};
    const new_values = {};
    row.querySelectorAll("[data-row-field]").forEach(control => {
      values[control.dataset.rowField] = control.value;
    });
    row.querySelectorAll("[data-row-new-value]").forEach(control => {
      new_values[control.dataset.rowNewValue] = control.value;
    });
    return {
      source_sheet: row.dataset.sourceSheet,
      source_row: Number(row.dataset.sourceRow),
      values,
      new_values,
      leave_delivery_date_blank: Boolean(row.querySelector("[data-row-date-blank]")?.checked),
    };
  });
  const result = await api(`/api/imports/${state.importBatchId}/commit-rows`, {
    method: "POST",
    body: {
      rows,
      acknowledge_location_warnings: $("#acknowledge-missing-locations").checked,
    },
  });
  $("#import-review-panel").hidden = true;
  $("#import-error").textContent = "";
  state.importBatchId = null;
  if (result.status === "complete") {
    window.alert(`Import complete: ${result.imported} rows added or updated.`);
    await loadLookups();
    await Promise.all([loadStores(), loadSummary()]);
    showPage("inventory");
  } else {
    window.alert(`Import submitted. ${result.pending_values} proposed dropdown value(s) are waiting for admin approval; no rows are visible until approved.`);
    if (state.user.role === "admin") await loadImportApprovals();
  }
}

function bindEvents() {
  setSidebarCollapsed(state.sidebarCollapsed);
  $("#sidebar-toggle").addEventListener("click", () => {
    setSidebarCollapsed(!state.sidebarCollapsed);
  });
  $("#login-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("#login-error").textContent = "";
    try {
      const result = await api("/api/login", { method: "POST", body: formObject(event.currentTarget) });
      showApplication(result.user);
    } catch (error) {
      $("#login-error").textContent = error.message;
    }
  });

  $("#logout-button").addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST", body: {} });
      showLogin();
    } catch (error) { showError(error); }
  });

  $$(".nav-button").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));

  $("#add-service-button").addEventListener("click", () => openServiceDialog().catch(showError));
  $("#add-equipment-button").addEventListener("click", () => openEquipmentDialog().catch(showError));
  $("#equipment-search").addEventListener("input", debounce(() => {
    state.equipmentPage = 1;
    loadEquipment().catch(showError);
  }, 250));
  $("#equipment-previous").addEventListener("click", () => {
    state.equipmentPage = Math.max(1, state.equipmentPage - 1);
    loadEquipment().catch(showError);
  });
  $("#equipment-next").addEventListener("click", () => {
    state.equipmentPage += 1;
    loadEquipment().catch(showError);
  });
  $("#equipment-rows").addEventListener("click", event => {
    const button = event.target.closest("[data-open-equipment-history]");
    if (button) openServiceReport(Number(button.dataset.openEquipmentHistory)).catch(showError);
  });
  $("#store-search").addEventListener("input", debounce(() => loadStores().catch(showError), 250));
  $("#store-rows").addEventListener("click", event => {
    const button = event.target.closest("[data-open-store]");
    if (button) openStore(Number(button.dataset.openStore)).catch(showError);
  });
  $("#store-freezer-list").addEventListener("click", event => {
    const button = event.target.closest("[data-open-freezer]");
    if (button) openFreezerHistory(Number(button.dataset.openFreezer)).catch(showError);
  });
  $("#store-add-service").addEventListener("click", () => {
    openServiceDialog(state.selectedStore?.id || "").catch(showError);
  });
  $("#store-add-freezer").addEventListener("click", () => openAddFreezerDialog().catch(showError));
  $$("[data-close-store-dialog]").forEach(button => button.addEventListener("click", () => $("#store-dialog").close()));
  $$("[data-close-service-dialog]").forEach(button => button.addEventListener("click", () => $("#service-dialog").close()));
  $$("[data-close-equipment-dialog]").forEach(button => button.addEventListener("click", () => $("#equipment-dialog").close()));
  $$("[data-close-add-freezer]").forEach(button => button.addEventListener("click", () => $("#add-freezer-dialog").close()));
  $("#store-dialog").addEventListener("click", event => {
    if (event.target === $("#store-dialog")) $("#store-dialog").close();
  });
  $("#service-dialog").addEventListener("click", event => {
    if (event.target === $("#service-dialog")) $("#service-dialog").close();
  });
  $("#equipment-dialog").addEventListener("click", event => {
    if (event.target === $("#equipment-dialog")) $("#equipment-dialog").close();
  });
  $("#add-freezer-dialog").addEventListener("click", event => {
    if (event.target === $("#add-freezer-dialog")) $("#add-freezer-dialog").close();
  });
  $$(".dialog-tab").forEach(button => button.addEventListener("click", () => showStoreDialogView(button.dataset.storeTab)));
  $("#back-to-store").addEventListener("click", () => openStore(state.selectedStore.id).catch(showError));
  $("#store-info-form [name=area]").addEventListener("change", () => {
    updateProvinceSelect($("#store-info-form [name=province]"), $("#store-info-form [name=area]").value);
  });
  $("#add-service-form [name=new_store_area]").addEventListener("change", () => {
    updateProvinceSelect($("#add-service-form [name=new_store_province]"), $("#add-service-form [name=new_store_area]").value);
  });
  $("#add-service-form [name=store_id]").addEventListener("change", event => {
    populateFreezerOptions(event.currentTarget.value).catch(showError);
  });
  $("#new-store-freezer-toggle").addEventListener("change", event => {
    const isNewFreezer = event.currentTarget.checked;
    const form = $("#add-freezer-form");
    $("#store-new-freezer-fields").hidden = !isNewFreezer;
    $("#available-freezer-label").hidden = isNewFreezer;
    form.elements.asset_id.disabled = isNewFreezer;
    form.elements.asset_id.required = !isNewFreezer;
    form.elements.equipment_type.required = isNewFreezer;
  });
  $("#add-freezer-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("#add-freezer-error").textContent = "";
    const values = formObject(event.currentTarget);
    const isNewFreezer = $("#new-store-freezer-toggle").checked;
    const payload = isNewFreezer
      ? {
          new_freezer: {
            product_line: values.product_line,
            equipment_type: values.equipment_type,
            equipment_brand: values.equipment_brand,
            model: values.model,
            serial_number: values.serial_number,
            delivery_date: values.delivery_date,
            notes: values.notes,
          },
        }
      : { asset_id: Number(values.asset_id) };
    try {
      await api(`/api/stores/${state.selectedStore.id}/freezers`, {
        method: "POST",
        body: payload,
      });
      $("#add-freezer-dialog").close();
      await Promise.all([loadStores(), loadSummary(), loadEquipment()]);
      await openStore(state.selectedStore.id);
    } catch (error) {
      $("#add-freezer-error").textContent = error.message;
    }
  });
  $("#equipment-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("#equipment-error").textContent = "";
    const form = event.currentTarget;
    const values = formObject(form);
    try {
      await api("/api/assets", {
        method: "POST",
        body: { ...values, status: "unassigned" },
      });
      $("#equipment-dialog").close();
      form.reset();
      await loadEquipment();
    } catch (error) {
      $("#equipment-error").textContent = error.message;
    }
  });
  $("#new-store-toggle").addEventListener("change", event => {
    const isNewStore = event.currentTarget.checked;
    $("#new-store-fields").hidden = !isNewStore;
    $("#add-service-form").elements.store_id.disabled = isNewStore;
    $("#add-service-form").elements.store_id.required = !isNewStore;
    $("#add-service-form").elements.new_store_name.required = isNewStore;
    $("#add-service-form").elements.new_store_address.required = isNewStore;
    if (isNewStore) {
      $("#add-service-form").elements.store_id.value = "";
      $("#new-freezer-toggle").checked = true;
      $("#new-freezer-toggle").disabled = true;
      $("#existing-freezer-label").hidden = true;
      $("#add-service-form").elements.asset_id.required = false;
      $("#add-service-form").elements.equipment_type.required = true;
      $("#new-freezer-fields").hidden = false;
    } else {
      $("#new-freezer-toggle").disabled = false;
      $("#new-freezer-toggle").checked = false;
      $("#existing-freezer-label").hidden = false;
      $("#new-freezer-fields").hidden = true;
      $("#add-service-form").elements.new_store_name.required = false;
      $("#add-service-form").elements.new_store_address.required = false;
      $("#add-service-form").elements.asset_id.required = !$("#new-freezer-toggle").checked;
      $("#add-service-form").elements.equipment_type.required = $("#new-freezer-toggle").checked;
    }
  });
  $("#new-freezer-toggle").addEventListener("change", event => {
    const isNewFreezer = event.currentTarget.checked;
    $("#new-freezer-fields").hidden = !isNewFreezer;
    $("#existing-freezer-label").hidden = isNewFreezer;
    $("#add-service-form").elements.asset_id.required = !isNewFreezer;
    $("#add-service-form").elements.equipment_type.required = isNewFreezer;
  });
  $("#add-service-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("#add-service-error").textContent = "";
    const form = event.currentTarget;
    const values = formObject(form);
    const serviceId = values.service_id;
    const isNewStore = $("#new-store-toggle").checked;
    const isNewFreezer = $("#new-freezer-toggle").checked;
    const payload = {
      service_date: values.service_date,
      technician: values.technician,
      repairs: values.repairs,
      parts: values.parts,
      notes: values.notes,
    };
    if (isNewStore) {
      payload.new_store = {
        store_name: values.new_store_name,
        business_address: values.new_store_address,
        area: values.new_store_area,
        province: values.new_store_province,
        manager: values.new_store_manager,
        contact: values.new_store_contact,
        sales_rep: values.new_store_sales_rep,
        notes: values.new_store_notes,
      };
    } else {
      payload.store_id = Number(values.store_id);
    }
    if (isNewFreezer) {
      payload.new_freezer = {
        product_line: values.product_line,
        equipment_type: values.equipment_type,
        equipment_brand: values.equipment_brand,
        model: values.model,
        serial_number: values.serial_number,
      };
    } else if (!serviceId) {
      payload.asset_id = Number(values.asset_id);
    }
    try {
      const result = await api(
        serviceId ? `/api/services/${serviceId}` : "/api/services",
        { method: serviceId ? "PATCH" : "POST", body: payload },
      );
      const currentStoreId = serviceId ? state.selectedStore?.id : result.store_id;
      $("#service-dialog").close();
      await Promise.all([loadStores(), loadSummary()]);
      if (state.selectedStore && currentStoreId === state.selectedStore.id) {
        await openStore(currentStoreId);
      }
      if (serviceId) {
        await openFreezerHistory(state.selectedFreezerId);
      }
    } catch (error) {
      $("#add-service-error").textContent = error.message;
    }
  });
  $("#store-info-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("#store-info-error").textContent = "";
    try {
      await api(`/api/stores/${state.selectedStore.id}`, {
        method: "PATCH",
        body: formObject(event.currentTarget),
      });
      await Promise.all([loadLookups(), loadStores(), loadSummary()]);
      await openStore(state.selectedStore.id);
      showStoreDialogView("info");
    } catch (error) {
      $("#store-info-error").textContent = error.message;
    }
  });
  $("#move-freezer-button").addEventListener("click", () => {
    $("#move-freezer-form").hidden = !$("#move-freezer-form").hidden;
  });
  $("#move-freezer-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("#move-freezer-error").textContent = "";
    try {
      const values = formObject(event.currentTarget);
      const result = await api(`/api/assets/${state.selectedFreezerId}/move`, {
        method: "POST",
        body: { store_id: Number(values.store_id), effective_date: values.effective_date },
      });
      await Promise.all([loadStores(), loadSummary()]);
      await openStore(state.selectedStore.id);
      window.alert(`Freezer moved. Its new placement is record ${result.id}; service history starts fresh at the destination.`);
    } catch (error) {
      $("#move-freezer-error").textContent = error.message;
    }
  });
  $("#freezer-service-history").addEventListener("click", event => {
    const button = event.target.closest("[data-edit-service]");
    if (button) editService(Number(button.dataset.editService), Number(button.dataset.assetId)).catch(showError);
  });

  $("#report-rows").addEventListener("click", event => {
    const row = event.target.closest("[data-open-service-report]");
    if (row) openServiceReport(Number(row.dataset.openServiceReport)).catch(showError);
  });
  $("#report-rows").addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-open-service-report]");
    if (!row) return;
    event.preventDefault();
    openServiceReport(Number(row.dataset.openServiceReport)).catch(showError);
  });
  $$("[data-close-service-report]").forEach(button => button.addEventListener("click", () => $("#service-report-dialog").close()));
  $("#service-report-dialog").addEventListener("click", event => {
    if (event.target === $("#service-report-dialog")) $("#service-report-dialog").close();
  });

  ["report-store", "report-technician", "report-product_line", "report-equipment_brand", "report-model"].forEach(selector => {
    $(`#${selector}`).addEventListener("change", () => loadServiceReport().catch(showError));
  });
  $("#report-serial-number").addEventListener("input", debounce(() => loadServiceReport().catch(showError), 250));

  $("#user-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/admin/users", { method: "POST", body: formObject(form) });
      form.reset();
      await loadAdminUsers();
    } catch (error) { showError(error); }
  });

  $("#lookup-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = formObject(form);
    try {
      await api("/api/admin/lookups", { method: "POST", body: payload });
      form.elements.value.value = "";
      form.elements.parent_value.value = "";
      await loadLookups();
      await loadAdminLookups();
      await loadVariants();
    } catch (error) { showError(error); }
  });

  $("#import-file").addEventListener("change", async () => {
    $("#import-error").textContent = "";
    $("#sheet-selection").hidden = true;
    $("#import-review-panel").hidden = true;
    state.importBatchId = null;
    if (!$("#import-file").files[0]) {
      $("#preview-import-button").disabled = true;
      return;
    }
    try {
      await previewSelectedWorkbook();
    } catch (error) {
      $("#import-error").textContent = error.message;
    }
  });

  $("#import-upload-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("#import-error").textContent = "";
    try {
      await previewSelectedWorkbook();
    } catch (error) {
      $("#import-error").textContent = error.message;
    }
  });

  $("#import-unknown-values").addEventListener("change", event => {
    const row = event.target.closest("[data-import-row]");
    if (!row) return;
    const select = event.target.closest("[data-row-field]");
    if (select?.dataset.rowField === "area") {
      const province = row.querySelector('[data-row-field="province"]');
      const previous = province.value;
      const options = lookupValues("province").filter(item => item.parent_value === select.value);
      province.replaceChildren(new Option(select.value ? "Choose province" : "Choose area first", ""));
      options.forEach(item => province.add(new Option(item.value, item.value)));
      province.disabled = !select.value;
      if (options.some(item => item.value === previous)) province.value = previous;
    }
    if (select && ["product_line", "equipment_type", "equipment_brand", "model"].includes(select.dataset.rowField)) {
      const field = select.dataset.rowField;
      const custom = row.querySelector(`[data-row-new-value="${field}"]`);
      const isNew = select.value === "__new__";
      custom.hidden = !isNew;
      custom.required = isNew;
      if (isNew && !custom.value) custom.value = "";
    }
    const dateBlank = event.target.closest("[data-row-date-blank]");
    if (dateBlank) {
      const date = row.querySelector('[data-row-field="delivery_date"]');
      date.disabled = dateBlank.checked;
      if (dateBlank.checked) date.value = "";
    }
  });
  $("#commit-import-button").addEventListener("click", async () => {
    $("#import-commit-error").textContent = "";
    try {
      await submitImportReview();
    } catch (error) {
      $("#import-commit-error").textContent = error.message;
    }
  });
  $("#cancel-import-review").addEventListener("click", () => {
    $("#import-review-panel").hidden = true;
    state.importBatchId = null;
  });

  $("#lookup-field").addEventListener("change", renderLookupAdmin);
  $("#user-list").addEventListener("change", async event => {
    const select = event.target.closest("[data-user-role]");
    if (!select) return;
    try {
      await api(`/api/admin/users/${select.dataset.userRole}`, { method: "PATCH", body: { role: select.value } });
      await loadAdminUsers();
      await loadAudit();
    } catch (error) { showError(error); await loadAdminUsers(); }
  });
  $("#user-list").addEventListener("click", async event => {
    const toggle = event.target.closest("[data-toggle-user]");
    const reset = event.target.closest("[data-reset-user]");
    try {
      if (toggle) {
        const active = toggle.dataset.active !== "1";
        await api(`/api/admin/users/${toggle.dataset.toggleUser}`, { method: "PATCH", body: { active } });
        await loadAdminUsers();
        await loadAudit();
      }
      if (reset) {
        const password = window.prompt("Enter a new password (at least 12 characters):");
        if (password === null) return;
        await api(`/api/admin/users/${reset.dataset.resetUser}`, { method: "PATCH", body: { password } });
        await loadAudit();
        window.alert("Password reset.");
      }
    } catch (error) { showError(error); }
  });

  $("#lookup-list").addEventListener("click", async event => {
    const save = event.target.closest("[data-save-lookup]");
    const button = event.target.closest("[data-toggle-lookup]");
    if (!button && !save) return;
    try {
      if (save) {
        const row = save.closest(".admin-list-item");
        const value = $(`[data-lookup-value="${save.dataset.saveLookup}"]`, row).value;
        const parent = $(`[data-lookup-parent="${save.dataset.saveLookup}"]`, row);
        await api(`/api/admin/lookups/${save.dataset.saveLookup}`, {
          method: "PATCH",
          body: parent ? { value, parent_value: parent.value } : { value },
        });
      } else {
        const active = button.dataset.active !== "1";
        await api(`/api/admin/lookups/${button.dataset.toggleLookup}`, { method: "PATCH", body: { active } });
      }
      await Promise.all([loadAdminLookups(), loadLookups(), loadVariants(), loadAudit(), loadStores()]);
    } catch (error) { showError(error); }
  });
  $("#backup-schedule-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/admin/backups/schedule", {
        method: "PATCH",
        body: formObject(form),
      });
      await Promise.all([loadBackups(), loadAudit()]);
    } catch (error) { showError(error); }
  });
  $("#backup-now").addEventListener("click", async () => {
    try {
      const result = await api("/api/admin/backups", { method: "POST", body: {} });
      await Promise.all([loadBackups(), loadAudit()]);
      window.location.assign(`/api/admin/backups/${encodeURIComponent(result.filename)}`);
    } catch (error) { showError(error); }
  });
  $("#backup-list").addEventListener("click", event => {
    const button = event.target.closest("[data-download-backup]");
    if (button) {
      window.location.assign(`/api/admin/backups/${encodeURIComponent(button.dataset.downloadBackup)}`);
    }
  });
  $("#reset-application-data").addEventListener("click", async () => {
    if (!window.confirm("This will delete all app records and dropdown values. A backup will be created first. Continue?")) return;
    if (window.prompt('Type RESET to confirm clearing all app data:') !== "RESET") return;
    try {
      const result = await api("/api/admin/reset", {
        method: "POST",
        body: { confirmation: "RESET" },
      });
      window.alert(`App data was reset. A pre-reset backup was saved as ${result.backup}.`);
      await loadWorkspace();
    } catch (error) { showError(error); }
  });
  $("#import-approval-list").addEventListener("click", async event => {
    const approve = event.target.closest("[data-approve-import-value]");
    const reject = event.target.closest("[data-reject-import-value]");
    const target = approve || reject;
    if (!target) return;
    try {
      const endpoint = approve
        ? `/api/admin/import-requests/${approve.dataset.approveImportValue}/approve`
        : `/api/admin/import-requests/${reject.dataset.rejectImportValue}/reject`;
      await api(endpoint, { method: "POST", body: {} });
      await Promise.all([loadImportApprovals(), loadAdminLookups(), loadLookups(), loadAudit(), loadStores(), loadSummary()]);
    } catch (error) { showError(error); }
  });
  $("#refresh-variants").addEventListener("click", () => loadVariants().catch(showError));
  $("#variant-list").addEventListener("click", async event => {
    const button = event.target.closest("[data-merge-source]");
    if (!button) return;
    const accepted = window.confirm("Merge the selected variant into the canonical value? Matching equipment/service records will be changed.");
    if (!accepted) return;
    try {
      await api("/api/admin/variants/merge", {
        method: "POST",
        body: { source_id: Number(button.dataset.mergeSource), target_id: Number(button.dataset.mergeTarget) },
      });
      await Promise.all([loadAdminLookups(), loadLookups(), loadVariants(), loadAudit(), loadStores(), loadSummary()]);
    } catch (error) { showError(error); }
  });
}

function debounce(callback, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), delay);
  };
}

async function initialize() {
  bindEvents();
  try {
    const result = await api("/api/me");
    if (result.user) showApplication(result.user);
    else showLogin();
  } catch (error) {
    showLogin(error.message);
  }
}

initialize();
