#!/bin/bash
set -e

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

if [ ! -f "vendor/autoload.php" ]; then
    echo ">>> Installing Laravel dependencies..."
    gosu www-data composer install --no-interaction --prefer-dist --optimize-autoloader
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
if [ "$APP_ENV" = "production" ]; then
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
