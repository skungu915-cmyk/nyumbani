import { api, ApiError } from './api.js';
import { qs, escapeHtml, fmtKes, fmtDate } from './utils.js';
import { toast } from './toast.js';
import { closeModal } from './modal.js';
import { state } from './state.js';

let myProperties = [];

export function showLV(view) {
  document.querySelectorAll('.ll-nav').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  document.querySelectorAll('.lv').forEach((v) => v.classList.toggle('on', v.id === `lv-${view}`));
  const loaders = {
    'll-dashboard': loadDashboard,
    'll-units': loadUnits,
    'll-tenants': loadTenants,
    'll-revenue': loadRevenue,
    'll-maintenance': loadMaintenance,
    'll-notices': loadNotices,
  };
  loaders[view]?.();
}

export async function loadLandlordHome() {
  await loadMyProperties();
  showLV('ll-dashboard');
}

async function loadMyProperties() {
  try {
    // Scoped to this landlord's own ownerId — the backend enforces that only the owner or an
    // admin may request a non-owner's non-public-status listings this way (see
    // property.service.listProperties), but we still pass it explicitly rather than relying on
    // the public default, which would otherwise return every ACTIVE listing on the platform.
    const res = await api.get(`/api/properties?ownerId=${state.user.id}&pageSize=50`);
    myProperties = res.items;
    populatePropertySelects();
  } catch {
    myProperties = [];
  }
}

function populatePropertySelects() {
  const opts = myProperties.map((p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`).join('');
  const a = qs('tenantPropertySelect');
  const b = qs('maintPropertySelect');
  if (a) a.innerHTML = opts || '<option value="">No properties yet</option>';
  if (b) b.innerHTML = opts || '<option value="">No properties yet</option>';
}

async function loadDashboard() {
  try {
    const d = await api.get('/api/landlord/dashboard');
    qs('llKpis').innerHTML = `
      <div class="ll-kpi lk-teal"><div class="ll-kpi-val">${fmtKes(d.revenueThisMonth)}</div><div class="ll-kpi-lbl">Revenue This Month</div></div>
      <div class="ll-kpi lk-gold"><div class="ll-kpi-val">${d.totalUnits}</div><div class="ll-kpi-lbl">Total Units</div><div class="ll-kpi-chg" style="color:var(--dim)">${d.occupied} occupied · ${d.vacant} vacant</div></div>
      <div class="ll-kpi lk-green"><div class="ll-kpi-val">${d.occupancyRate}%</div><div class="ll-kpi-lbl">Occupancy Rate</div></div>
      <div class="ll-kpi lk-red"><div class="ll-kpi-val">${fmtKes(d.arrears)}</div><div class="ll-kpi-lbl">Outstanding Arrears</div><div class="ll-kpi-chg kdn">${d.overdueCount} tenants overdue</div></div>
    `;
    const max = Math.max(1, ...d.monthlyRevenue.map((m) => m.totalKes));
    qs('llChart').innerHTML = d.monthlyRevenue
      .map((m) => `<div class="cbar cb-t" style="height:${Math.max(4, (m.totalKes / max) * 100)}%" title="${escapeHtml(m.label)}: ${fmtKes(m.totalKes)}"></div>`)
      .join('');
  } catch {
    toast('❌', 'Error', 'Could not load dashboard', true);
  }
}

async function loadUnits() {
  const tbl = qs('llUnitsTbl');
  tbl.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
  await loadMyProperties();
  if (myProperties.length === 0) {
    tbl.innerHTML = '<tr><td colspan="6">No properties yet — add your first unit.</td></tr>';
    return;
  }
  tbl.innerHTML = myProperties
    .map(
      (p) => `<tr>
      <td style="font-weight:700;color:var(--ink)">${escapeHtml(p.title)}</td>
      <td>${escapeHtml(p.type)}</td>
      <td>${escapeHtml(p.area)}</td>
      <td>${fmtKes(p.rentAmount)}</td>
      <td><span class="${p.status === 'ACTIVE' ? 'us-ok' : p.status === 'RENTED' ? 'us-ok' : 'us-vacant'}">${escapeHtml(p.status)}</span></td>
      <td><button class="ll-btn ll-btn-v" data-action="viewProperty" data-id="${p.id}">View</button></td>
    </tr>`
    )
    .join('');
}

async function loadTenants() {
  const tbl = qs('llTenantsTbl');
  tbl.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
  try {
    const res = await api.get('/api/landlord/tenants');
    if (res.items.length === 0) return void (tbl.innerHTML = '<tr><td colspan="6">No tenants yet.</td></tr>');
    tbl.innerHTML = res.items
      .map(
        (t) => `<tr>
        <td style="font-weight:700;color:var(--ink)">${escapeHtml(t.tenantName)}</td>
        <td>${escapeHtml(t.property?.title || '—')}</td>
        <td>${escapeHtml(t.tenantPhone)}</td>
        <td>${fmtKes(t.rentAmount)}</td>
        <td><span class="${t.status === 'active' ? 'us-ok' : t.status === 'overdue' ? 'us-maint' : 'us-vacant'}">${escapeHtml(t.status)}</span></td>
        <td>
          <button class="ll-btn ll-btn-v" data-action="logRentPayment" data-id="${t.id}">Log Payment</button>
          <button class="ll-btn ll-btn-e" data-action="markOverdue" data-id="${t.id}">Mark Overdue</button>
        </td>
      </tr>`
      )
      .join('');
  } catch {
    tbl.innerHTML = '<tr><td colspan="6">Could not load tenants.</td></tr>';
  }
}

async function loadRevenue() {
  try {
    const r = await api.get('/api/landlord/revenue');
    qs('llRevKpis').innerHTML = `
      <div class="ll-kpi lk-teal"><div class="ll-kpi-val">${fmtKes(r.allTime)}</div><div class="ll-kpi-lbl">All-Time (logged)</div></div>
      <div class="ll-kpi lk-gold"><div class="ll-kpi-val">${fmtKes(r.thisMonth)}</div><div class="ll-kpi-lbl">This Month</div></div>
      <div class="ll-kpi lk-blue"><div class="ll-kpi-val">${fmtKes(r.platformFee)}</div><div class="ll-kpi-lbl">Platform Fee (${r.platformFeePercent}%)</div></div>
      <div class="ll-kpi lk-green"><div class="ll-kpi-val">${fmtKes(r.net)}</div><div class="ll-kpi-lbl">Net This Month</div></div>
    `;
  } catch {
    toast('❌', 'Error', 'Could not load revenue', true);
  }
}

async function loadMaintenance() {
  const tbl = qs('llMaintTbl');
  tbl.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
  try {
    const res = await api.get('/api/landlord/maintenance');
    if (res.items.length === 0) return void (tbl.innerHTML = '<tr><td colspan="6">No maintenance requests.</td></tr>');
    tbl.innerHTML = res.items
      .map(
        (m) => `<tr>
        <td>${fmtDate(m.createdAt)}</td>
        <td style="font-weight:700;color:var(--ink)">${escapeHtml(m.property?.title || '—')}</td>
        <td>${escapeHtml(m.issue)}</td>
        <td>${escapeHtml(m.priority)}</td>
        <td><span class="${m.status === 'RESOLVED' ? 'us-ok' : 'us-vacant'}">${escapeHtml(m.status)}</span></td>
        <td>${m.status !== 'RESOLVED' ? `<button class="ll-btn ll-btn-v" data-action="resolveMaint" data-id="${m.id}">Resolve</button>` : ''}</td>
      </tr>`
      )
      .join('');
  } catch {
    tbl.innerHTML = '<tr><td colspan="6">Could not load requests.</td></tr>';
  }
}

async function loadNotices() {
  const tbl = qs('llNoticesTbl');
  tbl.innerHTML = '<tr><td colspan="4">Loading…</td></tr>';
  try {
    const res = await api.get('/api/landlord/notices');
    if (res.items.length === 0) return void (tbl.innerHTML = '<tr><td colspan="4">No notices sent yet.</td></tr>');
    tbl.innerHTML = res.items
      .map(
        (n) => `<tr><td>${fmtDate(n.createdAt)}</td><td style="font-weight:700;color:var(--ink)">${escapeHtml(n.recipient)}</td><td>${escapeHtml(n.subject)}</td><td>${escapeHtml(n.channel)}</td></tr>`
      )
      .join('');
  } catch {
    tbl.innerHTML = '<tr><td colspan="4">Could not load notices.</td></tr>';
  }
}

export async function handleAddTenantSubmit(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await api.post('/api/landlord/tenants', { ...data, rentAmount: Number(data.rentAmount) });
    closeModal('addTenantOvl');
    form.reset();
    toast('✅', 'Tenant added', 'Property marked as rented.');
    loadTenants();
    loadDashboard();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not add tenant', true);
  }
}

export async function logRentPayment(tenancyId) {
  const amount = prompt('Amount received (KES):');
  if (!amount || Number.isNaN(Number(amount))) return;
  try {
    await api.post(`/api/landlord/tenants/${tenancyId}/payments`, { amountKes: Number(amount) });
    toast('✅', 'Payment logged', 'Rent payment recorded.');
    loadTenants();
    loadDashboard();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not log payment', true);
  }
}

export async function markOverdue(tenancyId) {
  try {
    await api.patch(`/api/landlord/tenants/${tenancyId}/status`, { status: 'overdue' });
    toast('⚠️', 'Marked overdue', 'Tenant flagged as overdue.');
    loadTenants();
    loadDashboard();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not update status', true);
  }
}

export async function handleMaintSubmit(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await api.post('/api/landlord/maintenance', data);
    closeModal('maintOvl');
    form.reset();
    toast('✅', 'Request logged', 'Maintenance request created.');
    loadMaintenance();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not create request', true);
  }
}

export async function resolveMaint(id) {
  try {
    await api.patch(`/api/landlord/maintenance/${id}/resolve`);
    toast('✅', 'Resolved', 'Marked as resolved.');
    loadMaintenance();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not resolve request', true);
  }
}

export async function handleNoticeSubmit(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await api.post('/api/landlord/notices', data);
    closeModal('noticeOvl');
    form.reset();
    toast('✅', 'Notice sent', 'Recorded in your notices log.');
    loadNotices();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not send notice', true);
  }
}
