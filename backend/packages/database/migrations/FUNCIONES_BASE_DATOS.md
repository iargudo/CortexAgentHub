# 📋 Funciones de Base de Datos - Documentación

Este documento explica el propósito de cada función creada en la base de datos y su estado de uso actual.

## 🔍 Funciones Disponibles

### 1. `get_flow_channel_ids(p_flow_id uuid)` → `uuid[]`

**Propósito:** Obtiene un array de UUIDs de todos los canales activos asociados a un flow (agente), ordenados por prioridad.

**Uso actual:** ❌ **NO SE ESTÁ USANDO**

**Razón:** El código actual hace JOINs directos con la tabla `flow_channels` en lugar de usar esta función helper.

**Ejemplo de uso potencial:**
```sql
-- En lugar de hacer:
SELECT channel_id FROM flow_channels WHERE flow_id = $1 AND active = true ORDER BY priority ASC;

-- Podrías usar:
SELECT get_flow_channel_ids($1);
```

**Dónde podría usarse:**
- En queries que necesiten obtener rápidamente los IDs de canales de un flow
- En funciones más complejas que trabajen con flows
- En reportes o analytics que necesiten listar canales por flow

**Recomendación:** 
- ✅ **Mantener** - Es útil como helper y puede simplificar código futuro
- Podría usarse en el Admin Panel para mostrar canales de un flow sin hacer JOINs complejos

---

### 2. `get_flow_channel_types(p_flow_id uuid)` → `text[]`

**Propósito:** Obtiene un array de tipos de canales únicos (ej: `['webchat', 'whatsapp']`) asociados a un flow activo.

**Uso actual:** ❌ **NO SE ESTÁ USANDO**

**Razón:** Similar a la función anterior, el código hace JOINs directos cuando necesita esta información.

**Ejemplo de uso potencial:**
```sql
-- En lugar de hacer:
SELECT DISTINCT c.channel_type 
FROM flow_channels fc
JOIN channel_configs c ON fc.channel_id = c.id
WHERE fc.flow_id = $1 AND fc.active = true AND c.is_active = true;

-- Podrías usar:
SELECT get_flow_channel_types($1);
```

**Dónde podría usarse:**
- En el Admin Panel para mostrar qué tipos de canales soporta un flow
- En validaciones que necesiten verificar si un flow soporta un tipo de canal específico
- En reportes que agrupen flows por tipo de canal

**Recomendación:**
- ✅ **Mantener** - Útil para simplificar queries y mejorar legibilidad
- Podría integrarse en el endpoint de flows del Admin Panel

---

### 3. `search_embeddings(query_embedding vector, match_threshold double precision, match_count integer)` → `TABLE(...)`

**Propósito:** Realiza búsqueda de similitud vectorial (cosine similarity) en la tabla `embeddings` usando pgvector.

**Parámetros:**
- `query_embedding`: Vector de embedding de la consulta
- `match_threshold`: Umbral mínimo de similitud (0-1), default: 0.7
- `match_count`: Número máximo de resultados, default: 5

**Retorna:** Tabla con `id`, `content`, `similarity`, `metadata`, `created_at`

**Uso actual:** ❌ **NO SE ESTÁ USANDO**

**Razón:** El código actual (`RAGService.ts`) hace búsquedas vectoriales directamente en las queries SQL, específicamente en la tabla `knowledge_base_embeddings` (no en `embeddings`).

**Ejemplo de uso potencial:**
```sql
-- En lugar de hacer:
SELECT 
  id, 
  content, 
  1 - (embedding <=> $1) as similarity,
  metadata,
  created_at
FROM embeddings
WHERE 1 - (embedding <=> $1) > 0.7
ORDER BY embedding <=> $1
LIMIT 5;

-- Podrías usar:
SELECT * FROM search_embeddings($1, 0.7, 5);
```

**Dónde podría usarse:**
- Si en el futuro se necesita buscar en la tabla `embeddings` general (no solo en knowledge bases)
- Para simplificar código que haga búsquedas vectoriales básicas
- En scripts de migración o mantenimiento

**Recomendación:**
- ⚠️ **Considerar eliminar** - Actualmente no se usa y el código busca en `knowledge_base_embeddings`, no en `embeddings`
- O **adaptar** para que busque en `knowledge_base_embeddings` si se quiere usar

---

### 4. `update_embeddings_updated_at()` → `trigger`

**Propósito:** Función trigger que actualiza automáticamente el campo `updated_at` en la tabla `embeddings` cuando se modifica un registro.

**Uso actual:** ✅ **SÍ SE ESTÁ USANDO**

**Dónde:** Asociada al trigger `embeddings_updated_at_trigger` en la tabla `embeddings`

**Cómo funciona:** Se ejecuta automáticamente antes de cada UPDATE en la tabla `embeddings`

**Recomendación:**
- ✅ **Mantener** - Esencial para mantener la integridad de los timestamps

---

### 5. `update_flow_channels_updated_at()` → `trigger`

**Propósito:** Función trigger que actualiza automáticamente el campo `updated_at` en la tabla `flow_channels` cuando se modifica un registro.

**Uso actual:** ✅ **SÍ SE ESTÁ USANDO**

**Dónde:** Asociada al trigger `flow_channels_updated_at_trigger` en la tabla `flow_channels`

**Cómo funciona:** Se ejecuta automáticamente antes de cada UPDATE en la tabla `flow_channels`

**Recomendación:**
- ✅ **Mantener** - Esencial para mantener la integridad de los timestamps

---

### 6. `update_knowledge_base_updated_at()` → `trigger`

**Propósito:** Función trigger que actualiza automáticamente el campo `updated_at` en tablas relacionadas con knowledge bases.

**Uso actual:** ✅ **SÍ SE ESTÁ USANDO**

**Dónde:** Asociada a múltiples triggers:
- `knowledge_bases_updated_at_trigger` en `knowledge_bases`
- `knowledge_base_documents_updated_at_trigger` en `knowledge_base_documents`
- `knowledge_base_embeddings_updated_at_trigger` en `knowledge_base_embeddings`
- `flow_knowledge_bases_updated_at_trigger` en `flow_knowledge_bases`

**Cómo funciona:** Se ejecuta automáticamente antes de cada UPDATE en las tablas mencionadas

**Recomendación:**
- ✅ **Mantener** - Esencial para mantener la integridad de los timestamps

---

### 7. `update_updated_at_column()` → `trigger`

**Propósito:** Función trigger genérica que actualiza automáticamente el campo `updated_at` en cualquier tabla.

**Uso actual:** ✅ **SÍ SE ESTÁ USANDO**

**Dónde:** Asociada a múltiples triggers:
- `update_channel_configs_updated_at` en `channel_configs`
- `update_routing_rules_updated_at` en `routing_rules`

**Cómo funciona:** Se ejecuta automáticamente antes de cada UPDATE en las tablas mencionadas

**Recomendación:**
- ✅ **Mantener** - Útil como función genérica reutilizable

---

## 📊 Resumen de Uso

| Función | Tipo | Estado | Uso Actual |
|---------|------|--------|------------|
| `get_flow_channel_ids` | Helper | ⚠️ No usado | ❌ |
| `get_flow_channel_types` | Helper | ⚠️ No usado | ❌ |
| `search_embeddings` | Helper | ⚠️ No usado | ❌ |
| `update_embeddings_updated_at` | Trigger | ✅ Usado | ✅ |
| `update_flow_channels_updated_at` | Trigger | ✅ Usado | ✅ |
| `update_knowledge_base_updated_at` | Trigger | ✅ Usado | ✅ |
| `update_updated_at_column` | Trigger | ✅ Usado | ✅ |

## 💡 Recomendaciones

### Funciones que NO se están usando:

1. **`get_flow_channel_ids` y `get_flow_channel_types`:**
   - ✅ **Mantener** - Son útiles como helpers y pueden simplificar código futuro
   - Considerar usarlas en el Admin Panel para mejorar la legibilidad del código

2. **`search_embeddings`:**
   - ⚠️ **Considerar eliminar o adaptar** - No se usa actualmente
   - Si se elimina, no afecta funcionalidad actual
   - Si se mantiene, podría adaptarse para buscar en `knowledge_base_embeddings`

### Funciones de Triggers:

- ✅ **Todas esenciales** - Mantienen la integridad de los timestamps automáticamente
- No requieren cambios

## 🔧 Posibles Mejoras Futuras

1. **Usar `get_flow_channel_ids` y `get_flow_channel_types` en el Admin Panel:**
   ```typescript
   // En lugar de hacer JOINs complejos:
   const result = await db.query(`
     SELECT get_flow_channel_ids($1) as channel_ids,
            get_flow_channel_types($1) as channel_types
     FROM orchestration_flows
     WHERE id = $1
   `, [flowId]);
   ```

2. **Adaptar `search_embeddings` para knowledge bases:**
   ```sql
   CREATE OR REPLACE FUNCTION search_knowledge_base_embeddings(
     query_embedding vector,
     knowledge_base_id uuid,
     match_threshold double precision DEFAULT 0.7,
     match_count integer DEFAULT 5
   ) RETURNS TABLE(...)
   ```

3. **Crear función para obtener flows con sus canales:**
   ```sql
   CREATE OR REPLACE FUNCTION get_flow_with_channels(flow_id uuid)
   RETURNS TABLE(...)
   -- Retorna flow con array de canales usando las funciones helper
   ```

