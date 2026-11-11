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

**Trabajo técnico necesario antes de desplegar:** el servidor actual usa APIs de Node (`node:sqlite`, `node:crypto` con scrypt, `busboy`). En Workers hay que reemplazar:
- `node:sqlite` por D1 (mismo SQL, otro cliente).
- scrypt por PBKDF2 con Web Crypto (o un módulo WASM), con iteraciones acordes a su proveedor.
- `busboy` por el lector `FormData` del runtime.
- El sistema de archivos por R2.

Esto es una migración acotada, no un rediseño: la lógica de dominio (`packages/*`) no cambia.

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
| Contraseña y TOTP | Contraseña con scrypt y sal; TOTP cifrado en reposo con AES-256-GCM (probado) |
| Permisos de base de datos | SQLite local no tiene roles. En D1/Postgres: un solo usuario de servicio, sin acceso público (**pendiente**) |
| Errores | Sin rastros, rutas ni datos internos (probado) |
| Cabeceras | CSP estricta en el panel, `nosniff`, `frame-ancestors`, `Referrer-Policy: same-origin` (probado) |
| Carga de archivos | Tipo por contenido, límites de tamaño y de cantidad, nombres sanitizados (probado) |
| Metadatos EXIF/GPS | **Pendiente:** las fotos se guardan tal cual. Antes de publicar hay que eliminar EXIF/GPS (requiere procesamiento de imagen). |
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
