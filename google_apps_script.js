/**
 * ====================================================================
 * BACKEND API - CLUSTER DE BIOTECNOLOGÍA DE CÓRDOBA
 * Google Apps Script para la Consola de Cobranzas
 * ====================================================================
 * 
 * Instrucciones breves de instalación:
 * 1. Crea una Google Sheet en tu cuenta de Google.
 * 2. En el menú superior de la hoja, ve a Extensiones > Apps Script.
 * 3. Borra todo el código existente y pega este archivo completo.
 * 4. Guarda el proyecto (icono de diskette).
 * 5. Pulsa en "Implementar" (arriba a la derecha) > "Nueva implementación".
 * 6. Tipo: "Aplicación web".
 * 7. Configura:
 *    - Ejecutar como: "Tú" (tu cuenta de correo institucional).
 *    - Quién tiene acceso: "Cualquiera" (necesario para que la SPA local pueda consultarla).
 * 8. Pulsa "Implementar", autoriza los permisos de Google que te solicite,
 *    y copia la "URL de la aplicación web" (la usaremos en el app.js).
 */

// NOMBRE DE LAS HOJAS DE TU GOOGLE SHEET
const HOJA_SOCIOS = "Socios";
const HOJA_HISTORIAL = "HistorialPagos";

// ID DE LA CARPETA DE GOOGLE DRIVE DONDE ESTÁN LOS PDFS DE LAS FACTURAS
// (Lo podés cambiar por el ID real de tu carpeta de Drive, o dejar en blanco para buscar en todo tu Drive)
const CARPETA_FACTURAS_ID = ""; 

/**
 * Recibe las solicitudes HTTP GET desde la aplicación local (SPA)
 */
function doGet(e) {
  const origin = e.parameter.origin || "*";
  let output;
  
  try {
    const action = e.parameter.action;
    
    if (action === "getSocios") {
      output = JSON.stringify({ success: true, data: obtenerSociosDeSheet() });
    } else {
      output = JSON.stringify({ success: false, error: "Acción no reconocida o faltante en GET." });
    }
  } catch (error) {
    output = JSON.stringify({ success: false, error: error.toString() });
  }
  
  return ContentService.createTextOutput(output)
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader("Access-Control-Allow-Origin", origin)
    .setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * Recibe las solicitudes HTTP POST (creación de borradores, registros de pago)
 */
function doPost(e) {
  const origin = e.parameter.origin || "*";
  let output;
  
  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;
    
    if (action === "registrarPago") {
      const result = registrarPagoSocio(postData.socioId, postData.periodo, postData.monto);
      output = JSON.stringify({ success: true, data: result });
    } 
    else if (action === "generarBorrador") {
      const result = generarBorradorGmail(postData.socioId, postData.periodo, postData.nivelAviso);
      output = JSON.stringify({ success: true, data: result });
    } 
    else if (action === "guardarSocio") {
      const result = guardarOEditarSocio(postData.socio);
      output = JSON.stringify({ success: true, data: result });
    }
    else {
      output = JSON.stringify({ success: false, error: "Acción no reconocida en POST." });
    }
  } catch (error) {
    output = JSON.stringify({ success: false, error: error.toString() });
  }
  
  return ContentService.createTextOutput(output)
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader("Access-Control-Allow-Origin", origin)
    .setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * Permite manejar las llamadas previas de CORS (OPTIONS)
 */
function doOptions(e) {
  return ContentService.createTextOutput("")
    .setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * Lee la base de datos de socios de Google Sheets
 */
function obtenerSociosDeSheet() {
  const sheet = obtenerOCrearHoja(HOJA_SOCIOS);
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) return []; // Solo cabecera o vacía
  
  const headers = data[0];
  const socios = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // Saltear filas sin ID
    
    let socio = {};
    headers.forEach((header, index) => {
      // Normalizar nombres de columnas a propiedades camelCase
      const key = normalizarCabecera(header);
      socio[key] = row[index];
    });
    socios.push(socio);
  }
  
  return socios;
}

/**
 * Guarda o edita un socio en la Google Sheet
 */
function guardarOEditarSocio(socioData) {
  const sheet = obtenerOCrearHoja(HOJA_SOCIOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  let rowIndex = -1;
  
  // Buscar si el socio ya existe por su ID
  if (socioData.id) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === socioData.id.toString()) {
        rowIndex = i + 1;
        break;
      }
    }
  } else {
    // Si no tiene ID, autogenerar uno
    socioData.id = "SOC-" + new Date().getTime();
  }
  
  // Mapear el objeto del socio a la fila según las cabeceras actuales
  const newRow = headers.map(header => {
    const key = normalizarCabecera(header);
    return socioData[key] !== undefined ? socioData[key] : "";
  });
  
  if (rowIndex !== -1) {
    // Editar existente
    sheet.getRange(rowIndex, 1, 1, newRow.length).setValues([newRow]);
  } else {
    // Añadir nuevo
    sheet.appendRow(newRow);
  }
  
  return socioData;
}

/**
 * Registra un pago de cuota, actualiza el último mes pagado del socio
 * y lo asienta en el historial.
 */
function registrarPagoSocio(socioId, periodo, monto) {
  const sheetSocios = obtenerOCrearHoja(HOJA_SOCIOS);
  const dataSocios = sheetSocios.getDataRange().getValues();
  const headersSocios = dataSocios[0];
  
  let socioRowIndex = -1;
  let socioNombre = "";
  
  // 1. Buscar al socio
  for (let i = 1; i < dataSocios.length; i++) {
    if (dataSocios[i][0].toString() === socioId.toString()) {
      socioRowIndex = i + 1;
      socioNombre = dataSocios[i][1];
      break;
    }
  }
  
  if (socioRowIndex === -1) throw new Error("Socio no encontrado");
  
  // 2. Actualizar datos en la planilla de socios
  const colUltimoMesIndex = headersSocios.map(normalizarCabecera).indexOf("ultimoMesPagado") + 1;
  const colEstadoIndex = headersSocios.map(normalizarCabecera).indexOf("estadoActual") + 1;
  
  if (colUltimoMesIndex > 0) {
    sheetSocios.getRange(socioRowIndex, colUltimoMesIndex).setValue(periodo);
  }
  if (colEstadoIndex > 0) {
    sheetSocios.getRange(socioRowIndex, colEstadoIndex).setValue("Pagado");
  }
  
  // 3. Asentar en la hoja de Historial de Pagos
  const sheetHistorial = obtenerOCrearHoja(HOJA_HISTORIAL);
  if (sheetHistorial.getLastRow() === 0) {
    // Si la hoja de historial es nueva, poner cabeceras
    sheetHistorial.appendRow(["ID Transacción", "Socio ID", "Nombre Socio", "Período Pagado", "Monto", "Fecha Registro"]);
  }
  
  const transaccionId = "TX-" + new Date().getTime();
  sheetHistorial.appendRow([
    transaccionId,
    socioId,
    socioNombre,
    periodo,
    monto,
    new Date()
  ]);
  
  return { transaccionId, socioId, periodo, estadoActual: "Pagado" };
}

/**
 * Busca una factura en PDF en Google Drive, redacta la plantilla elegida,
 * adjunta el PDF y genera un borrador en la bandeja de Gmail del Clúster.
 */
function generarBorradorGmail(socioId, periodo, nivelAviso) {
  const socios = obtenerSociosDeSheet();
  const socio = socios.find(s => s.id.toString() === socioId.toString());
  
  if (!socio) throw new Error("Socio no encontrado");
  if (!socio.emailContacto) throw new Error("El socio no tiene un correo de contacto configurado.");
  
  // 1. Intentar buscar el archivo PDF de la factura en Google Drive
  let archivoFactura = null;
  const nombreFacturaEsperado = `Factura - ${socio.nombreSocio} - ${periodo}`; // Nombre estándar buscado
  
  try {
    let carpeta = null;
    if (CARPETA_FACTURAS_ID) {
      carpeta = DriveApp.getFolderById(CARPETA_FACTURAS_ID);
    }
    
    // Buscar archivos que contengan el nombre del socio y el período
    const query = `title contains '${socio.nombreSocio}' and title contains '${periodo}' and mimeType = 'application/pdf'`;
    const archivosIterador = carpeta ? carpeta.searchFiles(query) : DriveApp.searchFiles(query);
    
    if (archivosIterador.hasNext()) {
      archivoFactura = archivosIterador.next(); // Tomamos la coincidencia más reciente
    }
  } catch (driveError) {
    Logger.log("Error al buscar en Drive: " + driveError.toString());
    // No detenemos el flujo si no encuentra Drive, se creará el borrador sin adjunto avisando de ello
  }
  
  // 2. Definir datos de transferencia fijos del Clúster (Modificalos a gusto)
  const datosBanco = {
    banco: "Banco Provincia de Córdoba (BANCOR)",
    cbu: "0200356401000012345678", // Placeholder seguro
    alias: "BIOTECH.CBA.CUOTA",    // Placeholder seguro
    titular: "Clúster de Biotecnología de Córdoba"
  };
  
  // 3. Procesar y redactar según el nivel de aviso seleccionado
  let asunto = "";
  let cuerpo = "";
  
  const mesAnioTexto = formatearMesAnio(periodo);
  
  if (nivelAviso === 1) {
    // AVISO 1: AMISTOSO
    asunto = `Clúster de Biotecnología de Córdoba - Recordatorio de Cuota Mensual [${mesAnioTexto}] - ${socio.nombreSocio}`;
    cuerpo = `Hola ${socio.contactoNombre || "de nuestra consideración"},\n\n` +
             `Espero que te encuentres muy bien.\n\n` +
             `Te escribimos desde el Clúster de Biotecnología de Córdoba para hacerte llegar el recordatorio de la cuota correspondiente a **${mesAnioTexto}** por un monto de **$${socio.montoCuota}**.\n\n` +
             `Para tu comodidad, te recordamos los datos de transferencia bancaria de la institución:\n` +
             `*   **Banco:** ${datosBanco.banco}\n` +
             `*   **CBU:** ${datosBanco.cbu}\n` +
             `*   **Alias:** ${datosBanco.alias}\n` +
             `*   **Titular:** ${datosBanco.titular}\n\n` +
             `Una vez realizada la transferencia, te pedimos que nos envíes el comprobante respondiendo a este correo para que podamos emitir el recibo oficial.\n\n` +
             `Agradecemos muchísimo tu constante apoyo y participación activa para seguir potenciando la biotecnología en Córdoba.\n\n` +
             `Saludos cordiales,\n\n` +
             `**Sebastián Bizzi & Pablo**\n` +
             `*Equipo de Operaciones*\n` +
             `*Clúster de Biotecnología de Córdoba*`;
  } 
  else if (nivelAviso === 2) {
    // AVISO 2: INSTITUCIONAL (MORA)
    asunto = `Estado de Cuenta y Aporte Societario - Clúster de Biotecnología de Córdoba - ${socio.nombreSocio}`;
    cuerpo = `Estimado/a ${socio.contactoNombre || "de nuestra consideración"},\n\n` +
             `Esperamos que estés muy bien.\n\n` +
             `Nos comunicamos para saludarte y, a la vez, realizar una actualización del estado de cuenta de **${socio.nombreSocio}** en el Clúster. Al día de la fecha, registramos un saldo pendiente de pago correspondiente al período de **${mesAnioTexto}** por un total acumulado de **$${socio.montoCuota}**.\n\n` +
             `Como sabes, el Clúster es una asociación sin fines de lucro, y el aporte mensual de nuestros socios es el motor fundamental que sostiene nuestras actividades, eventos de vinculación, gestión de financiamiento y representatividad sectorial. Tu contribución hace que todo esto sea posible.\n\n` +
             `Te dejamos nuevamente los datos para regularizar la situación mediante transferencia:\n` +
             `*   **Banco:** ${datosBanco.banco}\n` +
             `*   **CBU:** ${datosBanco.cbu} | **Alias:** ${datosBanco.alias}\n` +
             `*   **Titular:** ${datosBanco.titular}\n\n` +
             `Si ya realizaste el pago en las últimas horas, por favor desestima este mensaje y envíanos el comprobante para asentar el registro.\n\n` +
             `Quedamos a tu entera disposición ante cualquier consulta.\n\n` +
             `Atentamente,\n\n` +
             `**Sebastián Bizzi & Pablo**\n` +
             `*Equipo de Operaciones*\n` +
             `*Clúster de Biotecnología de Córdoba*`;
  } 
  else if (nivelAviso === 3) {
    // AVISO 3: PROPUESTA DE LLAMADA
    asunto = `Actualización y Agenda de Reunión Operativa - Clúster Biotech Cba - ${socio.nombreSocio}`;
    cuerpo = `Estimado/a ${socio.contactoNombre || "de nuestra consideración"},\n\n` +
             `Esperamos que te encuentres muy bien.\n\n` +
             `Te escribimos en esta oportunidad con la intención de ponernos en contacto directo con respecto al estado societario de **${socio.nombreSocio}**. Registramos un saldo pendiente acumulado correspondiente al período de **${mesAnioTexto}** por un total de **$${socio.montoCuota}**.\n\n` +
             `Más allá de la regularización administrativa, para nosotros es de vital importancia mantener un contacto cercano con cada uno de nuestros socios. Queremos entender el momento actual de la empresa, asegurarnos de que estén aprovechando al máximo la red de vinculación del Clúster, y conversar sobre cómo podemos apoyarlos mejor en sus desafíos presentes.\n\n` +
             `Por esta razón, nos gustaría proponerles agendar una breve reunión virtual de 15 minutos con Sebastián Bizzi o Pablo durante la próxima semana. ¿Tendrías disponibilidad el próximo martes o jueves por la mañana?\n\n` +
             `Quedamos a la espera de tu confirmación para coordinar el horario y enviarte el enlace de conexión.\n\n` +
             `Un cordial saludo,\n\n` +
             `**Sebastián Bizzi & Pablo**\n` +
             `*Equipo de Operaciones*\n` +
             `*Clúster de Biotecnología de Córdoba*`;
  }

  // 4. Parámetros del mail para el borrador
  const options = {};
  if (archivoFactura) {
    options.attachments = [archivoFactura.getAs(MimeType.PDF)];
  }
  
  // Convertimos a borrador en Gmail
  const borrador = GmailApp.createDraft(
    socio.emailContacto, 
    asunto, 
    cuerpo, 
    options
  );
  
  return { 
    success: true, 
    borradorId: borrador.getId(), 
    facturaAdjuntada: !!archivoFactura,
    nombreArchivo: archivoFactura ? archivoFactura.getName() : null
  };
}

/**
 * ====================================================================
 * FUNCIONES AUXILIARES DE UTILIDAD
 * ====================================================================
 */

/**
 * Busca una hoja específica y si no existe la crea con su fila de cabeceras ideal
 */
function obtenerOCrearHoja(nombreHoja) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(nombreHoja);
  
  if (!sheet) {
    sheet = ss.insertSheet(nombreHoja);
    if (nombreHoja === HOJA_SOCIOS) {
      sheet.appendRow([
        "ID", 
        "Nombre Socio", 
        "Tipo", 
        "Monto Cuota", 
        "Email Contacto", 
        "Contacto Nombre", 
        "Ultimo Mes Pagado", 
        "Estado Actual"
      ]);
      // Formatear cabeceras en negrita
      sheet.getRange("A1:H1").setFontWeight("bold").setBackground("#e2e8f0");
      
      // Agregar datos ficticios/iniciales realistas de prueba
      sheet.appendRow(["SOC-001", "Laboratorio Hemoderivados", "Fin de Lucro", 45000, "administracion@hemoderivados.unc.edu.ar", "Lic. María González", "2026-04", "Pendiente"]);
      sheet.appendRow(["SOC-002", "Lamarx Biotech", "Fin de Lucro", 30000, "finanzas@lamarx.com.ar", "Ing. Daniel Lamarque", "2026-05", "Pagado"]);
      sheet.appendRow(["SOC-003", "Lace Laboratorios", "Fin de Lucro", 35000, "pagos@lace.com.ar", "Dr. Claudio Lace", "2026-03", "Vencido"]);
      sheet.appendRow(["SOC-004", "UNC - Universidad Nacional", "Sin Fin de Lucro", 0, "vinculacion@unc.edu.ar", "Dr. Hugo Juri", "2026-05", "Pagado"]);
    }
  }
  return sheet;
}

/**
 * Convierte un texto a camelCase de forma segura para usarlo como clave JS
 */
function normalizarCabecera(str) {
  return str.toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Eliminar acentos
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .split(" ")
    .map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Convierte un formato "YYYY-MM" en una cadena legible "Mes Año" en español
 */
function formatearMesAnio(periodoStr) {
  if (!periodoStr || !periodoStr.includes("-")) return periodoStr;
  
  const partes = periodoStr.split("-");
  const anio = partes[0];
  const mesIndex = parseInt(partes[1], 10) - 1;
  
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  
  return `${meses[mesIndex]} ${anio}`;
}
