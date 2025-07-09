FROM php:8.4-fpm as builder

RUN apt-get update && apt-get install -y \
    zip unzip curl git libonig-dev libzip-dev \
    && docker-php-ext-install pdo pdo_mysql mbstring zip \
    && pecl install mongodb \
    && docker-php-ext-enable mongodb

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

RUN composer install --no-interaction --prefer-dist --optimize-autoloader \
    && cp .env.example .env || true \
    && php artisan key:generate || true

COPY docker/laravel-app/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /var/www
ENTRYPOINT ["entrypoint.sh"]
CMD ["php-fpm"]
