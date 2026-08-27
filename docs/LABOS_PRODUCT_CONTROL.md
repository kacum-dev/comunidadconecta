# Integración con el centro de productos de LAB OS

Comunidad Conecta funciona completamente en el servidor de la comunidad. LAB OS solo actúa como registro de instalaciones voluntarias y autoridad de licencias comerciales.

## Principios

- Todas las funciones son gratuitas para uso directo de comunidades y entidades sin ánimo de lucro.
- No hay módulos premium ni bloqueo remoto.
- El uso comercial requiere un certificado emitido desde LAB OS.
- La clave comercial completa solo se usa durante la activación y no se conserva localmente.
- El certificado Ed25519 se verifica localmente y sigue siendo válido aunque LAB OS no esté disponible.
- La telemetría comunitaria está desactivada por defecto y puede revocarse.

## Variables

```dotenv
LABOS_CONTROL_PLANE_URL=https://lab.kacum.com
COMMUNITY_CONNECTA_PRODUCT_CODE=comunidad-conecta
APP_VERSION=1.0.0
```

## Datos que pueden enviarse

- UUID aleatorio de la instalación.
- Versión y tipo de despliegue.
- Finalidad declarada: comunitaria, no lucrativa, demostración, desarrollo o comercial.
- Rangos de viviendas y usuarios activos.
- Banderas booleanas de uso de áreas funcionales.
- Salud de base de datos.

No se envían nombres de comunidades, dominios, IP desde la aplicación, propietarios, direcciones, correos, documentos, incidencias, movimientos, saldos, IBAN, votos ni texto libre.

## Activación

1. Crear `comunidad-conecta` en **LAB OS → Productos y licencias**.
2. Emitir una licencia comercial indicando instalaciones y versión principal.
3. Copiar la clave, que LAB OS muestra una sola vez.
4. En Comunidad Conecta abrir **Configuración → Licencia y privacidad**.
5. Introducir la clave y verificar el certificado.

La licencia es perpetua para la versión principal indicada. No incluye hosting, soporte ni mantenimiento.
