(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const root = $('drone-booking-mock');
  if (!root || !window.L) return;

  const storageKey = 'aerozone-zones';
  const backupKey = 'aerozone-zones-backup';
  const zoneHistoryKey = 'aerozone-zones-history-v1';
  const profileHistoryKey = 'aerozone-profile-history-v1';
  const lfr333MigrationKey = 'aerozone-lfr333-main-v1';
  const lfr333PreviousMainKey = 'aerozone-main-before-lfr333-v1';
  // Périmètre LF-R 333, AIP France ENR 5.1 (AIRAC 06 août 2026).
  // L'arc antihoraire de 400 m est échantillonné pour rester modifiable dans Leaflet-Geoman.
  const lfr333MainFeature = {
    type: 'Feature',
    properties: {
      name: 'LFR 333', type: 'main', source: 'SIA AIP France ENR 5.1',
      officialVerticalLimit: '500 ft ASFC', siteMaximumHeightMeters: 120
    },
    geometry: { type: 'Polygon', coordinates: [[
      [2.3425, 48.59], [2.341295, 48.5902005], [2.3400657, 48.5902612],
      [2.3388473, 48.5901373], [2.3377024, 48.589835], [2.3366898, 48.5893699],
      [2.3358616, 48.5887659], [2.3352603, 48.5880541], [2.3349169, 48.5872709],
      [2.3348489, 48.5864567], [2.3350598, 48.5856533], [2.3355389, 48.584902],
      [2.3362615, 48.5842413], [2.3371904, 48.5837053], [2.338278, 48.5833214],
      [2.3394684, 48.5831094], [2.3407003, 48.5830803], [2.3419106, 48.5832354],
      [2.3430369, 48.5835668], [2.3440214, 48.5840575], [2.3447222, 48.5847222],
      [2.3580556, 48.5777778], [2.3675, 48.5675], [2.3475, 48.5591667],
      [2.2905556, 48.5722222], [2.2902778, 48.5811111], [2.3083333, 48.6008333],
      [2.3425, 48.5919444], [2.3425, 48.59]
    ]] }
  };
  const reservationKey = 'aerozone-calendar-reservations';
  const clientKey = 'aerozone-demo-clients';
  const inviteMode = new URLSearchParams(window.location.search).get('invitation') === '1';
  const center = [48.5951055, 2.3212347];
  // Même échelle sur toutes les cartes, indépendamment de la largeur de l'écran.
  const siteViewZoom = 12.7;
  const palette = ['#166c8b', '#c06c84', '#bc7c18', '#39855b', '#6b5cc7', '#b2519b'];
  const zones = L.featureGroup();
  const map = L.map('site-map', { zoomSnap: 0.1 }).setView(center, siteViewZoom);
  map.attributionControl.setPrefix(false);
  zones.addTo(map);
  const editingPoints = L.featureGroup().addTo(map);
  const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>'
  }).addTo(map);
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Tiles &copy; Esri'
  });
  L.control.layers({ Plan: street, Satellite: satellite }, null, { position: 'bottomleft' }).addTo(map);
  let activeView = 'booking';
  let drawingType = 'sub';
  let hideSubzones = false;
  let selectedZone = '';
  let adminAuthenticated = false;
  let reservationsMap = null;
  let dashboardMap = null;
  let dashboardResizeObserver = null;
  let feedbackTimer = null;
  let profileDrones = [];
  const mirrorMaps = new Map();
  const reservations = readReservations();
  const clients = readClients();
  let calendarView = 'day';
  let calendarDate = parseDate($('booking-date').value) || new Date();

  function notify(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function askUser(title, { initial = '', secret = false, confirmOnly = false, validate = null } = {}) {
    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', zIndex: '10000',
        background: '#0b2234a8', display: 'grid', placeItems: 'center', padding: '18px'
      });
      const form = document.createElement('form');
      Object.assign(form.style, {
        width: 'min(100%, 390px)', background: '#fff', color: '#152432',
        borderRadius: '12px', padding: '22px', boxShadow: '0 18px 45px #0005',
        font: '14px system-ui,sans-serif'
      });
      const heading = document.createElement('h2');
      heading.textContent = title;
      heading.style.margin = '0 0 16px';
      const input = document.createElement('input');
      input.type = secret ? 'password' : 'text';
      input.value = initial;
      input.autocomplete = 'off';
      if (secret) input.setAttribute('aria-label', 'Mot de passe administrateur');
      input.style.cssText = 'display:block;width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccd8e0;border-radius:7px;margin-bottom:16px';
      const error = document.createElement('p');
      error.id = 'aerozone-modal-error';
      error.setAttribute('role', 'alert');
      error.style.cssText = 'margin:0 0 10px;color:#ae2734;font-size:13px;font-weight:700';
      error.hidden = true;
      input.setAttribute('aria-describedby', error.id);
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Annuler';
      const accept = document.createElement('button');
      accept.type = 'submit';
      accept.textContent = confirmOnly ? 'Confirmer' : 'Continuer';
      accept.style.cssText = 'background:#286178;color:#fff;border:0;border-radius:7px;padding:9px 14px';
      cancel.style.cssText = 'background:#fff;border:1px solid #ccd8e0;border-radius:7px;padding:9px 14px';
      actions.append(cancel, accept);
      form.append(heading);
      if (!confirmOnly) form.append(error, input);
      form.append(actions);
      backdrop.append(form);
      document.body.append(backdrop);
      const finish = value => {
        backdrop.remove();
        resolve(value);
      };
      cancel.onclick = () => finish(null);
      backdrop.onclick = event => { if (event.target === backdrop) finish(null); };
      input.oninput = () => {
        error.hidden = true;
        input.removeAttribute('aria-invalid');
      };
      form.onsubmit = event => {
        event.preventDefault();
        if (confirmOnly) return finish(true);
        const value = input.value.trim();
        const message = validate?.(value);
        if (message) {
          error.textContent = message;
          error.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          input.select();
          return;
        }
        finish(value);
      };
      if (!confirmOnly) input.focus();
      else accept.focus();
    });
  }

  function readCollection(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value?.type === 'FeatureCollection' && Array.isArray(value.features) ? value : null;
    } catch {
      return null;
    }
  }

  function readReservations() {
    try {
      const value = JSON.parse(localStorage.getItem(reservationKey) || '[]');
      return Array.isArray(value) ? value.filter(item =>
        item && typeof item.zone === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
        /^\d{2}:00$/.test(item.start) && /^\d{2}:00$/.test(item.end)) : [];
    } catch {
      return [];
    }
  }

  function saveReservations() {
    try { localStorage.setItem(reservationKey, JSON.stringify(reservations)); }
    catch { notify('Impossible d’enregistrer la réservation dans ce navigateur'); }
  }

  function readClients() {
    try {
      const saved = JSON.parse(localStorage.getItem(clientKey) || '[]');
      return Array.isArray(saved) ? saved.filter(client =>
        client && typeof client.email === 'string' && typeof client.name === 'string') : [];
    } catch {
      return [];
    }
  }

  function saveClients() {
    try { localStorage.setItem(clientKey, JSON.stringify(clients)); }
    catch { notify('Impossible d’enregistrer les clients dans ce navigateur'); }
  }

  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 &&
      date.getDate() === Number(match[3]) ? date : null;
  }

  function isoDate(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')].join('-');
  }

  function dateAfter(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function mondayOf(date) {
    return dateAfter(date, -((date.getDay() + 6) % 7));
  }

  function isoWeekNumber(date) {
    const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
    const firstDay = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    return Math.ceil((((thursday - firstDay) / 86400000) + 1) / 7);
  }

  function hourText(hour) {
    return String(hour).padStart(2, '0') + ':00';
  }

  function shortDate(date) {
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(date);
  }

  function reservationDate(date) {
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric'
    }).format(date);
  }

  function calendarElement(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function slotStatus(zone, date, hour) {
    const start = hourText(hour);
    const end = hourText(hour + 1);
    const matches = reservations.filter(item => item.status !== 'rejected' && item.zone === zone && item.date === date &&
      item.start < end && item.end > start);
    if (matches.some(item => item.status === 'confirmed')) return 'confirmed';
    return matches.length ? 'pending' : 'free';
  }

  function selectCalendarSlot(zone, date, hour) {
    $('zone-select').value = zone;
    $('zone-label').textContent = zone;
    $('booking-date').value = date;
    $('start').value = hourText(hour);
    $('end').value = hourText(hour + 1);
    selectedZone = zone;
    calendarDate = parseDate(date);
    refreshMainMap();
    renderCalendar();
    notify(zone + ' · ' + shortDate(calendarDate) + ' · ' + hourText(hour) + ' à ' + hourText(hour + 1));
    if (window.innerWidth < 900) $('booking-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function calendarSlot(zone, date, hour, compact = false) {
    const status = slotStatus(zone, date, hour);
    const label = status === 'free' ? 'Libre' : status === 'pending' ? 'En attente' : 'Réservé';
    const button = calendarElement('button', 'calendar-slot ' + status, compact ? hourText(hour).slice(0, 2) + 'h' : label);
    button.type = 'button';
    button.title = zone + ' · ' + date + ' · ' + hourText(hour) + '–' + hourText(hour + 1) + ' · ' + label;
    button.setAttribute('aria-label', button.title);
    button.disabled = status !== 'free';
    if (zone === $('zone-select').value && date === $('booking-date').value && hourText(hour) === $('start').value)
      button.classList.add('selected');
    button.onclick = () => selectCalendarSlot(zone, date, hour);
    return button;
  }

  function renderCalendar() {
    const target = $('booking-calendar');
    if (!target) return;
    target.replaceChildren();
    $('calendar-date').value = isoDate(calendarDate);
    $('calendar-week-label').textContent = 'Semaine ' + isoWeekNumber(calendarDate);
    root.querySelectorAll('[data-calendar-view]').forEach(button => {
      const active = button.dataset.calendarView === calendarView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const names = flightLayers().map(layer => layer.feature.properties.name || 'Zone sans nom');
    const title = $('availability-title');
    root.querySelector('.calendar-hint').textContent = calendarView === 'month' ?
      'Choisissez un jour pour afficher les créneaux de 08:00 à 19:00.' :
      'Créneaux de 08:00 à 19:00. Cliquez sur une heure libre pour préparer votre demande.';
    if (calendarView === 'day') title.textContent = 'Disponibilités du ' + shortDate(calendarDate);
    if (calendarView === 'week') {
      const monday = mondayOf(calendarDate);
      title.textContent = 'Semaine du ' + shortDate(monday) + ' au ' + shortDate(dateAfter(monday, 6));
    }
    if (calendarView === 'month') title.textContent = 'Disponibilités · ' +
      new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(calendarDate);
    if (!names.length) {
      target.append(calendarElement('p', 'calendar-empty', 'Aucune zone de vol disponible. Créez une zone dans la partie administrateur.'));
      return;
    }
    if (calendarView === 'month') {
      const summary = calendarElement('p', 'calendar-month-summary', 'Zones de vol : ' + names.join(', '));
      const grid = calendarElement('div', 'month-grid');
      ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].forEach(day =>
        grid.append(calendarElement('div', 'month-weekday', day)));
      const first = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
      const firstMonday = mondayOf(first);
      const days = Math.ceil((new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate() +
        (first.getDay() + 6) % 7) / 7) * 7;
      for (let offset = 0; offset < days; offset++) {
        const date = dateAfter(firstMonday, offset);
        const key = isoDate(date);
        const count = reservations.filter(item => item.status !== 'rejected' && item.date === key && names.includes(item.zone)).length;
        const button = calendarElement('button', 'month-day' +
          (date.getMonth() !== first.getMonth() ? ' outside' : '') +
          (key === isoDate(new Date()) ? ' today' : ''));
        button.type = 'button';
        button.append(calendarElement('span', 'day-number', String(date.getDate())),
          calendarElement('span', 'day-hours', '08:00–19:00'));
        if (count) button.append(calendarElement('span', 'day-count', count + ' demande' + (count > 1 ? 's' : '')));
        button.setAttribute('aria-label', shortDate(date) + (count ? ' · ' + count + ' demandes' : ' · libre de 08:00 à 19:00'));
        button.onclick = () => {
          calendarDate = date;
          calendarView = 'day';
          $('booking-date').value = key;
          renderCalendar();
        };
        grid.append(button);
      }
      target.append(summary, grid);
      return;
    }
    const table = calendarElement('table', 'calendar-table ' + calendarView);
    table.setAttribute('aria-label', calendarView === 'day' ? 'Créneaux par zone et par heure' : 'Créneaux par zone et par jour');
    const head = table.createTHead().insertRow();
    head.append(calendarElement('th', '', 'Zone de vol'));
    const monday = mondayOf(calendarDate);
    if (calendarView === 'day') {
      for (let hour = 8; hour < 19; hour++) head.append(calendarElement('th', '', hourText(hour)));
    } else {
      for (let day = 0; day < 7; day++) {
        const date = dateAfter(monday, day);
        head.append(calendarElement('th', '', new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'numeric' }).format(date)));
      }
    }
    const body = table.createTBody();
    names.forEach(zone => {
      const row = body.insertRow();
      row.append(calendarElement('td', '', zone));
      if (calendarView === 'day') {
        for (let hour = 8; hour < 19; hour++) {
          const cell = row.insertCell();
          cell.append(calendarSlot(zone, isoDate(calendarDate), hour));
        }
      } else {
        for (let day = 0; day < 7; day++) {
          const date = isoDate(dateAfter(monday, day));
          const cell = row.insertCell();
          const slots = calendarElement('div', 'week-slots');
          for (let hour = 8; hour < 19; hour++) slots.append(calendarSlot(zone, date, hour, true));
          cell.append(slots);
        }
      }
    });
    target.append(table);
  }

  function renderSavedRequests() {
    const currentList = $('current-requests');
    const upcomingList = $('my-requests');
    const reservationCards = root.querySelectorAll('#reservations-view .dashboard-card');
    const fullCurrentList = reservationCards[1]?.querySelector('.card-body');
    const fullUpcomingList = reservationCards[2]?.querySelector('.card-body');
    const dashboardCards = root.querySelectorAll('#flight-dashboard .dashboard-side > .dashboard-card');
    const dashboardCurrentList = dashboardCards[0]?.querySelector('.card-body');
    const dashboardUpcomingList = dashboardCards[2]?.querySelector('.card-body');
    [currentList, upcomingList, fullCurrentList, fullUpcomingList,
      dashboardCurrentList, dashboardUpcomingList].forEach(list => list?.replaceChildren());
    const sorted = [...reservations].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const nowParis = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(new Date());
    const stillRelevant = item => !item.flightEndedAt && item.date + ' ' + item.end > nowParis;
    const isCurrent = item => item.status === 'confirmed' && item.flightStartValidatedAt &&
      item.date + ' ' + item.start <= nowParis && stillRelevant(item);
    const future = sorted.filter(item => item.status !== 'rejected' && stillRelevant(item));
    const current = future.filter(isCurrent);
    const upcoming = future.filter(item => !isCurrent(item));
    const createRow = (item, ongoing = false) => {
      const row = calendarElement('div', 'request');
      row.dataset.calendarReservation = 'true';
      const detail = document.createElement('div');
      const date = parseDate(item.date);
      detail.append(calendarElement('strong', '', item.zone + ' - ' + (date ? reservationDate(date) : item.date)),
        calendarElement('span', 'small', item.start + ' à ' + item.end + ' · ' +
          (item.purpose || 'Vol') +
          (item.machineModel || item.machineKind ? ' · ' + (item.machineModel || item.machineKind) : '')));
      const status = calendarElement('span', 'status' + (ongoing || item.status === 'confirmed' ? ' ok' : item.status === 'rejected' ? ' rejected' : ''),
        ongoing ? 'En cours' : item.status === 'confirmed' ? 'Confirmée' : item.status === 'rejected' ? 'Refusée' : 'En attente');
      row.append(detail, status);
      return row;
    };
    current.forEach(item => {
      currentList.append(createRow(item, true));
      fullCurrentList?.append(createRow(item, true));
      dashboardCurrentList?.append(createRow(item, true));
      dashboardUpcomingList?.append(createRow(item, true));
    });
    upcoming.forEach(item => {
      upcomingList.append(createRow(item));
      fullUpcomingList?.append(createRow(item));
      dashboardUpcomingList?.append(createRow(item));
    });
    const countText = count => count + ' vol' + (count > 1 ? 's' : '');
    reservationCards[1]?.querySelector('.dashboard-heading .small')?.replaceChildren(countText(current.length));
    reservationCards[2]?.querySelector('.dashboard-heading .small')?.replaceChildren(countText(upcoming.length));
    dashboardCards[0]?.querySelector('.dashboard-heading .small')?.replaceChildren(countText(current.length));
    dashboardCards[2]?.querySelector('.dashboard-heading .small')?.replaceChildren(countText(future.length));
    const menu = $('reservations-open');
    let indicator = $('reservations-nav-indicator');
    if (!indicator) {
      indicator = calendarElement('span', 'nav-reservation-indicator');
      indicator.id = 'reservations-nav-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      menu.append(indicator);
    }
    indicator.hidden = future.length === 0;
    const menuStatus = current.length + ' en cours, ' + upcoming.length + ' à venir';
    menu.title = menuStatus;
    menu.setAttribute('aria-label', 'Mes réservations, ' + menuStatus);
    const emptyRow = message => {
      const node = calendarElement('p', 'empty', message);
      node.dataset.reservationEmpty = 'true';
      return node;
    };
    if (!currentList.children.length) currentList.append(emptyRow('Aucun vol en cours.'));
    if (!upcomingList.children.length) upcomingList.append(emptyRow('Aucune réservation à venir.'));
    if (!current.length) {
      fullCurrentList?.append(emptyRow('Aucun vol en cours.'));
      dashboardCurrentList?.append(emptyRow('Aucun vol en cours.'));
    }
    if (!upcoming.length) fullUpcomingList?.append(emptyRow('Aucune réservation à venir.'));
    if (!future.length) dashboardUpcomingList?.append(emptyRow('Aucune réservation en cours ou à venir.'));
  }

  function reservationCompany(item) {
    const name = item.creator || 'Pilote';
    const normalizedName = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR');
    let savedProfile = null;
    try { savedProfile = JSON.parse(localStorage.getItem('aerozone-profile') || 'null'); } catch {}
    const profileName = [savedProfile?.firstname, savedProfile?.name].filter(Boolean).join(' ');
    const profileMatches = item.creatorEmail
      ? item.creatorEmail.trim().toLowerCase() === String(savedProfile?.email || '').trim().toLowerCase()
      : normalizedName(name) === normalizedName(profileName);
    const profileCompany = profileMatches ? String(savedProfile?.company || '').trim() : '';
    const matchingClients = clients.filter(client =>
      item.creatorEmail
        ? client.email.toLowerCase() === item.creatorEmail.toLowerCase()
        : [client.firstname, client.name].filter(Boolean).join(' ').toLocaleLowerCase('fr-FR') === name.toLocaleLowerCase('fr-FR'));
    return profileCompany || (matchingClients.length === 1 && matchingClients[0].company) ||
      item.company || 'Société non renseignée';
  }

  function renderAdminActiveFlights() {
    const list = $('admin-active-flight-list');
    list.replaceChildren();
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());
    const active = reservations.filter(item =>
      item.status === 'confirmed' && item.date === today && item.flightStartValidatedAt && !item.flightEndedAt);
    const demoFlight = readDemoFlightState();
    if (demoFlight.startAt && !demoFlight.endedAt) {
      const drone = profileDrones[0] || {};
      active.push({
        demo: true, date: today, zone: 'Zone Bravo', start: '10:00', end: '11:00',
        flightStartValidatedAt: demoFlight.startAt === 'legacy' ? null : demoFlight.startAt,
        purpose: 'Prise de vues', creator: root.querySelector('.pilot strong')?.textContent.trim() || 'Pilote',
        creatorEmail: $('profile-email').value.trim(), company: $('profile-company').value.trim(),
        machineBrand: drone.brand, machineModel: drone.model, machineKind: drone.machineKind,
        droneClass: drone.droneClass, weightGrams: drone.weightGrams
      });
    }
    active.sort((a, b) => a.start.localeCompare(b.start));
    $('admin-active-flight-count').textContent = active.length + ' vol' + (active.length > 1 ? 's' : '');
    if (!active.length) {
      list.append(calendarElement('p', 'empty', 'Aucun début de vol validé aujourd’hui dans ce navigateur.'));
      return;
    }
    active.forEach(item => {
      const row = calendarElement('div', 'request');
      const detail = document.createElement('div');
      const summary = calendarElement('div', 'admin-request-summary');
      summary.append(calendarElement('strong', '', item.creator || 'Pilote'),
        document.createTextNode(' - ' + reservationCompany(item) + ' - Zone de vol : ' + item.zone));
      const date = parseDate(item.date);
      const machine = [item.machineBrand, item.machineModel].filter(Boolean).join(' · ') ||
        item.machineKind || 'Non renseigné';
      const details = calendarElement('span', 'small admin-request-detail');
      const parts = [
        ['Date :', date ? reservationDate(date) : item.date],
        ['Heure :', item.start + ' à ' + item.end],
        ['Objet du vol :', item.purpose || 'Vol'],
        ['Type de machine :', machine],
        ['Zone principale :', 'LFR 333 · hauteur maximum 120 m']
      ];
      if (item.droneClass) parts.push(['Classe :', item.droneClass]);
      if (item.weightGrams) parts.push(['Poids :', item.weightGrams + ' g']);
      parts.forEach(([label, value], index) => {
        if (index) details.append(document.createTextNode(' - '));
        details.append(calendarElement('strong', '', label), document.createTextNode(' ' + value));
      });
      const validated = calendarElement('span', 'small admin-request-detail',
        'Début validé par le client' + (formatParisTime(item.flightStartValidatedAt) ?
          ' à ' + formatParisTime(item.flightStartValidatedAt) : '') +
          (item.demo ? ' (exemple de maquette).' : '.'));
      detail.append(summary, details, validated);
      row.append(detail, calendarElement('span', 'admin-flight-status', item.demo ? 'Démo validée' : 'Début validé'));
      list.append(row);
    });
  }

  function renderAdminRequests() {
    const list = $('admin-request-list');
    list.replaceChildren();
    renderAdminActiveFlights();
    const pending = reservations.filter(item => item.status !== 'confirmed' && item.status !== 'rejected')
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    $('admin-request-count').textContent = pending.length + ' demande' + (pending.length > 1 ? 's' : '');
    if (!pending.length) {
      list.append(calendarElement('p', 'empty',
        'Aucune demande en attente ici. Cette maquette ne synchronise pas les autres navigateurs ou appareils.'));
      return;
    }
    pending.forEach(item => {
      const row = calendarElement('div', 'request');
      const detail = document.createElement('div');
      const date = parseDate(item.date);
      const name = item.creator || 'Pilote';
      const company = reservationCompany(item);
      const firstLine = calendarElement('div', 'admin-request-summary');
      firstLine.append(calendarElement('strong', '', name),
        document.createTextNode(' - ' + company + ' - Zone de vol : ' + item.zone));
      const machine = [item.machineBrand, item.machineModel].filter(Boolean).join(' · ') ||
        item.machineKind || 'Non renseigné';
      const secondLine = calendarElement('span', 'small admin-request-detail');
      const addDetail = (label, value, separator = false) => {
        if (separator) secondLine.append(document.createTextNode(' - '));
        secondLine.append(calendarElement('strong', '', label), document.createTextNode(' ' + value));
      };
      addDetail('Date :', date ? reservationDate(date) : item.date);
      addDetail('Heure :', item.start + ' à ' + item.end, true);
      addDetail('Objet du vol :', item.purpose || 'Vol', true);
      addDetail('Type de machine :', machine, true);
      detail.append(firstLine, secondLine);
      const actions = calendarElement('div', 'admin-request-actions');
      const refuse = calendarElement('button', 'admin-refuse-button', 'Refuser la demande');
      refuse.type = 'button';
      refuse.onclick = () => {
        item.status = 'rejected';
        saveReservations();
        renderAdminRequests();
        renderCalendar();
        renderSavedRequests();
        notify('Demande refusée pour ' + item.zone);
      };
      const approve = calendarElement('button', 'admin-validate-button', 'Valider la demande');
      approve.type = 'button';
      approve.onclick = () => {
        item.status = 'confirmed';
        saveReservations();
        renderAdminRequests();
        renderCalendar();
        renderSavedRequests();
        notify('Demande validée pour ' + item.zone);
      };
      actions.append(refuse, approve);
      row.append(detail, actions);
      list.append(row);
    });
  }

  function renderClients() {
    const list = $('client-list');
    list.replaceChildren();
    $('client-count').textContent = clients.length + ' client' + (clients.length > 1 ? 's' : '');
    if (!clients.length) {
      list.append(calendarElement('p', 'empty', 'Aucun client créé dans ce navigateur.'));
      return;
    }
    const invitationUrl = new URL(window.location.href);
    invitationUrl.search = '?invitation=1';
    invitationUrl.hash = '';
    clients.forEach(client => {
      const row = calendarElement('div', 'admin-client-row');
      const detail = document.createElement('div');
      detail.append(calendarElement('strong', '', [client.firstname, client.name].filter(Boolean).join(' ')),
        calendarElement('span', 'small', [client.company, client.email].filter(Boolean).join(' · ')));
      const draft = document.createElement('a');
      draft.textContent = 'Préparer l’invitation';
      draft.href = 'mailto:' + encodeURIComponent(client.email) +
        '?subject=' + encodeURIComponent('Invitation à compléter votre profil AERO ZONE') +
        '&body=' + encodeURIComponent('Bonjour ' + (client.firstname || '') +
          ',\n\nVoici le lien pour compléter votre profil et choisir votre code de démonstration :\n' +
          invitationUrl.href + '\n\nCette invitation concerne uniquement une maquette.\n');
      draft.onclick = () => notify('Un brouillon s’ouvre : envoyez-le depuis votre messagerie.');
      row.append(detail, draft);
      list.append(row);
    });
  }

  function currentFeatures() {
    return zones.getLayers().map(layer => layer.toGeoJSON());
  }

  function keepSnapshot(historyKey, raw) {
    if (!raw) return;
    try {
      const history = JSON.parse(localStorage.getItem(historyKey) || '[]');
      const now = Date.now();
      if (!Array.isArray(history)) return;
      // Une session de déplacement de sommets produit beaucoup de sauvegardes.
      // On conserve son état initial sans saturer l'historique.
      if (history[0] && now - history[0].savedAt < 60000) return;
      history.unshift({ savedAt: now, value: raw });
      localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 30)));
    } catch { /* Le stockage courant reste prioritaire si l'historique est plein. */ }
  }

  function saveZones() {
    try {
      const previous = localStorage.getItem(storageKey);
      const next = JSON.stringify({ type: 'FeatureCollection', features: currentFeatures() });
      if (previous && previous !== next) {
        keepSnapshot(zoneHistoryKey, previous);
        localStorage.setItem(backupKey, previous);
      }
      localStorage.setItem(storageKey, next);
      refreshMirrorMaps();
    } catch {
      notify('Impossible d’enregistrer les zones dans ce navigateur');
    }
  }

  function flightLayers() {
    return zones.getLayers().filter(layer => layer.feature?.properties?.type === 'sub');
  }

  function mainLayer() {
    return zones.getLayers().find(layer => layer.feature?.properties?.type === 'main');
  }

  function styleFor(type, index = 0) {
    if (type === 'main') {
      return { color: '#d43d3d', weight: 5, opacity: 1, fillColor: '#ef6262', fillOpacity: .28 };
    }
    const color = palette[index % palette.length];
    return { color, weight: 3, opacity: 1, fillColor: color, fillOpacity: .22 };
  }

  function bindLayer(layer) {
    if (layer.feature?.properties?.type === 'sub') markHoverLayer(layer);
    layer.on('pm:edit pm:vertexremoved pm:markerdragend', () => {
      saveZones();
      refreshAll();
    });
  }

  function markHoverLayer(layer) {
    const mark = () => layer.getElement()?.classList.add('aerozone-hover-zone');
    layer.on('add', mark);
    mark();
  }

  function addFeature(feature) {
    if (!feature || feature.geometry?.type !== 'Polygon') return;
    if (!['main', 'sub'].includes(feature.properties?.type)) return;
    L.geoJSON(feature, {
      style: item => styleFor(item.properties.type, flightLayers().length)
    }).eachLayer(layer => {
      bindLayer(layer);
      zones.addLayer(layer);
    });
  }

  function refreshMainBanner() {
    $('admin-main-zone-name').textContent = 'LFR 333 - Hauteur de vol maximum 120 m';
  }

  function refreshMainMap() {
    const flights = flightLayers();
    zones.eachLayer(layer => {
      const type = layer.feature?.properties?.type;
      if (type === 'main') {
        layer.setStyle(styleFor('main'));
        layer.unbindTooltip();
        return;
      }
      if (type !== 'sub') return;
      const index = flights.indexOf(layer);
      layer.unbindTooltip();
      const hidden = hideSubzones;
      const highlighted = activeView === 'booking' && layer.feature.properties.name === selectedZone;
      layer.setStyle(hidden
        ? { ...styleFor('sub', index), opacity: 0, fillOpacity: 0 }
        : highlighted
          ? { color: '#ffbd3a', weight: 5, opacity: 1, fillColor: '#ffbd3a', fillOpacity: .42 }
          : styleFor('sub', index));
      if (layer.getElement()) layer.getElement().style.pointerEvents = hidden ? 'none' : '';
      if (!hidden) layer.bindTooltip('SZ : ' + (layer.feature.properties.name || 'Sans nom'), {
        permanent: true, direction: 'center',
        className: 'aerozone-zone-label zone-label-' + (index % palette.length)
      });
    });
  }

  function syncBookingSubmitState() {
    const button = $('booking-form').querySelector('button[type="submit"]');
    button.disabled = $('zone-select').disabled || $('flight-machine-kind').disabled;
    button.title = $('flight-machine-kind').disabled ?
      'Ajoutez un drone dans votre profil avant de faire une demande.' :
      $('zone-select').disabled ? 'Aucune zone de vol disponible.' : '';
  }

  function refreshZoneSelect() {
    const select = $('zone-select');
    const previous = select.value;
    select.replaceChildren();
    const flights = flightLayers();
    if (!flights.length) {
      const option = new Option('Aucune zone de vol disponible', '');
      option.disabled = true;
      select.add(option);
      select.disabled = true;
      syncBookingSubmitState();
      $('zone-label').textContent = 'Aucune zone';
      selectedZone = '';
      return;
    }
    select.disabled = false;
    syncBookingSubmitState();
    flights.forEach(layer => {
      const name = layer.feature.properties.name || 'Zone sans nom';
      select.add(new Option(name, name));
    });
    select.value = [...select.options].some(option => option.value === previous) ? previous : select.options[0].value;
    $('zone-label').textContent = select.value;
    if (selectedZone && !flights.some(layer => layer.feature.properties.name === selectedZone)) selectedZone = '';
  }

  function renderZoneList() {
    const list = $('flight-zone-list');
    list.replaceChildren();
    const flights = flightLayers();
    if (!flights.length) {
      const empty = document.createElement('p');
      empty.className = 'small';
      empty.textContent = 'Aucune zone de vol enregistrée dans ce navigateur.';
      list.append(empty);
      return;
    }
    flights.forEach(layer => {
      const row = document.createElement('div');
      row.className = 'flight-zone-item';
      const name = document.createElement('button');
      name.type = 'button';
      name.textContent = layer.feature.properties.name || 'Zone sans nom';
      name.title = 'Renommer et modifier le tracé';
      name.onclick = () => {
        clearEditing();
        showSubzones(true);
        const input = document.createElement('input');
        input.value = layer.feature.properties.name || '';
        input.setAttribute('aria-label', 'Nom de la zone de vol');
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Enregistrer';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Annuler';
        const editor = document.createElement('div');
        editor.className = 'flight-zone-editor';
        editor.append(input, save, cancel);
        row.replaceWith(editor);
        input.focus();
        input.select();
        save.onclick = () => {
          const value = input.value.trim();
          if (!value) return;
          const previousName = layer.feature.properties.name;
          layer.feature.properties.name = value;
          reservations.forEach(item => { if (item.zone === previousName) item.zone = value; });
          if (previousName !== value) saveReservations();
          saveZones();
          refreshAll();
          renderSavedRequests();
          renderAdminRequests();
          notify('Zone renommée : ' + value);
        };
        cancel.onclick = renderZoneList;
        input.onkeydown = event => {
          if (event.key === 'Enter') save.click();
          if (event.key === 'Escape') cancel.click();
        };
        if (layer.pm) layer.pm.enable();
        // La sélection ne modifie pas l'échelle de référence de la carte.
      };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-zone';
      remove.textContent = 'Supprimer';
      remove.onclick = async () => {
        const label = layer.feature.properties.name || 'cette zone';
        if (!await askUser('Supprimer la zone ' + label + ' ?', { confirmOnly: true })) return;
        zones.removeLayer(layer);
        saveZones();
        refreshAll();
        notify('Zone supprimée : ' + label);
      };
      row.append(name, remove);
      list.append(row);
    });
  }

  function refreshAll() {
    refreshMainBanner();
    refreshZoneSelect();
    refreshMainMap();
    renderZoneList();
    renderCalendar();
    refreshMirrorMaps();
  }

  function clearEditing() {
    editingPoints.clearLayers();
    zones.eachLayer(layer => {
      try { layer.pm?.disable(); } catch {}
    });
    try {
      map.pm.disableGlobalEditMode();
      map.pm.disableGlobalRemovalMode();
      map.pm.disableDraw();
      map.pm.removeControls();
    } catch {}
  }

  function showSubzones(show) {
    hideSubzones = !show;
    refreshMainMap();
  }

  function mirrorStyle(feature) {
    const index = flightLayers().findIndex(layer => layer.feature.properties.name === feature.properties.name);
    return styleFor(feature.properties.type, Math.max(index, 0));
  }

  function siteViewCenter() {
    return mainLayer()?.getBounds().getCenter() || L.latLng(center);
  }

  function refreshMirrorMap(target) {
    if (!target) return;
    const old = mirrorMaps.get(target);
    if (old) target.removeLayer(old);
    const overlay = L.geoJSON({ type: 'FeatureCollection', features: currentFeatures() }, {
      style: mirrorStyle,
      onEachFeature: (feature, layer) => {
        if (feature.properties.type !== 'sub') return;
        markHoverLayer(layer);
        const index = flightLayers().findIndex(item => item.feature.properties.name === feature.properties.name);
        layer.bindTooltip('SZ : ' + (feature.properties.name || 'Sans nom'), {
          permanent: true, direction: 'center',
          className: 'aerozone-zone-label zone-label-' + (Math.max(index, 0) % palette.length)
        });
      }
    }).addTo(target);
    mirrorMaps.set(target, overlay);
    target.invalidateSize();
  }

  function refreshMirrorMaps() {
    refreshMirrorMap(reservationsMap);
    refreshMirrorMap(dashboardMap);
  }

  function createMirrorMap(id) {
    const target = L.map(id, { zoomSnap: 0.1 }).setView(siteViewCenter(), siteViewZoom);
    const plan = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    });
    const aerial = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles &copy; Esri'
    });
    (map.hasLayer(satellite) ? aerial : plan).addTo(target);
    L.control.layers({ Plan: plan, Satellite: aerial }, null, { position: 'topright' }).addTo(target);
    refreshMirrorMap(target);
    return target;
  }

  function fitDashboardMap() {
    if (!dashboardMap || activeView !== 'dashboard') return;
    dashboardMap.invalidateSize({ pan: false });
    const bounds = mainLayer()?.getBounds();
    if (!bounds?.isValid()) return;
    const size = dashboardMap.getSize();
    dashboardMap.fitBounds(bounds, {
      padding: [Math.round(size.x * 0.045), Math.round(size.y * 0.045)],
      animate: false
    });
  }

  function setAdminSection(section) {
    const validation = section === 'validation';
    const clientSection = section === 'clients';
    $('admin-map-panel').hidden = validation || clientSection;
    $('admin-validation').hidden = !validation;
    $('admin-active-flights').hidden = !validation;
    $('admin-clients').hidden = !clientSection;
    $('admin-map-open').classList.toggle('active', !validation && !clientSection);
    $('admin-validation-open').classList.toggle('active', validation);
    $('admin-clients-open').classList.toggle('active', clientSection);
    if (validation) renderAdminRequests();
    else if (clientSection) renderClients();
    else requestAnimationFrame(() => map.invalidateSize());
  }

  let weatherLastLoaded = 0;
  let weatherLoading = false;

  function weatherLabel(code) {
    if (code === 0) return '☀️ Ciel dégagé';
    if (code >= 1 && code <= 3) return '⛅ Ciel nuageux';
    if (code >= 45 && code <= 48) return '🌫️ Brouillard';
    if (code >= 51 && code <= 67) return '🌧️ Pluie';
    if (code >= 71 && code <= 77) return '🌨️ Neige';
    if (code >= 80 && code <= 82) return '🌦️ Averses';
    if (code >= 95) return '⛈️ Orage';
    return 'Conditions variables';
  }

  async function loadDashboardWeather() {
    if (weatherLoading || Date.now() - weatherLastLoaded < 10 * 60 * 1000) return;
    weatherLoading = true;
    const params = new URLSearchParams({
      latitude: String(center[0]), longitude: String(center[1]),
      current: 'temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m',
      timezone: 'Europe/Paris', forecast_days: '1'
    });
    try {
      const response = await fetch('https://api.open-meteo.com/v1/forecast?' + params, {
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error('Météo indisponible');
      const weather = (await response.json()).current;
      if (!weather || !Number.isFinite(weather.temperature_2m) ||
          !Number.isFinite(weather.wind_speed_10m) || !Number.isFinite(weather.wind_gusts_10m)) {
        throw new Error('Données météo incomplètes');
      }
      const time = typeof weather.time === 'string' ? weather.time.slice(11, 16) : '';
      $('dashboard-weather-condition').textContent =
        weatherLabel(weather.weather_code) + (time ? ' · ' + time : '');
      $('dashboard-weather-temp').textContent = Math.round(weather.temperature_2m) + ' °C';
      $('dashboard-weather-wind').textContent = Math.round(weather.wind_speed_10m) + ' km/h';
      $('dashboard-weather-gusts').textContent = Math.round(weather.wind_gusts_10m) + ' km/h';
      $('dashboard-weather-note').textContent =
        'Estimation météo locale, non suffisante pour autoriser un vol.';
      weatherLastLoaded = Date.now();
    } catch {
      $('dashboard-weather-condition').textContent = 'Météo momentanément indisponible';
      $('dashboard-weather-note').textContent =
        'Vérifiez les conditions auprès d’une source météo adaptée avant le vol.';
    } finally {
      weatherLoading = false;
    }
  }

  function flightStartStorageKey() {
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());
    return 'aerozone-demo-flight-start-' + day;
  }

  function formatParisTime(value) {
    if (!value || value === 'legacy') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function readDemoFlightState() {
    const stored = localStorage.getItem(flightStartStorageKey());
    if (stored === '1') return { startAt: 'legacy', endedAt: null };
    if (!stored) return { startAt: null, endedAt: null };
    try {
      const state = JSON.parse(stored);
      return { startAt: state.startAt || null, endedAt: state.endedAt || null };
    } catch {
      return { startAt: null, endedAt: null };
    }
  }

  function saveDemoFlightState(state) {
    localStorage.setItem(flightStartStorageKey(), JSON.stringify(state));
  }

  function flightStartCandidate() {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());
    const confirmed = reservations.filter(item => item.status === 'confirmed' && item.date === today)
      .sort((a, b) => a.start.localeCompare(b.start));
    return confirmed.find(item => item.flightStartValidatedAt && !item.flightEndedAt) ||
      confirmed.find(item => !item.flightStartValidatedAt) || confirmed[0] || null;
  }

  function renderFlightStartValidation() {
    const candidate = flightStartCandidate();
    const startButton = $('validate-flight-start');
    const finishButton = $('finish-flight');
    if (candidate) {
      const started = Boolean(candidate.flightStartValidatedAt);
      const ended = Boolean(candidate.flightEndedAt);
      const startTime = formatParisTime(candidate.flightStartValidatedAt);
      const endTime = formatParisTime(candidate.flightEndedAt);
      $('flight-start-status').textContent = candidate.zone + (ended ?
        ' · vol terminé' + (endTime ? ' à ' + endTime : '') + '.' : started ?
          ' · début des vols validé' + (startTime ? ' à ' + startTime : '') + '.' :
          ' · début des vols à confirmer.');
      startButton.textContent = started ? 'Début validé' + (startTime ? ' à ' + startTime : '') :
        'Valider le début des vols';
      startButton.disabled = started;
      finishButton.hidden = !started;
      finishButton.disabled = ended;
      finishButton.textContent = ended ? 'Vol terminé' + (endTime ? ' à ' + endTime : '') : 'Vol terminé';
      return;
    }
    const demo = readDemoFlightState();
    const started = Boolean(demo.startAt);
    const ended = Boolean(demo.endedAt);
    const startTime = formatParisTime(demo.startAt);
    const endTime = formatParisTime(demo.endedAt);
    $('flight-start-status').textContent = 'Zone Bravo · ' + (ended ?
      'vol terminé' + (endTime ? ' à ' + endTime : '') + ' (maquette).' : started ?
        'début des vols validé' + (startTime ? ' à ' + startTime : '') + ' (maquette).' :
        'début à confirmer (maquette).');
    startButton.textContent = started ? 'Début validé' + (startTime ? ' à ' + startTime : '') :
      'Valider le début des vols';
    startButton.disabled = started;
    finishButton.hidden = !started;
    finishButton.disabled = ended;
    finishButton.textContent = ended ? 'Vol terminé' + (endTime ? ' à ' + endTime : '') : 'Vol terminé';
  }

  function setView(view, adminSection = 'map') {
    if (activeView === 'admin' && view !== 'admin') saveZones();
    clearEditing();
    showSubzones(true);
    activeView = view;
    const booking = view === 'booking';
    if (booking || view === 'reservations' || view === 'dashboard') renderSavedRequests();
    $('booking-top').hidden = !booking;
    root.querySelector('.layout').hidden = !booking;
    $('reservations-view').hidden = view !== 'reservations';
    $('flight-dashboard').hidden = view !== 'dashboard';
    $('rules-view').hidden = view !== 'rules';
    $('profile-panel').hidden = view !== 'profile';
    $('admin-view').hidden = view !== 'admin';
    $('admin-subnav').hidden = view !== 'admin';
    $('admin-nav').setAttribute('aria-expanded', String(view === 'admin'));
    if (view === 'admin') $('admin-map-host').append($('site-map'));
    else $('site-map-home').append($('site-map'));
    root.querySelectorAll('.nav button').forEach(button => {
      const name = {
        'booking-open': 'booking', 'reservations-open': 'reservations',
        'flight-dashboard-open': 'dashboard', 'admin-nav': 'admin',
        'rules-open': 'rules'
      }[button.id];
      button.classList.toggle('active', name === view);
    });
    root.classList.toggle('admin-on', view === 'admin');
    if (view === 'admin') setAdminSection(adminSection);
    if (view === 'reservations') {
      reservationsMap ||= createMirrorMap('reservations-map');
      refreshMirrorMap(reservationsMap);
      requestAnimationFrame(() => reservationsMap.invalidateSize());
    }
    if (view === 'dashboard') {
      dashboardMap ||= createMirrorMap('flight-dashboard-map');
      refreshMirrorMap(dashboardMap);
      if (!dashboardResizeObserver && window.ResizeObserver) {
        dashboardResizeObserver = new ResizeObserver(() => requestAnimationFrame(fitDashboardMap));
        dashboardResizeObserver.observe($('flight-dashboard-map'));
      }
      requestAnimationFrame(fitDashboardMap);
      renderFlightStartValidation();
      loadDashboardWeather();
    }
    requestAnimationFrame(() => map.invalidateSize());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getMockPassword() {
    const source = [...document.querySelectorAll('script[type="text/plain"]')]
      .map(script => script.textContent).find(text => text.includes('mockAdminPassword='));
    return source?.match(/mockAdminPassword='([^']+)'/)?.[1] || '';
  }

  async function openAdmin(section = 'map') {
    if (!adminAuthenticated) {
      const entered = await askUser('Accès administrateur', {
        secret: true,
        validate: value => value && value === getMockPassword() ? '' : 'Mot de passe incorrect'
      });
      if (entered === null) return;
      adminAuthenticated = true;
    }
    if (activeView === 'admin' && section !== 'map') {
      clearEditing();
      saveZones();
    }
    setView('admin', section);
  }

  function enterMainEdit() {
    clearEditing();
    drawingType = 'main';
    showSubzones(false);
    const layer = mainLayer();
    if (layer?.pm) {
      layer.pm.enable();
      notify('Déplacez les points du périmètre principal');
    } else {
      map.pm.addControls({ position: 'topleft', drawMarker: false, drawCircle: false,
        drawCircleMarker: false, drawPolyline: false, drawText: false,
        drawRectangle: false, editMode: false, removalMode: false });
      notify('Dessinez la zone principale avec l’outil polygone');
    }
  }

  function showDeletePoints() {
    clearEditing();
    drawingType = 'main';
    showSubzones(false);
    const layer = mainLayer();
    if (!layer) {
      notify('Aucune zone principale à modifier');
      return;
    }
    const renderPoints = () => {
      editingPoints.clearLayers();
      const paths = layer.getLatLngs();
      const rings = Array.isArray(paths[0]) ? paths : [paths];
      rings.forEach((ring, ringIndex) => {
        ring.forEach((point, index) => {
          L.circleMarker(point, {
            radius: 8, color: '#fff', weight: 2, fillColor: '#d63737', fillOpacity: 1
          }).addTo(editingPoints).bindTooltip(
            ring.length > 3 ? 'Supprimer ce point' :
              ringIndex === 0 ? 'Supprimer la zone principale' : 'Supprimer ce contour intérieur'
          ).on('click', async () => {
            if (ring.length <= 3) {
              if (ringIndex === 0) {
                if (!await askUser('Supprimer toute la zone principale et ses contours intérieurs ?', { confirmOnly: true })) return;
                zones.removeLayer(layer);
                clearEditing();
                showSubzones(true);
                saveZones();
                refreshAll();
                notify('Zone principale supprimée. Les zones de vol sont conservées.');
              } else {
                if (!await askUser('Supprimer ce contour intérieur ?', { confirmOnly: true })) return;
                rings.splice(ringIndex, 1);
                layer.setLatLngs(paths);
                layer.feature.geometry = layer.toGeoJSON().geometry;
                saveZones();
                renderPoints();
                notify('Contour intérieur supprimé et enregistré');
              }
              return;
            }
            ring.splice(index, 1);
            layer.setLatLngs(paths);
            layer.feature.geometry = layer.toGeoJSON().geometry;
            saveZones();
            renderPoints();
            notify('Point supprimé et enregistré');
          });
        });
      });
    };
    renderPoints();
    notify('Cliquez sur un point rouge, extérieur ou intérieur');
  }

  function enterFlightEdit() {
    clearEditing();
    drawingType = 'sub';
    showSubzones(true);
    map.pm.addControls({
      position: 'topleft', drawMarker: false, drawCircleMarker: false,
      drawPolyline: false, drawText: false, drawCircle: false,
      drawPolygon: true, drawRectangle: true,
      editMode: false, removalMode: false, dragMode: false, cutPolygon: false
    });
    notify('Dessinez une zone ou cliquez sur son nom pour la modifier');
  }

  map.on('pm:create', async event => {
    const layer = event.layer;
    if (drawingType === 'main' && mainLayer()) {
      if (!await askUser('Remplacer la zone principale existante ?', { confirmOnly: true })) {
        map.removeLayer(layer);
        return;
      }
      zones.removeLayer(mainLayer());
    }
    if (drawingType === 'sub' && !mainLayer()) {
      map.removeLayer(layer);
      notify('Créez d’abord une zone principale');
      return;
    }
    const name = (await askUser(
      drawingType === 'main' ? 'Nom de la zone principale' : 'Nom de la zone de vol',
      { initial: drawingType === 'main' ? 'Zone principale' : 'Nouvelle zone' }
    ))?.trim();
    if (!name) {
      map.removeLayer(layer);
      return;
    }
    layer.feature = {
      type: 'Feature', properties: { name, type: drawingType },
      geometry: layer.toGeoJSON().geometry
    };
    layer.setStyle(styleFor(drawingType, flightLayers().length));
    bindLayer(layer);
    zones.addLayer(layer);
    saveZones();
    refreshAll();
    notify('Zone ajoutée : ' + name);
  });

  function newDroneId() {
    return 'drone-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function renumberDroneCards() {
    root.querySelectorAll('#profile-drones .drone-card').forEach((card, index) => {
      card.querySelector('.drone-card-title').textContent = 'Drone ' + (index + 1);
    });
  }

  function addDroneCard(drone = {}) {
    $('profile-drones').querySelector('.empty')?.remove();
    const card = document.createElement('div');
    card.className = 'drone-card';
    card.dataset.droneId = drone.id || newDroneId();
    card.innerHTML = `<div class="drone-card-head"><strong class="drone-card-title"></strong><button class="approve drone-remove" type="button">Retirer</button></div>
      <div class="two"><label>Type de machine<select data-drone-field="machineKind"><option>Drone</option><option>Aéronef télépiloté</option><option>Autre</option></select></label><label>Marque<input data-drone-field="brand" placeholder="Ex. DJI"></label></div>
      <div class="two"><label>Type ou modèle de drone<input data-drone-field="model" placeholder="Ex. Mavic 3 Enterprise"></label><label>Classe du drone<select data-drone-field="droneClass"><option value="">Non renseignée</option><option>C0</option><option>C1</option><option>C2</option><option>C3</option><option>C4</option><option>C5</option><option>C6</option><option>Sans classe</option></select></label></div>
      <label>Poids (g)<input data-drone-field="weightGrams" type="number" min="0" step="1" inputmode="numeric" placeholder="Ex. 900"></label>`;
    for (const field of ['machineKind', 'brand', 'model', 'droneClass', 'weightGrams']) {
      const input = card.querySelector(`[data-drone-field="${field}"]`);
      if (drone[field] !== undefined && drone[field] !== null) input.value = String(drone[field]);
    }
    card.querySelector('.drone-remove').onclick = () => {
      card.remove();
      renumberDroneCards();
    };
    $('profile-drones').append(card);
    renumberDroneCards();
    return card;
  }

  function renderDroneCards(drones) {
    $('profile-drones').replaceChildren();
    if (!drones.length) $('profile-drones').append(calendarElement('p', 'empty',
      'Aucun drone enregistré. Cliquez sur « Ajouter un drone ».'));
    drones.forEach(addDroneCard);
  }

  function syncBookingDrones(drones) {
    const select = $('flight-machine-kind');
    const previous = select.value;
    select.replaceChildren();
    drones.filter(drone => drone.model?.trim()).forEach(drone => {
      const label = [drone.brand?.trim(), drone.model.trim()].filter(Boolean).join(' · ');
      select.add(new Option(label, drone.id));
    });
    if (!select.options.length) select.add(new Option('Aucun drone enregistré', ''));
    select.disabled = !drones.some(drone => drone.model?.trim());
    $('machine-help').hidden = !select.disabled;
    $('booking-profile-link').hidden = !select.disabled;
    syncBookingSubmitState();
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }

  function loadProfile() {
    if (inviteMode) {
      for (const id of ['profile-name', 'profile-firstname', 'profile-company', 'profile-email'])
        $(id).value = '';
      $('profile-role').value = 'Pilote opérateur';
      root.querySelectorAll('input[name="licence"]').forEach(input => { input.checked = false; });
      profileDrones = [];
      renderDroneCards([]);
      syncBookingDrones([]);
      return;
    }
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('aerozone-profile') || 'null'); } catch {}
    if (!saved) {
      try { saved = JSON.parse(localStorage.getItem('aerozone-profile-backup') || 'null'); } catch {}
    }
    if (!saved) {
      for (const id of ['profile-name', 'profile-firstname', 'profile-company', 'profile-email'])
        $(id).value = '';
      root.querySelector('.pilot strong').textContent = 'Profil non enregistré';
      $('pilot-company').textContent = 'Aucune société enregistrée';
      renderDroneCards([]);
      syncBookingDrones([]);
      return;
    }
    $('profile-name').value = saved.name || '';
    $('profile-firstname').value = saved.firstname || '';
    $('profile-company').value = saved.company || '';
    $('profile-email').value = saved.email || '';
    const role = saved.role === 'Responsable d équipe' ? "Responsable d'équipe" :
      (saved.role || 'Pilote opérateur');
    $('profile-role').value = role;
    root.querySelectorAll('input[name="licence"]').forEach(input => {
      input.checked = (saved.licences || []).includes(input.value);
    });
    profileDrones = Array.isArray(saved.drones) && saved.drones.length ? saved.drones.filter(drone =>
      drone && typeof drone.model === 'string').map(drone => ({ ...drone, id: drone.id || newDroneId() })) :
      (saved.machineModel?.trim() ? [{
        id: newDroneId(), machineKind: saved.machineKind || 'Drone',
        brand: saved.machineBrand || '', model: saved.machineModel,
        droneClass: '', weightGrams: ''
      }] : []);
    renderDroneCards(profileDrones);
    syncBookingDrones(profileDrones);
    root.querySelector('.pilot strong').textContent =
      [saved.firstname, saved.name].filter(Boolean).join(' ');
    $('pilot-company').textContent = saved.company?.trim() || 'Société non renseignée';
    $('pilot-role').textContent = role;
  }

  $('booking-open').onclick = () => setView('booking');
  $('reservations-open').onclick = () => setView('reservations');
  $('flight-dashboard-open').onclick = () => setView('dashboard');
  $('rules-open').onclick = () => setView('rules');
  $('validate-flight-start').onclick = () => {
    const candidate = flightStartCandidate();
    if (candidate) {
      if (candidate.flightStartValidatedAt || candidate.flightEndedAt) return;
      candidate.flightStartValidatedAt = new Date().toISOString();
      saveReservations();
    } else {
      const demo = readDemoFlightState();
      if (demo.startAt || demo.endedAt) return;
      saveDemoFlightState({ startAt: new Date().toISOString(), endedAt: null });
    }
    renderFlightStartValidation();
    renderAdminActiveFlights();
    renderSavedRequests();
    notify('Début des vols validé dans cette maquette.');
  };
  $('finish-flight').onclick = () => {
    const candidate = flightStartCandidate();
    if (candidate) {
      if (!candidate.flightStartValidatedAt || candidate.flightEndedAt) return;
      candidate.flightEndedAt = new Date().toISOString();
      saveReservations();
    } else {
      const demo = readDemoFlightState();
      if (!demo.startAt || demo.endedAt) return;
      saveDemoFlightState({ ...demo, endedAt: new Date().toISOString() });
    }
    renderFlightStartValidation();
    renderAdminActiveFlights();
    renderSavedRequests();
    notify('Vol terminé à ' + formatParisTime(new Date().toISOString()) + '.');
  };
  window.addEventListener('storage', event => {
    if (event.key === reservationKey) {
      reservations.splice(0, reservations.length, ...readReservations());
      renderSavedRequests();
      renderAdminRequests();
      renderFlightStartValidation();
    } else if (event.key === flightStartStorageKey()) {
      renderAdminActiveFlights();
      renderFlightStartValidation();
    }
  });
  $('admin-nav').onclick = () => openAdmin('map');
  $('admin-map-open').onclick = () => openAdmin('map');
  $('admin-validation-open').onclick = () => openAdmin('validation');
  $('admin-clients-open').onclick = () => openAdmin('clients');
  $('exit-admin').onclick = () => setView('booking');
  $('profile-open').onclick = () => setView('profile');
  $('booking-profile-link').onclick = () => setView('profile');
  $('profile-close').onclick = () => setView('booking');
  $('client-form').onsubmit = event => {
    event.preventDefault();
    const email = $('client-email').value.trim().toLowerCase();
    if (clients.some(client => client.email.toLowerCase() === email)) {
      notify('Cette adresse e-mail figure déjà dans la liste.');
      return;
    }
    clients.push({
      id: 'client-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      name: $('client-name').value.trim(),
      firstname: $('client-firstname').value.trim(),
      company: $('client-company').value.trim(), email
    });
    saveClients();
    renderClients();
    $('client-form').reset();
    notify('Client ajouté. Préparez puis envoyez son invitation par e-mail.');
  };
  $('add-profile-drone').onclick = () => {
    const card = addDroneCard();
    card.querySelector('[data-drone-field="model"]').focus();
  };
  $('edit-main-zone').onclick = enterMainEdit;
  $('delete-main-points').onclick = showDeletePoints;
  $('edit-flight-zones').onclick = enterFlightEdit;

  const saveMain = document.createElement('button');
  saveMain.type = 'button';
  saveMain.className = 'approve';
  saveMain.textContent = 'Enregistrer le tracé';
  saveMain.onclick = () => {
    saveZones();
    clearEditing();
    refreshAll();
    notify('Tracé enregistré');
  };
  $('delete-main-points').after(saveMain);

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'approve';
  exportButton.textContent = 'Exporter les zones';
  exportButton.onclick = () => {
    const blob = new Blob([JSON.stringify({
      type: 'FeatureCollection', features: currentFeatures()
    }, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'aerozone-zones.geojson';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('edit-flight-zones').after(exportButton);

  const restoreButton = document.createElement('button');
  restoreButton.type = 'button';
  restoreButton.className = 'approve';
  restoreButton.textContent = 'Restaurer la sauvegarde précédente';
  restoreButton.onclick = async () => {
    const backup = readCollection(backupKey);
    if (!backup) {
      notify('Aucune sauvegarde précédente disponible');
      return;
    }
    if (!await askUser('Restaurer la version précédente des zones ?', { confirmOnly: true })) return;
    const current = localStorage.getItem(storageKey);
    zones.clearLayers();
    backup.features.forEach(addFeature);
    if (current) localStorage.setItem(backupKey, current);
    localStorage.setItem(storageKey, JSON.stringify(backup));
    refreshAll();
    notify('Zones restaurées');
  };
  exportButton.after(restoreButton);

  function setupBookingHours() {
    const start = $('start');
    const end = $('end');
    const initialStart = start.value;
    const initialEnd = end.value;
    start.replaceChildren();
    end.replaceChildren();
    for (let hour = 8; hour < 19; hour++) start.add(new Option(hourText(hour), hourText(hour)));
    for (let hour = 9; hour <= 19; hour++) end.add(new Option(hourText(hour), hourText(hour)));
    start.value = [...start.options].some(option => option.value === initialStart) ? initialStart : '08:00';
    end.value = [...end.options].some(option => option.value === initialEnd) ? initialEnd : '09:00';
  }

  setupBookingHours();
  root.querySelectorAll('[data-calendar-view]').forEach(button => {
    button.onclick = () => {
      calendarView = button.dataset.calendarView;
      renderCalendar();
    };
  });
  $('calendar-prev').onclick = () => {
    calendarDate = calendarView === 'month'
      ? new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1)
      : dateAfter(calendarDate, calendarView === 'week' ? -7 : -1);
    renderCalendar();
  };
  $('calendar-next').onclick = () => {
    calendarDate = calendarView === 'month'
      ? new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1)
      : dateAfter(calendarDate, calendarView === 'week' ? 7 : 1);
    renderCalendar();
  };
  $('calendar-today').onclick = () => {
    calendarDate = new Date();
    $('booking-date').value = isoDate(calendarDate);
    renderCalendar();
  };
  $('calendar-date').onchange = () => {
    const date = parseDate($('calendar-date').value);
    if (!date) return;
    calendarDate = date;
    $('booking-date').value = isoDate(date);
    renderCalendar();
  };
  $('booking-date').onchange = () => {
    const date = parseDate($('booking-date').value);
    if (!date) return;
    calendarDate = date;
    renderCalendar();
  };
  $('start').onchange = () => {
    if ($('end').value <= $('start').value) {
      const next = Number($('start').value.slice(0, 2)) + 1;
      $('end').value = hourText(next);
    }
    renderCalendar();
  };

  $('zone-select').onchange = () => {
    selectedZone = $('zone-select').value;
    $('zone-label').textContent = selectedZone;
    refreshMainMap();
    renderCalendar();
    const layer = flightLayers().find(item => item.feature.properties.name === selectedZone);
    // La zone sélectionnée est mise en évidence sans changer le niveau de zoom.
  };

  $('booking-form').onsubmit = event => {
    event.preventDefault();
    const zone = $('zone-select').value;
    const date = $('booking-date').value;
    const start = $('start').value;
    const end = $('end').value;
    const drone = profileDrones.find(item => item.id === $('flight-machine-kind').value);
    if (!drone) {
      notify('Ajoutez un drone dans votre profil adhérant avant de réserver');
      return;
    }
    if (!flightLayers().some(layer => layer.feature.properties.name === zone)) {
      notify('Sélectionnez une zone de vol disponible');
      return;
    }
    if (!parseDate(date) || start < '08:00' || end > '19:00' || start >= end) {
      notify('Choisissez une date et un horaire entre 08:00 et 19:00');
      return;
    }
    if (reservations.some(item => item.status !== 'rejected' && item.zone === zone && item.date === date && item.start < end && item.end > start)) {
      notify('Ce créneau est déjà demandé pour cette zone');
      return;
    }
    reservations.push({
      zone, date, start, end, purpose: $('flight-purpose').value,
      droneId: drone.id, machineKind: drone.machineKind, machineBrand: drone.brand,
      machineModel: drone.model, droneClass: drone.droneClass,
      weightGrams: drone.weightGrams,
      creator: root.querySelector('.pilot strong')?.textContent.trim() || 'Pilote',
      creatorEmail: $('profile-email').value.trim(),
      company: $('profile-company').value.trim(),
      status: 'pending'
    });
    saveReservations();
    selectedZone = zone;
    calendarDate = parseDate(date);
    refreshMainMap();
    renderCalendar();
    renderSavedRequests();
    renderAdminRequests();
    notify('Demande enregistrée pour ' + zone + ' dans ce navigateur.');
  };

  $('profile-form').onsubmit = event => {
    event.preventDefault();
    const drones = [...root.querySelectorAll('#profile-drones .drone-card')].map(card => {
      const value = field => card.querySelector(`[data-drone-field="${field}"]`).value.trim();
      return {
        id: card.dataset.droneId, machineKind: value('machineKind'),
        brand: value('brand'), model: value('model'),
        droneClass: value('droneClass'), weightGrams: value('weightGrams')
      };
    });
    if (drones.some(drone => !drone.model)) {
      notify('Renseignez le type ou modèle de chaque drone ajouté');
      root.querySelector('#profile-drones .drone-card [data-drone-field="model"]:placeholder-shown')?.focus();
      return;
    }
    const profile = {
      name: $('profile-name').value, firstname: $('profile-firstname').value,
      company: $('profile-company').value, email: $('profile-email').value,
      role: $('profile-role').value,
      licences: [...root.querySelectorAll('input[name="licence"]:checked')].map(input => input.value),
      drones
    };
    if (inviteMode) {
      const code = $('invite-code').value;
      if (code.length < 6 || code !== $('invite-code-confirm').value) {
        notify('Le code doit contenir au moins 6 caractères et être identique dans les deux champs.');
        return;
      }
      try {
        localStorage.setItem('aerozone-demo-invite-profile', JSON.stringify(profile));
        localStorage.setItem('aerozone-demo-invite-complete', 'true');
      } catch {
        notify('Impossible d’enregistrer ce profil dans ce navigateur.');
        return;
      }
      $('invite-code').value = '';
      $('invite-code-confirm').value = '';
      $('invite-code-fields').hidden = true;
      $('invite-intro').textContent = 'Profil de démonstration enregistré dans ce navigateur. Le code n’est pas conservé et ne permet pas de se connecter.';
      const saveButton = $('profile-form').querySelector('button[type="submit"]');
      saveButton.disabled = true;
      saveButton.textContent = 'Profil enregistré';
      notify('Profil de démonstration enregistré.');
      return;
    }
    try {
      const previous = localStorage.getItem('aerozone-profile');
      const next = JSON.stringify(profile);
      if (previous && previous !== next) {
        keepSnapshot(profileHistoryKey, previous);
        localStorage.setItem('aerozone-profile-backup', previous);
      }
      localStorage.setItem('aerozone-profile', next);
    } catch {
      notify('Impossible d’enregistrer le profil dans ce navigateur. Aucun drone n’a été modifié.');
      return;
    }
    root.querySelector('.pilot strong').textContent =
      [profile.firstname, profile.name].filter(Boolean).join(' ');
    $('pilot-company').textContent = profile.company.trim() || 'Société non renseignée';
    $('pilot-role').textContent = profile.role;
    profileDrones = drones;
    syncBookingDrones(profileDrones);
    notify('Profil enregistré');
  };

  loadProfile();
  if (inviteMode) {
    $('invite-intro').hidden = false;
    $('invite-code-fields').hidden = false;
    $('invite-code').required = true;
    $('invite-code-confirm').required = true;
    setView('profile');
  }
  renderSavedRequests();
  setInterval(() => {
    if (document.visibilityState === 'visible') renderSavedRequests();
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderSavedRequests();
  });
  renderAdminRequests();
  renderClients();
  const saved = readCollection(storageKey);
  let displayedFeatures = saved?.features || [];
  let needsLfr333 = true;
  try { needsLfr333 = localStorage.getItem(lfr333MigrationKey) !== 'done' || !saved; } catch {}
  if (needsLfr333) {
    // Ne remplace que le périmètre principal ; les sous-zones restent intactes.
    displayedFeatures = [lfr333MainFeature, ...displayedFeatures.filter(feature => feature.properties?.type !== 'main')];
    try {
      if (saved) {
        keepSnapshot(zoneHistoryKey, JSON.stringify(saved));
        localStorage.setItem(lfr333PreviousMainKey, JSON.stringify(saved));
      }
      localStorage.setItem(storageKey, JSON.stringify({ type: 'FeatureCollection', features: displayedFeatures }));
      localStorage.setItem(lfr333MigrationKey, 'done');
    } catch { notify('Le nouveau périmètre ne peut pas être enregistré dans ce navigateur'); }
  }
  displayedFeatures.forEach(addFeature);
  refreshAll();
  map.setView(siteViewCenter(), siteViewZoom);
})();
