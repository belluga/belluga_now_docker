# Começa com a imagem base do NGINX
FROM nginx:stable-alpine

# Instala o gettext, que contém a ferramenta 'envsubst'
RUN apk update && apk add gettext

# Copia o template de configuração e o script de entrypoint para a imagem
COPY ./prod.conf.template /etc/nginx/templates/
COPY ./local.conf.template /etc/nginx/templates/
COPY ./entrypoint.sh /

# Dá permissão de execução ao script de entrypoint
RUN chmod +x /entrypoint.sh

# O contêiner irá executar este script quando iniciar
ENTRYPOINT ["/entrypoint.sh"]