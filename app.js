/* ============================================================
   PlanificaPlanta — app.js
   Vanilla JS — Google Apps Script integration
   ============================================================ */

'use strict';

// ============================================================
// CONFIG
// ============================================================
const CONFIG_KEY = 'planificaplanta_script_url';
const TOKEN_KEY   = 'planificaplanta_access_token';
const DAYS_ORDER = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAYS_ABBR  = { 'Lunes':'Lun', 'Martes':'Mar', 'Miércoles':'Mié', 'Jueves':'Jue', 'Viernes':'Vie', 'Sábado':'Sáb', 'Domingo':'Dom' };

let allTasks = [];
let allColaboradores = []; // Lista maestra { nombre, puesto } cargada desde la hoja "Colaboradores"
let selectedPriority = null;
let selectedDias = [];          // Días seleccionados en el formulario (multi-selección)
let selectedColaboradores = [];  // Colaboradores seleccionados en el formulario (multi-selección)
let scriptUrl   = localStorage.getItem(CONFIG_KEY) || '';
let accessToken = localStorage.getItem(TOKEN_KEY) || '';
let pendingBatchPayload = null; // Payload de lote pausado por combinaciones que exceden 8h
let draggedTaskId = null;       // ID de la tarjeta que se está arrastrando
let viewWeekMonday = getMonday(new Date()); // Semana que se está viendo en Tablero/Seguimiento

/**
 * Agrega el token de acceso a una URL de GET como query param.
 */
function withToken(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(accessToken)}`;
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initWeekBadge();
  initForm();
  initCharCounter();
  initDeleteHandler();
  initExecutedHandler();
  initDragAndDrop();
  updateWeekNavLabels();

  if (!scriptUrl || !accessToken) {
    showConfigModal();
  } else {
    loadColaboradores();
    loadTasks();
  }
});

// ============================================================
// SEMANA — helpers de fecha y navegación
// ============================================================
function getMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Domingo..6=Sábado
  const diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDateKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatWeekRangeLabel(monday) {
  const sunday = addDays(monday, 6);
  const fmt = (d) => d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function updateWeekNavLabels() {
  const label = formatWeekRangeLabel(viewWeekMonday);
  const isCurrent = formatDateKey(viewWeekMonday) === formatDateKey(getMonday(new Date()));
  const text = isCurrent ? `Semana actual · ${label}` : `Semana: ${label}`;

  ['boardWeekLabel', 'segWeekLabel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
  ['boardWeekToday', 'segWeekToday'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = isCurrent;
  });
  const printTitle = document.getElementById('printWeekTitle');
  if (printTitle) printTitle.textContent = `Planificación Semanal · ${label}`;
}

function changeWeek(delta) {
  viewWeekMonday = addDays(viewWeekMonday, delta * 7);
  updateWeekNavLabels();
  renderBoard(allTasks);
  renderSeguimiento();
}

function goToCurrentWeek() {
  viewWeekMonday = getMonday(new Date());
  updateWeekNavLabels();
  renderBoard(allTasks);
  renderSeguimiento();
}

// ============================================================
// DELETE — Eliminar tarea (delegación de eventos sobre el tablero)
// ============================================================
function initDeleteHandler() {
  const board = document.getElementById('boardContent');
  board.addEventListener('click', (e) => {
    const btn = e.target.closest('.task-delete-btn');
    if (!btn) return;
    deleteTaskItem(btn.dataset.id);
  });
}

async function deleteTaskItem(id) {
  if (!id) return;
  if (!confirm('¿Eliminar esta actividad? Esta acción no se puede deshacer.')) return;

  try {
    const res  = await fetch(scriptUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ action: 'delete', token: accessToken, id }),
    });
    const json = await res.json();

    if (json.status === 'ok') {
      showToast('🗑️ Actividad eliminada.', 'success');
      loadTasks();
    } else {
      throw new Error(json.message || 'Error al eliminar la actividad.');
    }
  } catch (err) {
    console.error(err);
    showToast(`❌ No se pudo eliminar: ${err.message}`, 'error');
  }
}

// ============================================================
// MARCAR EJECUTADA — delegación de eventos sobre el tablero
// ============================================================
function initExecutedHandler() {
  const board = document.getElementById('boardContent');
  board.addEventListener('click', (e) => {
    const btn = e.target.closest('.task-exec-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    const nuevoEstado = btn.dataset.ejecutada !== '1';
    toggleEjecutada(id, nuevoEstado);
  });
}

async function toggleEjecutada(id, ejecutada) {
  try {
    const res  = await fetch(scriptUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ action: 'setEjecutada', token: accessToken, id, ejecutada }),
    });
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message || 'Error al actualizar el estado.');

    const t = allTasks.find(x => x.id === id);
    if (t) {
      t.ejecutada = ejecutada;
      t.fecha_ejecucion = ejecutada ? new Date().toISOString() : null;
    }
    showToast(ejecutada ? '✅ Actividad marcada como ejecutada.' : '↩️ Actividad marcada como pendiente.', 'success');
    renderBoard(allTasks);
    renderSeguimiento();
  } catch (err) {
    console.error(err);
    showToast(`❌ ${err.message}`, 'error');
  }
}

// ============================================================
// DRAG & DROP — mover tarjetas entre días
// ============================================================
function initDragAndDrop() {
  const board = document.getElementById('boardContent');

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.task-card');
    if (!card) return;
    draggedTaskId = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });

  board.addEventListener('dragend', (e) => {
    const card = e.target.closest('.task-card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.tasks-grid.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  board.addEventListener('dragover', (e) => {
    const grid = e.target.closest('.tasks-grid');
    if (!grid) return;
    e.preventDefault();
    grid.classList.add('drag-over');
  });

  board.addEventListener('dragleave', (e) => {
    const grid = e.target.closest('.tasks-grid');
    if (grid && !grid.contains(e.relatedTarget)) grid.classList.remove('drag-over');
  });

  board.addEventListener('drop', (e) => {
    const grid = e.target.closest('.tasks-grid');
    if (!grid || !draggedTaskId) return;
    e.preventDefault();
    grid.classList.remove('drag-over');
    const nuevoDia = grid.dataset.day;
    moveTaskToDay(draggedTaskId, nuevoDia);
    draggedTaskId = null;
  });
}

async function moveTaskToDay(id, nuevoDia) {
  const task = allTasks.find(t => t.id === id);
  if (!task || task.dia === nuevoDia) return;
  const diaAnterior = task.dia;

  // Actualización optimista
  task.dia = nuevoDia;
  renderBoard(allTasks);

  try {
    const res  = await fetch(scriptUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ action: 'move', token: accessToken, id, nuevoDia }),
    });
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message || 'Error al mover la actividad.');
    showToast(`↔️ Actividad movida a ${nuevoDia}.`, 'success');
  } catch (err) {
    console.error(err);
    task.dia = diaAnterior; // revertir
    renderBoard(allTasks);
    showToast(`❌ No se pudo mover: ${err.message}`, 'error');
  }
}

// ============================================================
// CARGAR RUTINAS — inyecta el catálogo Actividades_Rutinarias en la semana vista
// ============================================================
async function injectRoutinesThisWeek() {
  if (!scriptUrl) { showConfigModal(); return; }
  const btn = document.getElementById('injectRoutinesBtn');
  if (btn) btn.disabled = true;

  try {
    const semanaLunes = formatDateKey(viewWeekMonday);
    const res  = await fetch(scriptUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ action: 'injectRoutines', token: accessToken, semanaLunes }),
    });
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message || 'Error al cargar las actividades rutinarias.');

    const count = json.insertadas || 0;
    if (count > 0) {
      showToast(`🔁 ${count} actividad${count !== 1 ? 'es' : ''} rutinaria${count !== 1 ? 's' : ''} agregada${count !== 1 ? 's' : ''} a esta semana.`, 'success');
      loadTasks();
    } else {
      showToast('ℹ️ No hay actividades rutinarias nuevas para esta semana (o ya estaban cargadas).', 'info');
    }
  } catch (err) {
    console.error(err);
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================
// IMPRIMIR / PDF
// ============================================================
function printWeeklyPlan() {
  const label = formatWeekRangeLabel(viewWeekMonday).replace(/\s+/g, ' ');
  const prevTitle = document.title;
  document.title = `Planificacion Semana ${label}`;
  window.print();
  setTimeout(() => { document.title = prevTitle; }, 500);
}

// ============================================================
// CLOCK & DATE UTILITIES
// ============================================================
function initClock() {
  const el = document.getElementById('headerTime');
  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  tick();
  setInterval(tick, 1000);
}

function initWeekBadge() {
  const badge = document.getElementById('weekBadge');
  const monday = getMonday(new Date());
  badge.textContent = `Semana: ${formatWeekRangeLabel(monday)}`;
}

function getTodayName() {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return days[new Date().getDay()];
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(tab) {
  const panels = document.querySelectorAll('.tab-panel');
  const btns   = document.querySelectorAll('.tab-btn');
  panels.forEach(p => p.classList.remove('active'));
  btns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });

  document.getElementById(`tab-${tab}`).classList.add('active');
  const btn = document.getElementById(`tab-${tab}-btn`);
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');

  if ((tab === 'board' || tab === 'seg') && scriptUrl) loadTasks();
}

// ============================================================
// FORM INIT & PRIORITY SELECTOR
// ============================================================
function initForm() {
  const form = document.getElementById('planForm');
  form.addEventListener('submit', handleSubmit);

  // Priority buttons
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPriority = btn.dataset.value;
      document.getElementById('prioridad').value = selectedPriority;
      document.getElementById('prioridad').closest('.field-group').classList.remove('has-error');
    });
  });

  initDaySelector();
  initColaboradorPicker();
}

function initCharCounter() {
  const textarea = document.getElementById('actividad');
  const counter  = document.getElementById('charCount');
  textarea.addEventListener('input', () => {
    counter.textContent = textarea.value.length;
  });
}

// ============================================================
// SELECTOR DE DÍAS (multi-selección)
// ============================================================
function initDaySelector() {
  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.value;
      const idx = selectedDias.indexOf(val);

      if (idx === -1) {
        selectedDias.push(val);
        btn.classList.add('selected');
      } else {
        selectedDias.splice(idx, 1);
        btn.classList.remove('selected');
      }

      document.getElementById('dia').value = selectedDias.join(',');
      if (selectedDias.length > 0) {
        document.getElementById('dia').closest('.field-group').classList.remove('has-error');
      }
    });
  });
}

// ============================================================
// SELECTOR DE COLABORADORES (tag-picker, multi-selección)
// ============================================================
function initColaboradorPicker() {
  const search   = document.getElementById('colaboradorSearch');
  const dropdown = document.getElementById('colaboradorDropdown');
  const picker   = document.getElementById('colaboradorPicker');
  const chips    = document.getElementById('colaboradorChips');

  search.addEventListener('focus', () => {
    renderColaboradorDropdown(search.value);
    dropdown.hidden = false;
  });
  search.addEventListener('input', () => {
    renderColaboradorDropdown(search.value);
    dropdown.hidden = false;
  });

  dropdown.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    toggleColaborador(cb.value, cb.checked);
  });

  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('.tag-chip-remove');
    if (!btn) return;
    toggleColaborador(btn.dataset.nombre, false);
    renderColaboradorDropdown(search.value);
  });

  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target)) dropdown.hidden = true;
  });
}

function renderColaboradorDropdown(filterText) {
  const dropdown = document.getElementById('colaboradorDropdown');
  const ft = (filterText || '').trim().toLowerCase();
  const list = allColaboradores
    .filter(c => !ft || c.nombre.toLowerCase().includes(ft))
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  if (list.length === 0) {
    dropdown.innerHTML = `<div class="tag-picker-empty">Sin resultados</div>`;
    return;
  }

  dropdown.innerHTML = list.map(c => {
    const checked = selectedColaboradores.includes(c.nombre);
    return `
      <label class="tag-picker-item">
        <input type="checkbox" value="${escapeHtml(c.nombre)}" ${checked ? 'checked' : ''}>
        <span>${escapeHtml(c.nombre)}${c.puesto ? ` — ${escapeHtml(c.puesto)}` : ''}</span>
      </label>`;
  }).join('');
}

function toggleColaborador(nombre, checked) {
  const idx = selectedColaboradores.indexOf(nombre);
  if (checked && idx === -1) selectedColaboradores.push(nombre);
  if (!checked && idx !== -1) selectedColaboradores.splice(idx, 1);

  document.getElementById('colaborador').value = selectedColaboradores.join(',');
  renderColaboradorChips();
  if (selectedColaboradores.length > 0) {
    document.getElementById('colaborador').closest('.field-group').classList.remove('has-error');
  }
}

function renderColaboradorChips() {
  const chips = document.getElementById('colaboradorChips');
  chips.innerHTML = selectedColaboradores.map(nombre => `
    <span class="tag-chip">
      ${escapeHtml(nombre)}
      <button type="button" class="tag-chip-remove" data-nombre="${escapeHtml(nombre)}" aria-label="Quitar ${escapeHtml(nombre)}">×</button>
    </span>`).join('');
}

// ============================================================
// FORM VALIDATION
// ============================================================
function validateForm() {
  let valid = true;
  const fields = [
    { id: 'area',           errId: 'area-error' },
    { id: 'actividad',      errId: 'actividad-error' },
    { id: 'dia',            errId: 'dia-error' },
    { id: 'prioridad',      errId: 'prioridad-error' },
    { id: 'colaborador',    errId: 'colaborador-error' },
  ];

  fields.forEach(f => {
    const el  = document.getElementById(f.id);
    const grp = el.closest('.field-group');
    if (!el.value.trim()) {
      grp.classList.add('has-error');
      valid = false;
    } else {
      grp.classList.remove('has-error');
    }
  });

  // Validate duration (both selects must have a value)
  const hEl  = document.getElementById('duracionHoras');
  const mEl  = document.getElementById('duracionMinutos');
  const dGrp = hEl.closest('.field-group');
  if (!hEl.value.trim() || !mEl.value.trim()) {
    dGrp.classList.add('has-error');
    valid = false;
  } else {
    dGrp.classList.remove('has-error');
  }

  return valid;
}

// ============================================================
// LOAD COLABORADORES — GET from Apps Script
// ============================================================
async function loadColaboradores() {
  if (!scriptUrl) return;
  const search = document.getElementById('colaboradorSearch');

  try {
    const res  = await fetch(withToken(`${scriptUrl}?action=colaboradores`), { method: 'GET' });
    const json = await res.json();

    if (json.status === 'ok' && json.data && json.data.length > 0) {
      allColaboradores = json.data.map(item =>
        typeof item === 'string' ? { nombre: item, puesto: '' } : item
      );
      search.disabled = false;
      search.placeholder = 'Buscar colaborador...';
      renderColaboradorDropdown('');
      populateColaboradorFilter();
    } else if (json.status === 'error') {
      throw new Error(json.message);
    } else {
      allColaboradores = [];
      search.disabled = false;
      search.placeholder = 'Sin colaboradores registrados';
      showToast('ℹ️ La hoja "Colaboradores" está vacía.', 'info');
    }
  } catch (err) {
    console.error('Error cargando colaboradores:', err);
    search.placeholder = `Error: ${err.message}`;
    showToast(`❌ No se pudo cargar la lista de colaboradores: ${err.message}`, 'error');
  }
}

/**
 * Llena los <select> de filtro por colaborador (tablero y seguimiento)
 * usando la lista maestra cargada desde la hoja "Colaboradores".
 */
function populateColaboradorFilter() {
  ['filterColaborador', 'segFilterColaborador'].forEach(id => {
    const filterSel = document.getElementById(id);
    if (!filterSel) return;
    const current = filterSel.value;

    filterSel.innerHTML = '<option value="">Todos los colaboradores</option>';
    allColaboradores
      .slice()
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .forEach(item => {
        const opt = document.createElement('option');
        opt.value       = item.nombre;
        opt.textContent = item.nombre;
        filterSel.appendChild(opt);
      });

    if ([...filterSel.options].some(o => o.value === current)) {
      filterSel.value = current;
    }
  });
}

// ============================================================
// UTILS FOR DURATION
// ============================================================
function parseDurationToMinutes(durStr) {
  if (!durStr) return 0;
  let total = 0;
  const matchH = durStr.match(/(\d+)h/);
  const matchM = durStr.match(/(\d+)min/);
  if (matchH) total += parseInt(matchH[1]) * 60;
  if (matchM) total += parseInt(matchM[1]);
  return total;
}

function formatMinutesToDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m.toString().padStart(2, '0')}min`;
}

// ============================================================
// SUBMIT — POST (addBatch) to Apps Script
// ============================================================
async function handleSubmit(e) {
  e.preventDefault();
  if (!validateForm()) {
    showToast('Completa todos los campos antes de guardar.', 'error');
    return;
  }
  if (!scriptUrl) { showConfigModal(); return; }

  const horas   = document.getElementById('duracionHoras').value;
  const minutos = document.getElementById('duracionMinutos').value;
  const duracion = `${horas}h ${minutos}min`;
  const duracionMins = parseInt(horas) * 60 + parseInt(minutos);

  const area       = document.getElementById('area').value;
  const actividad  = document.getElementById('actividad').value.trim();
  const prioridad  = parseInt(document.getElementById('prioridad').value);
  const dias           = selectedDias.slice();
  const colaboradores  = selectedColaboradores.slice();

  const basePayload = { action: 'addBatch', token: accessToken, area, actividad, prioridad, duracion, dias, colaboradores };

  // Pre-chequeo local del límite de 8h/día contra la semana actual
  const todayMonday = formatDateKey(getMonday(new Date()));
  const minutosMap = {};
  allTasks
    .filter(t => t.semana_lunes === todayMonday)
    .forEach(t => {
      const key = `${t.colaborador}||${t.dia}`;
      minutosMap[key] = (minutosMap[key] || 0) + parseDurationToMinutes(t.duracion);
    });

  const skipped = [];
  dias.forEach(dia => {
    colaboradores.forEach(colaborador => {
      const key = `${colaborador}||${dia}`;
      const previos = minutosMap[key] || 0;
      if (duracionMins > 0 && previos + duracionMins > 480) {
        skipped.push({ dia, colaborador, motivo: `superaría 8h (${formatMinutesToDuration(previos)} ya asignados)` });
      }
    });
  });

  if (skipped.length > 0) {
    const totalCombos = dias.length * colaboradores.length;
    if (skipped.length === totalCombos) {
      showToast('⚠️ Todas las combinaciones seleccionadas superan el límite de 8 horas diarias. Ajuste días, colaboradores o duración.', 'error');
      return;
    }
    pendingBatchPayload = basePayload;
    const list = document.getElementById('batchSkipList');
    list.innerHTML = skipped.map(s => `<li><strong>${escapeHtml(s.colaborador)}</strong> — ${s.dia}: ${escapeHtml(s.motivo)}</li>`).join('');
    document.getElementById('batchSkipModal').removeAttribute('hidden');
    return;
  }

  await executeSaveBatch(basePayload);
}

function cancelBatchSave() {
  document.getElementById('batchSkipModal').setAttribute('hidden', '');
  pendingBatchPayload = null;
}

async function confirmBatchSave() {
  if (!pendingBatchPayload) return;
  document.getElementById('batchSkipModal').setAttribute('hidden', '');
  await executeSaveBatch(pendingBatchPayload);
  pendingBatchPayload = null;
}

async function executeSaveBatch(payload) {
  const btn      = document.getElementById('submitBtn');
  const btnText  = btn.querySelector('.btn-text');
  const btnLoad  = btn.querySelector('.btn-loading');

  btn.disabled    = true;
  btnText.hidden  = true;
  btnLoad.hidden  = false;

  try {
    const res  = await fetch(scriptUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify(payload),
    });
    const json = await res.json();

    if (json.status === 'ok') {
      const addedCount   = json.added ? json.added.length : 0;
      const skippedCount = json.skipped ? json.skipped.length : 0;
      let msg = `✅ ${addedCount} actividad${addedCount !== 1 ? 'es' : ''} guardada${addedCount !== 1 ? 's' : ''} en Google Sheets.`;
      if (skippedCount > 0) msg += ` ${skippedCount} combinación${skippedCount !== 1 ? 'es' : ''} omitida${skippedCount !== 1 ? 's' : ''} por el servidor (límite de horas).`;
      showToast(msg, addedCount > 0 ? 'success' : 'error');
      resetForm();
      loadTasks();
    } else {
      throw new Error(json.message || 'Error desconocido del servidor.');
    }
  } catch (err) {
    console.error(err);
    showToast(`❌ Error al guardar: ${err.message}`, 'error');
  } finally {
    btn.disabled   = false;
    btnText.hidden = false;
    btnLoad.hidden = true;
  }
}

function resetForm() {
  document.getElementById('area').value = '';
  document.getElementById('actividad').value = '';
  document.getElementById('duracionHoras').value = '';
  document.getElementById('duracionMinutos').value = '';

  document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('selected'));
  selectedDias = [];
  document.getElementById('dia').value = '';

  selectedColaboradores = [];
  document.getElementById('colaborador').value = '';
  document.getElementById('colaboradorSearch').value = '';
  renderColaboradorChips();
  renderColaboradorDropdown('');

  document.getElementById('charCount').textContent = '0';
  document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('prioridad').value = '';
  selectedPriority = null;
  document.querySelectorAll('.field-group').forEach(g => g.classList.remove('has-error'));
}

// ============================================================
// LOAD TASKS — GET from Apps Script
// ============================================================
async function loadTasks() {
  if (!scriptUrl) return;
  const content    = document.getElementById('boardContent');
  const segContent = document.getElementById('segContent');
  const btn        = document.getElementById('refreshBtn');

  content.innerHTML = `<div class="loading-state"><div class="spinner large"></div><p>Cargando planificación...</p></div>`;
  if (segContent) segContent.innerHTML = `<div class="loading-state"><div class="spinner large"></div><p>Cargando reporte...</p></div>`;
  if (btn) btn.disabled = true;

  try {
    const res  = await fetch(withToken(`${scriptUrl}?action=get`), { method: 'GET' });
    const json = await res.json();

    if (json.status === 'ok') {
      allTasks = json.data || [];
      renderBoard(allTasks);
      renderSeguimiento();
      updateStats();
      updateHoursTable();
    } else {
      throw new Error(json.message || 'Error al obtener los datos.');
    }
  } catch (err) {
    console.error(err);
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p class="empty-title">No se pudo conectar con Google Sheets</p>
        <p class="empty-sub">${err.message}</p>
      </div>`;
    showToast('Error al cargar los datos. Verifique la URL del script.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================
// RENDER BOARD
// ============================================================
function renderBoard(tasks) {
  const content       = document.getElementById('boardContent');
  const areaFilter     = document.getElementById('filterArea')?.value || '';
  const colabFilter    = document.getElementById('filterColaborador')?.value || '';
  const today          = getTodayName();
  const weekKey        = formatDateKey(viewWeekMonday);
  const isCurrentWeek  = weekKey === formatDateKey(getMonday(new Date()));

  const filtered = tasks.filter(t =>
    t.semana_lunes === weekKey &&
    (!areaFilter  || t.area === areaFilter) &&
    (!colabFilter || t.colaborador === colabFilter)
  );

  if (filtered.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p class="empty-title">Sin actividades para esta semana</p>
        <p class="empty-sub">${isCurrentWeek ? 'Agregue tareas desde la pestaña "Registrar Actividad".' : 'Navegue a otra semana o ajuste los filtros.'}</p>
      </div>`;
    return;
  }

  // Group by day
  const grouped = {};
  DAYS_ORDER.forEach(d => { grouped[d] = []; });
  filtered.forEach(t => {
    if (grouped[t.dia]) grouped[t.dia].push(t);
  });

  // Sort each day by priority DESC
  DAYS_ORDER.forEach(d => {
    grouped[d].sort((a, b) => b.prioridad - a.prioridad);
  });

  let html = '';
  DAYS_ORDER.forEach(day => {
    const tasksForDay = grouped[day];
    const isToday = isCurrentWeek && day === today;

    // Calcular totales diarios por colaborador para este día
    const dailyTotals = {};
    tasksForDay.forEach(t => {
      if (t.colaborador && t.duracion) {
        if (!dailyTotals[t.colaborador]) dailyTotals[t.colaborador] = 0;
        dailyTotals[t.colaborador] += parseDurationToMinutes(t.duracion);
      }
    });

    let dailyColabHtml = '';
    const entries = Object.entries(dailyTotals).sort((a, b) => b[1] - a[1]);
    if (entries.length > 0) {
      dailyColabHtml = `<div class="daily-colab-summary">` + entries.map(([nombre, mins]) => {
        const isOverload = mins > 480;
        return `
          <span class="colab-stat-chip">
            <span class="colab-stat-name">${escapeHtml(nombre)}</span>
            <span class="colab-stat-time ${isOverload ? 'overload' : ''}">${formatMinutesToDuration(mins)}</span>
          </span>`;
      }).join('') + `</div>`;
    }

    html += `
      <div class="day-section">
        <div class="day-header">
          <div class="day-header-left">
            <div class="day-dot ${isToday ? 'today' : ''}"></div>
            <span class="day-name">${day}${isToday ? ' · Hoy' : ''}</span>
            <span class="day-count">${tasksForDay.length} tarea${tasksForDay.length !== 1 ? 's' : ''}</span>
          </div>
          ${dailyColabHtml}
        </div>
        <div class="tasks-grid" data-day="${day}">
          ${tasksForDay.length > 0 ? tasksForDay.map(renderTaskCard).join('') : '<div class="day-empty-drop">Arrastre aquí una actividad</div>'}
        </div>
      </div>`;
  });

  content.innerHTML = html;
}

function renderTaskCard(task) {
  const areaClass = {
    'Planta 1':               'area-p1',
    'Planta 2':               'area-p2',
    'Mantenimiento':          'area-mnt',
    'Seguridad/Medioambiente':'area-seg',
  }[task.area] || 'area-p1';

  const dateStr = task.fecha_creacion
    ? new Date(task.fecha_creacion).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

  const colaboradorHtml = task.colaborador
    ? `<div class="task-chip">
         <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
         ${escapeHtml(task.colaborador)}
       </div>`
    : '';

  const duracionHtml = task.duracion
    ? `<div class="task-chip">
         <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
         ${escapeHtml(task.duracion)}
       </div>`
    : '';

  const origenBadge = (task.origen === 'Rutinaria')
    ? `<span class="task-origen-badge origen-rutinaria">🔁 Rutinaria</span>`
    : (task.origen === 'Traspaso')
      ? `<span class="task-origen-badge origen-traspaso">↪️ Traspasada</span>`
      : '';

  return `
    <article class="task-card prio-${task.prioridad} ${task.ejecutada ? 'ejecutada' : ''}" role="article" draggable="true" data-id="${escapeHtml(task.id)}">
      <div class="task-top">
        <span class="task-area-badge ${areaClass}">${escapeHtml(task.area)}</span>
        <div class="task-top-right">
          <span class="task-prio-badge p${task.prioridad}" title="Prioridad ${task.prioridad}">${task.prioridad}</span>
          <button type="button" class="task-exec-btn ${task.ejecutada ? 'active' : ''}" data-id="${escapeHtml(task.id)}" data-ejecutada="${task.ejecutada ? '1' : '0'}" title="${task.ejecutada ? 'Marcar como pendiente' : 'Marcar como ejecutada'}" aria-label="Marcar ejecutada">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button type="button" class="task-delete-btn" data-id="${escapeHtml(task.id)}" title="Eliminar actividad" aria-label="Eliminar actividad">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>
      <p class="task-desc">${escapeHtml(task.actividad)}</p>
      ${origenBadge}
      <div class="task-chips">
        ${colaboradorHtml}
        ${duracionHtml}
      </div>
      <div class="task-meta">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Registrado: ${dateStr}
      </div>
    </article>`;
}

// ============================================================
// FILTER
// ============================================================
function applyFilter() {
  renderBoard(allTasks);
}

// ============================================================
// STATS (semana real actual)
// ============================================================
function updateStats() {
  const todayMonday = formatDateKey(getMonday(new Date()));
  const weekTasks = allTasks.filter(t => t.semana_lunes === todayMonday);

  const total    = weekTasks.length;
  const criticas = weekTasks.filter(t => t.prioridad === 5).length;
  const p1count  = weekTasks.filter(t => t.area === 'Planta 1').length;
  const p2count  = weekTasks.filter(t => t.area === 'Planta 2').length;

  const grid = document.getElementById('statsGrid');
  grid.innerHTML = `
    <div class="stat-item"><span class="stat-num">${total}</span><span class="stat-lbl">Total</span></div>
    <div class="stat-item"><span class="stat-num" style="color:var(--p5)">${criticas}</span><span class="stat-lbl">Críticas</span></div>
    <div class="stat-item"><span class="stat-num" style="color:var(--area-p1)">${p1count}</span><span class="stat-lbl">Planta 1</span></div>
    <div class="stat-item"><span class="stat-num" style="color:var(--area-p2)">${p2count}</span><span class="stat-lbl">Planta 2</span></div>
  `;
}

// ============================================================
// HORAS POR COLABORADOR — pestaña "Registrar Actividad" (semana real actual)
// ============================================================
function updateHoursTable() {
  const wrap = document.getElementById('hoursTableWrap');
  if (!wrap) return;

  const todayMonday = formatDateKey(getMonday(new Date()));
  const weekTasks = allTasks.filter(t => t.semana_lunes === todayMonday && t.colaborador);

  if (weekTasks.length === 0) {
    wrap.innerHTML = `<p class="empty-sub" style="text-align:center;padding:16px 0;">Sin actividades esta semana.</p>`;
    return;
  }

  const porColaborador = {};
  weekTasks.forEach(t => {
    if (!porColaborador[t.colaborador]) porColaborador[t.colaborador] = {};
    porColaborador[t.colaborador][t.dia] = (porColaborador[t.colaborador][t.dia] || 0) + parseDurationToMinutes(t.duracion);
  });

  const nombres = Object.keys(porColaborador).sort((a, b) => a.localeCompare(b, 'es'));

  let html = `<table class="hours-table"><thead><tr><th>Colaborador</th>${DAYS_ORDER.map(d => `<th>${DAYS_ABBR[d]}</th>`).join('')}<th>Total</th></tr></thead><tbody>`;
  nombres.forEach(nombre => {
    let totalMin = 0;
    const cells = DAYS_ORDER.map(dia => {
      const mins = porColaborador[nombre][dia] || 0;
      totalMin += mins;
      const cls = mins > 480 ? 'hours-cell overload' : 'hours-cell';
      return `<td class="${cls}">${mins > 0 ? formatMinutesToDuration(mins) : '—'}</td>`;
    }).join('');
    html += `<tr><td class="hours-name">${escapeHtml(nombre)}</td>${cells}<td class="hours-total">${formatMinutesToDuration(totalMin)}</td></tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

// ============================================================
// SEGUIMIENTO — reporte de planificación
// ============================================================
function renderSeguimiento() {
  const content = document.getElementById('segContent');
  const summary = document.getElementById('segSummary');
  if (!content || !summary) return;

  const weekKey       = formatDateKey(viewWeekMonday);
  const areaFilter     = document.getElementById('segFilterArea')?.value || '';
  const colabFilter    = document.getElementById('segFilterColaborador')?.value || '';
  const estadoFilter   = document.getElementById('segFilterEstado')?.value || '';

  const weekTasks = allTasks.filter(t => t.semana_lunes === weekKey);

  const filtered = weekTasks.filter(t =>
    (!areaFilter   || t.area === areaFilter) &&
    (!colabFilter  || t.colaborador === colabFilter) &&
    (!estadoFilter || (estadoFilter === 'ejecutada' ? t.ejecutada : !t.ejecutada))
  );

  const total      = weekTasks.length;
  const ejecutadas = weekTasks.filter(t => t.ejecutada).length;
  const pendientes = total - ejecutadas;
  const pct        = total > 0 ? Math.round((ejecutadas / total) * 100) : 0;

  summary.innerHTML = `
    <div class="seg-stat"><span class="seg-stat-num">${total}</span><span class="seg-stat-lbl">Total tareas</span></div>
    <div class="seg-stat"><span class="seg-stat-num" style="color:var(--p1)">${ejecutadas}</span><span class="seg-stat-lbl">Ejecutadas</span></div>
    <div class="seg-stat"><span class="seg-stat-num" style="color:var(--p4)">${pendientes}</span><span class="seg-stat-lbl">Pendientes</span></div>
    <div class="seg-stat"><span class="seg-stat-num" style="color:var(--accent)">${pct}%</span><span class="seg-stat-lbl">Cumplimiento</span></div>
  `;

  if (filtered.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <p class="empty-title">Sin actividades para este filtro</p>
      </div>`;
    return;
  }

  const grouped = {};
  DAYS_ORDER.forEach(d => { grouped[d] = []; });
  filtered.forEach(t => { if (grouped[t.dia]) grouped[t.dia].push(t); });

  let html = '';
  DAYS_ORDER.forEach(day => {
    const tasksForDay = grouped[day];
    if (tasksForDay.length === 0) return;
    tasksForDay.sort((a, b) => b.prioridad - a.prioridad);

    html += `
      <div class="day-section">
        <div class="day-header">
          <div class="day-header-left">
            <span class="day-name">${day}</span>
            <span class="day-count">${tasksForDay.length} tarea${tasksForDay.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div class="seg-table-wrap">
          <table class="seg-table">
            <thead>
              <tr><th>Estado</th><th>Actividad</th><th>Colaborador</th><th>Área</th><th>Prioridad</th><th>Duración</th><th>Origen</th><th>Ejecutada el</th></tr>
            </thead>
            <tbody>
              ${tasksForDay.map(renderSeguimientoRow).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  });

  content.innerHTML = html;
}

function renderSeguimientoRow(t) {
  const estadoHtml = t.ejecutada
    ? `<span class="seg-status done">✅ Ejecutada</span>`
    : `<span class="seg-status pending">⏳ Pendiente</span>`;
  const fechaEj = t.fecha_ejecucion
    ? new Date(t.fecha_ejecucion).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

  return `
    <tr class="${t.ejecutada ? 'row-done' : ''}">
      <td>${estadoHtml}</td>
      <td>${escapeHtml(t.actividad)}</td>
      <td>${escapeHtml(t.colaborador)}</td>
      <td>${escapeHtml(t.area)}</td>
      <td><span class="task-prio-badge p${t.prioridad}">${t.prioridad}</span></td>
      <td>${escapeHtml(t.duracion || '—')}</td>
      <td>${escapeHtml(t.origen || 'Manual')}</td>
      <td>${fechaEj}</td>
    </tr>`;
}

// ============================================================
// CONFIG MODAL
// ============================================================
function showConfigModal() {
  const modal = document.getElementById('configModal');
  modal.removeAttribute('hidden');
}
function hideConfigModal() {
  const modal = document.getElementById('configModal');
  modal.setAttribute('hidden', '');
}
function saveConfig() {
  const input      = document.getElementById('scriptUrl').value.trim();
  const tokenInput = document.getElementById('scriptToken').value.trim();

  if (!input || !input.startsWith('https://script.google.com')) {
    showToast('Por favor ingrese una URL válida de Google Apps Script.', 'error');
    return;
  }
  if (!tokenInput) {
    showToast('Por favor ingrese el token de acceso configurado en Code.gs.', 'error');
    return;
  }

  scriptUrl   = input;
  accessToken = tokenInput;
  localStorage.setItem(CONFIG_KEY, scriptUrl);
  localStorage.setItem(TOKEN_KEY, accessToken);
  hideConfigModal();
  showToast('✅ Configuración guardada. Conectando con Google Sheets...', 'success');
  loadColaboradores();
  loadTasks();
}

// ============================================================
// TOAST
// ============================================================
function showToast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 320);
  }, 4000);
}

// ============================================================
// UTILS
// ============================================================
function escapeHtml(str) {
  const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' };
  return String(str).replace(/[&<>"']/g, m => map[m]);
}
