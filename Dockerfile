FROM php:8.4-fpm as builder

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libzip-dev \
    procps \
    vim-tiny \
    git \
    curl \
    libpng-dev \
    libonig-dev \
    libxml2-dev \
    zip \
    unzip \
    libssl-dev \
    openssl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install PHP extensions
RUN docker-php-ext-install pdo_mysql mbstring exif pcntl bcmath gd \
    && pecl install mongodb \
    && docker-php-ext-enable mongodb

# Get latest Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Final stage
FROM php:8.4-fpm

# Copy installed extensions from builder
COPY --from=builder /usr/local/etc/php/conf.d/ /usr/local/etc/php/conf.d/
COPY --from=builder /usr/local/lib/php/extensions/ /usr/local/lib/php/extensions/
COPY --from=builder /usr/bin/composer /usr/bin/composer

# 1. FIRST install Supervisor and required tools
RUN apt-get update && apt-get install -y \
    supervisor \
    nginx \
    procps \
    vim-tiny \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Create user
ARG user=laravel
ARG uid=1000
RUN useradd -G www-data,root -u ${uid} -d /home/${user} ${user} \
    && mkdir -p /home/${user}/.composer \
    && chown -R ${user}:${user} /home/${user}

# 2. THEN create directories and set permissions
RUN mkdir -p /var/log/supervisor \
    && mkdir -p /var/www/storage/logs/supervisor \
    && chown -R laravel:www-data /var/log/supervisor /var/www/storage/logs \
    && chmod -R 775 /var/log/supervisor /var/www/storage/logs

# 3. Create symlinks for easy access
RUN ln -s /usr/bin/supervisord /usr/local/bin/ \
    && ln -s /usr/bin/supervisorctl /usr/local/bin/

# Security hardening
RUN find / -perm /6000 -type f -exec chmod a-s {} \; || true

WORKDIR /var/www

# PHP-FPM configuration
RUN echo "listen = 0.0.0.0:9000" >> /usr/local/etc/php-fpm.d/zz-docker.conf \
    && echo "clear_env = no" >> /usr/local/etc/php-fpm.d/zz-docker.conf

# Health check (optional)
HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl -f http://localhost/ || exit 1

RUN echo "Verifying permissions:" \
    && ls -ld /var/log/supervisor \
    && ls -ld /var/www/storage/logs \
    && ls -la /var/www/storage/logs/

RUN echo "Checking supervisor:" \
    && apt list --installed | grep supervisor \
    && ls -la /usr/bin/super* \
    && ls -la /etc/supervisor/

USER ${user}