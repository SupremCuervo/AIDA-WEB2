# Cómo utilizar AIDA y la API

Guía para usuarios finales (orientador y alumno) y para integradores que consuman las rutas `app/api` de **aida-web** (Next.js 15).

**Carpeta de capturas:** coloca las imágenes en `docs/capturas/` con los nombres indicados en cada bloque *Captura sugerida* o en la tabla del final. Si usas otros nombres, actualiza las rutas en este archivo.

---

## 1. Entorno y URL base

1. Instala dependencias y arranca el servidor de desarrollo (ver `README.md` en la raíz de `aida-web`).
2. La URL local suele ser `http://localhost:3000`. En producción, sustituye por el dominio desplegado (por ejemplo Vercel).
3. Todas las rutas API son relativas a esa base: `https://TU_DOMINIO/api/...`.

**Variables de entorno relevantes** (sin poner secretos en el código): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AIDA_JWT_SECRET`; para el cron, `CRON_SECRET`. Copia desde `.env.example` hacia `.env.local`.

---

## 2. Uso de la aplicación web — vista general

### 2.1 Inicio y elección de rol

Abre la raíz del sitio (`/`). Verás la landing con el mensaje de selección de rol y dos accesos: **Orientador** y **Alumno**.

**Captura sugerida**

- Archivo: `docs/capturas/01-inicio-seleccion-rol.png`
- Contenido: landing con logo AIDA y las dos tarjetas (Orientador / Alumno).

```markdown
![Inicio — selección de rol](./capturas/01-inicio-seleccion-rol.png)
```

*(Cuando aún no exista el archivo, el visor de Markdown puede mostrar un enlace roto; basta con añadir la imagen en esa ruta.)*

---

### 2.2 Flujo Orientador

1. Entra en `/orientador` (o desde la tarjeta *Orientador* en `/`).
2. Inicia sesión con correo y contraseña. El sistema valida el formato de correo institucional (`@cecyteh.edu.mx`, reglas definidas en la API de acceso).
3. Si el usuario no existe, puede enviarse una **solicitud de acceso** pendiente de aprobación (respuesta `202` en la API; en la UI verás el mensaje correspondiente).
4. Tras un login correcto, la sesión queda en una **cookie HTTP** (`aida_orientador`). El panel principal está en `/orientador/panel`.

**Capturas sugeridas**

| Archivo | Qué debe mostrar |
|---------|------------------|
| `docs/capturas/02-orientador-login.png` | Pantalla de acceso orientador (formulario correo/contraseña). |
| `docs/capturas/03-orientador-panel-menu.png` | Panel con menú/secciones visibles (Expediente, Crear tabla, Plantillas, Cargas, Escolar, Historial si aplica). |
| `docs/capturas/04-orientador-expediente.png` | Sección Expediente con lista o filtros representativos. |
| `docs/capturas/05-orientador-cargas.png` | Sección Cargas / periodos (tokens, fechas o tabla según tu despliegue). |

Rutas útiles adicionales en la interfaz (según permisos):

- `/orientador/panel/grupo/[grupoTokenId]` — detalle por grupo.
- `/orientador/panel/alumno/[cuentaId]` — detalle de alumno.
- `/orientador/panel/plantillas/[plantillaId]/editar` — edición de plantilla.

**Cerrar sesión (API):** `POST /api/orientador/salir` — elimina la cookie `aida_orientador`.

---

### 2.3 Flujo Alumno

1. Entra en `/alumno` desde la landing.
2. Flujo típico: validar **clave de grupo** → indicar **nombre** y **contraseña** (creación o acceso a cuenta existente) → panel en `/alumno/panel`.
3. Cookies involucradas: `aida_clave_ok` (tras validar clave) y `aida_alumno` (sesión de alumno). Son **HttpOnly**; el navegador las envía solo al mismo origen.

**Capturas sugeridas**

| Archivo | Qué debe mostrar |
|---------|------------------|
| `docs/capturas/06-alumno-modal-clave.png` | Modal o paso de captura de clave de grupo. |
| `docs/capturas/07-alumno-cuenta.png` | Paso nombre / contraseña unificado. |
| `docs/capturas/08-alumno-panel.png` | Panel del alumno con documentos o estado de entrega. |

**Cerrar sesión (API):** `POST /api/alumno/salir`.

---

## 3. Cómo usar la API

### 3.1 Principio general

- La mayoría de rutas bajo `/api/orientador/...` y `/api/alumno/...` exigen **sesión por cookie JWT**, no un encabezado `Authorization: Bearer` de uso general (salvo el cron, ver más abajo).
- Desde **JavaScript en el mismo sitio** (páginas servidas por la misma app Next), usa `fetch` con `credentials: "include"` para que el navegador envíe las cookies.
- Desde **Postman, curl u otro cliente**, primero haz el `POST` de acceso correspondiente, guarda las cookies de respuesta (`Set-Cookie`) y reenvíalas en las peticiones siguientes (`Cookie: ...`).

### 3.2 Orientador — iniciar sesión y comprobar sesión

**Iniciar sesión**

```http
POST /api/orientador/acceso
Content-Type: application/json

{"email":"usuario@cecyteh.edu.mx","password":"..."}
```

- Éxito (`200`): cuerpo JSON con `ok`, `email`, `nombre` y cookie `aida_orientador`.
- Credenciales incorrectas: `401`.
- Solicitud de alta pendiente (usuario no registrado): `202` con `solicitudEnviada`, etc.

**Estado de sesión**

```http
GET /api/orientador/sesion
Cookie: aida_orientador=...
```

- `200` con `autenticado: true`, `email`, `nombre`, `rolPanel` (`normal` o `jefe`).
- Sin sesión válida: `401` con `{ "autenticado": false }`.

Ejemplo **curl** (guardar cookies en un archivo jar):

```bash
curl -c cookies.txt -X POST "http://localhost:3000/api/orientador/acceso" \
	-H "Content-Type: application/json" \
	-d "{\"email\":\"usuario@cecyteh.edu.mx\",\"password\":\"TU_PASSWORD\"}"

curl -b cookies.txt "http://localhost:3000/api/orientador/sesion"
```

**Captura sugerida**

- `docs/capturas/09-api-orientador-sesion-json.png` — respuesta JSON de `GET /api/orientador/sesion` (oculta datos sensibles si la compartes).

---

### 3.3 Alumno — validar clave y acceso

Flujo típico en API (el front ya lo encadena):

1. `POST /api/alumno/validar-clave` con `{ "clave": "..." }` → establece `aida_clave_ok` si la clave es válida.
2. `GET /api/alumno/paso-clave` — indica si la clave ya fue validada.
3. `POST /api/alumno/acceso` — nombre + contraseña según el flujo de cuenta (ver implementación y mensajes de error en la ruta).
4. `GET /api/alumno/sesion` — estado con cookie `aida_alumno`.

**Captura sugerida**

- `docs/capturas/10-devtools-fetch-alumno.png` — pestaña Red del navegador mostrando llamadas a `/api/alumno/...` con estado 200 (sin exponer contraseñas).

---

### 3.4 API sin sesión de usuario (utilidad y automatización)

**Nombre estándar de archivo** (no requiere cookie de orientador/alumno):

```http
POST /api/archivos/nombre-estandar
Content-Type: application/json

{"nombreAlumno":"Raúl Peña García","tipoDocumento":"acta_nacimiento","extension":"pdf"}
```

Detalle de campos y respuesta: sección homónima en `README.md`.

**Cron de promoción de semestre** (no usar desde el navegador del usuario; es para schedulers):

```http
GET /api/cron/promocion-semestre
Authorization: Bearer <CRON_SECRET>
```

El valor de `CRON_SECRET` debe coincidir con la variable de entorno del servidor.

**Captura sugerida**

- `docs/capturas/11-variables-entorno-vercel.png` — panel de variables de entorno del proveedor (sin mostrar valores completos de secretos).

---

## 4. Inventario de rutas API (referencia)

Prefijos principales:

| Prefijo | Uso resumido |
|---------|----------------|
| `/api/orientador/*` | Panel orientador: expediente, cargas, plantillas, documentos, OCR, grupos, periodos, logs, archivo muerto, importaciones, etc. |
| `/api/alumno/*` | Flujo y panel alumno: clave, sesión, documentos, descargas. |
| `/api/archivos/nombre-estandar` | Generar nombre de archivo normalizado. |
| `/api/cron/promocion-semestre` | Tarea programada con `Bearer CRON_SECRET`. |

### 4.1 Orientador (todas requieren cookie `aida_orientador` salvo que indiques lo contrario en código)

Rutas detectadas en el proyecto (métodos típicos: revisa cada `route.ts` para GET/POST/PATCH/DELETE exactos):

- `acceso`, `sesion`, `salir`
- `archivo-muerto/archivar`, `archivo-muerto/reactivar`, `archivo-muerto/alumnos`
- `cargas`, `cargas/[cargaId]`, `cargas/[cargaId]/grupos`, `cargas/linea`, `cargas/filas-xlsx`, `cargas/generar-clave`, `cargas/documentos-estatus`
- `carreras`
- `documento/adjunto`, `documento/descargar`
- `entrega`
- `expediente`, `expediente/[cuentaId]`, `expediente/[cuentaId]/ocr-campos`, `expediente/acciones-masivas-grupos`, `expediente-zip`
- `grupos`, `grupo/[grupoTokenId]/alumnos`, `grupo/[grupoTokenId]/grado-masivo`, `grupo/[grupoTokenId]/matriculas`, `grupo/[grupoTokenId]/carrera-masiva`
- `grupo-token`, `grupo-token/importar-xml`, `grupo-token/lote`
- `grupo-fecha-limite`
- `importar-alumnos-xml`, `importar-alumnos-lote`
- `logs`, `logs/acciones`
- `ocr/prepare`, `ocr/extract`
- `padron/[padronId]`
- `periodos-academicos`, `periodos-academicos/[periodoId]/grupos`, `periodos-academicos/[periodoId]/alumnos`
- `plantillas`, `plantillas/[plantillaId]`, `plantillas/[plantillaId]/pdf`, `plantillas/[plantillaId]/rellenar`, `plantillas/[plantillaId]/definicion-relleno`
- `semestre-fechas`
- `solicitudes-acceso`
- `subir-documento`

Ejemplos de URL completas: `GET http://localhost:3000/api/orientador/expediente?estado=activo&nombre=...`

### 4.2 Alumno

- `acceso`, `validar-clave`, `paso-clave`, `sesion`, `salir`
- `subir-documento`, `documento`, `documentos`, `documento/descargar`
- `carrera`

---

## 5. Tabla maestra — dónde poner cada captura

Guarda los PNG (o JPG) en **`aida-web/docs/capturas/`**. Nombres recomendados:

| # | Nombre de archivo | Sección del documento | Contenido esperado |
|---|-------------------|------------------------|--------------------|
| 1 | `01-inicio-seleccion-rol.png` | §2.1 | Landing `/` |
| 2 | `02-orientador-login.png` | §2.2 | Login `/orientador` |
| 3 | `03-orientador-panel-menu.png` | §2.2 | Panel con menú |
| 4 | `04-orientador-expediente.png` | §2.2 | Sección Expediente |
| 5 | `05-orientador-cargas.png` | §2.2 | Sección Cargas |
| 6 | `06-alumno-modal-clave.png` | §2.3 | Clave de grupo |
| 7 | `07-alumno-cuenta.png` | §2.3 | Nombre / contraseña |
| 8 | `08-alumno-panel.png` | §2.3 | Panel alumno |
| 9 | `09-api-orientador-sesion-json.png` | §3.2 | JSON sesión orientador |
| 10 | `10-devtools-fetch-alumno.png` | §3.3 | Red → API alumno |
| 11 | `11-variables-entorno-vercel.png` | §3.4 | Variables de entorno (opcional) |

Para insertarlas en este Markdown debajo de cada sección, añade por ejemplo:

```markdown
![descripción breve](./capturas/01-inicio-seleccion-rol.png)
```

---

## 6. Seguridad (lectura obligatoria para integradores)

- No expongas `SUPABASE_SERVICE_ROLE_KEY` ni `AIDA_JWT_SECRET` al cliente.
- Las cookies de sesión son **HttpOnly**; no son accesibles desde JavaScript del navegador.
- Integraciones de terceros en otro dominio no recibirán esas cookies por defecto; la integración debe ser **en servidor** (mismo origen) o mediante un diseño explícito de API pública (no es el caso de la mayoría de rutas orientador/alumno).

Para más detalle de esquema Supabase y tablas base, consulta `README.md` y `supabase/schema.sql`.
