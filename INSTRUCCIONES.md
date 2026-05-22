# 🚀 Guía de Configuración Rápida: Consola de Cobranzas del Clúster Biotech Cba

¡Felicitaciones! Has implementado con éxito la base de tu **Consola de Cobranzas en la Nube**. A continuación, sigue estos sencillos pasos para vincular tu Google Sheets, tu Google Drive y tu Gmail de forma definitiva y segura en tan solo 5 minutos.

---

## 📅 Paso 1: Configurar tu Google Sheets en la Nube

El sistema necesita leer y escribir en una planilla de cálculo alojada en tu Google Drive.

1.  Crea una planilla de cálculo vacía (o usa una existente) en tu cuenta de Google.
2.  Renombra la primera pestaña de la hoja exactamente como: **`Socios`**.
3.  Define en la primera fila (Fila 1) las siguientes columnas de cabecera en negrita (es importante respetar los nombres exactos para la sincronización):
    *   **Columna A:** `ID`
    *   **Columna B:** `Nombre Socio`
    *   **Columna C:** `Tipo` *(Admite los valores: "Fin de Lucro" o "Sin Fin de Lucro")*
    *   **Columna D:** `Monto Cuota` *(Valores numéricos)*
    *   **Columna E:** `Email Contacto`
    *   **Columna F:** `Contacto Nombre`
    *   **Columna G:** `Ultimo Mes Pagado` *(En formato YYYY-MM, ejemplo: `2026-04`)*
    *   **Columna H:** `Estado Actual` *(Admite los valores: "Pagado", "Pendiente" o "Vencido")*

> [!TIP]
> **No te preocupes por cargarlos manualmente ahora:** El código que pegarás en el paso 2 creará automáticamente estas cabeceras y unos socios realistas de demostración en tu hoja apenas corras el sistema por primera vez, para que luego solo tengas que editarlos a tu gusto.

---

## ⚙️ Paso 2: Desplegar el Google Apps Script (Backend)

Google Apps Script es el motor gratuito que conectará tu SPA local con la nube de Google.

1.  Abre tu hoja de cálculo de Google.
2.  En el menú superior, haz clic en **Extensiones** > **Apps Script**.
3.  Se abrirá una nueva ventana del editor. Borra todo el código que aparezca por defecto en el archivo `Código.gs`.
4.  Abre el archivo [google_apps_script.js](file:///c:/Users/sebab/Documents/Plataformas/Asistente%20Ejecutivo%20Cl%C3%BAster/google_apps_script.js) que acabo de crear en esta misma carpeta, copia todo su contenido y pégalo en el editor de Apps Script.
5.  Haz clic en el icono del **Diskette** 💾 (Guardar proyecto) en la barra de herramientas.
6.  Ahora haz clic en el botón azul **Implementar** (arriba a la derecha) > **Nueva implementación**.
7.  Haz clic en el icono de engranaje de "Seleccionar tipo" y elige **Aplicación web**.
8.  Configura las opciones exactamente así:
    *   **Descripción:** `API Cobranzas Clúster`
    *   **Ejecutar como:** `Tú` (Tu correo de Gmail institucional)
    *   **Quién tiene acceso:** `Cualquiera` *(Esto permite que el Dashboard local pueda enviar peticiones HTTP seguras).*
9.  Haz clic en el botón **Implementar**.
10. Te pedirá otorgar accesos de seguridad a tu cuenta (ya que el script accederá a tu Drive, Sheets y Gmail). Haz clic en **Autorizar acceso**, selecciona tu cuenta, ve a la opción *Configuración Avanzada* (abajo) e indica *Ir a Proyecto sin nombre (no seguro)* y dale a *Permitir*.
11. Al finalizar, aparecerá una ventana con la **URL de la aplicación web** (termina en `/exec`). **¡Copia esa URL!**

---

## 🔗 Paso 3: Conectar el Dashboard Local a la Nube

1.  Abre el archivo [index.html](file:///c:/Users/sebab/Documents/Plataformas/Asistente%20Ejecutivo%20Cl%C3%BAster/index.html) haciendo doble clic sobre él en tu laptop.
2.  Verás que por defecto arranca en el modo demostrativo con datos ficticios y en la cabecera dice **"Sin Conexión / Base Demo Local"**.
3.  Haz clic en la pestaña **Conexión Nube** en el menú de la izquierda.
4.  Pega la URL de la Web App de Google Apps Script que copiaste en el paso anterior.
5.  *(Opcional)* Si tienes tus facturas en PDF en una carpeta específica de Google Drive, copia el ID de esa carpeta (es la cadena de letras y números que aparece en la URL del navegador al abrir la carpeta en Drive) y pégala en el segundo casillero.
6.  Haz clic en **Guardar y Probar Conexión**.

¡Listo! El indicador del panel superior cambiará instantáneamente a un color verde vibrante con la leyenda **"Conectado a Sheets"**. A partir de este momento, todos los cambios que realices en el panel se guardarán de forma centralizada en la nube.

---

## 📁 Paso 4: Cómo automatizar el adjunto de Facturas en PDF de Drive

Para que cuando dispares un aviso de cobro en el Dashboard, el sistema busque y adjunte de forma automática el PDF de la factura desde tu Drive, solo debes seguir esta regla de nombres:

*   Sube los archivos PDF a tu carpeta de Drive elegida (o a tu Drive general).
*   Nómbralos con el formato: `Factura - {NombreSocio} - {Período}`
*   *Ejemplo:* Si el socio se llama `Lamarx Biotech` y estás notificando la cuota de `Mayo 2026` (período `2026-05`), el archivo de Drive debe llamarse:
    `Factura - Lamarx Biotech - 2026-05.pdf`

Si el sistema no encuentra un PDF con dicho nombre, no se romperá: creará el borrador del correo en tu Gmail de igual manera, dejándote una alerta en pantalla avisando que deberás adjuntarlo manualmente antes de enviarlo.

---

## 👥 Paso 5: Colaboración con Pablo (Multi-Laptop)

Como los datos y la configuración están 100% en la nube:
1.  Comparte esta carpeta local `"Asistente Ejecutivo Clúster"` con Pablo (pueden subirla a una carpeta compartida de Google Drive o enviarle los archivos por mail).
2.  Pablo solo tendrá que abrir el archivo `index.html` en su propia laptop, ir a la pestaña **Conexión Nube**, pegar la misma URL de Apps Script y guardar.
3.  ¡Ambos estarán operando la misma información en tiempo real sin pisarse!
