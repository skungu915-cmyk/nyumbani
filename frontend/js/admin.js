import { api, ApiError } from './api.js';
import { qs, escapeHtml, fmtKes, fmtDate, propertyTypeLabel, debounce } from './utils.js';
import { toast } from './toast.js';

let photoFiles = [];

export function showAV(view) {
  document.querySelectorAll('.ad-nav').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  document.querySelectorAll('.av').forEach((v) => v.classList.toggle('on', v.id === `av-${view}`));
  const loaders = {
    overview: loadOverview,
    listings: () => loadListings(),
    tx: () => loadTx(),
    landlords: loadLandlords,
    users: () => loadUsers(),
    enquiries: loadEnquiries,
    reviews: loadPendingReviews,
    mpesa: loadMpesaStatus,
    settings: loadSettings,
  };
  loaders[view]?.();
}

async function loadOverview() {
  try {
    const d = await api.get('/api/admin/overview');
    qs('adKpis').innerHTML = `
      <div class="kpi kpi-t"><div class="kpi-val kv-t">${fmtKes(d.monthRevenue)}</div><div class="kpi-lbl">Month Revenue</div></div>
      <div class="kpi kpi-g"><div class="kpi-val kv-g">${d.paymentCount}</div><div class="kpi-lbl">Viewing Payments</div></div>
      <div class="kpi kpi-b"><div class="kpi-val kv-b">${d.activeListings}</div><div class="kpi-lbl">Active Listings</div><div class="kpi-chg" style="color:rgba(255,255,255,.3)">${d.pendingListings} pending review</div></div>
      <div class="kpi kpi-gr"><div class="kpi-val kv-gr">${d.paymentSuccessRate}%</div><div class="kpi-lbl">Payment Success</div></div>
    `;
    qs('adTxRecent').innerHTML = d.recentTransactions
      .map(
        (t) => `<tr><td class="td-t">${escapeHtml(t.ref)}</td><td class="td-s">${escapeHtml(t.property)}</td><td class="td-dim">${escapeHtml(t.phone)}</td><td class="td-g">${fmtKes(t.amountKes)}</td><td><span class="sbg ${statusClass(t.status)}">${escapeHtml(t.status)}</span></td><td class="td-dim">${fmtDate(t.createdAt)}</td></tr>`
      )
      .join('');
  } catch {
    toast('❌', 'Error', 'Could not load overview', true);
  }
}

function statusClass(status) {
  return { SUCCESS: 's-ok', PENDING: 's-pend', FAILED: 's-off', CANCELLED: 's-off' }[status] || 's-blue';
}

async function loadListings(q = '') {
  const tbl = qs('adListTbl');
  tbl.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
  try {
    const params = new URLSearchParams({ pageSize: '50' });
    if (q) params.set('q', q);
    const res = await api.get(`/api/admin/listings?${params.toString()}`);
    if (res.items.length === 0) return void (tbl.innerHTML = '<tr><td colspan="6">No listings.</td></tr>');
    tbl.innerHTML = res.items
      .map(
        (p) => `<tr>
        <td class="td-s">${escapeHtml(p.title)}</td>
        <td class="td-dim">${escapeHtml(propertyTypeLabel(p.type))}</td>
        <td class="td-g">${fmtKes(p.rentAmount)}</td>
        <td class="td-dim">${escapeHtml(p.area)}</td>
        <td><span class="sbg ${p.status === 'ACTIVE' ? 's-ok' : p.status === 'PENDING_REVIEW' ? 's-pend' : 's-off'}">${escapeHtml(p.status)}</span></td>
        <td>
          ${p.status === 'PENDING_REVIEW' ? `<button class="ab ab-ok" data-action="approveListing" data-id="${p.id}">Approve</button>` : ''}
          ${p.status !== 'SUSPENDED' ? `<button class="ab ab-e" data-action="suspendListing" data-id="${p.id}">Suspend</button>` : `<button class="ab ab-ok" data-action="activateListing" data-id="${p.id}">Reactivate</button>`}
          <button class="ab ab-d" data-action="deleteListing" data-id="${p.id}">Delete</button>
        </td>
      </tr>`
      )
      .join('');
  } catch {
    tbl.innerHTML = '<tr><td colspan="6">Could not load listings.</td></tr>';
  }
}
export const searchListings = debounce((q) => loadListings(q), 300);

export async function approveListing(id) {
  await setListingStatus(id, 'ACTIVE');
}
export async function suspendListing(id) {
  await setListingStatus(id, 'SUSPENDED');
}
export async function activateListing(id) {
  await setListingStatus(id, 'ACTIVE');
}
async function setListingStatus(id, status) {
  try {
    await api.patch(`/api/admin/listings/${id}/status`, { status });
    toast('✅', 'Updated', `Listing set to ${status}`);
    loadListings();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not update listing', true);
  }
}
export async function deleteListing(id) {
  if (!confirm('Delete this listing permanently? This cannot be undone.')) return;
  try {
    await api.del(`/api/admin/listings/${id}`);
    toast('🗑️', 'Deleted', 'Listing removed.');
    loadListings();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not delete listing', true);
  }
}

export function addAdminPhotos(fileList) {
  photoFiles = photoFiles.concat(Array.from(fileList)).slice(0, 10);
  renderAdminPhotoPreview();
}
function renderAdminPhotoPreview() {
  const box = qs('adPhotoPreview');
  box.innerHTML = photoFiles
    .map((f, i) => `<div class="photo-thumb"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="photo-del" data-action="removeAdminPhoto" data-idx="${i}">✕</button></div>`)
    .join('');
}
export function removeAdminPhoto(idx) {
  photoFiles.splice(Number(idx), 1);
  renderAdminPhotoPreview();
}

export async function handleAdminAddListing(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const amenities = Array.from(form.querySelectorAll('#adAmenities input:checked')).map((c) => c.value);
  const payload = {
    ...data,
    bedrooms: Number(data.bedrooms) || 0,
    bathrooms: Number(data.bathrooms) || 1,
    rentAmount: Number(data.rentAmount),
    amenities,
  };
  try {
    const res = await api.post('/api/properties', payload);
    if (photoFiles.length) {
      const fd = new FormData();
      photoFiles.forEach((f) => fd.append('photos', f));
      await api.postForm(`/api/properties/${res.property.id}/photos`, fd);
    }
    // Admin-created listings default to ACTIVE only if auto-approve is on; ensure visibility.
    await api.patch(`/api/admin/listings/${res.property.id}/status`, { status: 'ACTIVE' }).catch(() => {});
    toast('✅', 'Published', 'Listing is now live.');
    form.reset();
    photoFiles = [];
    renderAdminPhotoPreview();
    showAV('listings');
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not create listing', true);
  }
}

async function loadTx(q = '') {
  const tbl = qs('adTxTbl');
  tbl.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
  try {
    const params = new URLSearchParams({ pageSize: '50' });
    if (q) params.set('q', q);
    const res = await api.get(`/api/admin/transactions?${params.toString()}`);
    if (res.items.length === 0) return void (tbl.innerHTML = '<tr><td colspan="8">No transactions.</td></tr>');
    tbl.innerHTML = res.items
      .map(
        (t) => `<tr>
        <td class="td-t">${escapeHtml(t.ref)}</td><td class="td-dim">${escapeHtml(t.phone)}</td><td class="td-s">${escapeHtml(t.property)}</td>
        <td class="td-g">${fmtKes(t.amountKes)}</td><td class="td-dim">${escapeHtml(t.mpesaReceiptNumber || '—')}</td>
        <td><span class="sbg ${statusClass(t.status)}">${escapeHtml(t.status)}</span></td><td class="td-dim">${fmtDate(t.createdAt)}</td>
        <td>${t.status === 'PENDING' ? `<button class="ab ab-ok" data-action="markTxPaid" data-id="${t.id}">Mark Paid</button>` : ''}</td>
      </tr>`
      )
      .join('');
  } catch {
    tbl.innerHTML = '<tr><td colspan="8">Could not load transactions.</td></tr>';
  }
}
export const searchTx = debounce((q) => loadTx(q), 300);

export async function markTxPaid(id) {
  const reason = prompt('Reason for manually confirming this payment (e.g. "Confirmed via Safaricom statement, callback never arrived"):');
  if (!reason || reason.trim().length < 5) return toast('❌', 'Reason required', 'Please provide a reason of at least 5 characters', true);
  try {
    await api.post(`/api/admin/transactions/${id}/mark-paid`, { reason: reason.trim() });
    toast('✅', 'Confirmed', 'Payment marked as paid and property unlocked for the payer.');
    loadTx();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not confirm payment', true);
  }
}

async function loadLandlords() {
  const tbl = qs('adLandlordsTbl');
  tbl.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
  try {
    const res = await api.get('/api/admin/landlords');
    if (res.items.length === 0) return void (tbl.innerHTML = '<tr><td colspan="6">No landlords yet.</td></tr>');
    tbl.innerHTML = res.items
      .map(
        (l) => `<tr><td class="td-s">${escapeHtml(l.name)}</td><td class="td-dim">${escapeHtml(l.phone)}</td><td class="td-t">${l.units}</td><td class="td-g">${fmtKes(l.revenue)}</td><td class="td-dim">${fmtKes(l.platformFeeDue)}</td><td><span class="sbg ${l.status === 'active' ? 's-ok' : 's-off'}">${escapeHtml(l.status).toUpperCase()}</span></td></tr>`
      )
      .join('');
  } catch {
    tbl.innerHTML = '<tr><td colspan="6">Could not load landlords.</td></tr>';
  }
}

async function loadUsers(q = '') {
  const tbl = qs('adUsersTbl');
  tbl.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
  try {
    const params = new URLSearchParams({ pageSize: '50' });
    if (q) params.set('q', q);
    const res = await api.get(`/api/admin/users?${params.toString()}`);
    tbl.innerHTML = res.items
      .map(
        (u) => `<tr>
        <td class="td-s">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</td>
        <td class="td-dim">${escapeHtml(u.email)}</td>
        <td class="td-t">${escapeHtml(u.role)}</td>
        <td><span class="sbg ${u.status === 'suspended' ? 's-off' : 's-ok'}">${escapeHtml(u.status).toUpperCase()}</span></td>
        <td>${u.status === 'suspended' ? `<button class="ab ab-ok" data-action="activateUser" data-id="${u.id}">Reactivate</button>` : `<button class="ab ab-d" data-action="suspendUser" data-id="${u.id}">Suspend</button>`}</td>
      </tr>`
      )
      .join('');
  } catch {
    tbl.innerHTML = '<tr><td colspan="5">Could not load users.</td></tr>';
  }
}
export const searchUsers = debounce((q) => loadUsers(q), 300);

export async function suspendUser(id) {
  if (!confirm('Suspend this account?')) return;
  await setUserStatus(id, 'suspended');
}
export async function activateUser(id) {
  await setUserStatus(id, 'active');
}
async function setUserStatus(id, status) {
  try {
    await api.patch(`/api/admin/users/${id}/status`, { status });
    toast('✅', 'Updated', `Account ${status}`);
    loadUsers();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not update user', true);
  }
}

async function loadEnquiries() {
  const tbl = qs('adEnqTbl');
  tbl.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
  try {
    const res = await api.get('/api/admin/enquiries');
    if (res.items.length === 0) return void (tbl.innerHTML = '<tr><td colspan="5">No enquiries.</td></tr>');
    tbl.innerHTML = res.items
      .map(
        (e) => `<tr><td class="td-s">${escapeHtml(e.name)}</td><td class="td-dim">${escapeHtml(e.subject)}</td><td class="td-dim">${fmtDate(e.createdAt)}</td><td><span class="sbg ${e.status === 'UNREAD' ? 's-pend' : 's-ok'}">${escapeHtml(e.status)}</span></td><td>${e.status === 'UNREAD' ? `<button class="ab ab-ok" data-action="markEnquiryReplied" data-id="${e.id}">Mark Replied</button>` : ''}</td></tr>`
      )
      .join('');
  } catch {
    tbl.innerHTML = '<tr><td colspan="5">Could not load enquiries.</td></tr>';
  }
}
export async function markEnquiryReplied(id) {
  try {
    await api.patch(`/api/admin/enquiries/${id}`, { status: 'REPLIED' });
    loadEnquiries();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not update enquiry', true);
  }
}

async function loadPendingReviews() {
  const tbl = qs('adReviewsTbl');
  tbl.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
  try {
    const res = await api.get('/api/admin/reviews/pending');
    if (res.items.length === 0) return void (tbl.innerHTML = '<tr><td colspan="5">No pending reviews.</td></tr>');
    tbl.innerHTML = res.items
      .map(
        (r) => `<tr>
        <td class="td-s">${escapeHtml(r.authorName)}</td><td class="td-dim">${escapeHtml(r.propertyTitle)}</td>
        <td class="td-g">${'★'.repeat(r.stars)}</td><td class="td-dim" style="max-width:280px">${escapeHtml(r.text)}</td>
        <td><button class="ab ab-ok" data-action="approveReview" data-id="${r.id}">Approve</button><button class="ab ab-d" data-action="rejectReview" data-id="${r.id}">Reject</button></td>
      </tr>`
      )
      .join('');
  } catch {
    tbl.innerHTML = '<tr><td colspan="5">Could not load reviews.</td></tr>';
  }
}
export async function approveReview(id) {
  await moderateReview(id, 'APPROVED');
}
export async function rejectReview(id) {
  await moderateReview(id, 'REJECTED');
}
async function moderateReview(id, status) {
  try {
    await api.patch(`/api/admin/reviews/${id}`, { status });
    toast('✅', 'Updated', `Review ${status.toLowerCase()}`);
    loadPendingReviews();
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not moderate review', true);
  }
}

async function loadMpesaStatus() {
  const box = qs('mpesaStatusBox');
  box.innerHTML = 'Loading…';
  try {
    const s = await api.get('/api/admin/mpesa-status');
    box.innerHTML = `
      <div class="tr"><span class="tr-lbl">Environment</span><strong style="color:#fff">${escapeHtml(s.environment)}</strong></div>
      <div class="tr"><span class="tr-lbl">Shortcode</span><strong style="color:#fff">${escapeHtml(s.shortcode)}</strong></div>
      <div class="tr"><span class="tr-lbl">Callback URL</span><strong style="color:#fff;font-size:12px">${escapeHtml(s.callbackUrl || 'not set')}</strong></div>
      <div class="tr"><span class="tr-lbl">Consumer Key</span><strong style="color:${s.consumerKeyConfigured ? '#4AE89A' : '#FF4D6D'}">${s.consumerKeyConfigured ? '✅ Configured' : '❌ Missing'}</strong></div>
      <div class="tr"><span class="tr-lbl">Consumer Secret</span><strong style="color:${s.consumerSecretConfigured ? '#4AE89A' : '#FF4D6D'}">${s.consumerSecretConfigured ? '✅ Configured' : '❌ Missing'}</strong></div>
      <div class="tr"><span class="tr-lbl">Passkey</span><strong style="color:${s.passkeyConfigured ? '#4AE89A' : '#FF4D6D'}">${s.passkeyConfigured ? '✅ Configured' : '❌ Missing'}</strong></div>
      <div class="fhint" style="margin-top:10px">Credentials are set via server environment variables only — this page never reads or writes them.</div>
    `;
  } catch {
    box.innerHTML = 'Could not load M-Pesa status.';
  }
}

async function loadSettings() {
  try {
    const s = await api.get('/api/admin/settings');
    const form = qs('adSettingsForm');
    for (const [key, val] of Object.entries(s)) {
      const el = form.elements[key];
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!val;
      else el.value = val ?? '';
    }
  } catch {
    toast('❌', 'Error', 'Could not load settings', true);
  }
}

export async function saveAdminSettings() {
  const form = qs('adSettingsForm');
  const fd = new FormData(form);
  const payload = {};
  for (const [key] of fd.entries()) {
    const el = form.elements[key];
    payload[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  }
  // Explicitly include unchecked checkboxes (FormData omits them).
  form.querySelectorAll('input[type=checkbox]').forEach((c) => {
    payload[c.name] = c.checked;
  });
  try {
    await api.patch('/api/admin/settings', payload);
    toast('✅', 'Saved', 'Platform settings updated.');
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not save settings', true);
  }
}
