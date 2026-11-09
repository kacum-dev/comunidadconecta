<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:ux-tres-experiencias-navegacion-v1 -->
## Norma transversal de experiencia y navegación (2026-11-09)

**Tres experiencias, una misma aplicación:** potencia para quien administra,
eficiencia para quien supervisa y sencillez para quien utiliza.

- **Administración:** panel técnico completo, configuración, auditoría, procesos
  y diagnósticos, sujeto a permisos. **Gestión/supervisión:** vistas operativas
  claras, KPIs y acciones frecuentes sin exponer algoritmos. **Usuario final:**
  interfaz intuitiva, guiada, con pocos campos y selección predefinida; en móvil
  priorizar una acción por pantalla, no encoger el escritorio.
- Mantener la identidad visual, los tokens, componentes y convenciones actuales
  de *cada* producto; escritorio, tableta y móvil necesitan diseños adaptados.
- Para asistentes móviles: viewport dinámico 100dvh, cabecera legible (icono +
  título + X en primera fila, pasos en segunda), cuerpo con scroll independiente,
  barra inferior accesible y zona segura; evitar scroll acumulativo, mostrar
  listas compactas y **un solo editor de concepto/tarea** cada vez.
- **X/Cerrar:** cierra únicamente la vista activa; desde una subacción vuelve
  a su padre, y solo desde la raíz sale al **origen real**, no siempre a Inicio.
- **Anterior:** retrocede exactamente un paso y **conserva** datos introducidos,
  selecciones y resultados válidos. **Volver a…:** destino nombrado, conserva
  búsqueda, filtros, entidad y contexto de navegación.
- **Cancelar:** descarta exclusivamente la operación no confirmada; nunca crea,
  emite, consume, elimina ni modifica un registro. **Continuar/Guardar:** debe
  ejecutar una acción real, mostrar validación y resultado; nada de botones
  inertes, rutas ficticias ni cierres que silencien fallos.
- Si una acción abre otro módulo (por ejemplo Orden → Recepción), definir
  **ida, vuelta tras éxito y vuelta tras cancelación**; no perder la entidad
  ni sustituir el origen por el módulo intermediario. El navegador/tecla Atrás
  y Escape respetan la misma jerarquía donde corresponda.
- Durante mutaciones: controlar estado busy, idempotencia y permisos;
  deshabilitar cierres/acciones conflictivos hasta finalizar, sin perder borrador.
- Cada acción nueva o modificada debe incluir **mapa de navegación**,
  estados vacío/carga/error/éxito, y pruebas de X, Anterior, Volver, Cancelar,
  enlace cruzado, conservación de estado y tamaños móviles 320/360/390 px,
  además de escritorio y roles. Auditar primero las acciones existentes.
- Reutilizar los componentes y lógica actuales. No introducir mocks, datos
  simulados, escrituras inseguras ni cambios de flujo sin autorización.
  No degradar RBAC, legalidad, privacidad, concurrencia ni reglas del dominio.

**Obligatorio para acciones actuales y futuras.** La documentación obliga
a revisar e implementar cada flujo: no equivale por sí sola a tener todas
las pantallas ya corregidas. Respetar siempre las reglas de seguridad,
arquitectura y especificaciones más estrictas del repositorio.
<!-- END:ux-tres-experiencias-navegacion-v1 -->
