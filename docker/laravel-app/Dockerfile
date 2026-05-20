FROM php:8.4.10-fpm AS runtime-deps

ARG MONGODB_PECL_VERSION=2.3.2
ARG MONGODB_PECL_SHA256=df01e7c41166fd068558977e390623061b3ef626e056b0fb4edb4d816021569c

# Install system dependencies and PHP extensions
RUN apt-get update && apt-get install -y \
        zip unzip curl git \
        libpng-dev \
        libjpeg62-turbo-dev \
        libfreetype6-dev \
        libonig-dev libzip-dev libssl-dev libzstd-dev gosu \
        libfcgi-bin \
        && mkdir -p /tmp/mongodb-src \
        && curl -fsSL "https://pecl.php.net/get/mongodb-${MONGODB_PECL_VERSION}.tgz" -o /tmp/mongodb.tgz \
        && echo "${MONGODB_PECL_SHA256}  /tmp/mongodb.tgz" | sha256sum -c - \
        && tar -xzf /tmp/mongodb.tgz -C /tmp/mongodb-src --strip-components=1 \
        && sed -i 's/^#define BSON_HAVE_STRLCPY 1$/#define BSON_HAVE_STRLCPY 0/' /tmp/mongodb-src/src/libmongoc/src/libbson/src/bson/config.h \
        && cd /tmp/mongodb-src \
        && phpize \
        && ./configure \
        && make -j"$(nproc)" \
        && make install \
        && echo 'extension=mongodb.so' > /usr/local/etc/php/conf.d/docker-php-ext-mongodb.ini \
        && php --ri mongodb >/dev/null \
        && docker-php-ext-configure gd --with-freetype --with-jpeg \
        && docker-php-ext-install gd pdo pdo_mysql mbstring zip \
        && rm -rf /tmp/mongodb-src /tmp/mongodb.tgz

FROM runtime-deps AS builder

RUN groupmod -o -g 1000 www-data && usermod -o -u 1000 -g www-data www-data

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www

COPY ./laravel-app /var/www
COPY docker/laravel-app/uploads.ini /usr/local/etc/php/conf.d/uploads.ini

RUN mkdir -p /var/www/bootstrap/cache && \
    chown -R www-data:www-data /var/www/bootstrap/cache && \
    chmod -R 775 /var/www/bootstrap/cache

COPY docker/laravel-app/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["entrypoint.sh"]
CMD ["php-fpm"]
