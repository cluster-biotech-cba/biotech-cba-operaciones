/**
 * ====================================================================
 * LOGICA DEL CLIENTE (FRONTEND SPA) - CLUSTER BIOTECH CORDOBA
 * Gestiona el estado, KPIs, filtros e integraciones de Google Sheets.
 * ====================================================================
 */

// ESTADO GLOBAL DE LA APLICACIÓN
const GAS_URL_DEFAULT = "https://script.google.com/macros/s/AKfycbxMWDgndw9SUB3pzn5qqdcv47jChgM-_KSNxD61oqdJaiAo03-pFyVi0REbQzsg5z2k/exec";

let CONFIG = {
    gasUrl: localStorage.getItem("gas_url") || GAS_URL_DEFAULT,
    driveFolderId: localStorage.getItem("drive_folder_id") || ""
};

let SOCIOS = [];
let CATEGORIAS = [
    { categoria: "Premium", montoCuota: 50000 },
    { categoria: "Estándar", montoCuota: 35000 },
    { categoria: "Startup", montoCuota: 25000 },
    { categoria: "Exento", montoCuota: 0 }
];
let HISTORIAL_PAGOS = [];
let FILTRO_ESTADO = "todos";
let FILTRO_BUSQUEDA = "";
let PERIODO_ACTUAL = "2026-05";
let CURRENT_USER = JSON.parse(localStorage.getItem("current_user")) || null;

// Datos locales "fallback" para demostración si no hay URL en la nube conectada
const SOCIOS_DEMO = [
    { id: "SOC-001", nombreSocio: "Laboratorio Hemoderivados UNC", tipo: "Fin de Lucro", categoria: "Estándar", montoCuota: 35000, emailContacto: "administracion@hemoderivados.unc.edu.ar", contactoNombre: "Lic. María González", ultimoMesPagado: "2026-04", estadoActual: "Pendiente" },
    { id: "SOC-002", nombreSocio: "Lamarx Biotech", tipo: "Fin de Lucro", categoria: "Startup", montoCuota: 25000, emailContacto: "finanzas@lamarx.com.ar", contactoNombre: "Ing. Daniel Lamarque", ultimoMesPagado: "2026-05", estadoActual: "Pagado" },
    { id: "SOC-003", nombreSocio: "Lace Laboratorios", tipo: "Fin de Lucro", categoria: "Estándar", montoCuota: 35000, emailContacto: "pagos@lace.com.ar", contactoNombre: "Dr. Claudio Lace", ultimoMesPagado: "2026-03", estadoActual: "Vencido" },
    { id: "SOC-004", nombreSocio: "Promedon S.A.", tipo: "Fin de Lucro", categoria: "Premium", montoCuota: 50000, emailContacto: "proveedores@promedon.com", contactoNombre: "Cdra. Sofía Promedon", ultimoMesPagado: "2026-04", estadoActual: "Pendiente" },
    { id: "SOC-005", nombreSocio: "FPM Startups", tipo: "Fin de Lucro", categoria: "Startup", montoCuota: 25000, emailContacto: "contacto@fpmbiotech.com", contactoNombre: "Bioq. Lucas Toledo", ultimoMesPagado: "2026-05", estadoActual: "Pagado" },
    { id: "SOC-006", nombreSocio: "CONICET Córdoba", tipo: "Sin Fin de Lucro", categoria: "Exento", montoCuota: 0, emailContacto: "vinculacion@cordoba-conicet.gov.ar", contactoNombre: "Dr. Edgardo Baldo", ultimoMesPagado: "2026-05", estadoActual: "Pagado" },
    { id: "SOC-007", nombreSocio: "Ministerio de Ciencia y Tec.", tipo: "Sin Fin de Lucro", categoria: "Exento", montoCuota: 0, emailContacto: "mincyt@cba.gov.ar", contactoNombre: "Secretaría de Vinculación", ultimoMesPagado: "2026-05", estadoActual: "Pagado" }
];

// Datos bancarios institucionales para pre-redactar mails
const DATOS_BANCO = {
    banco: "Banco Provincia de Córdoba (BANCOR)",
    cbu: "0200356401000012345678",
    alias: "BIOTECH.CBA.CUOTA",
    titular: "Clúster de Biotecnología de Córdoba"
};

// SELECTORES DOM
document.addEventListener("DOMContentLoaded", () => {
    inicializarApp();
});

function inicializarApp() {
    // Cargar configuraciones guardadas en inputs
    if (CONFIG.gasUrl) {
        document.getElementById("gas-endpoint-url").value = CONFIG.gasUrl;
    }
    if (CONFIG.driveFolderId) {
        document.getElementById("drive-folder-id").value = CONFIG.driveFolderId;
    }
    
    // Configurar Período actual en el selector
    const hoy = new Date();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const anio = hoy.getFullYear();
    PERIODO_ACTUAL = `${anio}-${mes}`;
    document.getElementById("periodo-filtro").value = PERIODO_ACTUAL;

    // EVENTOS DE NAVEGACION (Sidebar Tabs)
    const navItems = document.querySelectorAll(".nav-item");
    navItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            navItems.forEach(i => i.classList.remove("active"));
            item.classList.add("active");
            
            const tabId = item.getAttribute("data-tab");
            document.querySelectorAll(".tab-panel").forEach(panel => {
                panel.classList.remove("active");
            });
            document.getElementById(`tab-${tabId}`).classList.add("active");
            
            // Cambiar título dinámicamente
            const titulos = {
                cobranzas: "Gestión de Cobranzas y Cuotas",
                socios: "Base de Miembros del Clúster",
                historial: "Registro Histórico de Recaudaciones",
                masivo: "Campañas de Envío Masivo y Reiteraciones",
                config: "Configuración de Conexión"
            };
            document.getElementById("page-title").textContent = titulos[tabId] || "Consola de Operaciones";
            
            // Cargar datos frescos al entrar
            if (tabId === "historial") {
                cargarHistorialDeNube();
            } else if (tabId === "masivo") {
                cargarCampanaMasiva();
            }
        });
    });

    // EVENTO MODO OSCURO/CLARO
    const themeToggle = document.getElementById("theme-toggle");
    themeToggle.addEventListener("click", () => {
        document.body.classList.toggle("light-theme");
        document.body.classList.toggle("dark-theme");
        const icon = themeToggle.querySelector("i");
        if (document.body.classList.contains("light-theme")) {
            icon.className = "fa-solid fa-sun";
        } else {
            icon.className = "fa-solid fa-moon";
        }
    });

    // EVENTOS DE FILTROS Y BÚSQUEDA
    document.getElementById("search-socio").addEventListener("input", (e) => {
        FILTRO_BUSQUEDA = e.target.value.toLowerCase();
        renderizarTablas();
    });

    const filterButtons = document.querySelectorAll(".filter-btn");
    filterButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            filterButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            FILTRO_ESTADO = btn.getAttribute("data-filter");
            renderizarTablas();
        });
    });

    document.getElementById("periodo-filtro").addEventListener("change", (e) => {
        PERIODO_ACTUAL = e.target.value;
        renderizarTablas();
    });

    // EVENTO SINCRONIZAR
    document.getElementById("btn-sync").addEventListener("click", () => {
        if (validarSesion()) cargarSociosDeNube();
    });

    // FORMULARIO CONFIGURACION NUBE
    document.getElementById("form-config-cloud").addEventListener("submit", (e) => {
        e.preventDefault();
        const url = document.getElementById("gas-endpoint-url").value.trim();
        const folderId = document.getElementById("drive-folder-id").value.trim();
        
        localStorage.setItem("gas_url", url);
        localStorage.setItem("drive_folder_id", folderId);
        CONFIG.gasUrl = url;
        CONFIG.driveFolderId = folderId;
        
        probarConexionNube();
    });

    // EVENTOS MODALES SOCIOS
    document.getElementById("btn-nuevo-socio").addEventListener("click", () => {
        abrirModalSocio();
    });

    document.getElementById("btn-close-socio-modal").addEventListener("click", cerrartodosModales);
    document.getElementById("btn-cancel-socio-modal").addEventListener("click", cerrartodosModales);
    
    document.getElementById("form-socio").addEventListener("submit", (e) => {
        e.preventDefault();
        guardarSocioHandler();
    });

    // EVENTOS MODALES EMAIL
    document.getElementById("btn-close-email-modal").addEventListener("click", cerrartodosModales);
    document.getElementById("btn-cancel-email-modal").addEventListener("click", cerrartodosModales);
    document.getElementById("select-aviso-nivel").addEventListener("change", actualizarVistaPreviaCorreo);
    
    document.getElementById("btn-copy-preview").addEventListener("click", copiarCuerpoCorreo);
    document.getElementById("btn-action-gmail").addEventListener("click", dispararBorradorGmail);

    // EVENTOS LOGIN Y LOGOUT
    const formLogin = document.getElementById("form-login");
    if (formLogin) {
        formLogin.addEventListener("submit", manejarLogin);
    }
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
        btnLogout.addEventListener("click", manejarLogout);
    }

    // EVENTOS HISTORIAL
    const btnSyncHistorial = document.getElementById("btn-sync-historial");
    if (btnSyncHistorial) {
        btnSyncHistorial.addEventListener("click", cargarHistorialDeNube);
    }
    const searchHistorial = document.getElementById("search-historial");
    if (searchHistorial) {
        searchHistorial.addEventListener("input", renderizarHistorial);
    }
    
    // EVENTOS CAMPAÑA MASIVA
    const btnEjecutarCampana = document.getElementById("btn-ejecutar-campana");
    if (btnEjecutarCampana) {
        btnEjecutarCampana.addEventListener("click", ejecutarCampanaMasiva);
    }

    actualizarSelectCategorias();

    // Cargar datos iniciales
    if (validarSesion()) {
        cargarSociosDeNube();
    } else {
        // Cargar datos locales de demostración mientras está la pantalla de login de fondo
        SOCIOS = [...SOCIOS_DEMO];
        renderizarTablas();
        calcularKPIs();
    }
}

function actualizarSelectCategorias() {
    const select = document.getElementById("socio-categoria");
    if (!select) return;
    
    select.innerHTML = "";
    CATEGORIAS.forEach(cat => {
        const option = document.createElement("option");
        option.value = cat.categoria;
        option.textContent = `${cat.categoria} ($${cat.montoCuota.toLocaleString('es-AR')})`;
        select.appendChild(option);
    });
}

/**
 * ====================================================================
 * OBTENCIÓN Y SINCRONIZACIÓN DE DATOS (NUBE O FALLBACK)
 * ====================================================================
 */

async function cargarSociosDeNube() {
    const listBody = document.getElementById("lista-cobranzas-body");
    const statusIndicator = document.getElementById("connection-status");
    
    listBody.innerHTML = `
        <tr>
            <td colspan="6" class="loading-state">
                <i class="fa-solid fa-spinner fa-spin"></i> Cargando base de datos en la nube...
            </td>
        </tr>
    `;

    if (!CONFIG.gasUrl) {
        // No hay API configurada, cargamos datos DEMO locales
        console.log("No hay URL de Apps Script configurada. Cargando base de datos de demostración local.");
        SOCIOS = [...SOCIOS_DEMO];
        statusIndicator.className = "status-indicator disconnected";
        statusIndicator.querySelector(".status-text").textContent = "Base Demo Local";
        
        setTimeout(() => {
            renderizarTablas();
            calcularKPIs();
        }, 600);
        return;
    }

    try {
        const userQuery = CURRENT_USER ? `&usuario=${encodeURIComponent(CURRENT_USER.usuario)}&clave=${encodeURIComponent(CURRENT_USER.clave || "")}` : "";
        const response = await fetch(`${CONFIG.gasUrl}?action=getSocios${userQuery}`);
        if (!response.ok) throw new Error("Error en respuesta HTTP del servidor.");
        
        const resJson = await response.json();
        
        if (resJson.success) {
            SOCIOS = resJson.data;
            if (resJson.categorias) {
                CATEGORIAS = resJson.categorias;
            }
            actualizarSelectCategorias();
            statusIndicator.className = "status-indicator connected";
            statusIndicator.querySelector(".status-text").textContent = "Conectado a Sheets";
            renderizarTablas();
            calcularKPIs();
            cargarCampanaMasiva();
        } else {
            if (resJson.error && resJson.error.includes("No autorizado")) {
                localStorage.removeItem("current_user");
                CURRENT_USER = null;
                validarSesion();
            }
            throw new Error(resJson.error || "Error desconocido devuelto por Apps Script.");
        }
    } catch (error) {
        console.error("Fallo al conectar con Google Sheets:", error);
        statusIndicator.className = "status-indicator disconnected";
        statusIndicator.querySelector(".status-text").textContent = "Error Conexión";
        
        // Cargar fallback demo
        SOCIOS = [...SOCIOS_DEMO];
        renderizarTablas();
        calcularKPIs();
        cargarCampanaMasiva();
        
        alert("Atención: No pudimos conectar con tu Google Sheet en la nube.\n" +
              "Hemos cargado la Base de Datos Demostrativa local para que sigas operando.\n" +
              "Revisá la pestaña 'Conexión Nube' y la URL ingresada.");
    }
}

async function probarConexionNube() {
    const logBox = document.getElementById("config-conn-log");
    logBox.innerHTML = `[${new Date().toLocaleTimeString()}] Iniciando prueba de conexión con Google Apps Script...\n`;
    
    try {
        const userQuery = CURRENT_USER ? `&usuario=${encodeURIComponent(CURRENT_USER.usuario)}&clave=${encodeURIComponent(CURRENT_USER.clave || "")}` : "";
        const response = await fetch(`${CONFIG.gasUrl}?action=getSocios${userQuery}`);
        if (!response.ok) throw new Error(`HTTP Error Status: ${response.status}`);
        
        const resJson = await response.json();
        if (resJson.success) {
            logBox.innerHTML += `[${new Date().toLocaleTimeString()}] ✅ CONEXIÓN EXITOSA!\n`;
            logBox.innerHTML += `[${new Date().toLocaleTimeString()}] Base de datos leída correctamente: ${resJson.data.length} socios identificados.\n`;
            
            SOCIOS = resJson.data;
            if (resJson.categorias) {
                CATEGORIAS = resJson.categorias;
            }
            actualizarSelectCategorias();
            document.getElementById("connection-status").className = "status-indicator connected";
            document.getElementById("connection-status").querySelector(".status-text").textContent = "Conectado a Sheets";
            
            renderizarTablas();
            calcularKPIs();
            cargarCampanaMasiva();
            alert("✅ Conexión con tu Google Sheet establecida con éxito.");
        } else {
            throw new Error(resJson.error);
        }
    } catch (error) {
        logBox.innerHTML += `[${new Date().toLocaleTimeString()}] ❌ FALLÓ LA CONEXIÓN.\n`;
        logBox.innerHTML += `Detalle del error: ${error.toString()}\n`;
        logBox.innerHTML += `Asegurate de haber publicado el Apps Script como Web App accesible por "Cualquiera".`;
        
        document.getElementById("connection-status").className = "status-indicator disconnected";
        document.getElementById("connection-status").querySelector(".status-text").textContent = "Error Conexión";
    }
}

/**
 * ====================================================================
 * PROCESAMIENTO Y RENDERIZADO DE TABLAS
 * ====================================================================
 */

function renderizarTablas() {
    const listCobranzasBody = document.getElementById("lista-cobranzas-body");
    const listSociosBody = document.getElementById("lista-socios-body");
    
    listCobranzasBody.innerHTML = "";
    listSociosBody.innerHTML = "";
    
    // Filtrar socios para cobranzas
    const sociosFiltrados = SOCIOS.filter(socio => {
        const matchesBusqueda = socio.nombreSocio.toLowerCase().includes(FILTRO_BUSQUEDA) || 
                                socio.contactoNombre.toLowerCase().includes(FILTRO_BUSQUEDA);
        
        // Evaluar estado para el período actual seleccionado
        const estadoPeriodo = calcularEstadoPagoPeriodo(socio, PERIODO_ACTUAL);
        const matchesEstado = FILTRO_ESTADO === "todos" || estadoPeriodo === FILTRO_ESTADO;
        
        return matchesBusqueda && matchesEstado;
    });

    const isReadOnly = CURRENT_USER && CURRENT_USER.rol === "Consulta";

    if (sociosFiltrados.length === 0) {
        listCobranzasBody.innerHTML = `
            <tr>
                <td colspan="7" class="loading-state">
                    No se encontraron socios que coincidan con los filtros aplicados.
                </td>
            </tr>
        `;
    } else {
        sociosFiltrados.forEach(socio => {
            const estado = calcularEstadoPagoPeriodo(socio, PERIODO_ACTUAL);
            const isSinFinLucro = socio.categoria === "Exento";
            
            let badgeClass = "badge-pendiente";
            if (estado === "Pagado") badgeClass = "badge-pagado";
            if (estado === "Vencido") badgeClass = "badge-vencido";
            
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <div style="font-weight: 600;">${socio.nombreSocio}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">ID: ${socio.id}</div>
                </td>
                <td>
                    <div>${socio.contactoNombre}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${socio.emailContacto}</div>
                </td>
                <td>
                    <strong style="font-size: 0.95rem;">$${socio.montoCuota.toLocaleString('es-AR')}</strong>
                </td>
                <td>
                    <span style="font-family: monospace;">${formatearUltimoPago(socio.ultimoMesPagado)}</span>
                </td>
                <td>
                    <span class="badge ${badgeClass}">${isSinFinLucro && estado === 'Pagado' ? 'Exento' : estado}</span>
                </td>
                <td>
                    <div class="btn-group">
                        ${isReadOnly ? `
                            <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500;"><i class="fa-solid fa-eye"></i> Solo Lectura</span>
                        ` : (estado !== "Pagado" && !isSinFinLucro ? `
                            <button class="btn btn-secondary btn-action btn-small" onclick="abrirGeneradorCorreo('${socio.id}')">
                                <i class="fa-solid fa-envelope"></i> Redactar Cobro
                            </button>
                            <button class="btn btn-primary btn-action btn-small" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);" onclick="marcarPagadoRapido('${socio.id}')">
                                <i class="fa-solid fa-check"></i> Pagó
                            </button>
                        ` : `
                            <span class="color-green-text" style="font-size: 0.8rem; font-weight:600;"><i class="fa-solid fa-circle-check"></i> Al Día</span>
                            <button class="btn btn-secondary btn-action btn-small" style="padding: 2px 6px; margin-left: 8px; font-size: 0.7rem;" onclick="verHistorialSocio('${socio.nombreSocio}')" title="Ver Historial de Pagos">
                                <i class="fa-solid fa-clock-rotate-left"></i> Ver Pagos
                            </button>
                        `)}
                    </div>
                </td>
            `;
            listCobranzasBody.appendChild(tr);
        });
    }

    // Renderizar pestaña de gestión de socios completa
    SOCIOS.forEach(socio => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><code style="font-size:0.75rem;">${socio.id}</code></td>
            <td><strong>${socio.nombreSocio}</strong></td>
            <td>${socio.categoria || 'Estándar'}</td>
            <td>$${socio.montoCuota.toLocaleString('es-AR')}</td>
            <td>${socio.emailContacto}</td>
            <td>${socio.contactoNombre}</td>
            <td>
                <div class="btn-group">
                    ${isReadOnly ? `
                        <span style="font-size: 0.8rem; color: var(--text-muted);">-</span>
                    ` : `
                        <button class="btn btn-secondary btn-action btn-small" onclick="abrirModalSocio('${socio.id}')">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                    `}
                </div>
            </td>
        `;
        listSociosBody.appendChild(tr);
    });
}

/**
 * Calcula dinámicamente si un socio está pagado, pendiente o vencido para el mes seleccionado
 */
function calcularEstadoPagoPeriodo(socio, periodoEvaluar) {
    if (socio.categoria === "Exento" || socio.montoCuota === 0) return "Pagado";
    if (!socio.ultimoMesPagado) return "Vencido";
    
    // Normalizar si viene en formato ISO o fecha completa (ej: 2026-02-01T03:00:00.000Z)
    let ultimoPagoStr = socio.ultimoMesPagado.toString().trim();
    if (ultimoPagoStr.includes("T")) {
        ultimoPagoStr = ultimoPagoStr.split("T")[0]; // Queda "2026-02-01"
    }
    if (ultimoPagoStr.includes("-")) {
        const partes = ultimoPagoStr.split("-");
        if (partes.length >= 2) {
            ultimoPagoStr = `${partes[0]}-${partes[1]}`; // Queda "2026-02"
        }
    }
    
    // Comparar períodos en formato YYYY-MM
    const [anioEval, mesEval] = periodoEvaluar.split("-").map(Number);
    const [anioPago, mesPago] = ultimoPagoStr.split("-").map(Number);
    
    if (isNaN(anioPago) || isNaN(mesPago)) return "Vencido";
    
    if (anioPago > anioEval || (anioPago === anioEval && mesPago >= mesEval)) {
        return "Pagado";
    }
    
    // Si debe más de 1 período, catalogamos como vencido (Mora), de lo contrario pendiente del mes
    const diferenciaMeses = (anioEval - anioPago) * 12 + (mesEval - mesPago);
    return diferenciaMeses > 1 ? "Vencido" : "Pendiente";
}

/**
 * ====================================================================
 * CALCULO DE DATOS Y ESTADÍSTICAS (KPIs)
 * ====================================================================
 */

function calcularKPIs() {
    let totalProyectado = 0;
    let totalRecaudado = 0;
    let totalPendiente = 0;
    let totalMora = 0;
    
    let sociosPendientesCount = 0;
    let sociosMoraCount = 0;

    SOCIOS.forEach(socio => {
        if (socio.categoria === "Exento" || socio.montoCuota === 0) return; // No suman al balance
        
        totalProyectado += socio.montoCuota;
        const estado = calcularEstadoPagoPeriodo(socio, PERIODO_ACTUAL);
        
        if (estado === "Pagado") {
            totalRecaudado += socio.montoCuota;
        } else if (estado === "Pendiente") {
            totalPendiente += socio.montoCuota;
            sociosPendientesCount++;
        } else if (estado === "Vencido") {
            totalMora += socio.montoCuota;
            sociosMoraCount++;
        }
    });

    const pctRecaudado = totalProyectado > 0 ? Math.round((totalRecaudado / totalProyectado) * 100) : 0;
    
    document.getElementById("kpi-total").textContent = `$${totalProyectado.toLocaleString('es-AR')}`;
    document.getElementById("kpi-total-sub").textContent = `${SOCIOS.filter(s => s.categoria !== "Exento" && s.montoCuota > 0).length} empresas en cuota`;
    
    document.getElementById("kpi-recaudado").textContent = `$${totalRecaudado.toLocaleString('es-AR')}`;
    document.getElementById("kpi-recaudado-pct").textContent = `${pctRecaudado}% recaudado`;
    
    document.getElementById("kpi-pendiente").textContent = `$${totalPendiente.toLocaleString('es-AR')}`;
    document.getElementById("kpi-pendiente-sub").textContent = `${sociosPendientesCount} cuotas del mes`;
    
    document.getElementById("kpi-mora").textContent = `$${totalMora.toLocaleString('es-AR')}`;
    document.getElementById("kpi-mora-sub").textContent = `${sociosMoraCount} socios con mora crítica`;
}

/**
 * ====================================================================
 * REGISTROS DE PAGO RÁPIDOS
 * ====================================================================
 */

async function marcarPagadoRapido(socioId) {
    const socio = SOCIOS.find(s => s.id === socioId);
    if (!socio) return;
    
    const confirmar = confirm(`¿Confirmas registrar el cobro de la cuota de ${socio.nombreSocio} por $${socio.montoCuota} para el período ${PERIODO_ACTUAL}?`);
    if (!confirmar) return;

    if (!CONFIG.gasUrl) {
        // Operación local en demo
        socio.ultimoMesPagado = PERIODO_ACTUAL;
        socio.estadoActual = "Pagado";
        alert("✅ Pago registrado con éxito (Modo local de prueba).");
        renderizarTablas();
        calcularKPIs();
        return;
    }

    try {
        const response = await fetch(CONFIG.gasUrl, {
            method: "POST",
            mode: "cors",
            headers: {
                "Content-Type": "text/plain;charset=utf-8"
            },
            body: JSON.stringify({
                action: "registrarPago",
                socioId: socioId,
                periodo: PERIODO_ACTUAL,
                monto: socio.montoCuota,
                usuario: CURRENT_USER ? CURRENT_USER.usuario : "",
                clave: CURRENT_USER ? CURRENT_USER.clave : ""
            })
        });

        const resJson = await response.json();
        if (resJson.success) {
            alert(`✅ Recaudación asentada en la nube para ${socio.nombreSocio}.`);
            cargarSociosDeNube(); // Recargar datos frescos
        } else {
            throw new Error(resJson.error);
        }
    } catch (error) {
        alert("❌ Error al registrar cobro en la nube: " + error.toString());
    }
}

/**
 * ====================================================================
 * MODAL DE SOCIOS (REGISTRAR/EDITAR)
 * ====================================================================
 */

function abrirModalSocio(socioId = null) {
    const modal = document.getElementById("modal-socio");
    const form = document.getElementById("form-socio");
    form.reset();
    
    if (socioId) {
        // Modo Edición
        document.getElementById("modal-socio-title").textContent = "Editar Datos del Socio";
        const socio = SOCIOS.find(s => s.id === socioId);
        if (socio) {
            document.getElementById("socio-id").value = socio.id;
            document.getElementById("socio-nombre").value = socio.nombreSocio;
            document.getElementById("socio-categoria").value = socio.categoria || "Estándar";
            document.getElementById("socio-email").value = socio.emailContacto;
            document.getElementById("socio-contacto-nombre").value = socio.contactoNombre;
            document.getElementById("socio-ultimo-pago").value = socio.ultimoMesPagado || "";
            document.getElementById("socio-estado").value = socio.estadoActual;
        }
    } else {
        // Modo Nuevo
        document.getElementById("modal-socio-title").textContent = "Registrar Nuevo Socio";
        document.getElementById("socio-id").value = "";
        document.getElementById("socio-ultimo-pago").value = PERIODO_ACTUAL;
        document.getElementById("socio-estado").value = "Pendiente";
    }
    
    modal.classList.add("active");
}

async function guardarSocioHandler() {
    const socioData = {
        id: document.getElementById("socio-id").value,
        nombreSocio: document.getElementById("socio-nombre").value.trim(),
        categoria: document.getElementById("socio-categoria").value,
        emailContacto: document.getElementById("socio-email").value.trim(),
        contactoNombre: document.getElementById("socio-contacto-nombre").value.trim(),
        ultimoMesPagado: document.getElementById("socio-ultimo-pago").value,
        estadoActual: document.getElementById("socio-estado").value
    };

    if (!CONFIG.gasUrl) {
        // Guardar localmente en demo (calcular cuota local para que los KPIs no rompan)
        const matchedCat = CATEGORIAS.find(c => c.categoria === socioData.categoria);
        socioData.montoCuota = matchedCat ? matchedCat.montoCuota : 0;
        socioData.tipo = (socioData.categoria === "Exento") ? "Sin Fin de Lucro" : "Fin de Lucro";
        
        if (socioData.id) {
            const index = SOCIOS.findIndex(s => s.id === socioData.id);
            SOCIOS[index] = socioData;
        } else {
            socioData.id = "SOC-" + new Date().getTime();
            SOCIOS.push(socioData);
        }
        alert("✅ Datos guardados localmente (Modo local de prueba).");
        cerrartodosModales();
        renderizarTablas();
        calcularKPIs();
        return;
    }

    try {
        const response = await fetch(CONFIG.gasUrl, {
            method: "POST",
            mode: "cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                action: "guardarSocio",
                socio: socioData,
                usuario: CURRENT_USER ? CURRENT_USER.usuario : "",
                clave: CURRENT_USER ? CURRENT_USER.clave : ""
            })
        });

        const resJson = await response.json();
        if (resJson.success) {
            alert(`✅ Socio guardado y sincronizado en Google Sheets.`);
            cerrartodosModales();
            cargarSociosDeNube();
        } else {
            throw new Error(resJson.error);
        }
    } catch (error) {
        alert("❌ Error al guardar socio en la nube: " + error.toString());
    }
}

/**
 * ====================================================================
 * MOTOR Y PRE-VISUALIZADOR DE CORREOS
 * ====================================================================
 */

let socioSeleccionadoParaMail = null;

function abrirGeneradorCorreo(socioId) {
    const socio = SOCIOS.find(s => s.id === socioId);
    if (!socio) return;
    
    socioSeleccionadoParaMail = socio;
    
    document.getElementById("mail-socio-nombre").textContent = socio.nombreSocio;
    document.getElementById("mail-socio-email").textContent = socio.emailContacto;
    document.getElementById("mail-socio-periodo").textContent = formatearMesAnio(PERIODO_ACTUAL);
    
    // Determinar qué aviso sugerir según el estado actual
    const estado = calcularEstadoPagoPeriodo(socio, PERIODO_ACTUAL);
    const selectAviso = document.getElementById("select-aviso-nivel");
    
    if (estado === "Vencido") {
        selectAviso.value = "2"; // 2° aviso si ya está vencido
    } else {
        selectAviso.value = "1"; // 1° aviso si es cuota regular pendiente
    }

    actualizarVistaPreviaCorreo();
    
    // Reset status indicator
    document.getElementById("factura-search-status").className = "search-indicator";
    document.getElementById("factura-search-status").innerHTML = `
        <i class="fa-solid fa-circle-question" style="color: var(--color-amber);"></i>
        <span>Búsqueda automática al generar borrador</span>
    `;

    document.getElementById("modal-email-generator").classList.add("active");
}

function actualizarVistaPreviaCorreo() {
    if (!socioSeleccionadoParaMail) return;
    
    const socio = socioSeleccionadoParaMail;
    const nivelAviso = parseInt(document.getElementById("select-aviso-nivel").value, 10);
    const mesAnioTexto = formatearMesAnio(PERIODO_ACTUAL);
    
    let asunto = "";
    let cuerpo = "";
    
    if (nivelAviso === 1) {
        asunto = `Clúster de Biotecnología de Córdoba - Recordatorio de Cuota Mensual [${mesAnioTexto}] - ${socio.nombreSocio}`;
        cuerpo = `Hola ${socio.contactoNombre || "de nuestra consideración"},\n\n` +
                 `Espero que te encuentres muy bien.\n\n` +
                 `Te escribimos desde el Clúster de Biotecnología de Córdoba para hacerte llegar el recordatorio de la cuota correspondiente a **${mesAnioTexto}** por un monto de **$${socio.montoCuota.toLocaleString('es-AR')}**.\n\n` +
                 `Para tu comodidad, te recordamos los datos de transferencia bancaria de la institución:\n` +
                 `*   **Banco:** ${DATOS_BANCO.banco}\n` +
                 `*   **CBU:** ${DATOS_BANCO.cbu}\n` +
                 `*   **Alias:** ${DATOS_BANCO.alias}\n` +
                 `*   **Titular:** ${DATOS_BANCO.titular}\n\n` +
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
                 `*   **CBU:** ${DATOS_BANCO.cbu} | **Alias:** ${DATOS_BANCO.alias}\n` +
                 `*   **Titular:** ${DATOS_BANCO.titular}\n\n` +
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
    
    document.getElementById("preview-asunto").textContent = asunto;
    document.getElementById("preview-cuerpo").innerHTML = cuerpo.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

function copiarCuerpoCorreo() {
    const cuerpoText = document.getElementById("preview-cuerpo").innerText;
    
    navigator.clipboard.writeText(cuerpoText).then(() => {
        const btn = document.getElementById("btn-copy-preview");
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-clipboard-check"></i> ¡Copiado!`;
        btn.style.background = "var(--color-success-bg)";
        btn.style.color = "var(--color-success)";
        
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.style.background = "";
            btn.style.color = "";
        }, 1500);
    }).catch(err => {
        alert("Fallo al copiar texto: ", err);
    });
}

async function dispararBorradorGmail() {
    if (!socioSeleccionadoParaMail) return;
    
    const socio = socioSeleccionadoParaMail;
    const nivelAviso = parseInt(document.getElementById("select-aviso-nivel").value, 10);
    const indicator = document.getElementById("factura-search-status");
    const btn = document.getElementById("btn-action-gmail");
    
    if (!CONFIG.gasUrl) {
        alert("⚠️ No has configurado la URL de conexión en la nube.\n" +
              "Para crear borradores reales en tu cuenta de Gmail institucional, conecta la Web App de Apps Script en la pestaña 'Conexión Nube'.\n" +
              "Podés copiar el texto del correo usando el botón 'Copiar Cuerpo' para enviarlo manualmente.");
        return;
    }
    
    // Cambiar estado a cargando
    indicator.className = "search-indicator";
    indicator.innerHTML = `
        <i class="fa-solid fa-circle-notch fa-spin color-blue-text"></i>
        <span>Buscando factura en Drive y redactando borrador...</span>
    `;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Procesando...`;
    
    try {
        const response = await fetch(CONFIG.gasUrl, {
            method: "POST",
            mode: "cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                action: "generarBorrador",
                socioId: socio.id,
                periodo: PERIODO_ACTUAL,
                nivelAviso: nivelAviso,
                usuario: CURRENT_USER ? CURRENT_USER.usuario : "",
                clave: CURRENT_USER ? CURRENT_USER.clave : ""
            })
        });
        
        const resJson = await response.json();
        
        if (resJson.success) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-envelope-open-text"></i> Borrador Creado!`;
            
            // Actualizar estado del indicador de factura
            indicator.className = "search-indicator";
            if (resJson.data.facturaAdjuntada) {
                indicator.style.color = "var(--color-success)";
                indicator.innerHTML = `
                    <i class="fa-solid fa-file-circle-check color-green-text"></i>
                    <span><strong>Factura adjuntada:</strong> ${resJson.data.nombreArchivo}</span>
                `;
            } else {
                indicator.innerHTML = `
                    <i class="fa-solid fa-triangle-exclamation color-amber-text"></i>
                    <span>Borrador creado, pero <strong>no se halló el PDF</strong> de factura en tu Drive.</span>
                `;
            }
            
            setTimeout(() => {
                alert(`🎉 ¡Excelente! Borrador creado con éxito en tu Gmail.\n\n` +
                      `Destinatario: ${socio.emailContacto}\n` +
                      `Asunto: ${document.getElementById("preview-asunto").textContent}\n` +
                      (resJson.data.facturaAdjuntada ? `📎 Se adjuntó la factura encontrada en Drive.` : `⚠️ Recordá adjuntar el PDF manualmente si no lo subiste a Drive.`));
                cerrartodosModales();
            }, 300);
            
        } else {
            throw new Error(resJson.error);
        }
    } catch (error) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-envelope-open-text"></i> Crear Borrador en Gmail`;
        
        indicator.className = "search-indicator";
        indicator.innerHTML = `
            <i class="fa-solid fa-circle-xmark color-red-text"></i>
            <span>Error en el procesamiento del borrador.</span>
        `;
        alert("❌ Error al comunicarse con Gmail: " + error.toString());
    }
}

/**
 * ====================================================================
 * UTILIDADES DE INTERFAZ
 * ====================================================================
 */

function cerrartodosModales() {
    document.querySelectorAll(".modal").forEach(modal => {
        modal.classList.remove("active");
    });
    socioSeleccionadoParaMail = null;
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

/**
 * ====================================================================
 * SISTEMA DE SEGURIDAD Y CONTROL DE SESIÓN
 * ====================================================================
 */

function validarSesion() {
    const loginOverlay = document.getElementById("login-overlay");
    if (!CURRENT_USER) {
        loginOverlay.classList.add("active");
        return false;
    }
    
    loginOverlay.classList.remove("active");
    
    // Actualizar sidebar con los datos del usuario logueado
    document.getElementById("display-user-name").textContent = CURRENT_USER.nombre;
    document.getElementById("display-user-role").textContent = CURRENT_USER.rol;
    
    const avatarIcon = document.getElementById("user-avatar-icon");
    if (CURRENT_USER.rol === "Administrador") {
        avatarIcon.className = "fa-solid fa-user-shield text-blue";
    } else {
        avatarIcon.className = "fa-solid fa-user text-muted";
    }
    
    aplicarRestriccionesRol();
    return true;
}

function aplicarRestriccionesRol() {
    const rol = CURRENT_USER ? CURRENT_USER.rol : "Consulta";
    
    // Seleccionar elementos admin-only
    const btnNuevoSocio = document.getElementById("btn-nuevo-socio");
    const navTabConfig = document.querySelector('.nav-item[data-tab="config"]');
    
    if (rol === "Consulta") {
        // Esconder botones administrativos permanentes
        if (btnNuevoSocio) btnNuevoSocio.classList.add("admin-only-hidden");
        if (navTabConfig) navTabConfig.classList.add("admin-only-hidden");
        
        // Si estaba en la pestaña de configuración, mandarlo a cobranzas
        const activeTab = document.querySelector(".nav-item.active");
        if (activeTab && activeTab.getAttribute("data-tab") === "config") {
            const cobTab = document.querySelector('.nav-item[data-tab="cobranzas"]');
            if (cobTab) cobTab.click();
        }
    } else {
        // Mostrar todo si es Admin
        if (btnNuevoSocio) btnNuevoSocio.classList.remove("admin-only-hidden");
        if (navTabConfig) navTabConfig.classList.remove("admin-only-hidden");
    }
}

async function manejarLogin(e) {
    e.preventDefault();
    const user = document.getElementById("login-username").value.trim();
    const pass = document.getElementById("login-password").value.trim();
    const errorMsg = document.getElementById("login-error-msg");
    const btnSubmit = document.getElementById("btn-login-submit");
    
    errorMsg.style.display = "none";
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Validando...`;
    
    // Si no hay url configurada o es la demo local por falla
    if (!CONFIG.gasUrl) {
        if ((user === "admin" && pass === "admin123") || (user === "consulta" && pass === "consulta123")) {
            CURRENT_USER = {
                usuario: user,
                rol: user === "admin" ? "Administrador" : "Consulta",
                nombre: user === "admin" ? "Sebastián (Local)" : "Pablo (Lectura Local)"
            };
            localStorage.setItem("current_user", JSON.stringify(CURRENT_USER));
            validarSesion();
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<i class="fa-solid fa-arrow-right-to-bracket"></i> Iniciar Sesión`;
            cargarSociosDeNube();
            return;
        } else {
            errorMsg.querySelector("span").textContent = "Credenciales incorrectas (Base local)";
            errorMsg.style.display = "flex";
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<i class="fa-solid fa-arrow-right-to-bracket"></i> Iniciar Sesión`;
            return;
        }
    }
    
    try {
        const response = await fetch(CONFIG.gasUrl, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain;charset=utf-8"
            },
            body: JSON.stringify({
                action: "login",
                usuario: user,
                clave: pass
            })
        });
        
        if (!response.ok) throw new Error("Error en respuesta HTTP del servidor.");
        
        const resJson = await response.json();
        if (resJson.success) {
            CURRENT_USER = {
                usuario: resJson.user.usuario,
                rol: resJson.user.rol,
                nombre: resJson.user.nombre,
                clave: pass // Guardamos la clave activa para transacciones subsiguientes
            };
            localStorage.setItem("current_user", JSON.stringify(CURRENT_USER));
            validarSesion();
            cargarSociosDeNube();
        } else {
            errorMsg.querySelector("span").textContent = resJson.error || "Usuario o clave incorrectos";
            errorMsg.style.display = "flex";
        }
    } catch (err) {
        console.error("Error al autenticar:", err);
        errorMsg.querySelector("span").textContent = "Error de conexión con Google Sheets.";
        errorMsg.style.display = "flex";
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<i class="fa-solid fa-arrow-right-to-bracket"></i> Iniciar Sesión`;
    }
}

function manejarLogout() {
    const confirmar = confirm("¿Deseas cerrar la sesión activa?");
    if (!confirmar) return;
    
    CURRENT_USER = null;
    localStorage.removeItem("current_user");
    
    // Limpiar inputs de login
    document.getElementById("login-username").value = "";
    document.getElementById("login-password").value = "";
    document.getElementById("login-error-msg").style.display = "none";
    
    validarSesion();
    
    // Recargar en modo demostración/vacío
    SOCIOS = [...SOCIOS_DEMO];
    renderizarTablas();
    calcularKPIs();
}

/**
 * ====================================================================
 * HISTORIAL DE COBROS Y TRANSCACIONES EN TIEMPO REAL
 * ====================================================================
 */

const HISTORIAL_DEMO = [
    { idTransaccion: "TX-1779730000000", idSocio: "SOC-002", nombreSocio: "Biosinergy", periodo: "2026-05", monto: 25000, fecha: "2026-05-15T14:30:00Z" },
    { idTransaccion: "TX-1779720000000", idSocio: "SOC-004", nombreSocio: "FPM", periodo: "2026-05", monto: 25000, fecha: "2026-05-14T09:15:00Z" },
    { idTransaccion: "TX-1779710000000", idSocio: "SOC-005", nombreSocio: "UNC-Hemoderivados", periodo: "2026-04", monto: 50000, fecha: "2026-04-22T11:45:00Z" }
];

async function cargarHistorialDeNube() {
    const listBody = document.getElementById("lista-historial-body");
    if (!listBody) return;
    
    listBody.innerHTML = `
        <tr>
            <td colspan="6" class="loading-state">
                <i class="fa-solid fa-spinner fa-spin"></i> Cargando historial de cobros desde la nube...
            </td>
        </tr>
    `;

    if (!CONFIG.gasUrl) {
        console.log("No hay URL de Apps Script configurada. Cargando historial de demostración local.");
        HISTORIAL_PAGOS = [...HISTORIAL_DEMO];
        setTimeout(() => {
            renderizarHistorial();
        }, 500);
        return;
    }

    try {
        const userQuery = CURRENT_USER ? `&usuario=${encodeURIComponent(CURRENT_USER.usuario)}&clave=${encodeURIComponent(CURRENT_USER.clave || "")}` : "";
        const response = await fetch(`${CONFIG.gasUrl}?action=getTransacciones${userQuery}`);
        if (!response.ok) throw new Error("Error en respuesta HTTP del servidor.");
        
        const resJson = await response.json();
        
        if (resJson.success) {
            HISTORIAL_PAGOS = resJson.data;
            renderizarHistorial();
        } else {
            throw new Error(resJson.error || "Error desconocido devuelto por Apps Script.");
        }
    } catch (error) {
        console.error("Fallo al cargar el historial de cobros:", error);
        HISTORIAL_PAGOS = [...HISTORIAL_DEMO];
        renderizarHistorial();
        alert("No pudimos conectar con tu base de datos para leer el historial de cobros.\n" +
              "Se ha cargado un listado demostrativo local.");
    }
}

function renderizarHistorial() {
    const listBody = document.getElementById("lista-historial-body");
    if (!listBody) return;
    
    listBody.innerHTML = "";
    const filterText = document.getElementById("search-historial").value.toLowerCase().trim();
    
    const transaccionesFiltradas = HISTORIAL_PAGOS.filter(tx => {
        return tx.nombreSocio.toLowerCase().includes(filterText) || 
               tx.idTransaccion.toLowerCase().includes(filterText) || 
               tx.periodo.toLowerCase().includes(filterText);
    });

    if (transaccionesFiltradas.length === 0) {
        listBody.innerHTML = `
            <tr>
                <td colspan="6" class="loading-state">
                    No se registraron cobros que coincidan con los filtros de búsqueda.
                </td>
            </tr>
        `;
        return;
    }

    transaccionesFiltradas.forEach(tx => {
        const fechaObj = new Date(tx.fecha);
        const fechaTexto = !isNaN(fechaObj.getTime()) ? fechaObj.toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : tx.fecha || "-";
        
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><code style="font-size:0.75rem;">${tx.idTransaccion}</code></td>
            <td><strong>${tx.nombreSocio}</strong><br><span style="font-size:0.72rem; color:var(--text-muted);">Socio ID: ${tx.idSocio}</span></td>
            <td><span style="font-family:monospace; font-weight:600;">${formatearMesAnio(tx.periodo)}</span></td>
            <td><strong style="color: var(--color-success); font-size:0.95rem;">+$${tx.monto.toLocaleString('es-AR')}</strong></td>
            <td>${fechaTexto}</td>
            <td><span class="badge badge-pagado" style="font-size:0.7rem;"><i class="fa-solid fa-circle-check"></i> Acreditado</span></td>
        `;
        listBody.appendChild(tr);
    });
}

function verHistorialSocio(nombreSocio) {
    // 1. Ir a la pestaña historial
    const tabHistorial = document.querySelector('.nav-item[data-tab="historial"]');
    if (tabHistorial) {
        tabHistorial.click();
    }
    
    // 2. Colocar el filtro de búsqueda
    const inputSearch = document.getElementById("search-historial");
    if (inputSearch) {
        inputSearch.value = nombreSocio;
        // Gatillar evento input para filtrar al instante
        inputSearch.dispatchEvent(new Event('input'));
    }
}

function formatearUltimoPago(ultimoMes) {
    if (!ultimoMes) return "Ninguno";
    let str = ultimoMes.toString().trim();
    if (str.includes("T")) {
        str = str.split("T")[0]; // "2026-02-01"
    }
    if (str.includes("-")) {
        const partes = str.split("-");
        if (partes.length >= 2) {
            str = `${partes[0]}-${partes[1]}`; // "2026-02"
        }
    }
    return formatearMesAnio(str);
}

let LISTA_CAMPANA_ACTUAL = []; // Almacena los socios clasificados de la campaña actual

function cargarCampanaMasiva() {
    const listBody = document.getElementById("lista-campana-body");
    if (!listBody) return;
    
    listBody.innerHTML = `
        <tr>
            <td colspan="7" class="loading-state">
                <i class="fa-solid fa-spinner fa-spin"></i> Cargando socios elegibles para la campaña...
            </td>
        </tr>
    `;
    
    // Clasificar todos los socios que no sean exentos y deban dinero
    LISTA_CAMPANA_ACTUAL = [];
    let countFacturas = 0;
    let countAviso1 = 0;
    let countAviso2 = 0;
    
    SOCIOS.forEach(socio => {
        // Ignorar exentos o sin cuota
        if (socio.categoria === "Exento" || socio.montoCuota === 0) return;
        
        const clasificacion = clasificarSocioCampana(socio);
        if (clasificacion && clasificacion.nivelAviso > 0) {
            LISTA_CAMPANA_ACTUAL.push(clasificacion);
            
            if (clasificacion.nivelAviso === 1) countFacturas++;
            if (clasificacion.nivelAviso === 2) countAviso1++;
            if (clasificacion.nivelAviso === 3) countAviso2++;
        }
    });
    
    // Actualizar KPIs de campaña
    document.getElementById("campana-total-facturas").textContent = countFacturas;
    document.getElementById("campana-total-aviso1").textContent = countAviso1;
    document.getElementById("campana-total-aviso2").textContent = countAviso2;
    
    if (LISTA_CAMPANA_ACTUAL.length === 0) {
        listBody.innerHTML = `
            <tr>
                <td colspan="7" class="loading-state" style="color: var(--color-success); font-weight: 500; text-align: center; padding: 30px;">
                    <i class="fa-solid fa-circle-check" style="font-size: 1.5rem; margin-bottom: 10px; display: block;"></i>
                    ¡Excelente! Todos los socios están al día para el período actual (${formatearMesAnio(PERIODO_ACTUAL)}).<br>No hay notificaciones de cobro pendientes.
                </td>
            </tr>
        `;
        return;
    }
    
    listBody.innerHTML = "";
    LISTA_CAMPANA_ACTUAL.forEach((item, index) => {
        const tr = document.createElement("tr");
        
        let typeBadgeClass = "badge-pendiente"; // Factura Inicial
        if (item.nivelAviso === 2) typeBadgeClass = "badge-pendiente"; // 1° recordatorio
        if (item.nivelAviso === 3) typeBadgeClass = "badge-vencido"; // 2° recordatorio (mora)
        
        const fechaAvisoStr = item.socio.ultimaNotificacion ? formatearUltimoPago(item.socio.ultimaNotificacion) : "Nunca";
        const nivelAvisoStr = item.socio.nivelNotificacion ? item.socio.nivelNotificacion : "Ninguno";
        
        tr.innerHTML = `
            <td style="text-align: center; vertical-align: middle;">
                <input type="checkbox" class="chk-campana-socio" data-index="${index}" checked style="transform: scale(1.1); cursor: pointer;">
            </td>
            <td>
                <strong style="color: var(--text-color);">${item.socio.nombreSocio}</strong><br>
                <span style="font-size:0.72rem; color:var(--text-muted);">${item.socio.emailContacto}</span>
            </td>
            <td>
                <span style="font-family: monospace;">${formatearUltimoPago(item.socio.ultimoMesPagado)}</span>
            </td>
            <td>
                <span class="badge ${typeBadgeClass}" style="font-size: 0.72rem; font-weight:600;">${item.tipoNotificacion}</span><br>
                <span style="font-size:0.68rem; color:var(--text-muted); font-style:italic; display: block; margin-top: 2px;">${item.motivo}</span>
            </td>
            <td>
                <span style="font-size:0.8rem; font-weight:500;">${nivelAvisoStr}</span><br>
                <span style="font-size:0.7rem; color:var(--text-muted);">${fechaAvisoStr}</span>
            </td>
            <td>
                <strong style="font-size: 0.9rem; color: var(--text-color);">$${item.socio.montoCuota.toLocaleString('es-AR')}</strong>
            </td>
            <td>
                <span style="color: var(--color-blue); font-size:0.78rem; font-weight:500;">
                    <i class="fa-solid fa-spinner fa-spin" style="margin-right:4px;"></i> Búsqueda en lote
                </span>
            </td>
        `;
        listBody.appendChild(tr);
    });
    
    // Volver a enlazar evento del select all
    const selectAllChk = document.getElementById("chk-campana-select-all");
    if (selectAllChk) {
        selectAllChk.checked = true;
        // Limpiar listeners viejos clonándolo
        const newChk = selectAllChk.cloneNode(true);
        selectAllChk.parentNode.replaceChild(newChk, selectAllChk);
        
        newChk.addEventListener("change", (e) => {
            document.querySelectorAll(".chk-campana-socio").forEach(chk => {
                chk.checked = e.target.checked;
            });
        });
    }
}

function clasificarSocioCampana(socio) {
    const estado = calcularEstadoPagoPeriodo(socio, PERIODO_ACTUAL);
    if (estado === "Pagado") return null; // Ya pagaron, eximidos.
    
    // Si no tienen última notificación, es Factura Inicial
    if (!socio.nivelNotificacion || socio.nivelNotificacion === "") {
        return {
            socio: socio,
            nivelAviso: 1, // Factura Inicial
            motivo: "Nueva Facturación Bimestral",
            tipoNotificacion: "Factura Inicial"
        };
    }
    
    // Si la última notificación fue la Factura Inicial
    if (socio.nivelNotificacion === "Factura Inicial") {
        let diasTranscurridos = 999;
        if (socio.ultimaNotificacion) {
            const fechaStr = socio.ultimaNotificacion.toString().split("T")[0];
            const partes = fechaStr.split("-");
            if (partes.length === 3) {
                const ultimaFecha = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
                const hoy = new Date();
                diasTranscurridos = Math.floor((hoy - ultimaFecha) / (1000 * 60 * 60 * 24));
            }
        }
        
        if (diasTranscurridos >= 15) {
            return {
                socio: socio,
                nivelAviso: 2, // 1° Recordatorio
                motivo: `Pasaron ${diasTranscurridos} días desde la Factura Inicial`,
                tipoNotificacion: "1° Recordatorio"
            };
        } else {
            // Aún no pasaron los 15 días reglamentarios
            return {
                socio: socio,
                nivelAviso: 0, // En espera
                motivo: `En espera (Aviso inicial enviado hace ${diasTranscurridos} días)`,
                tipoNotificacion: "En Espera (15 días)"
            };
        }
    }
    
    // Si la última notificación fue el 1° Recordatorio
    if (socio.nivelNotificacion === "1° Recordatorio") {
        return {
            socio: socio,
            nivelAviso: 3, // 2° Recordatorio
            motivo: "Segundo aviso por deudas pendientes",
            tipoNotificacion: "2° Recordatorio"
        };
    }
    
    // Si ya tiene el 2° Recordatorio, o se completó la secuencia
    return {
        socio: socio,
        nivelAviso: 3, // Repetir 2° Recordatorio (Mora Operativa)
        motivo: "Reiteración de Mora Crítica",
        tipoNotificacion: "Re-Aviso de Mora"
    };
}

async function ejecutarCampanaMasiva() {
    const seleccionados = [];
    document.querySelectorAll(".chk-campana-socio:checked").forEach(chk => {
        const index = parseInt(chk.getAttribute("data-index"), 10);
        seleccionados.push(LISTA_CAMPANA_ACTUAL[index]);
    });
    
    if (seleccionados.length === 0) {
        alert("⚠️ Por favor, selecciona al menos un socio para ejecutar la campaña.");
        return;
    }
    
    const confirmar = confirm(`¿Confirmas el envío directo de ${seleccionados.length} correos de cobranza para el período ${formatearMesAnio(PERIODO_ACTUAL)}?\n\nLos estados de notificación en Google Sheets se actualizarán de forma automática.`);
    if (!confirmar) return;
    
    const btn = document.getElementById("btn-ejecutar-campana");
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Enviando correos masivos...`;
    
    // Preparar payload para la campaña
    const campanaData = seleccionados.map(item => {
        return {
            socioId: item.socio.id,
            periodo: PERIODO_ACTUAL,
            nivelAviso: item.nivelAviso
        };
    });
    
    try {
        if (!CONFIG.gasUrl) {
            // Simulación en local
            alert("✅ Simulación local: Se simula el envío masivo de " + seleccionados.length + " correos.");
            // Actualizar localmente para demostración
            seleccionados.forEach(item => {
                const socio = SOCIOS.find(s => s.id === item.socio.id);
                if (socio) {
                    socio.ultimaNotificacion = new Date().toISOString().split("T")[0];
                    socio.nivelNotificacion = item.nivelAviso === 1 ? "Factura Inicial" : (item.nivelAviso === 2 ? "1° Recordatorio" : "2° Recordatorio");
                }
            });
            renderizarTablas();
            calcularKPIs();
            cargarCampanaMasiva();
            
            btn.disabled = false;
            btn.innerHTML = originalText;
            return;
        }
        
        const response = await fetch(CONFIG.gasUrl, {
            method: "POST",
            mode: "cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                action: "enviarCampanaMasiva",
                campana: campanaData,
                usuario: CURRENT_USER ? CURRENT_USER.usuario : "",
                clave: CURRENT_USER ? CURRENT_USER.clave : ""
            })
        });
        
        const resJson = await response.json();
        if (resJson.success) {
            let exitosos = 0;
            let fallidos = 0;
            resJson.resultados.forEach(r => {
                if (r.success) exitosos++;
                else fallidos++;
            });
            
            alert(`🎉 ¡Campaña finalizada con éxito!\n\n` +
                  `* Correos enviados correctamente: ${exitosos}\n` +
                  `* Envíos fallidos: ${fallidos}\n\n` +
                  `La planilla de Google Sheets ha sido actualizada con las fechas y niveles de notificación.`);
            
            // Recargar
            cargarSociosDeNube();
        } else {
            throw new Error(resJson.error);
        }
    } catch (err) {
        alert("❌ Error al ejecutar campaña masiva en la nube: " + err.toString());
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

