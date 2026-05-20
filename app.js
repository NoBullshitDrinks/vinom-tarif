/* =================================================================
   VINOM TARIF — App JavaScript
   ================================================================= */

// ---------- Config ----------
const ACCESS_CODE = 'vinom2026';   // Mot de passe partagé (changement annuel)
const GATE_KEY = 'vinom_tarif_unlocked';
const PROMO_URL = 'https://nobullshitdrinks.github.io/vinom-promotions/';

// ---------- État ----------
let DATA = null;
let state = {
  search: '',
  filters: {
    couleur: null,       // single
    label: new Set(),    // multi
    format: new Set(),   // multi
    mise_avant: new Set(), // multi
    prix: null,          // single
    region: null,        // single
  },
  sort: 'region',
};

const REGION_ORDER = [
  'Île-de-France', 'Jura', 'Alsace', 'Bordeaux', 'Beaujolais',
  'Bourgogne', 'Rhône', 'Loire', 'Provence-Corse', 'Occitanie',
  'Reste du Monde', 'Bulles', 'Spiritueux',
];

const SUBREGION_ORDER = {
  'Bordeaux': ['Régionaux et Côtes', 'Rive Droite', 'Rive Gauche', 'Sauternais'],
  'Bourgogne': ['Régionaux', 'Chablisien', 'Maconnais', 'Côte Chalonnaise', 'Côte de Nuits', 'Côte de Beaune'],
  'Rhône': ['Régionaux', 'Méridional', 'Septentrional'],
  'Loire': ['Blancs', 'Rouges'],
  'Provence-Corse': ['Blancs et Rouges', 'Rosés'],
  'Occitanie': ['Blancs', 'Rosés', 'Rouges - Nord', 'Rouges - Ouest & Sud'],
  'Reste du Monde': ['Blancs et Rosés', 'Rouges'],
  'Bulles': ['', 'les Magnums (150cl) et autres beaux flacons'],
};

// =================================================================
// GATE (mot de passe)
// =================================================================
function checkGate() {
  if (sessionStorage.getItem(GATE_KEY) === 'yes') {
    openApp();
    return;
  }
  // Permettre l'accès via ?code=xxx (lien partagé)
  const params = new URLSearchParams(window.location.search);
  if (params.get('code') === ACCESS_CODE) {
    sessionStorage.setItem(GATE_KEY, 'yes');
    // Nettoyer l'URL pour ne pas laisser traîner le code
    const url = new URL(window.location);
    url.searchParams.delete('code');
    window.history.replaceState({}, '', url);
    openApp();
    return;
  }
  // Sinon : afficher la gate
  document.getElementById('gate').style.display = 'flex';
  document.getElementById('app').hidden = true;
  document.getElementById('gate-pwd').focus();
}

function openApp() {
  document.getElementById('gate').style.display = 'none';
  document.getElementById('app').hidden = false;
  if (!DATA) loadData();
}

document.getElementById('gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const pwd = document.getElementById('gate-pwd').value.trim().toLowerCase();
  const err = document.getElementById('gate-error');
  if (pwd === ACCESS_CODE.toLowerCase()) {
    sessionStorage.setItem(GATE_KEY, 'yes');
    openApp();
  } else {
    err.hidden = false;
    document.getElementById('gate-pwd').value = '';
    document.getElementById('gate-pwd').focus();
    setTimeout(() => { err.hidden = true; }, 3000);
  }
});

// =================================================================
// DATA LOADING
// =================================================================
async function loadData() {
  try {
    const res = await fetch('tarif.json');
    DATA = await res.json();
    renderHeader();
    renderRegionFilter();
    updateCounts();
    syncFromURL();
    render();
    attachEvents();
  } catch (e) {
    console.error('Erreur de chargement', e);
    document.getElementById('results').innerHTML = '<p style="text-align:center;color:#7a1f2b;padding:60px">Impossible de charger le tarif. Vérifiez votre connexion ou contactez ADV VINOM.</p>';
  }
}

function renderHeader() {
  const d = new Date(DATA.meta.date_maj);
  const fmt = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('header-date').textContent = `Mise à jour ${fmt} · ${DATA.meta.total} références`;
}

function renderRegionFilter() {
  const container = document.getElementById('region-chips');
  const counts = {};
  for (const it of DATA.items) counts[it.region] = (counts[it.region] || 0) + 1;
  // Bulles et Spiritueux ne sont pas des régions géographiques : exclus du filtre
  // (ils restent filtrables via la barre Couleur)
  const NOT_REGIONS = new Set(['Bulles', 'Spiritueux']);
  const regionsOrdered = REGION_ORDER.filter(r => counts[r] > 0 && !NOT_REGIONS.has(r));
  container.innerHTML = regionsOrdered.map(r => {
    return `<button class="chip" data-value="${r}">${r} <span class="chip-count">${counts[r]}</span></button>`;
  }).join('');
}

// =================================================================
// FILTERING
// =================================================================
function normalize(s) {
  if (!s) return '';
  return s.toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function matchesFilters(item) {
  // Search
  if (state.search) {
    const q = normalize(state.search);
    const hay = normalize([item.cuvee, item.domaine, item.appellation, item.region, item.millesime].join(' '));
    if (!hay.includes(q)) return false;
  }
  // Couleur
  if (state.filters.couleur && item.couleur !== state.filters.couleur) return false;
  // Label (multi)
  if (state.filters.label.size > 0) {
    let ok = false;
    for (const tag of state.filters.label) {
      if (item.label_tags.includes(tag)) { ok = true; break; }
    }
    if (!ok) return false;
  }
  // Format (multi)
  if (state.filters.format.size > 0) {
    if (!state.filters.format.has(item.format)) return false;
  }
  // Mise en avant
  if (state.filters.mise_avant.size > 0) {
    let ok = false;
    if (state.filters.mise_avant.has('pepite') && item.pepite) ok = true;
    if (state.filters.mise_avant.has('nouveau') && item.nouveau) ok = true;
    if (!ok) return false;
  }
  // Prix
  if (state.filters.prix) {
    const [min, max] = state.filters.prix.split('-').map(Number);
    if (item.prix < min || item.prix > max) return false;
  }
  // Région
  if (state.filters.region && item.region !== state.filters.region) return false;
  return true;
}

function getFiltered() {
  return DATA.items.filter(matchesFilters);
}

function getSortValue(item) {
  switch (state.sort) {
    case 'prix-asc':
    case 'prix-desc':
      return item.prix;
    case 'domaine':
      return normalize(item.domaine || item.cuvee);
    case 'nouveau':
      return item.nouveau ? 0 : 1;
    case 'region':
    default:
      return REGION_ORDER.indexOf(item.region);
  }
}

function applySort(items) {
  const sorted = [...items].sort((a, b) => {
    const va = getSortValue(a), vb = getSortValue(b);
    if (va < vb) return state.sort === 'prix-desc' ? 1 : -1;
    if (va > vb) return state.sort === 'prix-desc' ? -1 : 1;
    // tiebreaker prix asc
    return (a.prix || 0) - (b.prix || 0);
  });
  return sorted;
}

// =================================================================
// COMPTAGE par chip (pour afficher (xx) à côté de chaque option)
// =================================================================
function updateCounts() {
  // Compter pour chaque chip combien d'items correspondent SI on appliquait ce filtre
  // en plus des filtres actuels.
  const groups = ['couleur', 'label', 'format', 'mise_avant'];
  // Base : items matchant les autres filtres (sauf le groupe en cours)
  document.querySelectorAll('.filter-group').forEach(group => {
    const groupName = group.dataset.group;
    if (groupName === 'region' || groupName === 'prix') return; // pas de count pour ceux-là
    // Calculer un état temporaire sans ce groupe
    const tempState = {
      ...state,
      filters: { ...state.filters, [groupName]: groupName === 'couleur' ? null : new Set() }
    };
    const tempItems = DATA.items.filter(it => matchesFiltersTemp(it, tempState));
    group.querySelectorAll('.chip').forEach(chip => {
      const value = chip.dataset.value;
      let count = 0;
      for (const it of tempItems) {
        if (groupName === 'couleur' && it.couleur === value) count++;
        else if (groupName === 'label' && it.label_tags.includes(value)) count++;
        else if (groupName === 'format' && it.format === value) count++;
        else if (groupName === 'mise_avant') {
          if (value === 'pepite' && it.pepite) count++;
          if (value === 'nouveau' && it.nouveau) count++;
        }
      }
      const countEl = chip.querySelector('.chip-count');
      if (countEl) countEl.textContent = count > 0 ? count : '';
    });
  });
}

function matchesFiltersTemp(item, tempState) {
  if (tempState.search) {
    const q = normalize(tempState.search);
    const hay = normalize([item.cuvee, item.domaine, item.appellation, item.region].join(' '));
    if (!hay.includes(q)) return false;
  }
  if (tempState.filters.couleur && item.couleur !== tempState.filters.couleur) return false;
  if (tempState.filters.label.size > 0) {
    let ok = false;
    for (const tag of tempState.filters.label) if (item.label_tags.includes(tag)) { ok = true; break; }
    if (!ok) return false;
  }
  if (tempState.filters.format.size > 0 && !tempState.filters.format.has(item.format)) return false;
  if (tempState.filters.mise_avant.size > 0) {
    let ok = false;
    if (tempState.filters.mise_avant.has('pepite') && item.pepite) ok = true;
    if (tempState.filters.mise_avant.has('nouveau') && item.nouveau) ok = true;
    if (!ok) return false;
  }
  if (tempState.filters.prix) {
    const [min, max] = tempState.filters.prix.split('-').map(Number);
    if (item.prix < min || item.prix > max) return false;
  }
  if (tempState.filters.region && item.region !== tempState.filters.region) return false;
  return true;
}

// =================================================================
// RENDER
// =================================================================
function fmtPrice(p) {
  if (p == null) return '';
  const v = Number(p);
  if (Number.isInteger(v)) return v.toFixed(2).replace('.', ',');
  return v.toFixed(2).replace('.', ',');
}

function labelBadgeHTML(item) {
  if (!item.label_tags.length) return '';
  // Priorité d'affichage : un seul badge le plus spécifique
  const priority = ['biodynamie', 'sans_so2', 'bio', 'hve', 'vegan', 'regen'];
  const labels = {
    biodynamie: 'BIODYN',
    sans_so2: 'NO SO₂',
    bio: 'BIO',
    hve: 'HVE',
    vegan: 'VEGAN',
    regen: 'RÉGÉN',
  };
  for (const tag of priority) {
    if (item.label_tags.includes(tag)) {
      return `<span class="badge badge-${tag}">${labels[tag]}</span>`;
    }
  }
  return '';
}

function cuveeCellHTML(item) {
  let html = escapeHtml(item.cuvee);
  if (item.nouveau) html += `<span class="badge badge-new">Nouveau</span>`;
  if (item.pepite) html += `<span class="badge badge-pepite">★ Pépite</span>`;
  if (item.format !== 'standard') {
    html += `<span class="badge badge-format">${item.format_label}</span>`;
  }
  return html;
}

function escapeHtml(s) {
  if (!s) return '';
  return s.toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render() {
  const items = applySort(getFiltered());
  const container = document.getElementById('results');
  const emptyEl = document.getElementById('empty');

  // Compteur
  const total = DATA.items.length;
  document.getElementById('results-count').innerHTML =
    items.length === total
      ? `<strong>${items.length}</strong> références`
      : `<strong>${items.length}</strong> référence${items.length > 1 ? 's' : ''} affichée${items.length > 1 ? 's' : ''} sur ${total}`;

  if (items.length === 0) {
    container.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  // Regroupement
  let html = '';
  if (state.sort === 'region') {
    html = renderByRegion(items);
  } else {
    html = renderFlat(items);
  }
  container.innerHTML = html;
}

function renderByRegion(items) {
  // Groupe par région puis sous-région
  const byRegion = {};
  for (const it of items) {
    if (!byRegion[it.region]) byRegion[it.region] = {};
    const sub = it.sous_region || '';
    if (!byRegion[it.region][sub]) byRegion[it.region][sub] = [];
    byRegion[it.region][sub].push(it);
  }

  const regionsOrdered = REGION_ORDER.filter(r => byRegion[r]);
  let html = '';
  for (const reg of regionsOrdered) {
    const subs = byRegion[reg];
    const subOrder = SUBREGION_ORDER[reg] || Object.keys(subs).sort();
    const ordered = subOrder.filter(s => subs[s]).concat(
      Object.keys(subs).filter(s => !subOrder.includes(s))
    );
    const total = Object.values(subs).reduce((acc, arr) => acc + arr.length, 0);
    const nouveaux = Object.values(subs).flat().filter(it => it.nouveau).length;

    html += `<section class="region-block">`;
    html += `<header class="region-block-head">`;
    html += `<h2 class="region-block-name">${reg}</h2>`;
    html += `<div class="region-block-meta"><strong>${total}</strong> référence${total>1?'s':''}`;
    if (nouveaux > 0) html += ` · dont <strong>${nouveaux}</strong> nouveauté${nouveaux>1?'s':''}`;
    html += `</div></header>`;

    for (const sub of ordered) {
      const arr = subs[sub];
      if (!arr) continue;
      html += `<div class="subregion-block">`;
      if (sub) html += `<h3 class="subregion-title">${escapeHtml(sub)}</h3>`;
      html += renderTable(arr, reg === 'Spiritueux');
      html += `</div>`;
    }
    html += `</section>`;
  }
  return html;
}

function renderFlat(items) {
  // Trié à plat (par prix, par domaine, etc.)
  return `<section class="region-block">
    <div class="ref-table-wrap">${renderTable(items, false, true).replace('<table class="ref-table"', '<table class="ref-table"')}</div>
  </section>`;
}

function renderTable(items, isSpiri, flat) {
  if (isSpiri) {
    return `<div class="ref-table-wrap"><table class="ref-table spiri">
      <thead><tr>
        <th class="col-cuvee">Cuvée</th>
        <th class="col-domaine">Maison</th>
        <th class="col-appellation">Catégorie</th>
        <th class="col-format">Format</th>
        <th class="col-prix">Tarif HT</th>
      </tr></thead>
      <tbody>${items.map(it => `
        <tr class="cat-${it.couleur}">
          <td class="col-cuvee">${cuveeCellHTML(it)}</td>
          <td class="col-domaine">${escapeHtml(it.domaine)}</td>
          <td class="col-appellation">${escapeHtml(it.appellation)}</td>
          <td class="col-format">${escapeHtml(it.format_label || '70cl')}</td>
          <td class="col-prix">${fmtPrice(it.prix)}&nbsp;€</td>
        </tr>`).join('')}
      </tbody></table></div>`;
  }
  // Standard
  const showRegion = flat;
  return `<div class="ref-table-wrap"><table class="ref-table">
    <thead><tr>
      <th class="col-cuvee">Cuvée</th>
      <th class="col-domaine">Domaine</th>
      <th class="col-appellation">${showRegion ? 'Région · ' : ''}Appellation</th>
      <th class="col-mill">Mill.</th>
      <th class="col-label">Label</th>
      <th class="col-prix">Tarif HT</th>
    </tr></thead>
    <tbody>${items.map(it => `
      <tr class="cat-${it.couleur}">
        <td class="col-cuvee">${cuveeCellHTML(it)}</td>
        <td class="col-domaine">${escapeHtml(it.domaine)}</td>
        <td class="col-appellation">${showRegion ? `<span style="color:#8a8a8a;font-size:11px">${it.region} · </span>` : ''}${escapeHtml(it.appellation)}</td>
        <td class="col-mill">${escapeHtml(it.millesime)}</td>
        <td class="col-label">${labelBadgeHTML(it)}</td>
        <td class="col-prix">${fmtPrice(it.prix)}&nbsp;€</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

// =================================================================
// EVENTS
// =================================================================
function attachEvents() {
  // Search
  const searchInput = document.getElementById('search');
  const searchClear = document.getElementById('search-clear');
  searchInput.addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    searchClear.hidden = !state.search;
    syncURL();
    updateCounts();
    render();
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    state.search = '';
    searchClear.hidden = true;
    syncURL();
    updateCounts();
    render();
  });

  // Filters (chips, including region chips)
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.chip')) return;
    const chip = e.target.closest('.chip');
    const group = chip.closest('.filter-group');
    if (!group) return;
    const groupName = group.dataset.group;
    const mode = group.dataset.mode;
    const value = chip.dataset.value;
    toggleFilter(groupName, value, mode);
    syncURL();
    updateCounts();
    refreshChips();
    render();
    // Scroll up doucement quand on filtre
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Sort
  document.getElementById('sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    syncURL();
    render();
  });

  // Reset
  document.getElementById('btn-reset').addEventListener('click', resetAll);

  // Print
  document.getElementById('btn-print').addEventListener('click', printPDF);
}

function toggleFilter(group, value, mode) {
  if (group === 'region' || group === 'couleur' || group === 'prix') {
    // Single: toggle on/off
    state.filters[group] = state.filters[group] === value ? null : value;
  } else {
    // Multi: add/remove
    if (state.filters[group].has(value)) state.filters[group].delete(value);
    else state.filters[group].add(value);
  }
}

function refreshChips() {
  document.querySelectorAll('.filter-group').forEach(group => {
    const groupName = group.dataset.group;
    group.querySelectorAll('.chip').forEach(chip => {
      const value = chip.dataset.value;
      const v = state.filters[groupName];
      let active = false;
      if (v instanceof Set) active = v.has(value);
      else active = v === value;
      chip.classList.toggle('active', active);
    });
  });
}

function resetAll() {
  state.search = '';
  state.filters = {
    couleur: null,
    label: new Set(),
    format: new Set(),
    mise_avant: new Set(),
    prix: null,
    region: null,
  };
  state.sort = 'region';
  document.getElementById('search').value = '';
  document.getElementById('search-clear').hidden = true;
  document.getElementById('sort').value = 'region';
  syncURL();
  updateCounts();
  refreshChips();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =================================================================
// URL SYNC (filtres dans l'URL pour partage)
// =================================================================
function syncURL() {
  const params = new URLSearchParams();
  if (state.search) params.set('q', state.search);
  if (state.filters.couleur) params.set('couleur', state.filters.couleur);
  if (state.filters.label.size) params.set('label', [...state.filters.label].join(','));
  if (state.filters.format.size) params.set('format', [...state.filters.format].join(','));
  if (state.filters.mise_avant.size) params.set('avant', [...state.filters.mise_avant].join(','));
  if (state.filters.prix) params.set('prix', state.filters.prix);
  if (state.filters.region) params.set('region', state.filters.region);
  if (state.sort !== 'region') params.set('sort', state.sort);
  const url = new URL(window.location);
  url.search = params.toString();
  window.history.replaceState({}, '', url);
}

function syncFromURL() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('q')) {
    state.search = params.get('q');
    document.getElementById('search').value = state.search;
    document.getElementById('search-clear').hidden = false;
  }
  if (params.get('couleur')) state.filters.couleur = params.get('couleur');
  if (params.get('label')) state.filters.label = new Set(params.get('label').split(','));
  if (params.get('format')) state.filters.format = new Set(params.get('format').split(','));
  if (params.get('avant')) state.filters.mise_avant = new Set(params.get('avant').split(','));
  if (params.get('prix')) state.filters.prix = params.get('prix');
  if (params.get('region')) state.filters.region = params.get('region');
  if (params.get('sort')) {
    state.sort = params.get('sort');
    document.getElementById('sort').value = state.sort;
  }
  refreshChips();
}

// =================================================================
// PRINT TO PDF
// =================================================================
function getActiveFiltersLabel() {
  const parts = [];
  if (state.search) parts.push(`Recherche : "${state.search}"`);
  if (state.filters.couleur) parts.push(`Couleur : ${state.filters.couleur}`);
  if (state.filters.region) parts.push(`Région : ${state.filters.region}`);
  if (state.filters.label.size) parts.push(`Label : ${[...state.filters.label].join(', ')}`);
  if (state.filters.format.size) parts.push(`Format : ${[...state.filters.format].join(', ')}`);
  if (state.filters.mise_avant.size) parts.push(`${[...state.filters.mise_avant].join(', ')}`);
  if (state.filters.prix) parts.push(`Prix : ${state.filters.prix.replace('-', '–')} €`);
  return parts.join(' · ');
}

function buildPrintHTML() {
  const filtered = applySort(getFiltered());
  const filtersLabel = getActiveFiltersLabel();
  const isFiltered = filtered.length !== DATA.items.length;

  // --- Couverture ---
  const today = new Date(DATA.meta.date_maj);
  const fmt = today.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const regionsCount = new Set(filtered.map(it => it.region)).size;

  let html = `
    <section class="p-cover">
      <div class="p-cover-eyebrow">Maison de Vins · Paris</div>
      <h1 class="p-cover-title">V&nbsp;I&nbsp;N&nbsp;O&nbsp;M</h1>
      <div class="p-cover-subtitle">Tarif Professionnel</div>
      <div class="p-cover-divider"></div>
      <div class="p-cover-meta">
        <strong>Édition ${DATA.meta.edition}</strong><br>
        ${filtered.length} référence${filtered.length>1?'s':''} · ${regionsCount} région${regionsCount>1?'s':''}<br>
        Mise à jour : ${fmt}
      </div>
      ${isFiltered ? `<div class="p-cover-filter-info"><strong>Sélection imprimée :</strong> ${escapeHtml(filtersLabel) || 'filtres actifs'}</div>` : ''}
      <div class="p-cover-edito">
        <div class="p-cover-edito-title">Le mot du mois</div>
        <p class="p-cover-edito-text">${escapeHtml(DATA.meta.edito)}</p>
        <div class="p-cover-edito-signature">— Olivier Mouton</div>
      </div>
      <div class="p-cover-footer">
        VINOM SAS · 13 boulevard des Batignolles · 75008 Paris<br>
        ADV : 01 85 56 84 50 · adv@vinom.fr<br>
        Promotions : ${PROMO_URL}
      </div>
    </section>
  `;

  // --- Pages région ---
  const byRegion = {};
  for (const it of filtered) {
    if (!byRegion[it.region]) byRegion[it.region] = {};
    const sub = it.sous_region || '';
    if (!byRegion[it.region][sub]) byRegion[it.region][sub] = [];
    byRegion[it.region][sub].push(it);
  }
  const regionsOrdered = REGION_ORDER.filter(r => byRegion[r]);

  for (const reg of regionsOrdered) {
    const subs = byRegion[reg];
    const subOrder = SUBREGION_ORDER[reg] || Object.keys(subs).sort();
    const ordered = subOrder.filter(s => subs[s]).concat(
      Object.keys(subs).filter(s => !subOrder.includes(s))
    );
    const total = Object.values(subs).reduce((acc, arr) => acc + arr.length, 0);
    const nouveaux = Object.values(subs).flat().filter(it => it.nouveau).length;
    const isSpiri = reg === 'Spiritueux';

    html += `<section class="p-region">
      <div class="p-region-header">
        <h2 class="p-region-name">${reg}</h2>
        <div class="p-region-meta"><strong>${total}</strong> référence${total>1?'s':''}${nouveaux>0?`<br>dont <strong>${nouveaux}</strong> nouveauté${nouveaux>1?'s':''}`:''}</div>
      </div>`;

    for (const sub of ordered) {
      const arr = subs[sub];
      if (!arr) continue;
      if (sub) html += `<h3 class="p-subregion">${escapeHtml(sub)}</h3>`;
      html += buildPrintTable(arr, isSpiri);
    }
    html += `</section>`;
  }

  // --- CGV ---
  html += `
    <section class="p-cgv">
      <h2 class="p-cgv-title">Informations & Conditions</h2>
      <div class="p-info-block">
        <h3>Service ADV — du lundi au vendredi · 9h–17h</h3>
        <p>Téléphone : 01 85 56 84 50 · Email : adv@vinom.fr</p>
        <p>Livraison J+1 sur Île-de-France et Picardie · panachés autorisés · le samedi sur Paris centre.</p>
        <p>Comptabilité : 01 85 56 84 52 · k.yazidi@vinom.fr</p>
        <p>Plus de 200 domaines et maisons en direct · 600+ références · domaines exclusifs.</p>
        <p>Nombreuses références BIO, biodynamie, vegan, sans soufre.</p>
      </div>
      <div class="p-cgv-content">
        <h3>Conditions Générales de Vente · VINOM SAS</h3>
        <p><strong>1 — Généralités</strong> · Les présentes conditions générales de vente s'appliquent à l'intégralité des prestations et services effectués par VINOM SAS (siège : 13 boulevard des Batignolles · 75008 Paris). En signant un bon de commande, le client accepte sans réserve les présentes CGV.</p>
        <p><strong>2 — Offre, Commande, Formation du contrat</strong> · Le contrat de vente, même en cas de devis préalable, n'est parfait que sous réserve d'acceptation expresse écrite par VINOM. La modification d'une commande n'est possible qu'avec accord exprès de VINOM. La commande représente l'acceptation de l'offre par l'acheteur et ne peut être retirée ou annulée.</p>
        <p><strong>3 — Prix et délais</strong> · Les prix sont établis hors taxes sur la base du tarif en vigueur au jour de la remise de l'offre. Toutes les offres s'entendent dans la limite des stocks disponibles. Les délais de livraison sont donnés à titre indicatif et ne constituent pas un engagement de VINOM.</p>
        <p><strong>4 — Délais de paiement</strong> · Sauf stipulation contraire, nos factures sont payables à 30 jours fin de mois net. Modes de règlement : virement ou chèque bancaire. En cas de retard, pénalités calculées au taux de la BCE majoré de 10 points.</p>
        <p><strong>5 — Défaut de paiement et clause pénale</strong> · Le défaut de paiement d'une seule échéance entraîne l'exigibilité immédiate de toute somme restant due, une indemnité forfaitaire de 40 € (art. D 441-5 du Code de Commerce) et, sauf accord, une indemnité égale à 15 % des sommes dues au titre de clause pénale.</p>
        <p><strong>6 — Transfert de propriété</strong> · VINOM se réserve l'entière propriété des marchandises jusqu'au paiement intégral de leur prix. L'acheteur supporte les risques dès la livraison.</p>
        <p><strong>7 — Garanties et responsabilités</strong> · Les marchandises voyagent aux risques et périls du client, qui doit vérifier leur bon état à la livraison. Aucune réclamation ne sera prise en compte au-delà de 48 heures.</p>
        <p><strong>8 — Force majeure</strong> · VINOM n'est pas responsable en cas d'incendie, inondation, grève, ou tout événement entravant la bonne marche de la société.</p>
        <p><strong>9 — Droit applicable / Tribunaux compétents</strong> · Tout litige sera jugé par le Tribunal de Commerce de Paris. Le droit applicable est le droit français.</p>
      </div>
    </section>
  `;

  return html;
}

function buildPrintTable(items, isSpiri) {
  if (isSpiri) {
    return `<table class="p-table spiri">
      <thead><tr>
        <th class="p-col-cuvee">Cuvée</th>
        <th class="p-col-domaine">Maison</th>
        <th class="p-col-appellation">Catégorie</th>
        <th class="p-col-format">Format</th>
        <th class="p-col-prix">Tarif HT</th>
      </tr></thead>
      <tbody>${items.map(it => `
        <tr class="cat-${it.couleur}">
          <td class="p-col-cuvee">${printCuveeHTML(it)}</td>
          <td class="p-col-domaine">${escapeHtml(it.domaine)}</td>
          <td class="p-col-appellation">${escapeHtml(it.appellation)}</td>
          <td class="p-col-format">${escapeHtml(it.format_label || '70cl')}</td>
          <td class="p-col-prix">${fmtPrice(it.prix)}&nbsp;€</td>
        </tr>`).join('')}
      </tbody></table>`;
  }
  return `<table class="p-table">
    <thead><tr>
      <th class="p-col-cuvee">Cuvée</th>
      <th class="p-col-domaine">Domaine</th>
      <th class="p-col-appellation">Appellation</th>
      <th class="p-col-mill">Mill.</th>
      <th class="p-col-label">Label</th>
      <th class="p-col-prix">Tarif HT</th>
    </tr></thead>
    <tbody>${items.map(it => `
      <tr class="cat-${it.couleur}">
        <td class="p-col-cuvee">${printCuveeHTML(it)}</td>
        <td class="p-col-domaine">${escapeHtml(it.domaine)}</td>
        <td class="p-col-appellation">${escapeHtml(it.appellation)}</td>
        <td class="p-col-mill">${escapeHtml(it.millesime)}</td>
        <td class="p-col-label">${printLabelBadge(it)}</td>
        <td class="p-col-prix">${fmtPrice(it.prix)}&nbsp;€</td>
      </tr>`).join('')}
    </tbody></table>`;
}

function printCuveeHTML(item) {
  let html = escapeHtml(item.cuvee);
  if (item.nouveau) html += `<span class="p-badge p-badge-new">Nouveau</span>`;
  if (item.pepite) html += `<span class="p-badge p-badge-pepite">★ Pépite</span>`;
  if (item.format !== 'standard') html += `<span class="p-badge p-badge-format">${item.format_label}</span>`;
  return html;
}

function printLabelBadge(item) {
  if (!item.label_tags.length) return '';
  const priority = ['biodynamie', 'sans_so2', 'bio', 'hve', 'vegan', 'regen'];
  const labels = { biodynamie: 'BIODYN', sans_so2: 'NO SO₂', bio: 'BIO', hve: 'HVE', vegan: 'VEGAN', regen: 'RÉGÉN' };
  for (const tag of priority) {
    if (item.label_tags.includes(tag)) return `<span class="p-badge p-badge-${tag}">${labels[tag]}</span>`;
  }
  return '';
}

function printPDF() {
  // Construire le DOM print
  document.getElementById('print-only').innerHTML = buildPrintHTML();
  // Lancer l'impression
  setTimeout(() => window.print(), 50);
}

// =================================================================
// INIT
// =================================================================
checkGate();
