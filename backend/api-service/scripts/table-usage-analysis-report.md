# Análisis de Uso de Tablas - Reporte Final

**Fecha:** $(date)
**Base de datos analizada:** Local (cortexagenthub)

## Resumen Ejecutivo

- **Total de tablas:** 27
- **Tablas activamente usadas:** 21
- **Tablas NO usadas:** 6 (tablas `*_count`)

---

## Tablas NO Usadas: `*_count`

### Tablas identificadas:
1. `analytics_count`
2. `context_count`
3. `conv_count`
4. `log_count`
5. `msg_count`
6. `tool_exec_count`

### Características de estas tablas:
- **Estructura:** Cada tabla tiene solo 1 columna: `count` (bigint)
- **Datos:** Todas tienen valor `0` (cero)
- **Tamaño:** Cada tabla ocupa ~8KB (solo overhead de estructura)
- **Total espacio:** ~48KB (6 tablas × 8KB)

### Análisis de dependencias:

#### ✅ Verificaciones realizadas:
1. **Código TypeScript/JavaScript:** ❌ No hay referencias
2. **Migraciones SQL:** ❌ No hay migraciones que las creen
3. **Scripts SQL:** ❌ No hay referencias directas
4. **Funciones PostgreSQL:** ❌ No hay funciones que las usen
5. **Triggers:** ❌ No hay triggers relacionados
6. **Vistas:** ❌ No hay vistas que las referencien
7. **Índices:** ❌ No tienen índices
8. **Constraints:** ❌ No tienen constraints
9. **Frontend:** ❌ No hay referencias
10. **Scripts de shell:** ❌ No hay referencias

#### ⚠️ Nota importante:
Las referencias encontradas en `clear-conversations.sql` son **variables locales** en bloques PL/pgSQL (como `conv_count INTEGER`), NO son referencias a las tablas. Estas variables se usan para almacenar conteos temporales durante la ejecución del script.

### Conclusión:

**Estas 6 tablas son completamente seguras de eliminar** porque:

1. ✅ No tienen ninguna dependencia en el código
2. ✅ No tienen datos útiles (todas tienen valor 0)
3. ✅ No tienen índices, constraints, triggers o vistas
4. ✅ No hay migraciones que las creen (probablemente fueron creadas manualmente)
5. ✅ No ocupan espacio significativo (~48KB total)
6. ✅ No hay funciones o procedimientos que las usen

### Recomendación:

**SEGURO ELIMINAR:** Estas tablas pueden ser eliminadas sin riesgo. Son tablas huérfanas que probablemente fueron creadas para algún propósito de estadísticas que nunca se implementó o fue reemplazado por otra solución.

---

## Tablas Activamente Usadas (21)

### Core Tables:
- ✅ `conversations` - Conversaciones de usuarios
- ✅ `messages` - Mensajes de conversaciones
- ✅ `channel_configs` - Configuraciones de canales
- ✅ `llm_configs` - Configuraciones de LLMs
- ✅ `tool_definitions` - Definiciones de herramientas
- ✅ `tool_executions` - Ejecuciones de herramientas
- ✅ `context_store` - Almacenamiento de contexto
- ✅ `routing_rules` - Reglas de routing
- ✅ `orchestration_flows` - Flujos de orquestación

### Knowledge Base & RAG:
- ✅ `knowledge_bases` - Bases de conocimiento
- ✅ `knowledge_base_documents` - Documentos
- ✅ `knowledge_base_embeddings` - Embeddings de documentos
- ✅ `embedding_models` - Modelos de embedding
- ✅ `embeddings` - Embeddings generados
- ✅ `flow_knowledge_bases` - Relación flows-KB
- ✅ `rag_queries` - Consultas RAG

### Analytics & Logging:
- ✅ `analytics_events` - Eventos de analytics
- ✅ `system_logs` - Logs del sistema

### Admin & Widgets:
- ✅ `admin_users` - Usuarios administradores
- ✅ `widgets` - Configuraciones de widgets
- ✅ `flow_channels` - Relación flows-canales

---

## Métricas

- **Espacio recuperable:** ~48KB (eliminando tablas `*_count`)
- **Tablas críticas:** 21
- **Tablas eliminables:** 6

---

## Notas Finales

Este análisis se realizó sobre la base de datos local sincronizada con Azure. Las conclusiones son válidas para ambas bases de datos ya que tienen la misma estructura.

**Acción recomendada:** Eliminar las 6 tablas `*_count` en un futuro mantenimiento, ya que no tienen ningún propósito funcional en el código actual.

