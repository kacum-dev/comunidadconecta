# Auditoría de coherencia entre el artículo y Comunidad Conecta

Fecha de revisión: 16 de agosto de 2026.

## Resultado

El artículo original era correcto como visión de producto, pero mezclaba funciones operativas, capacidades preparadas para una integración futura y objetivos todavía no medibles. La versión revisada separa esos tres estados y elimina afirmaciones absolutas que la aplicación no podía demostrar.

| Afirmación | Evidencia actual | Resultado tras la revisión |
| --- | --- | --- |
| El propietario ve su vivienda, sus recibos y no los de otra vivienda | Filtros de servidor por comunidad, usuario, relación y unidad; comprobación repetida en descargas | Cumple |
| La portada resume estado, deuda, avisos, junta, incidencias y documentos | Portada residente y actividad reciente, ahora también con documentos permitidos | Cumple; «nuevo» se cambió por «publicado recientemente» porque no existe lectura individual del documento |
| Comunicar una incidencia es un proceso guiado con foto, revisión y seguimiento | Formulario guiado, adjunto opcional, pantalla previa de revisión, confirmación y seguimiento posterior | Cumple tras la corrección |
| La persona sabe qué datos se usan y puede pedir una corrección | Nuevo espacio «Ayuda y privacidad», RAT publicado y solicitudes propias de derechos | Cumple; si el RAT está incompleto se muestra la carencia en vez de inventar información |
| El contenido puede ampliarse | Preferencia `simple_mode` persistente y modo «Lectura cómoda» | Cumple tras la corrección |
| Las acciones principales se entienden sin depender de iconos | Menú y acciones principales usan icono y texto; iconos universales tienen nombre accesible | Cumple con redacción corregida; se retiró el absoluto «siempre» |
| Correo y push pueden complementar la plataforma | Aviso interno y cola externa respetan la configuración de la comunidad | Cumplimiento condicionado: el envío real necesita proveedor y confirmación externa |
| Firma, pagos y remesas están plenamente disponibles | Existen fundamentos y modelos de integración, no un servicio externo completo en todos los casos | No debía afirmarse como operativo; el artículo revisado lo declara condicionado |
| La adopción se mide más allá de las cuentas creadas | Existen último acceso y eventos de auditoría, pero no todas las preguntas cualitativas son inferibles | Cumplimiento parcial; el texto ahora exige combinar agregados con investigación directa |
| Las comunicaciones legales pueden hacerse digitalmente | La aplicación registra preparación e historial, pero el canal legal depende del acto y de su prueba | Cumple solo con la cautela jurídica incorporada |

## Límites que no deben convertirse en mensajes comerciales

- No afirmar «correo enviado» o «push entregada» cuando únicamente existe una entrega pendiente.
- No presentar una integración como operativa por el mero hecho de que existan tablas o una pantalla de configuración.
- No afirmar que una aplicación sustituye cualquier procedimiento de notificación previsto en la Ley de Propiedad Horizontal.
- No prometer que todos los documentos recientes son «nuevos para el usuario» mientras no exista una marca individual de lectura.
- No convertir el registro de auditoría en una copia del contenido sensible de solicitudes o documentos.
- No usar el número de cuentas creadas como única métrica de adopción.

## Controles técnicos revisados

- Autorización en servidor por rol y comunidad.
- Alcance por vivienda para economía, incidencias, reservas y documentos privados.
- Audiencia de documentos comunitarios diferenciada entre propietarios y residentes.
- Descarga de documentos con una segunda comprobación de autorización.
- Solicitudes RGPD limitadas a la propia identidad autenticada.
- Preferencia de lectura actualizada únicamente para el usuario de la sesión.
- Creación de una única incidencia aunque falle posteriormente el adjunto opcional.
- Activación de correo y push respetada al preparar las entregas externas.

## Referencias oficiales usadas

- [Ley 49/1960, de 21 de julio, sobre propiedad horizontal](https://www.boe.es/eli/es/l/1960/07/21/49/con).
- [Reglamento (UE) 2016/679, en especial principios, transparencia, derechos, privacidad desde el diseño y seguridad](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=ES).
- [AEPD: principales obligaciones de las comunidades de propietarios](https://www.aepd.es/preguntas-frecuentes/9-comunidades-de-propietarios/FAQ-0902-cuales-son-las-principales-obligaciones).

Esta revisión técnica no sustituye el asesoramiento jurídico sobre un acuerdo, tratamiento o comunicación concretos.
