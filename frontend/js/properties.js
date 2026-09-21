import { api, ApiError } from './api.js';
import { API_BASE } from './config.js';
import { escapeHtml, fmtKes, propertyTypeLabel, qs } from './utils.js';
import { openModal, closeModal } from './modal.js';
import { toast } from './toast.js';
import { isLoggedIn } from './state.js';
import { requireLoginOrPrompt } from './auth.js';
import { openStkForProperty } from './payments.js';

export let currentFilter = { type: '', q: '', maxBudget: '' };
export let currentProperty = null;

function mediaUrl(path) {
  return `${API_BASE}${path}`;
}

function badgeFor(p) {
  if (p.type === 'BNB') return '<span class="pb b-bnb">BnB</span>';
  const days = (Date.now() - new Date(p.createdAt).getTime()) / 86400000;
  if (days < 7) return '<span class="pb b-new">New</span>';
  if (p.views > 50) return '<span class="pb b-hot">Popular</span>';
  return '';
}

function amenityChips(amenities) {
  return (amenities || [])
    .slice(0, 3)
    .map((a) => `<span class="ac">${escapeHtml(a)}</span>`)
    .join('');
}

export function mkCard(p) {
  const img = p.photos && p.photos[0] ? mediaUrl(p.photos[0].url) : 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=600&q=70';
  const lockRow = p.isUnlocked
    ? `<div class="pc-lock" style="border-style:solid;border-color:var(--teal)"><span class="pc-lock-lbl" style="color:var(--teal2);font-weight:700">✅ Contact unlocked</span></div>`
    : `<div class="pc-lock"><span class="pc-lock-lbl">🔒 Address &amp; contact hidden</span><button class="pc-unlock" data-action="viewProperty" data-id="${p.id}">Unlock</button></div>`;
  return `
    <div class="pcard" data-action="viewProperty" data-id="${p.id}">
      <div class="pcard-img">
        <img src="${img}" alt="${escapeHtml(p.title)}" loading="lazy">
        ${badgeFor(p)}
        ${p.isUnlocked ? '<span class="p-unlocked">Unlocked</span>' : ''}
      </div>
      <div class="pcard-body">
        <div class="pc-price">${fmtKes(p.rentAmount)}<span>/mo</span></div>
        <div class="pc-name">${escapeHtml(p.title)}</div>
        <div class="pc-loc">📍 ${escapeHtml(p.area)}</div>
        <div class="pc-stats">
          <div class="pc-stat">🛏 ${p.bedrooms}</div>
          <div class="pc-stat">🚿 ${p.bathrooms}</div>
          <div class="pc-stat">👁 ${p.views}</div>
        </div>
        <div class="pc-amens">${amenityChips(p.amenities)}</div>
        ${lockRow}
        <div class="pc-acts">
          <button class="pc-act" data-action="viewProperty" data-id="${p.id}">View Details</button>
          <button class="pc-act" data-action="openReviewsFor" data-id="${p.id}" data-title="${escapeHtml(p.title)}">⭐ Reviews</button>
        </div>
      </div>
    </div>`;
}

function renderEmpty(container, msg) {
  container.innerHTML = `<div class="empty-state"><div class="ico">🏚️</div>${escapeHtml(msg)}</div>`;
}

export async function loadFeatured() {
  try {
    const res = await api.get('/api/properties?pageSize=3');
    const slots = ['feat1', 'feat2', 'feat3'];
    res.items.forEach((p, i) => {
      const el = qs(slots[i]);
      if (el) el.innerHTML = mkCard(p);
    });
  } catch {
    /* homepage still works without featured cards */
  }
}

export async function loadListings(page = 1) {
  const grid = qs('pgrid');
  grid.innerHTML = '<div class="empty-state">Loading properties…</div>';
  const params = new URLSearchParams();
  if (currentFilter.type) params.set('type', currentFilter.type);
  if (currentFilter.q) params.set('q', currentFilter.q);
  if (currentFilter.maxBudget) params.set('maxBudget', currentFilter.maxBudget);
  params.set('page', page);
  params.set('pageSize', 12);

  try {
    const res = await api.get(`/api/properties?${params.toString()}`);
    if (res.items.length === 0) return renderEmpty(grid, 'No properties match your search yet.');
    grid.innerHTML = res.items.map(mkCard).join('');
    renderPager(res, page);
  } catch {
    renderEmpty(grid, 'Could not load properties right now.');
  }
}

function renderPager(res, page) {
  const pager = qs('listPager');
  if (!pager) return;
  const totalPages = Math.max(1, Math.ceil(res.total / res.pageSize));
  if (totalPages <= 1) return void (pager.innerHTML = '');
  let html = '';
  for (let i = 1; i <= Math.min(totalPages, 8); i += 1) {
    html += `<button class="pg${i === page ? ' on' : ''}" data-action="gotoPage" data-page="${i}">${i}</button>`;
  }
  pager.innerHTML = html;
}

export async function loadStats() {
  try {
    const res = await api.get('/api/public/stats');
    qs('statListings').textContent = res.activeListings;
    qs('statTenants').textContent = res.verifiedTenants;
  } catch {
    /* non-critical */
  }
}

function galleryHtml(p) {
  const photos = p.photos && p.photos.length ? p.photos : [{ url: null }];
  const mainUrl = photos[0].url ? mediaUrl(photos[0].url) : 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=900&q=75';
  const thumbs = photos
    .slice(1, 5)
    .map((ph) => `<div class="m-thumb"><img src="${mediaUrl(ph.url)}" alt=""></div>`)
    .join('');
  return `<div class="m-gal"><div class="m-main"><img src="${mainUrl}" alt="${escapeHtml(p.title)}"></div>${thumbs}</div>`;
}

function payGateHtml(p) {
  return `
    <div class="paygate">
      <div class="pg-title">🔒 Unlock Full Details</div>
      <div class="pg-sub">Get the exact address, owner/caretaker name and direct phone number.</div>
      <div class="pg-pts">
        <div class="pg-pt"><span class="pg-chk">✔</span> Exact address &amp; GPS pin</div>
        <div class="pg-pt"><span class="pg-chk">✔</span> Direct phone number</div>
        <div class="pg-pt"><span class="pg-chk">✔</span> WhatsApp the owner instantly</div>
      </div>
      <div class="pg-price-row"><div><div class="pg-price-lbl">One-time fee</div><div class="pg-price">${fmtKes(p.viewingFeeKes)}</div></div></div>
      <button class="mp-btn" data-action="unlockProperty" data-id="${p.id}"><span class="mp-tag">M-PESA</span> Pay &amp; Unlock Now</button>
      <div class="mp-note">Secured by Safaricom Daraja</div>
    </div>`;
}

function unlockedBoxHtml(p) {
  const wa = (p.ownerPhone || '').replace(/[^\d]/g, '');
  return `
    <div class="ul-box">
      <div class="ul-head">✅ Unlocked — Full Details</div>
      <div class="ul-row"><span class="ul-lbl">Address</span><span class="ul-val">${escapeHtml(p.exactAddress)}</span></div>
      <div class="ul-row"><span class="ul-lbl">Contact</span><span class="ul-val">${escapeHtml(p.ownerName || '')}</span></div>
      <div class="ul-row"><span class="ul-lbl">Phone</span><span class="ul-val ul-phone">${escapeHtml(p.ownerPhone || '')}</span></div>
      <div class="ul-acts">
        <a class="ul-btn ul-call" href="tel:${escapeHtml(p.ownerPhone || '')}">📞 Call</a>
        <a class="ul-btn ul-wa" href="https://wa.me/${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>
      </div>
    </div>`;
}

export async function viewProperty(id) {
  openModal('propOvl');
  qs('propTitle').textContent = 'Loading…';
  qs('propBody').innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const res = await api.get(`/api/properties/${id}`);
    currentProperty = res.property;
    renderPropertyDetail(res.property);
  } catch (err) {
    qs('propBody').innerHTML = `<div class="empty-state">${escapeHtml(err instanceof ApiError ? err.message : 'Failed to load property')}</div>`;
  }
}

function renderPropertyDetail(p) {
  qs('propTitle').textContent = p.title;
  const gate = p.isUnlocked ? unlockedBoxHtml(p) : payGateHtml(p);
  qs('propBody').innerHTML = `
    ${galleryHtml(p)}
    <div class="m-stats">
      <div class="m-stat"><div class="m-stat-val">${p.bedrooms}</div><div class="m-stat-lbl">Bedrooms</div></div>
      <div class="m-stat"><div class="m-stat-val">${p.bathrooms}</div><div class="m-stat-lbl">Bathrooms</div></div>
      <div class="m-stat"><div class="m-stat-val">${fmtKes(p.rentAmount)}</div><div class="m-stat-lbl">Per Month</div></div>
      <div class="m-stat"><div class="m-stat-val">${p.views}</div><div class="m-stat-lbl">Views</div></div>
    </div>
    <div class="m-info">
      <div>
        <div style="font-weight:700;margin-bottom:5px">${escapeHtml(propertyTypeLabel(p.type))} · 📍 ${escapeHtml(p.area)}</div>
        <div class="m-desc">${escapeHtml(p.description)}</div>
        <div class="m-chips">${(p.amenities || []).map((a) => `<span class="m-chip">${escapeHtml(a)}</span>`).join('')}</div>
      </div>
      <div>${gate}</div>
    </div>
    <button class="pc-act" style="width:100%" data-action="openReviewsFor" data-id="${p.id}" data-title="${escapeHtml(p.title)}">⭐ View Reviews</button>
  `;
}

export function refreshCurrentPropertyView() {
  if (currentProperty) viewProperty(currentProperty.id);
}

export async function unlockProperty(id) {
  if (!requireLoginOrPrompt('unlock this property')) return;
  const propRes = await api.get(`/api/properties/${id}`).catch(() => null);
  if (!propRes) return toast('❌', 'Error', 'Could not load property', true);
  openStkForProperty(propRes.property);
}

export function setQuickFilter(type) {
  currentFilter.type = type;
  document.querySelectorAll('.fp').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
  loadListings(1);
}

export function setCatFilter(type) {
  currentFilter.type = type;
  document.querySelectorAll('.cat-item').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
  document.getElementById('listSec')?.scrollIntoView({ behavior: 'smooth' });
  loadListings(1);
}

export function doSearch() {
  currentFilter.q = qs('sLoc').value.trim();
  currentFilter.type = qs('sType').value;
  currentFilter.maxBudget = qs('sBudg').value;
  document.getElementById('listSec')?.scrollIntoView({ behavior: 'smooth' });
  loadListings(1);
}

export { isLoggedIn };

let pendingGeo = null;

export function openSelfList() {
  if (!requireLoginOrPrompt('list a property')) return;
  pendingGeo = null;
  qs('geoBtn').classList.remove('got');
  qs('geoBtn').textContent = '📍 Use My Current Location';
  document.querySelectorAll('#slAmenities .amen-tog').forEach((b) => b.classList.remove('on'));
  document.getElementById('selfListForm').reset();
  clearSelfListErr();
  openModal('selfListOvl');
}

export function pickGeo() {
  if (!navigator.geolocation) return toast('❌', 'Not supported', 'Geolocation is not available on this device', true);
  const btn = qs('geoBtn');
  btn.textContent = '📍 Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      pendingGeo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      btn.classList.add('got');
      btn.textContent = `📍 Location captured (${pendingGeo.lat.toFixed(4)}, ${pendingGeo.lng.toFixed(4)})`;
    },
    () => {
      btn.textContent = '📍 Use My Current Location';
      toast('❌', 'Location denied', 'Could not get your location', true);
    },
    { timeout: 8000 }
  );
}

function clearSelfListErr() {
  const el = qs('selfListErr');
  el.textContent = '';
  el.classList.remove('show');
}

export async function handleSelfListSubmit(form) {
  clearSelfListErr();
  const data = Object.fromEntries(new FormData(form).entries());
  const amenities = Array.from(document.querySelectorAll('#slAmenities .amen-tog.on')).map((b) => b.dataset.val);
  const payload = {
    ...data,
    bedrooms: Number(data.bedrooms) || 0,
    bathrooms: Number(data.bathrooms) || 1,
    rentAmount: Number(data.rentAmount),
    amenities,
  };
  if (pendingGeo) {
    payload.geoLat = pendingGeo.lat;
    payload.geoLng = pendingGeo.lng;
  }
  try {
    const res = await api.post('/api/properties', payload);
    closeModal('selfListOvl');
    form.reset();
    toast('✅', 'Listing submitted', 'Your property is pending review before it goes live.');
    window.dispatchEvent(new CustomEvent('property:created', { detail: res.property }));
  } catch (err) {
    const el = qs('selfListErr');
    if (err instanceof ApiError && err.details) {
      const first = Object.values(err.details)[0];
      el.textContent = Array.isArray(first) ? first[0] : err.message;
    } else {
      el.textContent = err instanceof ApiError ? err.message : 'Could not create listing';
    }
    el.classList.add('show');
  }
}
