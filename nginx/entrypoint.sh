#!/bin/sh

# Espera o Certbot gerar o certificado pela primeira vez
until [ -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ]; do
  echo "Aguardando o certificado SSL para ${DOMAIN}..."
  sleep 5
done

# Substitui a variável de domínio no template e cria o arquivo de configuração final
envsubst '${DOMAIN}' < /etc/nginx/templates/app.conf.template > /etc/nginx/conf.d/default.conf

echo "Configuração do NGINX gerada para ${DOMAIN}"

# Inicia o NGINX em "foreground"
exec nginx -g 'daemon off;'