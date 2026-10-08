<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:codex-shared-standards -->
## Complemento operativo de Codex — estándares compartidos (2026-10-08)

> Este complemento amplía las reglas anteriores; no las reemplaza. Ante conflicto prevalecen las instrucciones de seguridad, documentación canónica, contratos legales y restricciones más específicas del repositorio. Las preferencias de interfaz no autorizan a saltarse una arquitectura o flujo de aprobación.

### Método de trabajo
- Responde y documenta en español. Antes de editar, revisa el código, componentes, API, esquema, migraciones, tests, instrucciones locales y estado de Git. Identifica la causa raíz y evita duplicar funcionalidades.
- Implementa una solución real de extremo a extremo cuando esté dentro del alcance: contratos, servidor, datos, autorizaciones, UI, estados de error, pruebas y documentación. No sustituir funcionalidades solicitadas por mocks sin indicarlo.
- Actúa con autonomía en decisiones reversibles; consulta solo ante ambigüedad crítica, riesgo irreversible, acciones productivas o decisiones de negocio sin autorización. No inventes resultados ni afirmes haber ejecutado verificaciones no realizadas.

### Interfaz y backoffice
- Favorece pantallas operativas claras, densidad informativa útil, aprovechamiento del ancho y tablas con filtros, búsqueda, ordenación, paginación y acciones rápidas; evita tarjetas decorativas y espacios desperdiciados. Respeta siempre el lenguaje visual canónico existente.
- Usa drawers amplios, edición contextual o modales grandes cuando proceda. Mantén funcionalidad y accesibilidad en escritorio, tablet y móvil; contempla menú inferior móvil cuando el producto y sus roles lo requieran.
- Todos los botones y acciones deben funcionar, o estar deshabilitados con explicación. Incluye estados vacíos, carga, error, permisos y confirmaciones de acciones de riesgo.
- El backoffice debe permitir configurar y supervisar parámetros de negocio e integraciones cuando corresponda, con ayuda por campo, validación, prueba de conexión, permisos y auditoría. Los secretos se gestionan de forma segura y no se exponen completos; las variables de entorno siguen reservadas para bootstrap y despliegue.

### Backend, datos y seguridad
- Aplica validación y autorización en servidor, mínimo privilegio, aislamiento de tenant cuando exista, control de concurrencia e idempotencia en escrituras o webhooks; evita N+1 y operaciones bloqueantes.
- Preserva datos reales: no ejecutar migraciones destructivas, borrados masivos, sobrescrituras, force push, reset destructivo o acceso a producción sin autorización y plan de recuperación.
- Protege secretos y datos personales. No registrar tokens, contraseñas ni información sensible en logs. Observabilidad suficiente para diagnosticar fallos, timeouts y dependencias externas.

### Git, verificación y entrega
- Comprueba la rama y cambios sin confirmar; conserva trabajo ajeno. Para tareas de desarrollo usa ramas separadas cuando proceda. No fusionar a main ni desplegar sin autorización explícita.
- Ejecuta las verificaciones disponibles relevantes (lint, typecheck, tests, build y comprobaciones funcionales) y reporta qué se ejecutó, resultado y limitaciones del entorno.
- El resumen final debe indicar qué cambió, riesgos, migraciones, pruebas, pendientes y cómo probarlo. No declarar DONE si no se cumplen gates/criterios canónicos del repositorio.

### Adaptación específica del proyecto
- Comunidad Conecta: interfaz orientada a propietarios, inquilinos, juntas y administradores de fincas; cuotas, incidencias, documentos y transparencia. Verificar autorización por comunidad y rol en cada consulta y escritura, sin fugas entre comunidades. UX tipo banca: tablas productivas en escritorio, experiencia móvil clara y accesible. Pagos, firma, notificaciones y contabilidad requieren auditoría e idempotencia.

<!-- END:codex-shared-standards -->
