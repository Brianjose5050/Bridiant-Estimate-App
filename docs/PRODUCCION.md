# Producción: arquitectura, servicios y auditoría

Estado: **no desplegado, no publicado, sin cuentas creadas, sin servicios contratados.** Este documento describe lo que hace falta para publicar. Verifique los límites gratuitos en cada sitio del proveedor antes de activar nada.

## 1. Qué se probó en local (sin cuentas)

| Área | Estado | Prueba |
|---|---|---|
| Sitio público EN/ES | Construido; enlaces revisados (28 páginas, sin enlaces rotos; página inexistente → 404) | Rastreo HTTP + navegador |
| Solicitud de estimado con fotos | Guardada en SQLite antes de confirmar; fotos en almacenamiento privado | Pruebas de integración y E2E |
| Panel privado | Contraseña + TOTP, sesión con tiempo de inactividad, CSRF, Origin | Pruebas + E2E |
| Notas internas e historial | Solo en el panel; nunca en API pública | Pruebas + E2E |
| Galería | Subir, clasificar, aprobar, emparejar, ordenar, ocultar, quitar, publicar | 14 pruebas + E2E de 9 pasos |
| Welcome Center | Capítulos EN/ES sin publicar hasta aprobación; PDF solo si está publicado y aprobado | Pruebas + E2E |
| Correo | Cola persistente, reintentos, sin duplicados, nada se envía sin proveedor | Pruebas |
| Verificación humana | Servidor lista para Turnstile; producción exige el secreto para arrancar | Prueba de configuración |

### 1.1 Verificado en el runtime de Workers (wrangler dev, sin cuentas)

Se ejecutó el Worker real (`apps/server/src/worker.ts`) con `wrangler dev`, usando el emulador local de D1 y R2. No se creó ningún recurso remoto ni se desplegó nada.

| Prueba | Resultado |
|---|---|
| Suite HTTP sobre el Worker (`apps/server/scripts/workers-smoke.mjs`) | **48/48**, código de salida 0 |
| E2E de navegador: cliente en móvil, panel con 2FA, Welcome Center | **30/30** |
| E2E de navegador: galería (subir, aprobar, publicar, quitar metadatos) | **9/9** |
| Carga de fotografías | Intake y galería aceptan una foto válida de 12 MB; archivo de 16 MB rechazado (413); ejecutable con extensión .jpg rechazado (400) |
| Carga de documentos | PDF guardado en privado; no-PDF renombrado a .pdf rechazado; PDF público solo si está publicado y aprobado en ese idioma (inline, `application/pdf`) |
| Solicitudes | Confirmación solo tras guardar; idempotencia (misma clave, misma referencia); honeypot sin revelar el campo; estado, notas e historial; notas nunca en respuestas públicas |
| Autenticación | Contraseña + TOTP; error genérico; cookie `HttpOnly` y `SameSite=Strict`; CSRF obligatorio (403 sin token); sesión invalidada al cerrar sesión |
| Galería | Sin fotos públicas antes de aprobar (404 por URL directa); GPS eliminado del archivo guardado; JPEG válido |
| Welcome Center | Capítulos no publicados ocultos; publicado solo en el idioma aprobado |
| Límite de lectura sin `Content-Length` | Formulario chunked de 40 KB cortado con 413; formulario pequeño leído y validado |
| Estilos del panel | `admin.css` servido como `text/css` (antes se servía como HTML y el panel no tenía estilos) |

**Errores encontrados y corregidos en esta etapa:**
1. El límite de lectura dependía de `Content-Length`. Un cuerpo enviado en trozos podía superar el límite. Ahora el límite se cuenta mientras llega el cuerpo (`src/limits.ts`), con pruebas en Node y en el Worker.
2. La subida de varias fotos no era atómica: si el segundo archivo era inválido, el primero quedaba guardado. Ahora todos los archivos se validan y limpian antes de escribir ninguno, y las filas se insertan en un solo lote. Si falla algo después de escribir, los archivos escritos se borran. Hay prueba de regresión.
3. El panel servía su CSS como HTML. Corregido, con prueba.

**Limitaciones de esta verificación (importante):**
- Es un emulador local (`workerd` con D1 y R2 simulados). No prueba la red, la latencia, ni los límites reales de CPU y memoria de Cloudflare en producción.
- El envío de correo y Turnstile no se probaron en el Worker: no hay proveedor ni claves. Se probaron con respuestas simuladas en las pruebas de servidor.
- No se probó una subida total cercana a 150 MB. El límite sí está activo; el caso grande se verificó solo con archivos de 12 y 16 MB.
- `wrangler dev` registra como error las cancelaciones de cliente cuando el Worker corta una subida a mitad (413). Es el comportamiento esperado.
- El log del emulador no mostró excepciones de la aplicación durante las pruebas.

## 2. Arquitectura recomendada para producción

Objetivo: el menor número de servicios, todos con plan gratuito al inicio, sin pagos.

| Necesidad | Solución | Por qué | Límite gratuito a verificar |
|---|---|---|---|
| Sitio público | Cloudflare Pages | Estático, rápido, HTTPS | Compilaciones por mes, un build a la vez |
| Servidor (intake, panel, API) | Cloudflare Workers | Mismo proveedor que el sitio, sin servidor que duerma | Solicitudes por día |
| Base de datos | Cloudflare D1 | SQLite, igual que el esquema actual: migración directa | Almacenamiento y lecturas/escrituras diarias |
| Fotos y PDF privados | Cloudflare R2 (bucket privado) | Sin cargos por salida de datos; acceso solo desde el Worker | Almacenamiento mensual |
| Protección del panel | Cloudflare Access | Inicio de sesión delante de `admin.<dominio>` | Número de usuarios gratuitos |
| Verificación humana | Turnstile | Gratuito, reemplaza el captcha | Verificaciones (ver condiciones) |
| Correo | Resend | Confirmaciones y avisos | 3.000 al mes y 100 al día |
| Respaldos | Exportación programada de D1 y copia de R2 a una cuenta privada | D1 y R2 no tienen respaldo automático en plan gratuito | Según cuenta elegida |

**Trabajo técnico para Workers: completado y verificado en local (ver sección 1.1).** El núcleo del servidor ya no depende de `node:sqlite`, `busboy` ni scrypt: la base es D1 y los archivos van a R2 mediante una interfaz. `node:sqlite` queda solo en el adaptador local de desarrollo. La lógica de dominio (`packages/*`) no cambió.

**Alternativa:** Supabase (Postgres + Storage privado) con un Worker o Edge Function. Requiere cuenta y el plan Pro para respaldos automáticos y para evitar la pausa por inactividad.

## 3. Configuración de producción (variables, nunca en el repositorio)

- `BRIDIANT_ENV=production`: activa cookies `__Host-` con `Secure` y HSTS.
- `BRIDIANT_SECRET_KEY`: 32 bytes en base64. Cifra el secreto TOTP.
- `BRIDIANT_IP_SALT`: 16+ caracteres. Protege las huellas de IP.
- `BRIDIANT_TURNSTILE_SECRET`: obligatorio en producción; sin él el servidor no arranca.
- `BRIDIANT_OWNER_EMAIL`, `BRIDIANT_EMAIL_FROM`, `BRIDIANT_EMAIL_API_KEY`, `BRIDIANT_ADMIN_URL`: pendientes de su aprobación.

## 4. Auditoría de seguridad y privacidad (estado)

| Control | Resultado |
|---|---|
| Panel sin autenticación | Bloqueado en todas las rutas (probado) |
| Solicitudes públicas | Ninguna ruta pública las expone (probado) |
| Fotos privadas | Fuera de la carpeta pública; acceso solo con sesión; publicación solo por reglas (probado) |
| Notas internas | Nunca en respuestas públicas (probado) |
| Claves | Clave en archivo 0600 fuera del repositorio (desarrollo); en producción por variable obligatoria |
| Contraseña y TOTP | Contraseña con PBKDF2-SHA256 (100 000 iteraciones y sal, límite de Workers); TOTP cifrado en reposo con AES-256-GCM (probado) |
| Permisos de base de datos | D1 se accede solo desde el Worker, con el binding; sin API pública. Un solo usuario de servicio con permisos mínimos debe configurarse en la cuenta (**pendiente de cuenta**) |
| Errores | Sin rastros, rutas ni datos internos (probado) |
| Cabeceras | CSP estricta en el panel, `nosniff`, `frame-ancestors`, `Referrer-Policy: same-origin` (probado) |
| Carga de archivos | Tipo por contenido, límites de tamaño y de cantidad, límite de bytes reales aunque falte `Content-Length`, nombres sanitizados (probado en Node y en Workers) |
| Metadatos EXIF/GPS | Eliminados antes de guardar en JPEG, PNG y WebP (probado en Node y en Workers). HEIC se rechaza hasta contar con un decodificador seguro. |
| Escaneo antimalware | **No incluido** (sin proveedor). Riesgo aceptado y documentado. |
| Revisión de terceros | **Pendiente** antes de tráfico real |

## 5. Lo que sigue pendiente de su aprobación

1. Aprobar cada capítulo del Welcome Packet en inglés y español (los textos en español son borradores).
2. Decidir si el programa de referidos ($100) y la lista de precios de complementos aparecen públicamente. **Recomendación: no** (precios y créditos son internos).
3. Confirmar o retirar "fully insured, bonded, background-checked".
4. Confirmar teléfono, correo, horario y redes del paquete.
5. Autorizar el uso de las fotos (propiedad y permiso de personas identificables) antes de publicarlas.
6. Designar revisor de español.
7. Elegir la arquitectura de producción (sección 2) y autorizar cada cuenta.

## 6. Veredicto

El sitio está **terminado y probado en local**. **No está listo para recibir clientes reales** hasta: migrar el almacenamiento y la base a servicios duraderos, configurar correo y verificación humana, eliminar metadatos de fotos, activar respaldos verificados por restauración y tener su aprobación de contenido.
