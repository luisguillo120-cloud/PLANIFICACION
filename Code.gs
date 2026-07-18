// ============================================================
// PlanificaPlanta — Code.gs
// Google Apps Script — Backend para la planificación semanal
//
// INSTRUCCIONES DE DESPLIEGUE:
//   1. En Google Sheets: Extensiones → Apps Script
//   2. Pegar este código en Code.gs
//   3. Cambiar el valor de ACCESS_TOKEN (más abajo) por un token propio
//   4. Implementar → Nueva implementación → Aplicación web
//      - Ejecutar como: Yo
//      - Quién tiene acceso: Cualquier usuario (o "Usuarios de tu organización")
//   5. Copiar la URL y pegarla en la aplicación web, junto con el
//      mismo ACCESS_TOKEN que configuró en el paso 3
//   6. Ejecutar UNA VEZ la función configurarTriggerSemanal() desde
//      este editor para activar el traspaso automático de pendientes
//      y la inyección de actividades rutinarias cada lunes.
// ============================================================

// ============================================================
// CONFIGURACIÓN — Cambie el nombre de la hoja si es diferente
// ============================================================
var SHEET_NAME = 'Planificacion';
var RUTINARIAS_SHEET_NAME = 'Actividades_Rutinarias';

// Límite de horas diarias por colaborador (en minutos). 8h = 480 min.
var LIMITE_MINUTOS_DIA = 480;

// Encabezados de la hoja Planificacion (el ORDEN define la posición de columna).
var HEADERS = [
  'ID', 'Fecha_Creacion', 'Area', 'Actividad', 'Dia_Semana', 'Prioridad',
  'Duracion', 'Colaborador', 'Fecha_Planificada', 'Semana_Lunes',
  'Ejecutada', 'Fecha_Ejecucion', 'Origen'
];

var RUTINARIAS_HEADERS = ['Actividad', 'Día', 'Tiempo', 'Colaborador', 'Prioridad', 'Área'];

var DIAS_ORDEN  = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
var DIAS_OFFSET = { 'Lunes': 0, 'Martes': 1, 'Miércoles': 2, 'Jueves': 3, 'Viernes': 4, 'Sábado': 5, 'Domingo': 6 };

// ============================================================
// SEGURIDAD — Token de acceso compartido
// ------------------------------------------------------------
// Cambie este valor por uno propio antes de implementar (letras,
// números, sin espacios). Debe coincidir con el token que se
// ingresa en el modal de configuración del frontend.
// Cualquiera con la URL pero SIN este token no podrá leer ni
// escribir datos.
// ============================================================
var ACCESS_TOKEN = 'CAMBIA-ESTE-TOKEN-2026';

function isTokenValid(token) {
  return ACCESS_TOKEN && token === ACCESS_TOKEN;
}

// ============================================================
// GET — Leer tareas
// ============================================================
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = params.action || 'get';

    if (!isTokenValid(params.token)) {
      return buildResponse({ status: 'error', message: 'No autorizado. Token de acceso inválido.' });
    }

    if (action === 'get') {
      var data = getTasks();
      return buildResponse({ status: 'ok', data: data });
    }

    if (action === 'colaboradores') {
      var nombres = getColaboradores();
      return buildResponse({ status: 'ok', data: nombres });
    }

    if (action === 'areas') {
      var areas = getAreas();
      return buildResponse({ status: 'ok', data: areas });
    }

    return buildResponse({ status: 'error', message: 'Acción no reconocida.' });

  } catch (err) {
    return buildResponse({ status: 'error', message: err.message });
  }
}

// ============================================================
// POST — Guardar/eliminar/mover/marcar tarea
// ============================================================
function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action || 'add';

    if (!isTokenValid(body.token)) {
      return buildResponse({ status: 'error', message: 'No autorizado. Token de acceso inválido.' });
    }

    if (action === 'add') {
      var id = addTask(body);
      return buildResponse({ status: 'ok', id: id, message: 'Tarea guardada correctamente.' });
    }

    if (action === 'addBatch') {
      var resultado = addBatchTasks(body);
      return buildResponse({ status: 'ok', added: resultado.added, skipped: resultado.skipped });
    }

    if (action === 'delete') {
      deleteTask(body.id);
      return buildResponse({ status: 'ok', message: 'Tarea eliminada.' });
    }

    if (action === 'move') {
      moveTask(body.id, body.nuevoDia);
      return buildResponse({ status: 'ok', message: 'Tarea movida.' });
    }

    if (action === 'setEjecutada') {
      setEjecutada(body.id, body.ejecutada);
      return buildResponse({ status: 'ok', message: 'Estado actualizado.' });
    }

    if (action === 'injectRoutines') {
      var resultadoRutinas = injectRoutinesForWeek(body.semanaLunes);
      return buildResponse({ status: 'ok', insertadas: resultadoRutinas.insertadas });
    }

    if (action === 'sendEmail') {
      sendPlanningEmail(body);
      return buildResponse({ status: 'ok', message: 'Correo enviado.' });
    }

    return buildResponse({ status: 'error', message: 'Acción no reconocida.' });

  } catch (err) {
    return buildResponse({ status: 'error', message: err.message });
  }
}

// ============================================================
// HELPERS DE FECHA / SEMANA
// ============================================================

/**
 * Devuelve la fecha del lunes (00:00) de la semana que contiene `date`.
 */
function getMonday(date) {
  var d = new Date(date);
  d.setHours(0, 0, 0, 0);
  var day  = d.getDay(); // 0=Domingo..6=Sábado
  var diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date, n) {
  var d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDateKey(date) {
  var d = new Date(date);
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function isValidSemanaLunesKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

/**
 * Parsea una clave "YYYY-MM-DD" a Date en hora local, evitando el
 * desfase de un día que causa `new Date("YYYY-MM-DD")` (lo interpreta
 * en UTC) en zonas horarias con offset negativo.
 */
function parseDateKey(key) {
  var parts = key.split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

// ============================================================
// HELPERS DE HOJA — Planificacion
// ============================================================

/**
 * Obtiene la hoja de cálculo. La crea con encabezados si no existe,
 * y asegura que tenga las columnas nuevas si venía de una versión anterior.
 */
function getSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 200);  // ID
    sheet.setColumnWidth(2, 180);  // Fecha_Creacion
    sheet.setColumnWidth(3, 160);  // Area
    sheet.setColumnWidth(4, 400);  // Actividad
    sheet.setColumnWidth(5, 120);  // Dia_Semana
    sheet.setColumnWidth(6, 90);   // Prioridad
    sheet.setColumnWidth(7, 100);  // Duracion
    sheet.setColumnWidth(8, 180);  // Colaborador
    sheet.setColumnWidth(9, 130);  // Fecha_Planificada
    sheet.setColumnWidth(10, 120); // Semana_Lunes
    sheet.setColumnWidth(11, 90);  // Ejecutada
    sheet.setColumnWidth(12, 150); // Fecha_Ejecucion
    sheet.setColumnWidth(13, 110); // Origen
  }

  ensureSheetSchema(sheet);
  return sheet;
}

/**
 * Agrega al final cualquier columna de HEADERS que falte, sin tocar
 * las columnas existentes. Permite migrar hojas creadas con versiones
 * anteriores del sistema (8 columnas) sin perder datos.
 */
function ensureSheetSchema(sheet) {
  var lastCol   = sheet.getLastColumn();
  var headerRow = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var missing   = [];

  for (var i = 0; i < HEADERS.length; i++) {
    if (headerRow.indexOf(HEADERS[i]) === -1) missing.push(HEADERS[i]);
  }

  if (missing.length > 0) {
    var startCol = lastCol + 1;
    var range = sheet.getRange(1, startCol, 1, missing.length);
    range.setValues([missing]);
    range.setFontWeight('bold');
  }
}

function generateId() {
  return Utilities.getUuid();
}

/**
 * Lee todas las tareas y las devuelve como array de objetos.
 * Migra de forma perezosa las filas antiguas que no tengan
 * Fecha_Planificada/Semana_Lunes (las asigna a la semana actual).
 */
function getTasks() {
  var sheet   = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var range  = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
  var values = range.getValues();
  var tasks  = [];
  var needsWrite = false;

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue; // Saltear filas vacías

    var diaSemana = String(row[4]);

    if (!row[8] || !row[9]) {
      var monday = getMonday(new Date());
      var offset = DIAS_OFFSET.hasOwnProperty(diaSemana) ? DIAS_OFFSET[diaSemana] : 0;
      row[8] = addDays(monday, offset);
      row[9] = monday;
      needsWrite = true;
    }
    if (row[10] === '' || row[10] === null || row[10] === undefined) {
      row[10] = false;
      needsWrite = true;
    }
    if (!row[12]) {
      row[12] = 'Manual';
      needsWrite = true;
    }

    tasks.push({
      id:              String(row[0]),
      fecha_creacion:  row[1] ? new Date(row[1]).toISOString() : null,
      area:            String(row[2]),
      actividad:       String(row[3]),
      dia:             diaSemana,
      prioridad:       parseInt(row[5]) || 1,
      duracion:        row[6] ? String(row[6]) : '',
      colaborador:     row[7] ? String(row[7]) : '',
      fecha_planificada: row[8] ? formatDateKey(row[8]) : '',
      semana_lunes:      row[9] ? formatDateKey(row[9]) : '',
      ejecutada:         row[10] === true || row[10] === 'TRUE',
      fecha_ejecucion:   row[11] ? new Date(row[11]).toISOString() : null,
      origen:            row[12] ? String(row[12]) : 'Manual',
    });
  }

  if (needsWrite) {
    range.setValues(values);
  }

  return tasks;
}

/**
 * Convierte un texto de duración tipo "2h 30min" a minutos totales.
 * Replica la misma lógica del frontend (app.js) para poder validar
 * el límite diario también en el servidor.
 * @param {string} durStr
 * @returns {number}
 */
function parseDurationToMinutes(durStr) {
  if (!durStr) return 0;
  var total = 0;
  var matchH = String(durStr).match(/(\d+)h/);
  var matchM = String(durStr).match(/(\d+)min/);
  if (matchH) total += parseInt(matchH[1], 10) * 60;
  if (matchM) total += parseInt(matchM[1], 10);
  return total;
}

/**
 * Suma los minutos ya asignados a un colaborador en un día y semana
 * dados, leyendo directamente la hoja (no confía en el frontend).
 * @param {string} colaborador
 * @param {string} dia
 * @param {string} semanaLunesKey - clave YYYY-MM-DD del lunes de la semana
 * @param {string} [excludeId] - ID de tarea a excluir del cómputo (para mover)
 * @returns {number} minutos totales ya asignados
 */
function getMinutosAsignados(colaborador, dia, semanaLunesKey, excludeId) {
  var tasks = getTasks();
  var total = 0;
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (excludeId && String(t.id) === String(excludeId)) continue;
    if (t.colaborador === colaborador && t.dia === dia && t.semana_lunes === semanaLunesKey) {
      total += parseDurationToMinutes(t.duracion);
    }
  }
  return total;
}

/**
 * Construye un mapa "colaborador||dia" -> minutos ya usados, para una
 * semana específica. Usado por addBatchTasks/procesarFinDeSemana para
 * evitar releer la hoja en cada iteración.
 */
function buildMinutosMap(tasks, semanaLunesKey) {
  var map = {};
  tasks.forEach(function (t) {
    if (t.semana_lunes !== semanaLunesKey) return;
    var key = t.colaborador + '||' + t.dia;
    map[key] = (map[key] || 0) + parseDurationToMinutes(t.duracion);
  });
  return map;
}

function validarCamposComunes(data) {
  if (!data.area)      throw new Error('El campo "area" es requerido.');
  if (!data.actividad) throw new Error('El campo "actividad" es requerido.');
  if (!data.prioridad) throw new Error('El campo "prioridad" es requerido.');

  var areasValidas = getAreas();
  if (areasValidas.length > 0 && areasValidas.indexOf(data.area) === -1) {
    throw new Error('Área no válida.');
  }

  var prioridad = parseInt(data.prioridad);
  if (prioridad < 1 || prioridad > 5) throw new Error('Prioridad debe estar entre 1 y 5.');
  return prioridad;
}

/**
 * Agrega una nueva tarea a la hoja de cálculo (flujo de un solo
 * día/colaborador). Usa LockService para evitar condiciones de carrera
 * y valida el límite de 8h/día en el servidor.
 * @param {Object} data - { area, actividad, dia, prioridad, duracion, colaborador }
 * @returns {string} ID de la nueva tarea
 */
function addTask(data) {
  var prioridad = validarCamposComunes(data);

  if (!data.dia) throw new Error('El campo "dia" es requerido.');
  if (DIAS_ORDEN.indexOf(data.dia) === -1) throw new Error('Día no válido.');
  if (!data.colaborador) throw new Error('El campo "colaborador" es requerido.');

  var colaborador  = String(data.colaborador).trim();
  var duracion     = data.duracion ? String(data.duracion).trim() : '';
  var duracionMins = parseDurationToMinutes(duracion);

  var monday          = getMonday(new Date());
  var semanaLunesKey  = formatDateKey(monday);
  var fechaPlanificada = addDays(monday, DIAS_OFFSET[data.dia]);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    if (duracionMins > 0) {
      var minutosPrevios = getMinutosAsignados(colaborador, data.dia, semanaLunesKey);
      if (minutosPrevios + duracionMins > LIMITE_MINUTOS_DIA) {
        throw new Error(
          'El colaborador "' + colaborador + '" superaría el límite de 8 horas el ' +
          data.dia + ' (ya tiene ' + formatMinutes(minutosPrevios) +
          ' asignados). Elija otro día u otro colaborador.'
        );
      }
    }

    var id    = generateId();
    var sheet = getSheet();

    sheet.appendRow([
      id, new Date(), data.area, String(data.actividad).trim(), data.dia, prioridad,
      duracion, colaborador, fechaPlanificada, monday, false, '', 'Manual',
    ]);

    return id;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Agrega varias tareas de una sola vez a partir de listas de días y
 * colaboradores (producto cruzado): una fila por cada combinación
 * día×colaborador. Las combinaciones que excederían el límite de 8h
 * se omiten y se reportan en `skipped`, el resto se guarda.
 * @param {Object} data - { area, actividad, prioridad, duracion, dias:[], colaboradores:[], semanaLunes? }
 *   `semanaLunes` (opcional) es la clave "YYYY-MM-DD" del lunes de la
 *   semana elegida en el selector de semana del formulario; si no se
 *   envía, se usa la semana calendario actual.
 * @returns {{added: string[], skipped: Array<{dia,colaborador,motivo}>}}
 */
function addBatchTasks(data) {
  var prioridad = validarCamposComunes(data);

  if (!Array.isArray(data.dias) || data.dias.length === 0) {
    throw new Error('Debe seleccionar al menos un día.');
  }
  if (!Array.isArray(data.colaboradores) || data.colaboradores.length === 0) {
    throw new Error('Debe seleccionar al menos un colaborador.');
  }
  data.dias.forEach(function (d) {
    if (DIAS_ORDEN.indexOf(d) === -1) throw new Error('Día no válido: ' + d);
  });

  var actividad = String(data.actividad).trim();
  if (!actividad) throw new Error('El campo "actividad" es requerido.');
  var duracion     = data.duracion ? String(data.duracion).trim() : '';
  var duracionMins = parseDurationToMinutes(duracion);

  // Semana destino: la que eligió el usuario en el selector de semana del
  // formulario (dias.semanaLunes = "YYYY-MM-DD"), o la semana actual si no se envía.
  var monday = isValidSemanaLunesKey(data.semanaLunes)
    ? getMonday(parseDateKey(data.semanaLunes))
    : getMonday(new Date());
  var semanaLunesKey = formatDateKey(monday);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet      = getSheet();
    var minutosMap = buildMinutosMap(getTasks(), semanaLunesKey);

    var added   = [];
    var skipped = [];
    var newRows = [];

    data.dias.forEach(function (dia) {
      var fechaPlanificada = addDays(monday, DIAS_OFFSET[dia]);

      data.colaboradores.forEach(function (colabRaw) {
        var colaborador = String(colabRaw).trim();
        if (!colaborador) return;

        var key     = colaborador + '||' + dia;
        var previos = minutosMap[key] || 0;

        if (duracionMins > 0 && previos + duracionMins > LIMITE_MINUTOS_DIA) {
          skipped.push({
            dia: dia, colaborador: colaborador,
            motivo: 'Supera el límite de 8 horas (' + formatMinutes(previos) + ' ya asignados).',
          });
          return;
        }

        var id = generateId();
        newRows.push([
          id, new Date(), data.area, actividad, dia, prioridad, duracion,
          colaborador, fechaPlanificada, monday, false, '', 'Manual',
        ]);
        minutosMap[key] = previos + duracionMins;
        added.push(id);
      });
    });

    if (newRows.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, newRows.length, HEADERS.length).setValues(newRows);
    }

    return { added: added, skipped: skipped };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Mueve una tarea existente a otro día de la misma semana (drag&drop
 * en el tablero). Valida el límite de 8h del colaborador en el día
 * destino (excluyendo la propia tarea).
 * @param {string} id
 * @param {string} nuevoDia
 */
function moveTask(id, nuevoDia) {
  if (!id) throw new Error('ID requerido.');
  if (DIAS_ORDEN.indexOf(nuevoDia) === -1) throw new Error('Día no válido.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet   = getSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) throw new Error('Tarea no encontrada con ID: ' + id);

    var range  = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
    var values = range.getValues();

    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0]) === String(id)) {
        var row          = values[i];
        var colaborador  = String(row[7]);
        var duracion     = row[6] ? String(row[6]) : '';
        var duracionMins = parseDurationToMinutes(duracion);
        var semanaLunesDate = row[9] ? new Date(row[9]) : getMonday(new Date());
        var semanaLunesKey  = formatDateKey(semanaLunesDate);

        if (duracionMins > 0) {
          var minutosPrevios = getMinutosAsignados(colaborador, nuevoDia, semanaLunesKey, id);
          if (minutosPrevios + duracionMins > LIMITE_MINUTOS_DIA) {
            throw new Error(
              'El colaborador "' + colaborador + '" superaría el límite de 8 horas el ' +
              nuevoDia + ' (ya tiene ' + formatMinutes(minutosPrevios) + ' asignados).'
            );
          }
        }

        var nuevaFecha = addDays(semanaLunesDate, DIAS_OFFSET[nuevoDia]);
        sheet.getRange(i + 2, 5).setValue(nuevoDia);   // Dia_Semana
        sheet.getRange(i + 2, 9).setValue(nuevaFecha); // Fecha_Planificada
        return;
      }
    }
    throw new Error('Tarea no encontrada con ID: ' + id);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Marca (o desmarca) una tarea como ejecutada, registrando la fecha
 * de ejecución. Usado por el botón "Marcar ejecutada" del tablero.
 * @param {string} id
 * @param {boolean} ejecutada
 */
function setEjecutada(id, ejecutada) {
  if (!id) throw new Error('ID requerido.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet   = getSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) throw new Error('Tarea no encontrada con ID: ' + id);

    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        sheet.getRange(i + 2, 11).setValue(!!ejecutada);
        sheet.getRange(i + 2, 12).setValue(ejecutada ? new Date() : '');
        return;
      }
    }
    throw new Error('Tarea no encontrada con ID: ' + id);
  } finally {
    lock.releaseLock();
  }
}

function formatMinutes(mins) {
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  return h + 'h ' + (m < 10 ? '0' + m : m) + 'min';
}

/**
 * Lee los colaboradores desde la hoja "Colaboradores".
 * Lee columna A (Nombre) y columna B (Puesto) si existe.
 * Detecta automáticamente si la fila 1 es encabezado.
 * @returns {Array<Object>} Lista de { nombre, puesto }
 */
function getColaboradores() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Colaboradores');

  if (!sheet) {
    throw new Error('No se encontró la hoja "Colaboradores" en el archivo.');
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];

  // Leer todas las filas con datos
  var values = sheet.getRange(1, 1, lastRow, Math.max(lastCol, 2)).getValues();
  if (values.length === 0) return [];

  // Detectar si fila 1 es encabezado: si la celda A1 NO parece un nombre propio
  // (encabezados suelen ser: "Nombre", "Colaborador", "Nombres", "NOMBRE", etc.)
  var firstCell = String(values[0][0]).trim().toLowerCase();
  var esEncabezado = (firstCell === 'nombre' || firstCell === 'colaborador' ||
                      firstCell === 'nombres' || firstCell === 'nombre completo' ||
                      firstCell === 'empleado' || firstCell === 'trabajador');
  var startRow = esEncabezado ? 1 : 0;

  var colaboradores = [];
  for (var i = startRow; i < values.length; i++) {
    var nombre = String(values[i][0]).trim();
    var puesto = values[i].length > 1 ? String(values[i][1]).trim() : '';
    if (nombre) {
      colaboradores.push({ nombre: nombre, puesto: puesto });
    }
  }

  return colaboradores;
}

/**
 * Lee las áreas disponibles desde la hoja "Area" (columna A).
 * Detecta automáticamente si la fila 1 es encabezado.
 * @returns {Array<string>} Lista de nombres de área
 */
function getAreas() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Area') || ss.getSheetByName('Área');

  if (!sheet) {
    throw new Error('No se encontró la hoja "Area" en el archivo.');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];

  var values = sheet.getRange(1, 1, lastRow, 1).getValues();
  if (values.length === 0) return [];

  var firstCell = String(values[0][0]).trim().toLowerCase();
  var esEncabezado = (firstCell === 'area' || firstCell === 'área' ||
                      firstCell === 'areas' || firstCell === 'áreas');
  var startRow = esEncabezado ? 1 : 0;

  var areas = [];
  for (var i = startRow; i < values.length; i++) {
    var nombre = String(values[i][0]).trim();
    if (nombre) areas.push(nombre);
  }

  return areas;
}

/**
 * Elimina una tarea por ID.
 * @param {string} id - ID de la tarea a eliminar
 */
function deleteTask(id) {
  if (!id) throw new Error('ID requerido para eliminar.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet  = getSheet();
    var values = sheet.getDataRange().getValues();

    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(id)) {
        sheet.deleteRow(i + 1);
        return;
      }
    }
    throw new Error('Tarea no encontrada con ID: ' + id);
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// HOJA — Actividades_Rutinarias
// ============================================================

/**
 * Obtiene la hoja "Actividades_Rutinarias". La crea con encabezados
 * si no existe. El usuario la llena manualmente con las tareas que
 * deben repetirse cada semana.
 */
function getActividadesRutinariasSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(RUTINARIAS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(RUTINARIAS_SHEET_NAME);
    sheet.appendRow(RUTINARIAS_HEADERS);
    sheet.getRange(1, 1, 1, RUTINARIAS_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 350); // Actividad
    sheet.setColumnWidth(2, 120); // Día
    sheet.setColumnWidth(3, 100); // Tiempo
    sheet.setColumnWidth(4, 180); // Colaborador
    sheet.setColumnWidth(5, 90);  // Prioridad
    sheet.setColumnWidth(6, 200); // Área
  }
  return sheet;
}

/**
 * Lee el catálogo de actividades rutinarias.
 * @returns {Array<Object>} { actividad, dia, tiempo, colaborador, prioridad, area }
 */
function getActividadesRutinarias() {
  var sheet   = getActividadesRutinariasSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, RUTINARIAS_HEADERS.length).getValues();
  var rutinas = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue;
    rutinas.push({
      actividad:   String(row[0]).trim(),
      dia:         String(row[1]).trim(),
      tiempo:      row[2] ? String(row[2]).trim() : '',
      colaborador: row[3] ? String(row[3]).trim() : '',
      prioridad:   parseInt(row[4]) || 1,
      area:        String(row[5]).trim(),
    });
  }
  return rutinas;
}

// ============================================================
// TRASPASO SEMANAL AUTOMÁTICO
// ============================================================

/**
 * Copia a la semana indicada (o a la actual si no se especifica) las
 * actividades del catálogo "Actividades_Rutinarias" que aún no se
 * hayan inyectado para esa semana. Es idempotente: se puede llamar
 * cuantas veces se quiera sin duplicar filas. Usada por el botón
 * "Cargar Rutinas" del frontend y por procesarFinDeSemana().
 * @param {string} [semanaLunesInput] - clave YYYY-MM-DD del lunes de la semana destino
 * @returns {{insertadas: number}}
 */
function injectRoutinesForWeek(semanaLunesInput) {
  var semanaDate = semanaLunesInput ? getMonday(new Date(semanaLunesInput)) : getMonday(new Date());
  var semanaKey  = formatDateKey(semanaDate);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet    = getSheet();
    var allTasks = getTasks();

    var yaInyectadas = {};
    allTasks.forEach(function (t) {
      if (t.origen === 'Rutinaria' && t.semana_lunes === semanaKey) {
        yaInyectadas[t.actividad + '||' + t.colaborador + '||' + t.dia] = true;
      }
    });

    var newRows = [];
    getActividadesRutinarias().forEach(function (r) {
      if (!r.actividad || !r.dia || DIAS_ORDEN.indexOf(r.dia) === -1) return;
      var key = r.actividad + '||' + r.colaborador + '||' + r.dia;
      if (yaInyectadas[key]) return;

      var fechaPlanificada = addDays(semanaDate, DIAS_OFFSET[r.dia]);
      var id = generateId();
      newRows.push([
        id, new Date(), r.area, r.actividad, r.dia, r.prioridad, r.tiempo,
        r.colaborador, fechaPlanificada, semanaDate, false, '', 'Rutinaria',
      ]);
      yaInyectadas[key] = true;
    });

    if (newRows.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, newRows.length, HEADERS.length).setValues(newRows);
    }

    return { insertadas: newRows.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Función que corre por trigger cada lunes temprano:
 *   1) Inyecta en la semana que empieza las actividades del catálogo
 *      "Actividades_Rutinarias" (idempotente: no duplica si ya corrió).
 *   2) Traspasa a la semana que empieza las tareas de la semana que
 *      terminó que no fueron marcadas como ejecutadas, ordenándolas
 *      por prioridad y encajándolas desde el lunes respetando el
 *      límite de 8h/día por colaborador (si no caben en ningún día,
 *      se colocan el domingo como desborde visible).
 * Instale el trigger ejecutando UNA VEZ configurarTriggerSemanal().
 */
function procesarFinDeSemana() {
  var semanaNuevaDate      = getMonday(new Date());
  var semanaQueTerminaDate = addDays(semanaNuevaDate, -7);
  var semanaNuevaKey       = formatDateKey(semanaNuevaDate);
  var semanaQueTerminaKey  = formatDateKey(semanaQueTerminaDate);

  // ---- 1) Inyectar actividades rutinarias en la semana nueva ----
  injectRoutinesForWeek(semanaNuevaKey);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet    = getSheet();
    var allTasks = getTasks(); // re-leer: ya incluye las rutinas recién inyectadas

    var minutosMap = buildMinutosMap(allTasks, semanaNuevaKey);
    var newRows = [];

    // ---- 2) Traspasar pendientes de la semana que terminó ----
    var pendientes = allTasks.filter(function (t) {
      return t.semana_lunes === semanaQueTerminaKey && !t.ejecutada;
    });

    var porColaborador = {};
    pendientes.forEach(function (t) {
      if (!porColaborador[t.colaborador]) porColaborador[t.colaborador] = [];
      porColaborador[t.colaborador].push(t);
    });

    Object.keys(porColaborador).forEach(function (colaborador) {
      var lista = porColaborador[colaborador];
      lista.sort(function (a, b) { return b.prioridad - a.prioridad; });

      lista.forEach(function (t) {
        var duracionMins = parseDurationToMinutes(t.duracion);
        var diaElegido = null;

        for (var d = 0; d < DIAS_ORDEN.length; d++) {
          var dia    = DIAS_ORDEN[d];
          var mapKey = colaborador + '||' + dia;
          var usado  = minutosMap[mapKey] || 0;
          if (duracionMins === 0 || usado + duracionMins <= LIMITE_MINUTOS_DIA) {
            diaElegido = dia;
            break;
          }
        }
        if (!diaElegido) diaElegido = DIAS_ORDEN[DIAS_ORDEN.length - 1]; // Domingo, desborde

        var fechaPlanificada = addDays(semanaNuevaDate, DIAS_OFFSET[diaElegido]);
        var id = generateId();
        newRows.push([
          id, new Date(), t.area, t.actividad, diaElegido, t.prioridad, t.duracion,
          colaborador, fechaPlanificada, semanaNuevaDate, false, '', 'Traspaso',
        ]);

        var mapKeyFinal = colaborador + '||' + diaElegido;
        minutosMap[mapKeyFinal] = (minutosMap[mapKeyFinal] || 0) + duracionMins;
      });
    });

    if (newRows.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, newRows.length, HEADERS.length).setValues(newRows);
    }

    Logger.log('procesarFinDeSemana: ' + newRows.length + ' fila(s) creadas para la semana ' + semanaNuevaKey);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Ejecute esta función UNA SOLA VEZ desde el editor de Apps Script
 * (menú de funciones → seleccionar "configurarTriggerSemanal" → Ejecutar)
 * para instalar el trigger que corre procesarFinDeSemana() cada lunes.
 * Es seguro volver a ejecutarla: elimina triggers previos antes de crear uno nuevo.
 */
function configurarTriggerSemanal() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'procesarFinDeSemana') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('procesarFinDeSemana')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(0)
    .nearMinute(5)
    .create();

  Logger.log('Trigger semanal configurado: procesarFinDeSemana correrá cada lunes ~00:05.');
}

// ============================================================
// ENVÍO DE CORREO — Planificación Semanal / Reporte de Seguimiento
// ============================================================

/**
 * Envía por correo (con MailApp) el PDF que generó el frontend con
 * jsPDF, adjuntándolo al mensaje. El límite diario de MailApp depende
 * del tipo de cuenta de Google (≈100/día en cuentas gratuitas).
 * @param {Object} data - { to: string[]|string, subject, body, pdfBase64, filename }
 */
function sendPlanningEmail(data) {
  var destinatarios = Array.isArray(data.to) ? data.to.filter(Boolean).join(',') : String(data.to || '').trim();
  if (!destinatarios) throw new Error('Debe indicar al menos un destinatario.');
  if (!data.pdfBase64) throw new Error('No se recibió el PDF a enviar.');

  var asunto = data.subject ? String(data.subject) : 'Planificación Semanal';
  var cuerpo = data.body ? String(data.body) : 'Se adjunta el archivo PDF.';
  var nombreArchivo = data.filename ? String(data.filename) : 'planificacion.pdf';

  var pdfBytes = Utilities.base64Decode(data.pdfBase64);
  var blob = Utilities.newBlob(pdfBytes, 'application/pdf', nombreArchivo);

  MailApp.sendEmail({
    to: destinatarios,
    subject: asunto,
    body: cuerpo,
    attachments: [blob],
  });
}

/**
 * Construye la respuesta JSON con encabezados CORS correctos.
 */
function buildResponse(data) {
  var output = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}
