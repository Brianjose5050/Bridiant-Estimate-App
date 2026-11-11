# Despliegue: estado por etapa y puntos de detención

Estado: **preparado, no desplegado.** Ningún recurso de Cloudflare, Resend o dominio existe todavía. No hay credenciales en el repositorio.

## Copia de seguridad previa (hecha)

- Etiqueta local `backup/pre-produccion` (commit `9021225`).
- Paquete completo del repositorio (`git bundle`) y archivo del árbol de trabajo, guardados fuera del repositorio.
- La versión local actual **no fue modificada ni eliminada**.

## Etapas

| # | Etapa | Estado | Qué se hizo | Qué falta (requiere su acción) |
|---|---|---|---|---|
| 1 | Infraestructura Cloudflare | **Detenida (requiere cuenta)** | Plantilla `apps/server/wrangler.toml` sin identificadores reales. CLI `wrangler` instalado localmente (herramienta de código abierto) | Crear cuenta de Cloudflare; crear base D1 y bucket R2 privado; token de API con permisos mínimos; decidir el dominio |
| 2 | Servidor y SQLite → D1 | **Hecha en código y probada localmente** | Servidor portado a Workers: una sola aplicación `Request → Response` (`apps/server/src/app.ts`), entrada de Workers (`src/worker.ts`) con D1, R2 y `ASSETS`, y adaptador de Node solo para desarrollo. Base asíncrona en todo el código; contraseñas con PBKDF2 (Web Crypto); `busboy` eliminado (`request.formData()`); metadatos sin `Buffer`. Verificado: 95 pruebas de servidor, 30/30 pruebas de navegador (cliente, panel, Welcome Center), 9/9 de galería, bundle de Workers construido en simulación (`wrangler deploy --dry-run`, sin cuenta) | Crear la base D1 real y aplicar `migrations/0001_initial.sql`; pegar su identificador en `wrangler.toml`; `wrangler secret put` para los secretos |
| 3 | Fotos y PDF → R2 privado | **Hecha en código, sin bucket real** | Interfaz `FileStore` con implementación R2 (`r2Files`) y local para desarrollo. Las claves las genera el servidor; nada se sirve sin comprobar sesión o publicación | Crear el bucket privado `bridiant-private-files` y pegar su nombre en `wrangler.toml`. Sin acceso público ni dominio propio |
| 4 | Turnstile y Resend | **Probado con respuestas simuladas** | Verificación fallida-cerrada; adaptador de correo con la forma de la API; cola con reintentos | Clave pública y secreta de Turnstile; clave de API de Resend; dominio de envío verificado con registros DNS |
| 5 | Eliminación de EXIF y GPS | **Hecha y probada** | JPEG, PNG y WebP: se eliminan EXIF, XMP, IPTC, comentarios y textos. Se aplica antes de guardar, en la solicitud pública y en la galería. Verificado con una foto real: píxeles idénticos y sin GPS | HEIC se rechaza hasta contar con un decodificador seguro (decisión suya) |
| 6 | Respaldos y restauración | **Hecha y verificada localmente** | Respaldo cifrado (AES-256-GCM), con sumas SHA-256 y conteo de filas; restauración que se niega con clave incorrecta o archivo alterado. Restauración real de los datos de prueba: conteos coincidentes | Generar y guardar la clave de respaldo (`BRIDIANT_BACKUP_KEY`); copia programada fuera de Cloudflare |
| 7 | Pruebas completas | **Hecha** | 167 pruebas automatizadas; flujo de navegador de 30 pasos; galería de 9 pasos; rastreo de 28 páginas en ambos idiomas | Repetirlas tras la etapa 2 (cambia el runtime) |
| 8 | Preparación del despliegue | **Preparada, no ejecutada** | Este documento y la plantilla de configuración | Autorización explícita para desplegar |

## Credenciales y acciones que necesito de usted

1. **Cuenta de Cloudflare** (plan gratuito). Usted la crea. No la creo yo.
2. **Token de API de Cloudflare** con permisos mínimos (Workers, D1, R2, Pages). Se guarda con `wrangler login` o como secreto; nunca en el repositorio.
3. **Dominio** y decisión de nombres: `www.<dominio>` (sitio) y `admin.<dominio>` (panel protegido por Cloudflare Access).
4. **Resend**: cuenta, clave de API y verificación del dominio de envío con los registros DNS que les indique.
5. **Turnstile**: clave pública (va en el formulario) y clave secreta (va como secreto del Worker).
6. **Correo del propietario** y **dirección de envío aprobada** por usted.
7. **Clave de respaldo**: genere con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, guárdela en su gestor de contraseñas y en una copia física. Sin ella los respaldos no se pueden restaurar.
8. **Aprobación de contenido** (capítulos del Welcome Packet, fotos, textos en español, referidos, precios de complementos, afirmación de seguros) antes de publicar.

## Orden de despliegue (cuando estén las credenciales y la etapa 2 esté terminada)

1. Crear D1 (`wrangler d1 create`) y aplicar `migrations/0001_initial.sql`.
2. Crear el bucket R2 privado (sin acceso público) y subir archivos cifrados.
3. Configurar secretos: `BRIDIANT_SECRET_KEY`, `BRIDIANT_IP_SALT`, `BRIDIANT_TURNSTILE_SECRET`, `BRIDIANT_EMAIL_API_KEY`, `BRIDIANT_BACKUP_KEY`.
4. Proteger `admin.<dominio>` con Cloudflare Access (solo el correo del propietario).
5. Desplegar el Worker y el sitio en Pages. Verificar cabeceras y que `/admin` exige sesión.
6. Ejecutar un respaldo y una restauración en un entorno de prueba antes de recibir clientes.
7. Enviar una solicitud de prueba real; comprobar el aviso y la confirmación.

## Veredicto

Todavía **no** está listo para producción: el código está portado y probado en local, pero faltan los recursos reales de la etapa 1 (cuenta, D1 y R2 creados), las credenciales de la etapa 4, la clave de respaldo y la aprobación de contenido. Nada se ha desplegado ni publicado.
