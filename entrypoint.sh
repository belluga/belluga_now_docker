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

# Start services
echo "=== Starting Services ==="
exec "$@"