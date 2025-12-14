#!/bin/sh
set -e

if [ "$APP_ENV" = "production" ]; then
  TEMPLATE_FILE=/etc/nginx/templates/prod.conf.template
  # In production, NGINX requires the certificate files to exist before starting.
  # Certbot writes them into the shared volume mounted at /etc/letsencrypt.
  until [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; do
    echo "Waiting for SSL certificate for ${DOMAIN}..."
    sleep 5
  done
else
  TEMPLATE_FILE=/etc/nginx/templates/local.conf.template
fi

envsubst '${DOMAIN}' < $TEMPLATE_FILE > /etc/nginx/conf.d/default.conf
echo "NGINX configuration generated for environment: $APP_ENV"

# O bundle do Flutter é montado como read-only; não altere permissões aqui.

exec nginx -g 'daemon off;'
