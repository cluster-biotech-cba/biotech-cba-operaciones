/**
 * ====================================================================
 * BACKEND API RELACIONAL - CLUSTER DE BIOTECNOLOGÍA DE CÓRDOBA
 * Google Apps Script para la Consola de Cobranzas y Operaciones
 * ====================================================================
 * 
 * Este script actúa como una base de datos relacional en la nube.
 * Vincula cuatro tablas/pestañas:
 * 1. Categorias (Gestión centralizada de precios de cuotas).
 * 2. Socios (Miembros activos asociados a una categoría de cuota).
 * 3. HistorialPagos (Registro histórico de transacciones de cobranza).
 * 4. CRM_Prospectos (Pipeline de captación de nuevos socios).
 */

const HOJA_SOCIOS = "Socios";
const HOJA_CATEGORIAS = "Categorias";
const HOJA_HISTORIAL = "HistorialPagos";
const HOJA_CRM = "CRM_Prospectos";

// ID DE LA CARPETA DE GOOGLE DRIVE DONDE ESTÁN LOS PDFS DE LAS FACTURAS
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
      output = JSON.stringify({ success: true, data: obtenerSociosRelacionales() });
    } 
    else if (action === "getCategorias") {
      output = JSON.stringify({ success: true, data: obtenerCategoriasDeSheet() });
    }
    else {
      output = JSON.stringify({ success: false, error: "Acción no reconocida en GET." });
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
 * ====================================================================
 * LOGICA DE BASE DE DATOS RELACIONAL (SOCIOS + CATEGORIAS)
 * ====================================================================
 */

/**
 * Lee la tabla de categorías y sus valores de cuota
 */
function obtenerCategoriasDeSheet() {
  const sheet = obtenerOCrearHoja(HOJA_CATEGORIAS);
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) return [];
  
  const categorias = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    categorias.push({
      categoria: data[i][0].toString(),
      montoCuota: Number(data[i][1])
    });
  }
  return categorias;
}

/**
 * Realiza un "JOIN" en memoria entre Socios y Categorias
 * De esta forma, el frontend recibe los socios con su cuota calculada en tiempo real.
 */
function obtenerSociosRelacionales() {
  const sheet = obtenerOCrearHoja(HOJA_SOCIOS);
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) return [];
  
  const headers = data[0];
  const sociosRaw = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    
    let socio = {};
    headers.forEach((header, index) => {
      const key = normalizarCabecera(header);
      socio[key] = row[index];
    });
    sociosRaw.push(socio);
  }
  
  // Obtener categorías para relacionar
  const categorias = obtenerCategoriasDeSheet();
  const catMap = {};
  categorias.forEach(cat => {
    catMap[cat.categoria] = cat.montoCuota;
  });
  
  // Realizar el JOIN en memoria
  return sociosRaw.map(socio => {
    // Buscar el valor de la cuota según su categoría
    const cuotaCalculada = catMap[socio.categoria] !== undefined ? catMap[socio.categoria] : 0;
    
    // Mantenemos el campo montoCuota para compatibilidad directa con el frontend
    return {
      ...socio,
      montoCuota: cuotaCalculada
    };
  });
}

/**
 * Guarda o edita un socio en la Google Sheet de forma relacional
 */
function guardarOEditarSocio(socioData) {
  const sheet = obtenerOCrearHoja(HOJA_SOCIOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  let rowIndex = -1;
  
  if (socioData.id) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === socioData.id.toString()) {
        rowIndex = i + 1;
        break;
      }
    }
  } else {
    socioData.id = "SOC-" + new Date().getTime();
  }
  
  // Mapear el objeto del socio a la fila según las cabeceras actuales de la planilla
  const newRow = headers.map(header => {
    const key = normalizarCabecera(header);
    return socioData[key] !== undefined ? socioData[key] : "";
  });
  
  if (rowIndex !== -1) {
    sheet.getRange(rowIndex, 1, 1, newRow.length).setValues([newRow]);
  } else {
    sheet.appendRow(newRow);
  }
  
  return socioData;
}

/**
 * Registra un pago de cuota y actualiza el último mes pagado en la planilla
 */
function registrarPagoSocio(socioId, periodo, monto) {
  const sheetSocios = obtenerOCrearHoja(HOJA_SOCIOS);
  const dataSocios = sheetSocios.getDataRange().getValues();
  const headersSocios = dataSocios[0];
  
  let socioRowIndex = -1;
  let socioNombre = "";
  
  for (let i = 1; i < dataSocios.length; i++) {
    if (dataSocios[i][0].toString() === socioId.toString()) {
      socioRowIndex = i + 1;
      socioNombre = dataSocios[i][1];
      break;
    }
  }
  
  if (socioRowIndex === -1) throw new Error("Socio no encontrado en la base de datos.");
  
  const colUltimoMesIndex = headersSocios.map(normalizarCabecera).indexOf("ultimoMesPagado") + 1;
  const colEstadoIndex = headersSocios.map(normalizarCabecera).indexOf("estadoActual") + 1;
  
  if (colUltimoMesIndex > 0) {
    sheetSocios.getRange(socioRowIndex, colUltimoMesIndex).setValue(periodo);
  }
  if (colEstadoIndex > 0) {
    sheetSocios.getRange(socioRowIndex, colEstadoIndex).setValue("Pagado");
  }
  
  // Registrar en la hoja de Historial
  const sheetHistorial = obtenerOCrearHoja(HOJA_HISTORIAL);
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
 * Genera un borrador en Gmail con la plantilla adecuada y adjunta la factura en PDF de Drive
 */
function generarBorradorGmail(socioId, periodo, nivelAviso) {
  const socios = obtenerSociosRelacionales();
  const socio = socios.find(s => s.id.toString() === socioId.toString());
  
  if (!socio) throw new Error("Socio no encontrado");
  if (!socio.emailContacto) throw new Error("El socio no tiene un correo de contacto configurado.");
  
  let archivoFactura = null;
  
  try {
    let carpeta = null;
    if (CARPETA_FACTURAS_ID) {
      carpeta = DriveApp.getFolderById(CARPETA_FACTURAS_ID);
    }
    
    const query = `title contains '${socio.nombreSocio}' and title contains '${periodo}' and mimeType = 'application/pdf'`;
    const archivosIterador = carpeta ? carpeta.searchFiles(query) : DriveApp.searchFiles(query);
    
    if (archivosIterador.hasNext()) {
      archivoFactura = archivosIterador.next();
    }
  } catch (driveError) {
    Logger.log("Error al buscar factura en Drive: " + driveError.toString());
  }
  
  const datosBanco = {
    banco: "Banco Provincia de Córdoba (BANCOR)",
    cbu: "0200356401000012345678",
    alias: "BIOTECH.CBA.CUOTA",
    titular: "Clúster de Biotecnología de Córdoba"
  };
  
  let asunto = "";
  let cuerpo = "";
  const mesAnioTexto = formatearMesAnio(periodo);
  
  if (nivelAviso === 1) {
    asunto = `Clúster de Biotecnología de Córdoba - Recordatorio de Cuota Mensual [${mesAnioTexto}] - ${socio.nombreSocio}`;
    cuerpo = `Hola ${socio.contactoNombre || "de nuestra consideración"},\n\n` +
             `Espero que te encuentres muy bien.\n\n` +
             `Te escribimos desde el Clúster de Biotecnología de Córdoba para hacerte llegar el recordatorio de la cuota correspondiente a **${mesAnioTexto}** por un monto de **$${socio.montoCuota.toLocaleString('es-AR')}**.\n\n` +
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
    asunto = `Estado de Cuenta y Aporte Societario - Clúster de Biotecnología de Córdoba - ${socio.nombreSocio}`;
    cuerpo = `Estimado/a ${socio.contactoNombre || "de nuestra consideración"},\n\n` +
             `Esperamos que estés muy bien.\n\n` +
             `Nos comunicamos para saludarte y, a la vez, realizar una actualización del estado de cuenta de **${socio.nombreSocio}** en el Clúster. Al día de la fecha, registramos un saldo pendiente de pago correspondiente al período de **${mesAnioTexto}** por un total acumulado de **$${socio.montoCuota.toLocaleString('es-AR')}**.\n\n` +
             `Como sabes, el Clúster es una asociación sin fines de lucro, y el aporte mensual de nuestros socios es el motor fundamental que sostiene nuestras actividades, eventos de vinculación, gestión de financiamiento y representatividad sectorial. Tu contribución hace que todo esto sea posible.\n\n` +
             `Te dejamos nuevamente los datos para regularizar la situación mediante transferencia:\n` +
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
    asunto = `Actualización y Agenda de Reunión Operativa - Clúster Biotech Cba - ${socio.nombreSocio}`;
    cuerpo = `Estimado/a ${socio.contactoNombre || "de nuestra consideración"},\n\n` +
             `Esperamos que te encuentres muy bien.\n\n` +
             `Te escribimos en esta oportunidad con la intención de ponernos en contacto directo con respecto al estado societario de **${socio.nombreSocio}**. Registramos un saldo pendiente acumulado correspondiente al período de **${mesAnioTexto}** por un total de **$${socio.montoCuota.toLocaleString('es-AR')}**.\n\n` +
             `Más allá de la regularización administrativa, para nosotros es de vital importancia mantener un contacto cercano con cada uno de nuestros socios. Queremos entender el momento actual de la empresa, asegurarnos de que estén aprovechando al máximo la red de vinculación del Clúster, y conversar sobre cómo podemos apoyarlos mejor en sus desafíos presentes.\n\n` +
             `Por esta razón, nos gustaría proponerles agendar una breve reunión virtual de 15 minutos con Sebastián Bizzi o Pablo durante la próxima semana. ¿Tendrías disponibilidad el próximo martes o jueves por la mañana?\n\n` +
             `Quedamos a la espera de tu confirmación para coordinar el horario y enviarte el enlace de conexión.\n\n` +
             `Un cordial saludo,\n\n` +
             `**Sebastián Bizzi & Pablo**\n` +
             `*Equipo de Operaciones*\n` +
             `*Clúster de Biotecnología de Córdoba*`;
  }

  const options = {};
  if (archivoFactura) {
    options.attachments = [archivoFactura.getAs(MimeType.PDF)];
  }
  
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
 * CREACION E INICIALIZACIÓN DE HOJAS CON ESTRUCTURA RELACIONAL
 * ====================================================================
 */

function obtenerOCrearHoja(nombreHoja) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(nombreHoja);
  
  if (!sheet) {
    sheet = ss.insertSheet(nombreHoja);
    
    // TABLA 1: CATEGORIAS (Precios de cuotas)
    if (nombreHoja === HOJA_CATEGORIAS) {
      sheet.appendRow(["Categoria", "Monto Cuota ($)"]);
      sheet.getRange("A1:B1").setFontWeight("bold").setBackground("#cbd5e1");
      
      // Valores por defecto
      sheet.appendRow(["Premium", 50000]);
      sheet.appendRow(["Estándar", 35000]);
      sheet.appendRow(["Startup", 25000]);
      sheet.appendRow(["Exento", 0]);
    }
    
    // TABLA 2: SOCIOS (Relacional)
    else if (nombreHoja === HOJA_SOCIOS) {
      sheet.appendRow([
        "ID", 
        "Nombre Socio", 
        "Tipo", 
        "Categoria", // Hace referencia a la hoja de Categorias
        "Email Contacto", 
        "Contacto Nombre", 
        "Ultimo Mes Pagado", 
        "Estado Actual"
      ]);
      sheet.getRange("A1:H1").setFontWeight("bold").setBackground("#e2e8f0");
      
      // Socios de prueba relacionales
      sheet.appendRow(["SOC-001", "Laboratorio Hemoderivados UNC", "Fin de Lucro", "Estándar", "administracion@hemoderivados.unc.edu.ar", "Lic. María González", "2026-04", "Pendiente"]);
      sheet.appendRow(["SOC-002", "Lamarx Biotech", "Fin de Lucro", "Startup", "finanzas@lamarx.com.ar", "Ing. Daniel Lamarque", "2026-05", "Pagado"]);
      sheet.appendRow(["SOC-003", "Lace Laboratorios", "Fin de Lucro", "Estándar", "pagos@lace.com.ar", "Dr. Claudio Lace", "2026-03", "Vencido"]);
      sheet.appendRow(["SOC-004", "Promedon S.A.", "Fin de Lucro", "Premium", "proveedores@promedon.com", "Cdra. Sofía Promedon", "2026-04", "Pendiente"]);
      sheet.appendRow(["SOC-005", "CONICET Córdoba", "Sin Fin de Lucro", "Exento", "vinculacion@cordoba-conicet.gov.ar", "Dr. Edgardo Baldo", "2026-05", "Pagado"]);
    }
    
    // TABLA 3: HISTORIAL DE PAGOS
    else if (nombreHoja === HOJA_HISTORIAL) {
      sheet.appendRow(["ID Transaccion", "ID Socio", "Nombre Socio", "Periodo Pagado", "Monto", "Fecha Registro"]);
      sheet.getRange("A1:F1").setFontWeight("bold").setBackground("#cbd5e1");
    }
    
    // TABLA 4: CRM PROSPECTOS (Para el pipeline futuro)
    else if (nombreHoja === HOJA_CRM) {
      sheet.appendRow(["ID Lead", "Nombre Empresa", "Estado", "Email Contacto", "Contacto Nombre", "Fecha Registro"]);
      sheet.getRange("A1:F1").setFontWeight("bold").setBackground("#e2e8f0");
      
      // Cargar prospectos iniciales de prueba
      sheet.appendRow(["LEAD-001", "Biocombustibles Cba", "Mapeado", "contacto@biocba.com", "Ing. Roberto Paz", new Date()]);
      sheet.appendRow(["LEAD-002", "AgroBiotech S.A.", "Contacto Inicial", "ventas@agrobiotech.com", "Dra. Laura Rossi", new Date()]);
      sheet.appendRow(["LEAD-003", "Genética Semillas", "Reunión", "info@geneticasemillas.com", "Lic. Esteban Juárez", new Date()]);
    }
  }
  return sheet;
}

/**
 * ====================================================================
 * FUNCIONES AUXILIARES DE UTILIDAD
 * ====================================================================
 */

function normalizarCabecera(str) {
  return str.toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .split(" ")
    .map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

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
