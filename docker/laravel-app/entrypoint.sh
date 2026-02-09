#!/bin/bash
set -euo pipefail

# Set user and group ID to match the host user
USER_ID=${LOCAL_UID:-1000}
GROUP_ID=${LOCAL_GID:-1000}
groupmod -g $GROUP_ID www-data
usermod -u $USER_ID -g $GROUP_ID www-data

# THE FIX:
# Explicitly set ownership on BOTH the code and the storage volume.
chown -R www-data:www-data /var/www

# Ensure bootstrap cache exists for artisan/package discovery.
mkdir -p /var/www/bootstrap/cache
chown -R www-data:www-data /var/www/bootstrap/cache

# Make sure the storage volume exists before artisan tries to touch it.
mkdir -p /var/www/storage/app/public \
         /var/www/storage/framework/cache \
         /var/www/storage/framework/sessions \
         /var/www/storage/framework/testing \
         /var/www/storage/framework/views \
         /var/www/storage/logs
touch /var/www/storage/logs/laravel.log
chown -R www-data:www-data /var/www/storage

# --- The rest of your setup logic ---

composer_install_with_retry() {
    local max_attempts=5
    local attempt=1

    while [ "$attempt" -le "$max_attempts" ]; do
        echo ">>> Installing Laravel dependencies (attempt ${attempt}/${max_attempts})..."
        rm -rf /var/www/vendor
        rm -rf /var/www/vendor/composer 2>/dev/null || true

        if COMPOSER_MEMORY_LIMIT=-1 gosu www-data composer install --no-interaction --prefer-dist --optimize-autoloader --no-progress; then
            return 0
        fi

        if [ "$attempt" -eq "$max_attempts" ]; then
            echo "ERROR: composer install failed after ${max_attempts} attempts." >&2
            return 1
        fi

        local backoff=$((attempt * 5))
        echo "WARN: composer install failed, retrying in ${backoff}s..."
        sleep "$backoff"
        attempt=$((attempt + 1))
    done
}

composer_autoload_is_valid() {
    gosu www-data php -r "require '/var/www/vendor/autoload.php';" >/dev/null 2>&1
}

if [ ! -f "vendor/autoload.php" ] || ! composer_autoload_is_valid; then
    composer_install_with_retry
fi

if [ ! -f ".env" ]; then
    gosu www-data cp .env.example .env
    gosu www-data php artisan key:generate
fi

if [ ! -L "public/storage" ]; then
    echo ">>> Creating storage symlink..."
    gosu www-data php artisan storage:link
fi

# Only run caches in production.
app_env="${APP_ENV:-local}"
if [ "$app_env" = "production" ]; then
    echo ">>> Caching configuration for production..."
    gosu www-data php artisan config:cache
    gosu www-data php artisan route:cache
    gosu www-data php artisan view:cache
else
    echo ">>> Clearing caches for development/testing..."
    gosu www-data php artisan config:clear
    gosu www-data php artisan route:clear
    gosu www-data php artisan view:clear
fi

# Execute the main command (php-fpm).
exec "$@"
