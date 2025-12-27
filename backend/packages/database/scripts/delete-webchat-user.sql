-- =====================================================
-- Script para eliminar un usuario de WebChat
-- =====================================================
-- Uso: Reemplaza :channel_user_id con el ID del usuario de webchat
-- 
-- Ejemplo con psql:
--   psql -v channel_user_id="'user_2059755430_1765732414001'" -f delete-webchat-user.sql
--
-- O ejecuta directamente reemplazando el valor:

-- Primero, ver qué se va a borrar
SELECT 'Usuario a borrar:' as info;
SELECT id, channel, channel_user_id, started_at, last_activity, status
FROM conversations 
WHERE channel = 'webchat' AND channel_user_id = :channel_user_id;

SELECT 'Mensajes a borrar:' as info, COUNT(*) as total 
FROM messages 
WHERE conversation_id IN (
  SELECT id FROM conversations WHERE channel = 'webchat' AND channel_user_id = :channel_user_id
);

SELECT 'Tool executions a borrar:' as info, COUNT(*) as total 
FROM tool_executions 
WHERE message_id IN (
  SELECT id FROM messages 
  WHERE conversation_id IN (
    SELECT id FROM conversations WHERE channel = 'webchat' AND channel_user_id = :channel_user_id
  )
);

-- Borrar en orden (respetando foreign keys)
DELETE FROM tool_executions 
WHERE message_id IN (
  SELECT id FROM messages 
  WHERE conversation_id IN (
    SELECT id FROM conversations WHERE channel = 'webchat' AND channel_user_id = :channel_user_id
  )
);

DELETE FROM messages 
WHERE conversation_id IN (
  SELECT id FROM conversations WHERE channel = 'webchat' AND channel_user_id = :channel_user_id
);

DELETE FROM conversations 
WHERE channel = 'webchat' AND channel_user_id = :channel_user_id;

SELECT 'Usuario eliminado exitosamente' as resultado;

-- NOTA: Si también quieres limpiar el contexto de Redis, necesitarás hacerlo manualmente
-- o reiniciar Redis. El contexto se guarda con la clave: cortex:context:webchat:{channel_user_id}
