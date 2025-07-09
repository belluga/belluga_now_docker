#!/bin/sh
set -e

# Define qual template usar com base na variável de ambiente
if [ "$APP_ENV" = "production" ]; then
  TEMPLATE_FILE=/etc/nginx/templates/prod.conf.template
  # Se for produção, espera pelo certificado SSL
  until [ -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ]; do
    echo "Aguardando o certificado SSL para ${DOMAIN}..."
    sleep 5
  done
else
  # Para 'local' ou 'staging', usa o template simples sem SSL
  TEMPLATE_FILE=/etc/nginx/templates/local.conf.template
fi

# Gera a configuração final do NGINX a partir do template escolhido
envsubst '${DOMAIN}' < $TEMPLATE_FILE > /etc/nginx/conf.d/default.conf

echo "Configuração do NGINX gerada para o ambiente: $APP_ENV"

# Inicia o NGINX
exec nginx -g 'daemon off;'