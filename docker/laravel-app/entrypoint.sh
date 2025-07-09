#!/bin/bash
set -x  # Enable debug output

# Create required directories
mkdir -p /var/www/storage/logs/supervisor
chown -R laravel:www-data /var/www/storage/logs
chmod -R 775 /var/www/storage/logs

# Verify environment
echo "=== Environment Verification ==="
whoami
id
pwd
ls -la /var/www/storage/logs/

# Se não existir o arquivo vendor/autoload.php, rode o composer install
if [ ! -f vendor/autoload.php ]; then
    echo ">>> Instalando dependências do Laravel..."
    composer install --no-interaction --prefer-dist --optimize-autoloader
    if [ ! -f .env ]; then
        cp .env.example .env
        php artisan key:generate
    fi
    php artisan config:cache
fi

chown -R www-data:www-data /var/www
chmod -R 755 storage bootstrap/cache

# Start services
echo "=== Starting Services ==="
exec "$@"