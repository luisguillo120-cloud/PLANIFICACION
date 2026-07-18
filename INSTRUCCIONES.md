# 📋 Instrucciones de Configuración — PlanificaPlanta

## Arquitectura General

```
[Navegador Web] ──POST/GET──▶ [Google Apps Script Web App] ──▶ [Google Sheets]
```

---

## PASO 1 — Crear la Hoja de Google Sheets

1. Abra [Google Sheets](https://sheets.google.com) y cree una nueva hoja de cálculo.
2. Asígnele un nombre descriptivo, por ejemplo: **"PlanificaPlanta - BD"**.
3. **El Apps Script creará automáticamente las hojas internas** `Planificacion` y `Actividades_Rutinarias` con sus encabezados la primera vez que se ejecute. No es necesario hacerlo manualmente.
4. Debe existir además una hoja llamada **`Colaboradores`** (columna A = Nombre, columna B = Puesto opcional) — esta sí debe crearla y llenarla usted manualmente.

> **Opcional (verificación):** Después de desplegar, si desea verificar, la hoja `Planificacion` tendrá las columnas:
> `ID | Fecha_Creacion | Area | Actividad | Dia_Semana | Prioridad | Duracion | Colaborador | Fecha_Planificada | Semana_Lunes | Ejecutada | Fecha_Ejecucion | Origen`
>
> Las columnas `Fecha_Planificada`/`Semana_Lunes` ligan cada tarea a una fecha real (para el navegador de semanas). `Ejecutada`/`Fecha_Ejecucion` alimentan la pestaña "Seguimiento". `Origen` indica si la tarea fue creada manualmente (`Manual`), inyectada desde el catálogo de rutinas (`Rutinaria`) o traspasada automáticamente desde una semana anterior sin ejecutar (`Traspaso`).

### Hoja `Actividades_Rutinarias` (catálogo de tareas recurrentes)

También se crea automáticamente, con las columnas `Actividad | Día | Tiempo | Colaborador | Prioridad | Área`. Llénela manualmente con las tareas que deben repetirse **todas las semanas** (ej. "Inspección de extintores" — Lunes — "0h 30min" — Juan Pérez — 3 — Seguridad/Medioambiente). Cada lunes, el sistema las copia automáticamente a la nueva semana de planificación (ver Paso 2.5).

---

## PASO 2 — Configurar Google Apps Script

### 2.1 Abrir el editor de Apps Script

Con la hoja de Google Sheets abierta:
1. En el menú superior, haga clic en **Extensiones**
2. Seleccione **Apps Script**
3. Se abrirá el editor en una nueva pestaña

### 2.2 Pegar el código

1. En el editor, haga clic en el archivo **`Code.gs`** (en el panel izquierdo)
2. **Seleccione todo** el contenido existente (Ctrl+A) y **bórrelo**
3. **Copie y pegue** el contenido completo del archivo `Code.gs` que se encuentra en esta carpeta
4. Haga clic en el ícono de **guardar** (💾) o presione **Ctrl+S**

### 2.3 Configurar el manifest (appsscript.json)

1. En el panel izquierdo, haga clic en **⚙️ Configuración del proyecto**
2. Active la opción **"Mostrar el archivo de manifiesto appsscript.json en el editor"**
3. Vuelva al editor y haga clic en **`appsscript.json`**
4. Reemplace su contenido con el del archivo `appsscript.json` de esta carpeta
5. Ajuste `"timeZone"` a su zona horaria si es diferente:
   - México: `"America/Mexico_City"`
   - Colombia/Perú/Ecuador: `"America/Lima"`
   - Argentina: `"America/Argentina/Buenos_Aires"`
   - Chile: `"America/Santiago"`
   - Venezuela: `"America/Caracas"`
6. Guarde con **Ctrl+S**

### 2.4 🔒 Configurar el token de acceso (IMPORTANTE)

Por seguridad, el backend ahora exige un **token de acceso**: sin él, nadie puede leer ni escribir datos aunque conozca la URL de la aplicación.

1. En `Code.gs`, busque la línea:
   ```javascript
   var ACCESS_TOKEN = 'CAMBIA-ESTE-TOKEN-2026';
   ```
2. Reemplace el valor por uno propio (letras y números, sin espacios). Ejemplo: `'planta-norte-8f2k91'`
3. Guarde con **Ctrl+S**
4. **Anote este token** — lo va a necesitar en el Paso 4 para conectar el frontend.

> Si más adelante quiere revocar el acceso a todos los usuarios (por ejemplo, si el token se filtró), simplemente cambie este valor y vuelva a implementar (Paso 3). Cada usuario deberá ingresar el nuevo token en su navegador.

### 2.5 🔁 Activar el traspaso automático semanal (IMPORTANTE)

El sistema puede, cada lunes de madrugada, copiar automáticamente a la nueva semana las actividades del catálogo `Actividades_Rutinarias` y las tareas de la semana anterior que **no** se marcaron como ejecutadas (respetando el límite de 8h/día por colaborador, ordenando por prioridad). Para activarlo:

1. En el editor de Apps Script, en la barra superior donde dice **"Seleccionar función a ejecutar"**, elija **`configurarTriggerSemanal`**.
2. Haga clic en **▶️ Ejecutar**.
3. La primera vez le pedirá **autorizar permisos adicionales** (para crear triggers) — acéptelos.
4. Verifique en el editor, menú **⏰ Activadores** (icono del reloj en la barra lateral), que aparece un activador de tipo *Basado en tiempo* apuntando a `procesarFinDeSemana`, programado para "cada lunes".

> Es seguro volver a ejecutar `configurarTriggerSemanal` si necesita reinstalar el activador (por ejemplo, después de copiar el proyecto a otra hoja): elimina el activador anterior antes de crear uno nuevo, por lo que nunca quedan duplicados.

### 2.6 📧 Envío de correo con PDF adjunto

Los botones **"Enviar por Correo"** (en Planificación Semanal y en Seguimiento) generan un PDF en el navegador y lo envían mediante `MailApp` desde la cuenta de Google con la que desplegó el Apps Script.

- La **primera vez** que se use, Apps Script puede pedir autorizar el permiso adicional para enviar correo — acéptelo (aparece al ejecutar `doPost` con la acción `sendEmail`, o puede autorizarlo antes ejecutando manualmente `sendPlanningEmail` una vez desde el editor).
- Las cuentas de Gmail gratuitas tienen un límite de **~100 correos por día**; las cuentas de Google Workspace tienen límites más altos.
- El PDF que se adjunta se genera con una librería en el navegador (jsPDF), por lo que el diseño es un poco más simple que el de "Imprimir" (no requiere que el destinatario reciba nada más que el archivo).

---

## PASO 3 — Desplegar como Aplicación Web

1. En el editor de Apps Script, haga clic en el botón **"Implementar"** (esquina superior derecha)
2. Seleccione **"Nueva implementación"**
3. Haga clic en **⚙️ (configuración)** junto a "Seleccionar tipo" y elija **"Aplicación web"**
4. Complete la configuración:

   | Campo | Valor recomendado |
   |-------|-------------------|
   | **Descripción** | `PlanificaPlanta v1` |
   | **Ejecutar como** | `Yo (tu-email@gmail.com)` |
   | **Quién tiene acceso** | `Cualquier usuario` *(ver nota abajo)* |

5. Haga clic en **"Implementar"**
6. **Otorgue los permisos** cuando se le solicite (haga clic en "Autorizar acceso", seleccione su cuenta y acepte)
7. **COPIE la URL** que aparece — se verá así:
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```

> **Nota sobre acceso:** Si la aplicación es solo para uso personal o de su empresa con Google Workspace, puede seleccionar "Usuarios de tu organización" para mayor seguridad.

---

## PASO 4 — Conectar el Frontend

### Opción A — Usando los archivos localmente

1. Abra el archivo `index.html` en su navegador
2. Al cargarse por primera vez, aparecerá un **modal de configuración**
3. Pegue la URL del Apps Script obtenida en el Paso 3
4. Pegue también el **Token de Acceso** que configuró en el Paso 2.4
5. Haga clic en **"Guardar y Conectar"**
6. ✅ La aplicación se conectará automáticamente a Google Sheets

> Cada persona que use la aplicación necesita ingresar la URL **y** el token la primera vez que abre `index.html` en su navegador (se guarda localmente después de eso).

### Opción B — Hosting en GitHub Pages (gratuito)

1. Cree un repositorio en [GitHub](https://github.com)
2. Suba los archivos `index.html`, `style.css` y `app.js`
3. En el repositorio: **Settings → Pages → Branch: main → Save**
4. Su app estará disponible en `https://[usuario].github.io/[repositorio]`

### Opción C — Hosting en Google Drive

1. Suba los archivos a una carpeta en Google Drive
2. Comparta la carpeta como "cualquier persona con el enlace puede ver"
3. Use la URL de visualización de Google Drive

---

## PASO 5 — Verificar el Funcionamiento

### Test 1: Guardar una tarea con varios días y colaboradores
1. Vaya a la pestaña **"Registrar Actividad"**
2. Complete los campos, seleccionando **2 o más días** (píldoras) y **2 o más colaboradores** (buscador con chips)
3. Haga clic en **"Guardar Actividad"**
4. Debe crearse una tarea por cada combinación día×colaborador (ej. 2 días × 2 colaboradores = 4 filas nuevas)
5. Verifique en Google Sheets que las filas se agregaron con `Fecha_Planificada`/`Semana_Lunes` correctos

### Test 2: Ver el tablero y navegar semanas
1. Vaya a la pestaña **"Planificación Semanal"**
2. Las tareas deben aparecer agrupadas por día y ordenadas por prioridad (5 primero), solo las de la semana mostrada
3. Use las flechas **‹ ›** del navegador de semana para ver semanas anteriores/futuras, y "Ir a hoy" para volver
4. Use el filtro de área y el filtro de colaborador (pueden combinarse) para verificar el filtrado

### Test 3: Arrastrar y soltar entre días
1. En el tablero, arrastre una tarjeta de un día a otro
2. Debe actualizarse de inmediato y quedar reflejado en Google Sheets (`Dia_Semana`/`Fecha_Planificada`)
3. Si el colaborador ya tiene 8h ese día, debe revertirse y mostrar un mensaje de error

### Test 4: Marcar como ejecutada y ver el reporte
1. En una tarjeta del tablero, haga clic en el ícono de check (✔️)
2. La tarjeta debe verse atenuada/tachada
3. Vaya a la pestaña **"Seguimiento"** y confirme que la tarea aparece como "✅ Ejecutada" y que el % de cumplimiento se actualizó

### Test 5: Imprimir / exportar a PDF
1. En el tablero, haga clic en **"Imprimir / PDF"**
2. Debe abrirse la vista de impresión del navegador con un diseño limpio (sin botones, filtros ni menú)
3. Elija "Guardar como PDF" o imprima directamente

### Test 6: Eliminar una tarea
1. En cualquier tarjeta de tarea, haga clic en el ícono de basurero (🗑️) en la esquina superior derecha
2. Confirme la eliminación en el cuadro de diálogo
3. La tarea debe desaparecer del tablero y de la hoja de Google Sheets

### Test 7: Límite de 8 horas (validación en servidor)
1. Asigne varias tareas al mismo colaborador y al mismo día hasta acercarse a las 8 horas
2. Al guardar una combinación que excede el límite, debe aparecer el modal listando qué combinaciones se omitirán
3. Esta validación ocurre también en el servidor, por lo que es segura incluso si dos personas guardan al mismo tiempo

### Test 8: Traspaso automático y rutinas (manual, simulando el trigger)
1. En el editor de Apps Script, seleccione la función `procesarFinDeSemana` y ejecútela manualmente (▶️ Ejecutar)
2. Verifique en la hoja `Planificacion` que:
   - Las filas del catálogo `Actividades_Rutinarias` se copiaron a la semana entrante con `Origen = Rutinaria`
   - Las tareas de la semana anterior sin marcar como ejecutadas se copiaron a la semana entrante con `Origen = Traspaso`, respetando el límite de 8h/colaborador/día
3. Vuelva a ejecutar la función: no debe duplicar las filas de rutinas ya inyectadas (es idempotente)

---

## Solución de Problemas

### ❌ "Error al guardar" o "Error al cargar"
- Verifique que la URL del script sea correcta (debe terminar en `/exec`)
- Asegúrese de haber **re-desplegado** después de cualquier cambio al código
- Verifique que los permisos fueron otorgados correctamente

### ❌ "No autorizado" o error 403
- En el Apps Script, vaya a **Implementar → Administrar implementaciones**
- Edite la implementación y cambie el acceso a "Cualquier usuario"
- Haga clic en **"Implementar"** para aplicar el cambio

### ❌ "No autorizado. Token de acceso inválido."
- El token ingresado en el modal de configuración no coincide con `ACCESS_TOKEN` en `Code.gs`
- Verifique que copió el token exactamente (sin espacios extra) en ambos lugares
- Si cambió el token en `Code.gs` después de que otros ya configuraron la app, cada uno debe volver a ingresarlo

### ❌ El modal no desaparece
- Verifique en la consola del navegador (F12) si hay errores de red
- Asegúrese de que la URL pegada comience con `https://script.google.com/macros/s/`
- Asegúrese de haber ingresado también el token de acceso

### ❌ Cambiar la URL o el token del script después de configurados
- Abra la consola del navegador (F12 → Console)
- Ejecute:
  ```javascript
  localStorage.removeItem('planificaplanta_script_url');
  localStorage.removeItem('planificaplanta_access_token');
  ```
- Recargue la página — aparecerá nuevamente el modal de configuración

---

## Re-despliegue (Actualizaciones futuras)

Cuando modifique el código `Code.gs`:
1. En el editor de Apps Script: **Implementar → Administrar implementaciones**
2. Seleccione la implementación existente y haga clic en **✏️ Editar**
3. En "Versión", seleccione **"Nueva versión"**
4. Haga clic en **"Implementar"**
5. La URL del script **NO cambia** — no es necesario reconfigurar el frontend

---

## Estructura de Archivos del Proyecto

```
PLANIFICACION/
├── index.html          ← Interfaz principal (abrir en navegador)
├── style.css           ← Estilos del dashboard
├── app.js              ← Lógica del frontend
├── Code.gs             ← Backend Google Apps Script
├── appsscript.json     ← Configuración del proyecto Apps Script
└── INSTRUCCIONES.md    ← Este archivo
```

---

*PlanificaPlanta — Desarrollado para coordinación de planta manufacturera*
