/**
 * ====================================================================
 * BACKEND API RELACIONAL - CLUSTER DE BIOTECNOLOGÍA DE CÓRDOBA
 * Google Apps Script para la Consola de Cobranzas y Operaciones
 * ====================================================================
 */

const HOJA_SOCIOS = "Socios";
const HOJA_CATEGORIAS = "Categorias";
const HOJA_HISTORIAL = "HistorialPagos";
const HOJA_CRM = "CRM_Prospectos";
const HOJA_USUARIOS = "Usuarios";

// ID DE LA CARPETA DE GOOGLE DRIVE DONDE ESTÁN LOS PDFS DE LAS FACTURAS
const CARPETA_FACTURAS_ID = ""; 

/**
 * Valida las credenciales de un usuario contra la hoja de Usuarios
 */
function validarCredenciales(usuario, clave) {
  if (!usuario || !clave) {
    return { success: false, error: "Usuario o clave ausentes." };
  }
  
  try {
    const sheet = obtenerOCrearHoja(HOJA_USUARIOS);
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0].toString().trim().toLowerCase() === usuario.toString().trim().toLowerCase() && 
          row[1].toString().trim() === clave.toString().trim()) {
        return { 
          success: true, 
          user: { 
            usuario: row[0].toString(), 
            rol: row[2].toString(), // Administrador o Consulta
            nombre: row[3].toString() 
          } 
        };
      }
    }
    return { success: false, error: "Usuario o contraseña incorrectos." };
  } catch (err) {
    return { success: false, error: "Error al validar acceso: " + err.toString() };
  }
}

/**
 * Recibe las solicitudes HTTP GET desde la aplicación local (SPA)
 */
function doGet(e) {
  let output;
  
  try {
    const action = (e && e.parameter) ? e.parameter.action : "";
    const usuario = (e && e.parameter) ? e.parameter.usuario : "";
    const clave = (e && e.parameter) ? e.parameter.clave : "";
    
    // Todas las lecturas de base de datos requieren autenticación
    const auth = validarCredenciales(usuario, clave);
    
    if (!auth.success) {
      output = JSON.stringify({ success: false, error: "No autorizado. Inicie sesión nuevamente." });
    } 
    else if (action === "getSocios") {
      output = JSON.stringify({ 
        success: true, 
        data: obtenerSociosRelacionales(),
        categorias: obtenerCategoriasDeSheet() 
      });
    } 
    else if (action === "getCategorias") {
      output = JSON.stringify({ success: true, data: obtenerCategoriasDeSheet() });
    }
    else if (action === "getTransacciones") {
      output = JSON.stringify({ success: true, data: obtenerTransaccionesDeSheet() });
    }
    else {
      output = JSON.stringify({ success: false, error: "Acción no reconocida en GET." });
    }
  } catch (error) {
    output = JSON.stringify({ success: false, error: error.toString() });
  }
  
  // Google automáticamente añade las cabeceras CORS correctas a TextOutput
  return ContentService.createTextOutput(output)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Recibe las solicitudes HTTP POST (creación de borradores, registros de pago)
 */
function doPost(e) {
  let output;
  
  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;
    const usuario = postData.usuario;
    const clave = postData.clave;
    
    // Validar sesión
    const auth = validarCredenciales(usuario, clave);
    
    if (!auth.success) {
      output = JSON.stringify({ success: false, error: "No autorizado: " + auth.error });
    } 
    else if (action === "login") {
      // Si llega hasta aquí, las credenciales son válidas
      output = JSON.stringify({ success: true, user: auth.user });
    }
    else if (action === "registrarPago") {
      if (auth.user.rol !== "Administrador") {
        output = JSON.stringify({ success: false, error: "Operación denegada. Se requiere rol de Administrador." });
      } else {
        const result = registrarPagoSocio(postData.socioId, postData.periodo, postData.monto);
        output = JSON.stringify({ success: true, data: result });
      }
    } 
    else if (action === "generarBorrador") {
      if (auth.user.rol !== "Administrador") {
        output = JSON.stringify({ success: false, error: "Operación denegada. Se requiere rol de Administrador." });
      } else {
        const result = generarBorradorGmail(postData.socioId, postData.periodo, postData.nivelAviso);
        output = JSON.stringify({ success: true, data: result });
      }
    } 
    else if (action === "guardarSocio") {
      if (auth.user.rol !== "Administrador") {
        output = JSON.stringify({ success: false, error: "Operación denegada. Se requiere rol de Administrador." });
      } else {
        const result = guardarOEditarSocio(postData.socio);
        output = JSON.stringify({ success: true, data: result });
      }
    }
    else if (action === "enviarCampanaMasiva") {
      if (auth.user.rol !== "Administrador") {
        output = JSON.stringify({ success: false, error: "Operación denegada. Se requiere rol de Administrador." });
      } else {
        const campana = postData.campana; // Array de { socioId, periodo, nivelAviso }
        const resultados = [];
        for (let i = 0; i < campana.length; i++) {
          try {
            const res = enviarCorreoMasivoSocio(campana[i].socioId, campana[i].periodo, campana[i].nivelAviso);
            resultados.push({ socioId: campana[i].socioId, success: true, pdfAdjuntado: res.pdfAdjuntado });
          } catch (errSocio) {
            resultados.push({ socioId: campana[i].socioId, success: false, error: errSocio.toString() });
          }
        }
        output = JSON.stringify({ success: true, resultados: resultados });
      }
    }
    else {
      output = JSON.stringify({ success: false, error: "Acción no reconocida en POST." });
    }
  } catch (error) {
    output = JSON.stringify({ success: false, error: error.toString() });
  }
  
  return ContentService.createTextOutput(output)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Permite manejar las llamadas previas de CORS (OPTIONS)
 */
function doOptions(e) {
  return ContentService.createTextOutput("");
}

/**
 * ====================================================================
 * LOGICA DE BASE DE DATOS RELACIONAL (SOCIOS + CATEGORIAS)
 * ====================================================================
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

function obtenerSociosRelacionales() {
  const sheet = obtenerOCrearHoja(HOJA_SOCIOS);
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 0) return [];
  
  // Configurar validaciones en el sheet para prevenir errores de tipeo
  try {
    configurarValidacionesEnSheets();
  } catch (valErr) {
    Logger.log("Error al configurar validaciones: " + valErr.toString());
  }
  
  // 1. ADAPTAR EL SHEET SI LE FALTAN LAS COLUMNAS DE CONTROL DE PAGO
  const headers = data[0].map(h => h.toString().trim());
  let columnModified = false;
  
  let colUltimoMesIndex = headers.map(normalizarCabecera).indexOf("ultimoMesPagado");
  let colEstadoIndex = headers.map(normalizarCabecera).indexOf("estadoActual");
  let colUltimaNotifIndex = headers.map(normalizarCabecera).indexOf("ultimaNotificacion");
  let colNivelNotifIndex = headers.map(normalizarCabecera).indexOf("nivelNotificacion");
  
  if (colUltimoMesIndex === -1) {
    sheet.getRange(1, headers.length + 1).setValue("Ultimo Mes Pagado").setFontWeight("bold");
    headers.push("Ultimo Mes Pagado");
    columnModified = true;
  }
  if (colEstadoIndex === -1) {
    sheet.getRange(1, headers.length + 1).setValue("Estado Actual").setFontWeight("bold");
    headers.push("Estado Actual");
    columnModified = true;
  }
  if (colUltimaNotifIndex === -1) {
    sheet.getRange(1, headers.length + 1).setValue("Ultima Notificacion").setFontWeight("bold");
    headers.push("Ultima Notificacion");
    columnModified = true;
  }
  if (colNivelNotifIndex === -1) {
    sheet.getRange(1, headers.length + 1).setValue("Nivel Notificacion").setFontWeight("bold");
    headers.push("Nivel Notificacion");
    columnModified = true;
  }
  
  // Si agregamos columnas, volvemos a leer los datos frescos
  let activeData = data;
  if (columnModified) {
    activeData = sheet.getDataRange().getValues();
  }
  
  const activeHeaders = activeData[0];
  const sociosRaw = [];
  
  for (let i = 1; i < activeData.length; i++) {
    const row = activeData[i];
    // Tolerar filas vacías si hay datos en alguna columna clave
    if (!row[0] && !row[1] && !row[2] && !row[8]) continue;
    
    let socio = {};
    activeHeaders.forEach((header, index) => {
      const key = normalizarCabecera(header);
      socio[key] = row[index] !== undefined ? row[index] : "";
    });
    sociosRaw.push(socio);
  }
  
  const categorias = obtenerCategoriasDeSheet();
  const catMap = {};
  categorias.forEach(cat => {
    catMap[cat.categoria] = cat.montoCuota;
  });
  
  return sociosRaw.map((socio, idx) => {
    // Buscar equivalencias de cabeceras custom de la planilla real de Clúster
    const nombre = socio.razonSocial || socio.nombreSocio || socio.socio || "Socio Sin Nombre";
    const contacto = socio.socioContactoDeEntrega || socio.contactoNombre || socio.contacto || "Administración";
    const email = socio.mail || socio.emailContacto || socio.email || "";
    
    const cat = socio.categoria || "Estándar";
    const tipo = (cat.toLowerCase().trim() === "exento" || cat.toLowerCase().trim() === "exenta") ? "Sin Fin de Lucro" : "Fin de Lucro";
    const ultimoMes = socio.ultimoMesPagado || "";
    const estado = socio.estadoActual || "Pendiente";
    
    // Auto-generar un ID si no lo tiene en la planilla
    const id = socio.id || ("SOC-" + (1000 + idx));
    
    // Buscar si hay cuota o monto directo ingresado en la planilla
    let cuotaCalculada = 0;
    if (socio.cuota !== undefined && socio.cuota !== "" && !isNaN(Number(socio.cuota.toString().replace(/[^0-9.-]/g, "")))) {
      cuotaCalculada = Number(socio.cuota.toString().replace(/[^0-9.-]/g, ""));
    } else if (socio.monto !== undefined && socio.monto !== "" && !isNaN(Number(socio.monto.toString().replace(/[^0-9.-]/g, "")))) {
      cuotaCalculada = Number(socio.monto.toString().replace(/[^0-9.-]/g, ""));
    } else {
      cuotaCalculada = catMap[cat] !== undefined ? catMap[cat] : 0;
    }

    
    return {
      ...socio, // Preservar CUIT, telefono, cargo, DNI, IVA
      id: id,
      nombreSocio: nombre,
      contactoNombre: contacto,
      emailContacto: email,
      tipo: tipo,
      categoria: cat,
      ultimoMesPagado: ultimoMes,
      estadoActual: estado,
      ultimaNotificacion: socio.ultimaNotificacion || "",
      nivelNotificacion: socio.nivelNotificacion || "",
      montoCuota: cuotaCalculada
    };
  });
}

function guardarOEditarSocio(socioData) {
  const sheet = obtenerOCrearHoja(HOJA_SOCIOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  let rowIndex = -1;
  
  // Buscar coincidencia por ID, CUIT, o Razón Social
  const socioIdToFind = socioData.id;
  const cuitToFind = socioData.cuit;
  const nombreToFind = socioData.nombreSocio;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowId = row[0] ? row[0].toString() : "";
    
    const colCuitIndex = headers.map(normalizarCabecera).indexOf("cuit");
    const rowCuit = (colCuitIndex !== -1 && row[colCuitIndex]) ? row[colCuitIndex].toString() : "";
    
    const colNombreIndex = headers.map(normalizarCabecera).indexOf("razonSocial");
    const rowNombre = (colNombreIndex !== -1 && row[colNombreIndex]) ? row[colNombreIndex].toString() : "";
    
    if ((socioIdToFind && rowId === socioIdToFind.toString()) || 
        (cuitToFind && rowCuit === cuitToFind.toString()) ||
        (nombreToFind && rowNombre.toLowerCase() === nombreToFind.toLowerCase())) {
      rowIndex = i + 1;
      break;
    }
  }
  
  if (rowIndex === -1 && !socioData.id) {
    socioData.id = "SOC-" + new Date().getTime();
  }
  
  const newRow = headers.map(header => {
    const key = normalizarCabecera(header);
    if (socioData[key] !== undefined) return socioData[key];
    
    // Homologación reversa al escribir en las columnas originales del usuario
    if (key === "razonSocial") return socioData.nombreSocio || "";
    if (key === "socioContactoDeEntrega") return socioData.contactoNombre || "";
    if (key === "mail") return socioData.emailContacto || "";
    if (key === "tipo") return (socioData.categoria === "Exento" || socioData.categoria === "Exenta" ? "Sin Fin de Lucro" : "Fin de Lucro");
    if (key === "abonaMensual") return (socioData.categoria === "Exento" || socioData.categoria === "Exenta" ? "NO" : "SI");
    if (key === "ultimoMesPagado") return socioData.ultimoMesPagado || "";
    if (key === "estadoActual") return socioData.estadoActual || "Pendiente";
    if (key === "ultimaNotificacion") return socioData.ultimaNotificacion || "";
    if (key === "nivelNotificacion") return socioData.nivelNotificacion || "";
    
    return "";
  });
  
  if (rowIndex !== -1) {
    sheet.getRange(rowIndex, 1, 1, newRow.length).setValues([newRow]);
  } else {
    sheet.appendRow(newRow);
  }
  
  return socioData;
}

function registrarPagoSocio(socioId, periodo, monto) {
  const sheetSocios = obtenerOCrearHoja(HOJA_SOCIOS);
  const dataSocios = sheetSocios.getDataRange().getValues();
  const headersSocios = dataSocios[0];
  
  let socioRowIndex = -1;
  let socioNombre = "";
  
  const colNombreIndex = headersSocios.map(normalizarCabecera).indexOf("razonSocial");
  const fallbackNombreIndex = headersSocios.map(normalizarCabecera).indexOf("nombreSocio");
  const actualNombreIndex = colNombreIndex !== -1 ? colNombreIndex : (fallbackNombreIndex !== -1 ? fallbackNombreIndex : 1);
  
  for (let i = 1; i < dataSocios.length; i++) {
    if (dataSocios[i][0].toString() === socioId.toString()) {
      socioRowIndex = i + 1;
      socioNombre = dataSocios[i][actualNombreIndex] ? dataSocios[i][actualNombreIndex].toString() : "Socio";
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

function obtenerTransaccionesDeSheet() {
  const sheet = obtenerOCrearHoja(HOJA_HISTORIAL);
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) return [];
  
  const transacciones = [];
  for (let i = data.length - 1; i >= 1; i--) { // De más nuevas a más viejas
    const row = data[i];
    if (!row[0]) continue;
    transacciones.push({
      idTransaccion: row[0].toString(),
      idSocio: row[1].toString(),
      nombreSocio: row[2].toString(),
      periodo: row[3].toString(),
      monto: Number(row[4]),
      fecha: row[5]
    });
  }
  return transacciones;
}

/**
 * Genera un borrador en Gmail con la plantilla adecuada y adjunta la factura en PDF de Drive
 * SOPORTA BÚSQUEDA INTELIGENTE DE BIMESTRES (Eje: "marzo abril", "marzo abirl") con tolerancia a errores de tipeo.
 */
function generarBorradorGmail(socioId, periodo, nivelAviso) {
  const socios = obtenerSociosRelacionales();
  const socio = socios.find(s => s.id.toString() === socioId.toString());
  
  if (!socio) throw new Error("Socio no encontrado");
  if (!socio.emailContacto) throw new Error("El socio no tiene un correo de contacto configurado.");
  
  // 1. OBTENER PALABRAS CLAVE DEL PERÍODO BIMENSUAL
  const palabrasClavePeriodo = obtenerPalabrasClaveBimestre(periodo);
  const anioPeriodo = periodo.split("-")[0]; // Eje: "2026"
  
  let archivoFactura = null;
  
  try {
    let carpeta = null;
    if (CARPETA_FACTURAS_ID) {
      carpeta = DriveApp.getFolderById(CARPETA_FACTURAS_ID);
    }
    
    // Normalizar el nombre del socio para la búsqueda (ej: tomar la primera palabra significativa)
    // Eje: "UNC-Hemoderivados" -> buscar "Hemoderivados" o "UNC-Hemoderivados"
    const nombreSocioLimpio = socio.nombreSocio.split(" ")[0].replace(/[^a-zA-Z0-9\-]/g, ""); 
    
    // Query flexible: Buscar archivos PDF que contengan el nombre limpio del socio y el año
    const query = `title contains '${nombreSocioLimpio}' and title contains '${anioPeriodo}' and mimeType = 'application/pdf'`;
    const archivosIterador = carpeta ? carpeta.searchFiles(query) : DriveApp.searchFiles(query);
    
    // Analizar las coincidencias para encontrar la que mejor calce con el bimestre
    let mejorCoincidencia = null;
    let maxCoincidenciasPalabras = 0;
    
    while (archivosIterador.hasNext()) {
      const archivo = archivosIterador.next();
      const tituloLimpio = archivo.getName().toLowerCase();
      
      let coincidencias = 0;
      palabrasClavePeriodo.forEach(palabra => {
        if (tituloLimpio.includes(palabra)) {
          coincidencias++;
        }
      });
      
      // Si el título del archivo coincide con más palabras clave del bimestre, lo seleccionamos
      if (coincidencias > maxCoincidenciasPalabras) {
        maxCoincidenciasPalabras = coincidencias;
        mejorCoincidencia = archivo;
      }
    }
    
    archivoFactura = mejorCoincidencia;
  } catch (driveError) {
    Logger.log("Error al buscar factura bimensual en Drive: " + driveError.toString());
  }
  
  const datosBanco = {
    banco: "Banco Provincia de Córdoba (BANCOR)",
    cbu: "0200356401000012345678",
    alias: "BIOTECH.CBA.CUOTA",
    titular: "Clúster de Biotecnología de Córdoba"
  };
  
  let asunto = "";
  let cuerpo = "";
  const mesAnioTexto = formatearMesAnioBimestre(periodo); // Formato Bimestre: "Marzo-Abril 2026"
  
  if (nivelAviso === 1) {
    asunto = `Clúster de Biotecnología de Córdoba - Recordatorio de Cuota Mensual [${mesAnioTexto}] - ${socio.nombreSocio}`;
    cuerpo = `Hola ${socio.contactoNombre || "de nuestra consideración"},\n\n` +
             `Espero que te encuentres muy bien.\n\n` +
             `Te escribimos desde el Clúster de Biotecnología de Córdoba para hacerte llegar el recordatorio de la cuota correspondiente al bimestre **${mesAnioTexto}** por un monto de **$${socio.montoCuota.toLocaleString('es-AR')}**.\n\n` +
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
             `Nos comunicamos para saludarte y, a la vez, realizar una actualización del estado de cuenta de **${socio.nombreSocio}** en el Clúster. Al día de la fecha, registramos un saldo pendiente de pago correspondiente al período bimensual **${mesAnioTexto}** por un total acumulado de **$${socio.montoCuota.toLocaleString('es-AR')}**.\n\n` +
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
             `Te escribimos en esta oportunidad con la intención de ponernos en contacto directo con respecto al estado societario de **${socio.nombreSocio}**. Registramos un saldo pendiente acumulado correspondiente al período bimensual **${mesAnioTexto}** por un total de **$${socio.montoCuota.toLocaleString('es-AR')}**.\n\n` +
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
    
    if (nombreHoja === HOJA_CATEGORIAS) {
      sheet.appendRow(["Categoria", "Monto Cuota ($)"]);
      sheet.getRange("A1:B1").setFontWeight("bold").setBackground("#cbd5e1");
      sheet.appendRow(["Premium", 50000]);
      sheet.appendRow(["Estándar", 35000]);
      sheet.appendRow(["Startup", 25000]);
      sheet.appendRow(["Exento", 0]);
    }
    else if (nombreHoja === HOJA_SOCIOS) {
      sheet.appendRow([
        "ID", 
        "Nombre Socio", 
        "Tipo", 
        "Categoria", 
        "Email Contacto", 
        "Contacto Nombre", 
        "Ultimo Mes Pagado", 
        "Estado Actual"
      ]);
      sheet.getRange("A1:H1").setFontWeight("bold").setBackground("#e2e8f0");
      
      // Socios de prueba reales adaptados a la captura de Drive del usuario
      sheet.appendRow(["SOC-001", "Bioetanol", "Fin de Lucro", "Estándar", "administracion@bioetanol.com.ar", "Lic. Roberto Paz", "2026-02", "Pendiente"]);
      sheet.appendRow(["SOC-002", "Biosinergy", "Fin de Lucro", "Startup", "finanzas@biosinergy.com.ar", "Ing. Daniel Lamarque", "2026-04", "Pagado"]);
      sheet.appendRow(["SOC-003", "Buenas maltas", "Fin de Lucro", "Startup", "pagos@buenasmaltas.com.ar", "Dr. Claudio Lace", "2026-02", "Vencido"]);
      sheet.appendRow(["SOC-004", "FPM", "Fin de Lucro", "Startup", "proveedores@fpm.com", "Bioq. Lucas Toledo", "2026-04", "Pagado"]);
      sheet.appendRow(["SOC-005", "UNC-Hemoderivados", "Fin de Lucro", "Premium", "vinculacion@hemoderivados.unc.edu.ar", "Dr. Hugo Juri", "2026-02", "Pendiente"]);
    }
    else if (nombreHoja === HOJA_HISTORIAL) {
      sheet.appendRow(["ID Transaccion", "ID Socio", "Nombre Socio", "Periodo Pagado", "Monto", "Fecha Registro"]);
      sheet.getRange("A1:F1").setFontWeight("bold").setBackground("#cbd5e1");
    }
    else if (nombreHoja === HOJA_CRM) {
      sheet.appendRow(["ID Lead", "Nombre Empresa", "Estado", "Email Contacto", "Contacto Nombre", "Fecha Registro"]);
      sheet.getRange("A1:F1").setFontWeight("bold").setBackground("#e2e8f0");
      sheet.appendRow(["LEAD-001", "Biocombustibles Cba", "Mapeado", "contacto@biocba.com", "Ing. Roberto Paz", new Date()]);
      sheet.appendRow(["LEAD-002", "AgroBiotech S.A.", "Contacto Inicial", "ventas@agrobiotech.com", "Dra. Laura Rossi", new Date()]);
      sheet.appendRow(["LEAD-003", "Genética Semillas", "Reunión", "info@geneticasemillas.com", "Lic. Esteban Juárez", new Date()]);
    }
    else if (nombreHoja === HOJA_USUARIOS) {
      sheet.appendRow(["Usuario", "Clave", "Rol", "Nombre"]);
      sheet.getRange("A1:D1").setFontWeight("bold").setBackground("#cbd5e1");
      sheet.appendRow(["admin", "admin123", "Administrador", "Sebastián"]);
      sheet.appendRow(["consulta", "consulta123", "Consulta", "Pablo (Lectura)"]);
    }
  }
  return sheet;
}

/**
 * ====================================================================
 * CONFIGURACION DE TRADUCCION Y BUSQUEDA DE MESES/BIMESTRES
 * ====================================================================
 */

/**
 * Traduce un formato "YYYY-MM" al bimestre correspondiente en palabras clave para búsqueda en Drive.
 * Soporta fallos tipográficos ("abril", "abirl").
 */
function obtenerPalabrasClaveBimestre(periodoStr) {
  if (!periodoStr || !periodoStr.includes("-")) return ["marzo", "abril", "abirl"];
  
  const mesIndex = parseInt(periodoStr.split("-")[1], 10);
  
  // Asignación de bimestres según el mes de cierre o cobro del selector
  // Si el selector marca Abril (04), corresponde al bimestre Marzo-Abril
  if (mesIndex === 3 || mesIndex === 4) {
    return ["marzo", "abril", "abirl"];
  } 
  else if (mesIndex === 5 || mesIndex === 6) {
    return ["mayo", "junio", "junio"];
  } 
  else if (mesIndex === 7 || mesIndex === 8) {
    return ["julio", "agosto"];
  } 
  else if (mesIndex === 9 || mesIndex === 10) {
    return ["septiembre", "octubre"];
  } 
  else if (mesIndex === 11 || mesIndex === 12) {
    return ["noviembre", "diciembre"];
  } 
  else {
    return ["enero", "febrero"];
  }
}

/**
 * Formatea el período YYYY-MM en una cadena legible de Bimestre en español
 */
function formatearMesAnioBimestre(periodoStr) {
  if (!periodoStr || !periodoStr.includes("-")) return periodoStr;
  
  const partes = periodoStr.split("-");
  const anio = partes[0];
  const mesIndex = parseInt(partes[1], 10);
  
  if (mesIndex === 3 || mesIndex === 4) {
    return `Marzo-Abril ${anio}`;
  } 
  else if (mesIndex === 5 || mesIndex === 6) {
    return `Mayo-Junio ${anio}`;
  } 
  else if (mesIndex === 7 || mesIndex === 8) {
    return `Julio-Agosto ${anio}`;
  } 
  else if (mesIndex === 9 || mesIndex === 10) {
    return `Septiembre-Octubre ${anio}`;
  } 
  else if (mesIndex === 11 || mesIndex === 12) {
    return `Noviembre-Diciembre ${anio}`;
  } 
  else {
    return `Enero-Febrero ${anio}`;
  }
}

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

function configurarValidacionesEnSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetSocios = ss.getSheetByName(HOJA_SOCIOS);
  const sheetCategorias = ss.getSheetByName(HOJA_CATEGORIAS);
  
  if (!sheetSocios || !sheetCategorias) return;
  
  const headers = sheetSocios.getDataRange().getValues()[0].map(h => h.toString().trim());
  const colCatIndex = headers.map(normalizarCabecera).indexOf("categoria");
  const colEstadoIndex = headers.map(normalizarCabecera).indexOf("estadoActual");
  const colNivelNotifIndex = headers.map(normalizarCabecera).indexOf("nivelNotificacion");
  
  const lastRowSocios = sheetSocios.getLastRow();
  if (lastRowSocios < 2) return;
  
  // 1. Validación de Categoría: dinámicamente usando la lista de la hoja Categorias
  if (colCatIndex !== -1) {
    const numCategorias = sheetCategorias.getLastRow();
    if (numCategorias > 1) {
      const rangoCategorias = sheetCategorias.getRange(2, 1, numCategorias - 1, 1);
      const ruleCat = SpreadsheetApp.newDataValidation()
        .requireValueInRange(rangoCategorias, true)
        .setAllowInvalid(false)
        .setHelpText("Selecciona una categoria valida de la pestaña Categorias")
        .build();
      
      const rangoColCat = sheetSocios.getRange(2, colCatIndex + 1, lastRowSocios - 1, 1);
      rangoColCat.setDataValidation(ruleCat);
    }
  }
  
  // 2. Validación de Estado Actual: valores fijos Pagado, Pendiente, Vencido
  if (colEstadoIndex !== -1) {
    const ruleEstado = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Pagado", "Pendiente", "Vencido"], true)
      .setAllowInvalid(false)
      .setHelpText("Selecciona uno de los estados validos: Pagado, Pendiente o Vencido")
      .build();
    
    const rangoColEstado = sheetSocios.getRange(2, colEstadoIndex + 1, lastRowSocios - 1, 1);
    rangoColEstado.setDataValidation(ruleEstado);
  }

  // 3. Validación de Nivel Notificación: valores fijos Factura Inicial, 1° Recordatorio, 2° Recordatorio
  if (colNivelNotifIndex !== -1) {
    const ruleNivel = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Factura Inicial", "1° Recordatorio", "2° Recordatorio"], true)
      .setAllowInvalid(false)
      .setHelpText("Selecciona un nivel de notificacion valido")
      .build();
    
    const rangoColNivel = sheetSocios.getRange(2, colNivelNotifIndex + 1, lastRowSocios - 1, 1);
    rangoColNivel.setDataValidation(ruleNivel);
  }
}

function enviarCorreoMasivoSocio(socioId, periodo, nivelAviso) {
  const socios = obtenerSociosRelacionales();
  const socio = socios.find(s => s.id.toString() === socioId.toString());
  
  if (!socio) throw new Error("Socio no encontrado");
  if (!socio.emailContacto) throw new Error("El socio no tiene un correo de contacto configurado.");
  
  // 1. OBTENER PALABRAS CLAVE DEL PERÍODO BIMENSUAL Y BUSCAR PDF EN DRIVE
  const palabrasClavePeriodo = obtenerPalabrasClaveBimestre(periodo);
  const anioPeriodo = periodo.split("-")[0];
  let archivoFactura = null;
  
  try {
    let carpeta = null;
    if (CARPETA_FACTURAS_ID) {
      carpeta = DriveApp.getFolderById(CARPETA_FACTURAS_ID);
    }
    const nombreSocioLimpio = socio.nombreSocio.split(" ")[0].replace(/[^a-zA-Z0-9\-]/g, ""); 
    const query = `title contains '${nombreSocioLimpio}' and title contains '${anioPeriodo}' and mimeType = 'application/pdf'`;
    const archivosIterador = carpeta ? carpeta.searchFiles(query) : DriveApp.searchFiles(query);
    
    let mejorCoincidencia = null;
    let maxCoincidenciasPalabras = 0;
    
    while (archivosIterador.hasNext()) {
      const archivo = archivosIterador.next();
      const tituloLimpio = archivo.getName().toLowerCase();
      
      let coincidencias = 0;
      palabrasClavePeriodo.forEach(palabra => {
        if (tituloLimpio.includes(palabra)) {
          coincidencias++;
        }
      });
      if (coincidencias > maxCoincidenciasPalabras) {
        maxCoincidenciasPalabras = coincidencias;
        mejorCoincidencia = archivo;
      }
    }
    archivoFactura = mejorCoincidencia;
  } catch (driveError) {
    Logger.log("Error al buscar factura en Drive: " + driveError.toString());
  }
  
  // 2. PREPARAR DATOS DE EMAIL
  const datosBanco = {
    banco: "Banco Provincia de Córdoba (BANCOR)",
    cbu: "0200356401000012345678",
    alias: "BIOTECH.CBA.CUOTA",
    titular: "Clúster de Biotecnología de Córdoba"
  };
  
  let asunto = "";
  let cuerpo = "";
  const mesAnioTexto = formatearMesAnioBimestre(periodo);
  
  if (nivelAviso === 1) {
    asunto = `Clúster de Biotecnología de Córdoba - Recordatorio de Cuota Mensual [${mesAnioTexto}] - ${socio.nombreSocio}`;
    cuerpo = `Hola ${socio.contactoNombre || "de nuestra consideración"},\n\n` +
             `Espero que te encuentres muy bien.\n\n` +
             `Te escribimos desde el Clúster de Biotecnología de Córdoba para hacerte llegar el recordatorio de la cuota correspondiente al bimestre **${mesAnioTexto}** por un monto de **$${socio.montoCuota.toLocaleString('es-AR')}**.\n\n` +
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
             `Nos comunicamos para saludarte y, a la vez, realizar una actualización del estado de cuenta de **${socio.nombreSocio}** en el Clúster. Al día de la fecha, registramos un saldo pendiente de pago correspondiente al período bimensual **${mesAnioTexto}** por un total acumulado de **$${socio.montoCuota.toLocaleString('es-AR')}**.\n\n` +
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
  else {
    asunto = `Actualización y Agenda de Reunión Operativa - Clúster Biotech Cba - ${socio.nombreSocio}`;
    cuerpo = `Estimado/a ${socio.contactoNombre || "de nuestra consideración"},\n\n` +
             `Esperamos que te encuentres muy bien.\n\n` +
             `Te escribimos en esta oportunidad con la intención de ponernos en contacto directo con respecto al estado societario de **${socio.nombreSocio}**. Registramos un saldo pendiente acumulado correspondiente al período bimensual **${mesAnioTexto}** por un total de **$${socio.montoCuota.toLocaleString('es-AR')}**.\n\n` +
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
  
  // Crear borrador y enviarlo de inmediato
  const borrador = GmailApp.createDraft(
    socio.emailContacto, 
    asunto, 
    cuerpo,
    options
  );
  borrador.send();
  
  // 3. ACTUALIZAR COLUMNAS DE NOTIFICACIÓN EN GOOGLE SHEETS
  const sheet = obtenerOCrearHoja(HOJA_SOCIOS);
  const dataValues = sheet.getDataRange().getValues();
  const headers = dataValues[0];
  
  const colUltimaNotifIndex = headers.map(normalizarCabecera).indexOf("ultimaNotificacion");
  const colNivelNotifIndex = headers.map(normalizarCabecera).indexOf("nivelNotificacion");
  
  let rowIndex = -1;
  for (let i = 1; i < dataValues.length; i++) {
    if (dataValues[i][0] && dataValues[i][0].toString() === socioId.toString()) {
      rowIndex = i + 1;
      break;
    }
  }
  
  if (rowIndex !== -1) {
    const fechaHoy = new Date();
    const fechaHoyTexto = Utilities.formatDate(fechaHoy, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const nivelTexto = nivelAviso === 1 ? "Factura Inicial" : (nivelAviso === 2 ? "1° Recordatorio" : "2° Recordatorio");
    
    if (colUltimaNotifIndex !== -1) {
      sheet.getRange(rowIndex, colUltimaNotifIndex + 1).setValue(fechaHoyTexto);
    }
    if (colNivelNotifIndex !== -1) {
      sheet.getRange(rowIndex, colNivelNotifIndex + 1).setValue(nivelTexto);
    }
  }
  
  return {
    success: true,
    pdfAdjuntado: !!archivoFactura
  };
}


