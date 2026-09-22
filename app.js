(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const root = $('drone-booking-mock');
  if (!root || !window.L) return;

  const storageKey = 'aerozone-zones';
  const backupKey = 'aerozone-zones-backup';
  const center = [48.5951055, 2.3212347];
  const palette = ['#166c8b', '#c06c84', '#bc7c18', '#39855b', '#6b5cc7', '#b2519b'];
  const zones = L.featureGroup();
  const map = L.map('site-map').setView(center, 16);
  zones.addTo(map);
  const editingPoints = L.featureGroup().addTo(map);
  const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Tiles &copy; Esri'
  });
  L.control.layers({ Plan: street, Satellite: satellite }, null, { position: 'topright' }).addTo(map);
  const compass = L.control({ position: 'bottomleft' });
  compass.onAdd = () => {
    const element = L.DomUtil.create('div', 'aerozone-compass');
    element.innerHTML = '<span>N</span>';
    element.title = 'Nord';
    return element;
  };
  compass.addTo(map);

  let activeView = 'booking';
  let drawingType = 'sub';
  let hideSubzones = false;
  let selectedZone = '';
  let adminAuthenticated = false;
  let reservationsMap = null;
  let dashboardMap = null;
  let feedbackTimer = null;
  const mirrorMaps = new Map();

  function notify(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function askUser(title, { initial = '', secret = false, confirmOnly = false } = {}) {
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
      input.style.cssText = 'display:block;width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccd8e0;border-radius:7px;margin-bottom:16px';
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
      if (!confirmOnly) form.append(input);
      form.append(actions);
      backdrop.append(form);
      document.body.append(backdrop);
      const finish = value => {
        backdrop.remove();
        resolve(value);
      };
      cancel.onclick = () => finish(null);
      backdrop.onclick = event => { if (event.target === backdrop) finish(null); };
      form.onsubmit = event => {
        event.preventDefault();
        finish(confirmOnly ? true : input.value.trim());
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

  function currentFeatures() {
    return zones.getLayers().map(layer => layer.toGeoJSON());
  }

  function saveZones() {
    try {
      const previous = localStorage.getItem(storageKey);
      const next = JSON.stringify({ type: 'FeatureCollection', features: currentFeatures() });
      if (previous && previous !== next) localStorage.setItem(backupKey, previous);
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
      return { color: '#8f58e6', weight: 5, opacity: 1, fillColor: '#7240c1', fillOpacity: .16 };
    }
    const color = palette[index % palette.length];
    return { color, weight: 3, opacity: 1, fillColor: color, fillOpacity: .22 };
  }

  function bindLayer(layer) {
    layer.on('pm:edit pm:vertexremoved pm:markerdragend', () => {
      saveZones();
      refreshAll();
    });
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
      $('booking-form').querySelector('button[type="submit"]').disabled = true;
      $('zone-label').textContent = 'Aucune zone';
      selectedZone = '';
      return;
    }
    select.disabled = false;
    $('booking-form').querySelector('button[type="submit"]').disabled = false;
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
          layer.feature.properties.name = value;
          saveZones();
          refreshAll();
          notify('Zone renommée : ' + value);
        };
        cancel.onclick = renderZoneList;
        input.onkeydown = event => {
          if (event.key === 'Enter') save.click();
          if (event.key === 'Escape') cancel.click();
        };
        if (layer.pm) layer.pm.enable();
        map.fitBounds(layer.getBounds(), { padding: [40, 40] });
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

  function refreshMirrorMap(target) {
    if (!target) return;
    const old = mirrorMaps.get(target);
    if (old) target.removeLayer(old);
    const overlay = L.geoJSON({ type: 'FeatureCollection', features: currentFeatures() }, {
      style: mirrorStyle,
      onEachFeature: (feature, layer) => {
        if (feature.properties.type !== 'sub') return;
        const index = flightLayers().findIndex(item => item.feature.properties.name === feature.properties.name);
        layer.bindTooltip('SZ : ' + (feature.properties.name || 'Sans nom'), {
          permanent: true, direction: 'center',
          className: 'aerozone-zone-label zone-label-' + (Math.max(index, 0) % palette.length)
        });
      }
    }).addTo(target);
    mirrorMaps.set(target, overlay);
    if (overlay.getLayers().length) target.fitBounds(overlay.getBounds(), { padding: [20, 20] });
    target.invalidateSize();
  }

  function refreshMirrorMaps() {
    refreshMirrorMap(reservationsMap);
    refreshMirrorMap(dashboardMap);
  }

  function createMirrorMap(id) {
    const target = L.map(id).setView(center, 16);
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

  function setView(view) {
    if (activeView === 'admin' && view !== 'admin') saveZones();
    clearEditing();
    showSubzones(true);
    activeView = view;
    const booking = view === 'booking';
    $('booking-top').hidden = !booking;
    root.querySelector('.layout').hidden = !booking;
    $('reservations-view').hidden = view !== 'reservations';
    $('flight-dashboard').hidden = view !== 'dashboard';
    $('profile-panel').hidden = view !== 'profile';
    $('admin-view').hidden = view !== 'admin';
    if (view === 'admin') $('admin-map-host').append($('site-map'));
    else $('site-map-home').append($('site-map'));
    root.querySelectorAll('.nav button').forEach(button => {
      const name = {
        'booking-open': 'booking', 'reservations-open': 'reservations',
        'flight-dashboard-open': 'dashboard', 'admin-nav': 'admin'
      }[button.id];
      button.classList.toggle('active', name === view);
    });
    root.classList.toggle('admin-on', view === 'admin');
    if (view === 'reservations') {
      reservationsMap ||= createMirrorMap('reservations-map');
      refreshMirrorMap(reservationsMap);
      requestAnimationFrame(() => reservationsMap.invalidateSize());
    }
    if (view === 'dashboard') {
      dashboardMap ||= createMirrorMap('flight-dashboard-map');
      refreshMirrorMap(dashboardMap);
      requestAnimationFrame(() => dashboardMap.invalidateSize());
    }
    requestAnimationFrame(() => map.invalidateSize());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getMockPassword() {
    const source = [...document.querySelectorAll('script[type="text/plain"]')]
      .map(script => script.textContent).find(text => text.includes('mockAdminPassword='));
    return source?.match(/mockAdminPassword='([^']+)'/)?.[1] || '';
  }

  async function openAdmin() {
    if (!adminAuthenticated) {
      const entered = await askUser('Accès administrateur', { secret: true });
      if (entered === null) return;
      if (entered !== getMockPassword()) {
        notify('Mot de passe incorrect');
        return;
      }
      adminAuthenticated = true;
    }
    setView('admin');
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
      rings.forEach(ring => {
        ring.forEach((point, index) => {
          L.circleMarker(point, {
            radius: 8, color: '#fff', weight: 2, fillColor: '#d63737', fillOpacity: 1
          }).addTo(editingPoints).bindTooltip('Supprimer ce point').on('click', () => {
            if (ring.length <= 3) {
              notify('Un contour doit conserver au moins trois points');
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

  function loadProfile() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('aerozone-profile') || 'null'); } catch {}
    if (!saved) return;
    $('profile-name').value = saved.name || '';
    $('profile-firstname').value = saved.firstname || '';
    $('profile-company').value = saved.company || '';
    $('profile-email').value = saved.email || '';
    $('profile-role').value = saved.role || 'Pilote opérateur';
    root.querySelectorAll('input[name="licence"]').forEach(input => {
      input.checked = (saved.licences || []).includes(input.value);
    });
    $('machine-kind').value = saved.machineKind || 'Drone';
    $('machine-brand').value = saved.machineBrand || '';
    $('machine-model').value = saved.machineModel || '';
    root.querySelector('.pilot strong').textContent =
      [saved.firstname, saved.name].filter(Boolean).join(' ');
    $('pilot-role').textContent = saved.role || 'Pilote opérateur';
  }

  $('booking-open').onclick = () => setView('booking');
  $('reservations-open').onclick = () => setView('reservations');
  $('flight-dashboard-open').onclick = () => setView('dashboard');
  $('admin-nav').onclick = openAdmin;
  $('exit-admin').onclick = () => setView('booking');
  $('back-to-booking').onclick = () => setView('booking');
  $('profile-open').onclick = () => setView('profile');
  $('profile-close').onclick = () => setView('booking');
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

  $('zone-select').onchange = () => {
    selectedZone = $('zone-select').value;
    $('zone-label').textContent = selectedZone;
    refreshMainMap();
    const layer = flightLayers().find(item => item.feature.properties.name === selectedZone);
    if (layer) map.fitBounds(layer.getBounds(), { padding: [40, 40] });
  };

  $('booking-form').onsubmit = event => {
    event.preventDefault();
    if ($('start').value >= $('end').value) {
      notify('L’heure de fin doit être postérieure au début');
      return;
    }
    selectedZone = $('zone-select').value;
    const item = document.createElement('div');
    item.className = 'request';
    const detail = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = selectedZone + ' - demande envoyée';
    const hours = document.createElement('span');
    hours.className = 'small';
    hours.textContent = $('start').value + ' à ' + $('end').value;
    const status = document.createElement('span');
    status.className = 'status';
    status.textContent = 'En attente';
    detail.append(title, hours);
    item.append(detail, status);
    $('my-requests').prepend(item);
    refreshMainMap();
    notify('Demande envoyée pour ' + selectedZone);
  };

  $('profile-form').onsubmit = event => {
    event.preventDefault();
    const profile = {
      name: $('profile-name').value, firstname: $('profile-firstname').value,
      company: $('profile-company').value, email: $('profile-email').value,
      role: $('profile-role').value,
      licences: [...root.querySelectorAll('input[name="licence"]:checked')].map(input => input.value),
      machineKind: $('machine-kind').value,
      machineBrand: $('machine-brand').value, machineModel: $('machine-model').value
    };
    localStorage.setItem('aerozone-profile', JSON.stringify(profile));
    root.querySelector('.pilot strong').textContent =
      [profile.firstname, profile.name].filter(Boolean).join(' ');
    $('pilot-role').textContent = profile.role;
    notify('Profil enregistré');
  };

  $('approve').onclick = function () {
    const request = this.closest('.request');
    const status = request.querySelector('.status');
    status.textContent = 'Validée';
    status.classList.add('ok');
    this.remove();
    notify('Demande validée');
  };
  $('confirm-flight').onclick = function () {
    $('flight-status').textContent = 'Pré-vol confirmé';
    $('reminder-state').textContent = 'Validation effectuée ce matin';
    this.remove();
    notify('Pré-vol confirmé');
  };

  loadProfile();
  const saved = readCollection(storageKey);
  if (saved) saved.features.forEach(addFeature);
  refreshAll();
  if (zones.getLayers().length) map.fitBounds(zones.getBounds(), { padding: [20, 20] });

  if (!mainLayer()) {
    fetch('zone-principale.json')
      .then(response => {
        if (!response.ok) throw new Error('Import indisponible');
        return response.json();
      })
      .then(imported => {
        if (mainLayer()) return;
        addFeature({
          type: 'Feature',
          properties: {
            name: imported.name || 'Zone principale', type: 'main',
            altitudeMin: imported.geoFence.altitudeMin,
            altitudeMax: imported.geoFence.altitudeMax
          },
          geometry: { type: 'Polygon', coordinates: imported.geoFence.coordinates }
        });
        refreshAll();
        map.fitBounds(zones.getBounds(), { padding: [20, 20] });
      })
      .catch(() => notify('Carte principale indisponible'));
  }
})();
