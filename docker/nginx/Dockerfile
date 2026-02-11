# Começa com a imagem base do NGINX
FROM nginx:stable-alpine

# Instala o gettext (envsubst) e o OpenSSL para gerar certificado local.
RUN apk update && apk add --no-cache gettext openssl

# Certificado self-signed para servir HTTPS no origin quando APP_ENV != production.
# Isso evita handshake failures (Cloudflare 521) em cenários com SSL mode "Full".
RUN mkdir -p /etc/nginx/certs/local \
    && openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
      -keyout /etc/nginx/certs/local/privkey.pem \
      -out /etc/nginx/certs/local/fullchain.pem

# Copia o template de configuração e o script de entrypoint para a imagem
COPY ./prod.conf.template /etc/nginx/templates/
COPY ./local.conf.template /etc/nginx/templates/
COPY ./entrypoint.sh /

# Dá permissão de execução ao script de entrypoint
RUN chmod +x /entrypoint.sh

# O contêiner irá executar este script quando iniciar
ENTRYPOINT ["/entrypoint.sh"]
