# 9. Justificación de la guía de estilo

La interfaz de **AIDA** (web: alumno y orientador) busca ser **clara para usuarios escolares** (alumnos, familias y personal de orientación), **confiable** (sensación de trámite oficial) y **homogénea** entre pantallas. La guía visual no es decoración: reduce errores, acelera el reconocimiento de acciones y favorece la accesibilidad.

## 9.1. Colores (accesibilidad y contraste)

- **Texto principal sobre fondo claro:** Se trabaja con tonos **slate** (grises azulados) para el cuerpo de texto, por ejemplo cercanos a `#0F172A` sobre fondos claros como `#F8FAFC`, definidos también en variables globales (`globals.css`). Esta combinación ofrece **buen contraste** para lectura prolongada y cumple objetivos habituales de legibilidad (WCAG) cuando el tamaño de fuente es adecuado.
- **Color de marca / acciones principales:** El **violeta** (`#7C3AED`, `#5B21B6`, fondos suaves `#EDE9FE`, `#F5F3FF`) identifica acciones positivas del flujo: entrar al panel, confirmar pasos del orientador, enlaces destacados. Se separa del rojo y del verde para no mezclar “marca” con “peligro” o “éxito”.
- **Semántica por color:**
  - **Rojo** (`#DC2626`, `#B91C1C`, fondos `#FEF2F2`): cierre de sesión, rechazo, errores o acciones destructivas.
  - **Azul** (`#2563EB`, `#1D4ED8`, fondos `#DBEAFE`): alternativa clara frente al violeta (por ejemplo “No” en diálogos, estados “activo” en conmutadores).
  - **Ámbar / naranja:** avisos que no son error fatal (texto informativo o restricciones).
  - **Verde / esmeralda:** fondos de cabecera del orientador y sensación de “entorno institucional activo”, sin sustituir siempre al violeta en botones principales.

**Justificación:** Un número limitado de familias cromáticas evita fatiga visual y permite que **color = significado** (marca vs. peligro vs. información). El contraste texto/fondo se cuida de forma explícita en componentes críticos (formularios, modales, listas).

## 9.2. Tipografía (legibilidad)

- La aplicación usa la **pila tipográfica del sistema** (fuentes nativas del sistema operativo), con la clase `antialiased` en el cuerpo del documento. **No se carga una familia web propia** en el layout raíz: así se mejora **rendimiento**, se reduce la carga inicial y se mantiene una apariencia familiar en cada dispositivo.
- **Jerarquía:** títulos en negrita y tamaños mayores (`text-xl`, `text-2xl`, `text-4xl` en flujos clave), texto de apoyo en `text-sm` / `text-xs` y color más suave (`text-slate-500`, `text-slate-600`), de modo que el usuario distingue de un vistazo **qué es título, qué es instrucción y qué es detalle secundario**.

**Justificación:** Priorizar legibilidad y carga rápida encaja con un entorno educativo donde no todos los equipos son de gama alta y el uso puede ser esporádico (padre/alumno desde móvil).

## 9.3. Iconografía

- Se combinan **iconos vectoriales** (por ejemplo en cabeceras o acciones compactas) con **símbolos Unicode / emoji** en algunas listas o botones de acción rápida del panel de cargas (carpeta, intercambio, papelera en contextos muy concretos).
- Los iconos **no sustituyen** el texto cuando la acción es crítica: se complementan con `aria-label`, `title` o etiquetas visibles para **lectores de pantalla** y para usuarios que no interpretan bien el pictograma.

**Justificación reciente de simplificación:** En el diálogo **«¿Deseas cerrar sesión?»** se **eliminó el icono decorativo** duplicado arriba del título. El botón de cerrar sesión en la barra superior **mantiene** su icono para localizar la acción; el modal se centra en **pregunta + botones Sí/No**, reduciendo ruido visual y duplicidad semántica (mismo mensaje con menos elementos competiendo por atención).

## 9.4. Consistencia

- **Mismo lenguaje de formas:** bordes redondeados generosos (`rounded-xl`, `rounded-2xl`), sombras suaves en tarjetas y modales, mismos grosores de borde en botones secundarios.
- **Patrones repetibles:** modales a pantalla completa semitransparente, diálogos centrados con `role="dialog"` y título asociado; listas en cajas con borde `slate-200` y fondo blanco o `slate-50`.
- **Decisiones alineadas con la guía:**
  - **Historial de carga de alumnos:** se **retiró el botón «Eliminar»** por fila para evitar borrados accidentales y alinear la interfaz con un uso más conservador del historial (la trazabilidad de cargas prima sobre la limpieza agresiva de listados).
  - **Carreras registradas:** se dejó de mostrar la línea **«Código: …»** y solo el **nombre** como título visible, para que la lista sea más legible para el orientador y el código quede como dato interno del sistema.

**Justificación:** La consistencia reduce la curva de aprendizaje entre secciones (expediente, cargas, carreras, modales). Los ajustes puntuales anteriores refuerzan **menos clutter, más foco en lo esencial**.

---

# 10. Guía de estilo

Elemento que define **reglas visuales** concretas para implementación y revisión de pantallas en AIDA (web).

## 10.1. Paleta de colores (referencia)

| Uso | Referencia típica (Tailwind / hex) | Notas |
|-----|-----------------------------------|--------|
| Texto principal | `slate-900` ≈ `#0F172A` | Cuerpo y títulos fuertes |
| Texto secundario | `slate-600`, `slate-500` | Ayudas, metadatos |
| Fondo página | `slate-50`, `#F8FAFC` | Variable `--background` en `:root` |
| Acento / primario | `violet-600`, `violet-700`, `#7C3AED`, `#5B21B6` | Botones principales orientador |
| Fondo acento suave | `violet-50`, `violet-100`, `#EDE9FE`, `#F5F3FF` | Listas seleccionadas, modales |
| Acción destructiva / salir | `red-600`, `red-700`, `#DC2626`, `#B91C1C` | Cerrar sesión (header), inactivar |
| Información / alternativa | `blue-600`, `sky` | Conmutadores “Activo”, botón “No” |
| Éxito / institucional | `emerald`, `teal` | Cabeceras, mensajes positivos puntuales |
| Advertencia | `amber-800`, fondos `amber-50` | Avisos sin bloquear |
| Bordes neutros | `slate-200`, `#E2E8F0` | Tarjetas, separadores |

*No es obligatorio memorizar hex: en código se priorizan **tokens Tailwind** para mantener consistencia.*

## 10.2. Tipografías

- **Familia:** sistema (sans-serif del SO), sin fuente custom en `tailwind.config` extend.
- **Peso:** `font-semibold` / `font-bold` en títulos y botones; `font-medium` en etiquetas de formulario.
- **Cuerpo:** `text-sm` a `text-base` en formularios y listas; `text-xs` para legales, hints y badges.

## 10.3. Tamaños y espaciados

- **Radios:** `rounded-lg` (8px) en controles pequeños; `rounded-xl` y `rounded-2xl` en tarjetas, modales y botones destacados.
- **Relleno contenedores:** `p-4`–`p-6` en secciones; `px-3`–`px-6` en cabeceras alineadas con el contenido.
- **Separación entre bloques:** `gap-2`–`gap-4`, `mt-4`–`mt-8`, `space-y-3` en listas verticales.
- **Ancho útil:** en algunos flujos `max-w-lg` / `max-w-md` en modales; contenido ancho completo en panel orientador con márgenes laterales (`px-3` sm `px-4` lg `px-6`).

## 10.4. Uso de botones e iconos

- **Primario (acción principal):** fondo violeta o borde violeta fuerte + texto violeta oscuro; hover más oscuro o más saturado.
- **Secundario / cancelar:** borde `slate` o `blue`, fondo blanco o azul muy claro.
- **Peligro:** borde y texto rojo, fondo rojo muy claro; usar solo donde la acción sea irreversible o sensible.
- **Iconos:** tamaños coherentes (`h-5 w-5` a `h-7 w-7` en cabecera); en botones cuadrados, área mínima táctil ~44px (`h-11 w-11` sm `h-12 w-12` donde aplica).
- **Emoji / símbolos en botones cuadrados:** reservados a acciones muy localizadas (p. ej. fila de tabla); deben tener `title` o contexto de fila para no perder significado.

## 10.5. Reglas de accesibilidad

- **Contraste:** mantener texto de lectura sobre fondo con contraste suficiente; evitar gris claro sobre blanco para texto largo.
- **Foco y teclado:** botones nativos `<button>`; en modales, cerrar con clic fuera o `Escape` donde esté implementado; no depender solo del color para el estado (añadir texto o posición en conmutadores).
- **Diálogos:** `role="dialog"`, `aria-modal="true"`, título con `aria-labelledby` apuntando al encabezado visible.
- **Solo icono:** si un control no muestra texto visible, **obligatorio** `aria-label` o `title` descriptivo (“Cerrar sesión”, “Ver documentos”, etc.).
- **Estados de carga:** `disabled` + opacidad reducida + texto “Cargando…” / “Guardando…” para no inducir doble clic.

---

*Documento alineado al proyecto AIDA web (`aida-web`). Las reglas concretas de código siguen evolucionando; ante duda, priorizar consistencia con pantallas ya publicadas del panel orientador y del panel alumno.*
