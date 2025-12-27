#!/bin/bash

# Script para eliminar un usuario de WebChat
# Uso: ./delete-webchat-user.sh <channel_user_id>
# Ejemplo: ./delete-webchat-user.sh user_2059755430_1765732414001

if [ -z "$1" ]; then
  echo "Error: Debes proporcionar el channel_user_id del usuario"
  echo "Uso: $0 <channel_user_id>"
  echo "Ejemplo: $0 user_2059755430_1765732414001"
  exit 1
fi

CHANNEL_USER_ID="$1"

# Cargar variables de entorno si existe .env
if [ -f "../../.env" ]; then
  export $(cat ../../.env | grep -v '^#' | xargs)
fi

# Usar variables de entorno o valores por defecto
DB_HOST="${DB_HOST:-stg-cortexstorage-stg-001.postgres.database.azure.com}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-cortexagenthub}"
DB_PASSWORD="${DB_PASSWORD:-Pmafaraf2025}"

echo "Eliminando usuario de WebChat: $CHANNEL_USER_ID"
echo "Conectando a: $DB_HOST"

PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" <<EOF
-- Eliminar usuario de WebChat
DO \$\$
DECLARE
  conv_ids UUID[];
  deleted_convs INT;
BEGIN
  -- Obtener IDs de conversaciones
  SELECT ARRAY_AGG(id) INTO conv_ids
  FROM conversations 
  WHERE channel = 'webchat' AND channel_user_id = '$CHANNEL_USER_ID';
  
  IF conv_ids IS NULL THEN
    RAISE NOTICE 'No se encontraron conversaciones para el usuario: %', '$CHANNEL_USER_ID';
    RETURN;
  END IF;
  
  -- Borrar tool executions
  DELETE FROM tool_executions 
  WHERE message_id IN (
    SELECT id FROM messages WHERE conversation_id = ANY(conv_ids)
  );
  
  -- Borrar mensajes
  DELETE FROM messages 
  WHERE conversation_id = ANY(conv_ids);
  
  -- Borrar conversaciones
  DELETE FROM conversations 
  WHERE channel = 'webchat' AND channel_user_id = '$CHANNEL_USER_ID';
  
  deleted_convs := array_length(conv_ids, 1);
  RAISE NOTICE 'Usuario eliminado exitosamente. Conversaciones eliminadas: %', deleted_convs;
END \$\$;
EOF

echo ""
echo "✅ Usuario eliminado de la base de datos"
echo ""
echo "⚠️  NOTA: Si el contexto está en Redis, también necesitas limpiarlo:"
echo "   La clave en Redis es: cortex:context:webchat:$CHANNEL_USER_ID"
echo "   Puedes eliminarla con: redis-cli DEL cortex:context:webchat:$CHANNEL_USER_ID"
echo "   O simplemente esperar a que expire (TTL por defecto: 3600 segundos)"
