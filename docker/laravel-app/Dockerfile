FROM php:8.4.10-fpm AS builder

# Install system dependencies and PHP extensions
RUN apt-get update && apt-get install -y \
        zip unzip curl git \
        libpng-dev \
        libjpeg62-turbo-dev \
        libfreetype6-dev \
        libonig-dev libzip-dev libssl-dev gosu \
        libfcgi-bin \
        && docker-php-ext-configure gd --with-freetype --with-jpeg \
        && docker-php-ext-install gd pdo pdo_mysql mbstring zip \
        && pecl install mongodb \
        && docker-php-ext-enable mongodb

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
