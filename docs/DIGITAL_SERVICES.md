# Servicios digitales

La ampliación se diseña con una regla: la comunidad conserva los datos y puede sustituir cada proveedor sin perder el historial. El centro **Servicios digitales** muestra tres estados:

- **Base lista**: modelo de datos, permisos y trazabilidad disponibles; falta conectar un proveedor.
- **Conectado**: existe una integración habilitada para esa capacidad.
- **Siguiente fase**: arquitectura prevista, pero no debe presentarse aún como servicio operativo.

## Alcance de la base

| Capacidad | Base incorporada | Para activarla en producción |
| --- | --- | --- |
| SEPA y Norma 43 | Mandatos cifrados, remesas, operaciones e importaciones trazables | Entidad o proveedor bancario, identificador de acreedor y validación pain.008 |
| Tarjeta y Bizum | Intentos idempotentes, estados, devoluciones y referencias | Proveedor de pago autorizado y webhooks firmados |
| Incidencias | Relación con versiones documentales inmutables | Política de tamaños, tipos y almacenamiento si se supera el límite PostgreSQL |
| Firma eIDAS | Sobres, firmantes, hash y expediente de evidencia | Prestador de servicios de confianza y definición del nivel de firma |
| PGC y OCR | Asientos, líneas, propuesta OCR y revisión | Plan contable de la comunidad, proveedor OCR y reglas de aprobación |
| Copilot | Sugerencias revisables con hash y decisión humana | Proveedor de IA, minimización de datos y evaluación de calidad |
| Importación | Lotes, huella, mapeo, errores y reversión | Adaptadores por versión de cada programa y muestras anonimizadas |
| Push y nativo | Suscripciones cifradas, intentos y recepción web push en la PWA | VAPID/proveedor push, preferencias de usuario y worker de envío |

## Controles obligatorios

1. Credenciales cifradas y nunca expuestas al navegador.
2. Webhooks autenticados, idempotentes y auditados.
3. Revisión humana para OCR, Copilot y propuestas contables.
4. Doble control para pagos, remesas y cambios bancarios.
5. Evidencia inmutable para documentos y firmas.
6. Pruebas de contrato con cada proveedor antes de habilitar la integración.

La aplicación no debe inferir que una conexión configurada equivale a certificación jurídica, homologación bancaria o servicio cualificado. Esas condiciones se verifican con el proveedor y el asesor correspondiente antes del piloto.
