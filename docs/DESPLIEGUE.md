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
| 2 | Servidor y SQLite → D1 | **Hecha en código y probada en el runtime de Workers (local)** | Una sola aplicación `Request → Response` (`apps/server/src/app.ts`); entrada de Workers (`src/worker.ts`) con D1, R2 y `ASSETS`; adaptador de Node solo para desarrollo. Base asíncrona; PBKDF2 con Web Crypto; `busboy` eliminado; límite de lectura por bytes reales. Probado: 99 pruebas de servidor, 172 en el repositorio, Worker en `wrangler dev` con 48/48 (smoke), 30/30 y 9/9 en navegador, bundle de Workers construido | Crear la base D1 real y aplicar `migrations/0001_initial.sql`; pegar su identificador en `wrangler.toml`; comando de cuenta para D1 remoto (ver «Qué falta») |
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

## Prueba local en Workers (repetible, sin cuentas)

Todo se ejecuta contra el emulador local de `wrangler`. Ningún comando de esta sección toca un recurso remoto.

```bash
# Desde apps/server, con el sitio en modo preview para revisar las páginas:
npm run build -w @bridiant/server
npm run build:preview -w @bridiant/public           # solo para la prueba local; luego regenerar producción
npx wrangler d1 migrations apply bridiant-prod --local
node scripts/workers-local-seed.mjs                  # imprime localOwnerTotpSecret (solo local)
npx wrangler dev src/worker.ts --port 8788 --ip 127.0.0.1   # otra terminal
BRIDIANT_LOCAL_TOTP=<secreto> node scripts/workers-smoke.mjs  # debe terminar con 48/48 y código 0
npm run build:production -w @bridiant/public         # restaura el build de producción
```

Requiere `apps/server/.dev.vars` con `BRIDIANT_SECRET_KEY` (32 bytes en base64) y `BRIDIANT_IP_SALT`. Ambos archivos están fuera de git.

Suites de navegador (requieren Chromium instalado; `BRIDIANT_CHROMIUM` opcional; Playwright se carga desde el entorno):

```bash
BRIDIANT_BASE_URL=http://127.0.0.1:8788 BRIDIANT_OWNER_TOTP=<secreto> node e2e/customer-owner.mjs
BRIDIANT_BASE_URL=http://127.0.0.1:8788 BRIDIANT_OWNER_TOTP=<secreto> node e2e/gallery-owner.mjs
```

Ambas necesitan estado recién reiniciado. Con credenciales incorrectas fallan y salen con código 1.

Resultados de la última ejecución: smoke **48/48**; navegador cliente y propietario **30/30**; galería **9/9**. Detalle y limitaciones en `docs/PRODUCCION.md`, sección 1.1.

## Inicialización de D1 remoto (comando construido, no ejecutado contra su cuenta)

Comando: `apps/server/src/cli/d1-init-remote.ts` (`npm run d1:init-remote` desde `apps/server`). Usa las mismas funciones de producción (`createAdmin`, `seedWelcomePacket`) a través de un adaptador de la API REST de D1. No usa SQLite local.

**Protecciones:**
- Solo acepta la base `bridiant-prod`. Cualquier otro nombre se rechaza antes de hacer una petición.
- Simulación por defecto: sin `--apply` solo lee y muestra el plan. No escribe nada.
- Escribir exige `--apply --confirm bridiant-prod` (repetir el nombre).
- Si ya existe un propietario, **no crea otro**. Sigue el sembrado de capítulos, que solo añade los que faltan.
- Si hay más de una fila de propietario, se detiene y no cambia nada.
- Si el esquema no está migrado o la versión no coincide, se detiene antes de escribir.
- Contraseña de al menos 12 caracteres, validada antes de cualquier escritura. Se lee de `BRIDIANT_OWNER_PASSWORD` o de `--password-file`, nunca como argumento de la línea de órdenes.
- Solo se imprime una vez el secreto del autenticador del propietario, en la terminal. No se guarda ni se registra.
- El token de la API nunca aparece en mensajes de error. Los errores no muestran el SQL ni los parámetros.
- El adaptador rechaza `batch`: ninguna escritura multi-sentencia puede quedar a medias sin avisar.
- Los capítulos nuevos quedan sin aprobar y sin publicar. Los capítulos existentes nunca se sobrescriben.

**Variables** (solo en el entorno de la terminal del propietario): `CLOUDFLARE_ACCOUNT_ID`, `BRIDIANT_D1_DATABASE_ID`, `CLOUDFLARE_API_TOKEN` (permiso mínimo sobre D1), `BRIDIANT_SECRET_KEY` (la misma clave que el secreto del Worker, en base64), y `BRIDIANT_OWNER_PASSWORD`.

**Orden de uso** (una sola vez):
1. Simulación: `npm run d1:init-remote -- --database bridiant-prod --username <nombre>` con las variables. Debe mostrar `Owner accounts present before: 0` y `missing: 5`, sin escribir nada. Esta es también la primera llamada real a la API: si la respuesta no tiene la forma esperada, falla sin escribir.
2. Escritura: la misma orden con `--apply --confirm bridiant-prod`. Guarde el secreto que aparece.
3. Repetir la simulación: debe mostrar `Owner accounts present before: 1`.

**Verificado:** 12 pruebas con una simulación de la API REST respaldada por SQLite (incluye segunda ejecución sin duplicados, capítulo publicado que no se sobrescribe, esquema ausente, contraseña corta, token que no aparece en errores). Los rechazos del CLI se comprobaron en el binario compilado sin ninguna conexión de red.

**Sin verificar:** la forma exacta de las respuestas de la API REST de Cloudflare. La simulación sigue la documentación conocida, pero la primera simulación contra su base real es la prueba decisiva.

## Qué falta exactamente para conectar la cuenta y publicar

En este orden:

1. **Cuenta de Cloudflare** y token de API con permisos mínimos (Workers, D1, R2). Lo guarda usted con `wrangler login` o como secreto; no se pega en el chat ni en el repositorio.
2. **Crear la base D1** `bridiant-prod` y aplicar `apps/server/migrations/0001_initial.sql` en remoto. Pegar el identificador en `apps/server/wrangler.toml` (hoy dice `REPLACE_WITH_D1_DATABASE_ID`).
3. **Crear el bucket R2 privado** `bridiant-private-files` (sin acceso público ni dominio propio). El nombre ya está en `wrangler.toml`.
4. **Secretos del Worker** con `wrangler secret put`: `BRIDIANT_SECRET_KEY`, `BRIDIANT_IP_SALT`, `BRIDIANT_TURNSTILE_SECRET`, `BRIDIANT_EMAIL_API_KEY`, `BRIDIANT_OWNER_EMAIL`, `BRIDIANT_EMAIL_FROM`, `BRIDIANT_ADMIN_URL`. Las claves de Turnstile y de Resend las crea usted.
5. **Dominio** y dominio de envío verificado en Resend (registros DNS que usted publica).
6. **Clave de respaldo** (`BRIDIANT_BACKUP_KEY`) generada y guardada fuera de Cloudflare.
7. **Inicializar D1 remoto** con `npm run d1:init-remote` (ver la sección «Inicialización de D1 remoto»). Crea el propietario y siembra el Welcome Packet con el mismo código de producción. Primero una simulación; luego la escritura, una sola vez.
8. **Aprobación de contenido**: capítulos del Welcome Center en inglés y español, revisión de español, y las decisiones pendientes (HEIC rechazado; checklist y descargo de Move-Out; programa de referidos y lista de precios de complementos, que no se publican).
9. **Decisión sobre el despliegue actual de Vercel** (`bridiant-estimate-app.vercel.app`), que muestra precios en el navegador.
10. Recién entonces: `wrangler deploy` del Worker, subida del sitio de producción, y prueba de humo en la URL real.

## Orden de despliegue (cuando estén las credenciales y la etapa 2 esté terminada)

1. Crear D1 (`wrangler d1 create`) y aplicar `migrations/0001_initial.sql`.
2. Crear el bucket R2 privado (sin acceso público) y subir archivos cifrados.
3. Configurar secretos: `BRIDIANT_SECRET_KEY`, `BRIDIANT_IP_SALT`, `BRIDIANT_TURNSTILE_SECRET`, `BRIDIANT_EMAIL_API_KEY`, `BRIDIANT_BACKUP_KEY`.
4. Proteger `admin.<dominio>` con Cloudflare Access (solo el correo del propietario).
5. Desplegar el Worker y el sitio en Pages. Verificar cabeceras y que `/admin` exige sesión.
6. Ejecutar un respaldo y una restauración en un entorno de prueba antes de recibir clientes.
7. Enviar una solicitud de prueba real; comprobar el aviso y la confirmación.

## Veredicto

Todavía **no** está listo para producción: el Worker se ejecutó y probó en local (48/48 en el smoke y las suites de navegador), pero faltan los recursos reales de la etapa 1, las credenciales de la etapa 4, la clave de respaldo y la aprobación de contenido. Lista completa en la sección «Qué falta exactamente». Nada se ha desplegado ni publicado.
