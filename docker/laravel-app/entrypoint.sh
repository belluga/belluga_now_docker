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
runtime_command="${1:-}"
is_primary_runtime=false
if [ "$runtime_command" = "php-fpm" ]; then
    is_primary_runtime=true
fi

wait_for_bootstrap_dependencies() {
    local timeout_seconds=${BOOTSTRAP_WAIT_SECONDS:-300}
    local waited=0

    echo ">>> Waiting for Laravel bootstrap artifacts from app service..."
    while [ "$waited" -lt "$timeout_seconds" ]; do
        if [ -f "/var/www/vendor/autoload.php" ] && composer_autoload_is_valid; then
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
    done

    echo "ERROR: timeout while waiting for bootstrap artifacts (vendor/autoload.php)." >&2
    return 1
}

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

composer_autoload_can_resolve_class() {
    local class_name="$1"
    gosu www-data php -r "require '/var/www/vendor/autoload.php'; exit((class_exists('${class_name}') || interface_exists('${class_name}') || trait_exists('${class_name}')) ? 0 : 1);" >/dev/null 2>&1
}

composer_manifest_hash_file="/var/www/vendor/.composer-manifest-sha1"

composer_manifest_hash() {
    if [ ! -f "/var/www/composer.json" ]; then
        return 1
    fi

    if [ -f "/var/www/composer.lock" ]; then
        sha1sum /var/www/composer.json /var/www/composer.lock | sha1sum | awk '{print $1}'
        return 0
    fi

    sha1sum /var/www/composer.json | awk '{print $1}'
}

composer_manifest_hash_changed() {
    local current_hash recorded_hash
    if ! current_hash="$(composer_manifest_hash)"; then
        return 1
    fi

    if [ ! -f "$composer_manifest_hash_file" ]; then
        return 0
    fi

    recorded_hash="$(cat "$composer_manifest_hash_file" 2>/dev/null || true)"
    [ "$current_hash" != "$recorded_hash" ]
}

record_composer_manifest_hash() {
    local current_hash
    if ! current_hash="$(composer_manifest_hash)"; then
        return 0
    fi

    gosu www-data sh -lc "printf '%s' '$current_hash' > '$composer_manifest_hash_file'"
}

refresh_composer_autoload() {
    echo ">>> Refreshing Composer autoload metadata..."
    COMPOSER_MEMORY_LIMIT=-1 gosu www-data composer dump-autoload --no-interaction --optimize --no-progress >/dev/null
}

ensure_runtime_class_resolvable() {
    local class_name="$1"
    if composer_autoload_can_resolve_class "$class_name"; then
        return 0
    fi

    echo "WARN: required runtime class '$class_name' is not resolvable from current autoload."
    refresh_composer_autoload || true

    if composer_autoload_can_resolve_class "$class_name"; then
        return 0
    fi

    echo "WARN: class '$class_name' still unresolved after autoload refresh; reinstalling dependencies."
    composer_install_with_retry
    record_composer_manifest_hash

    if composer_autoload_can_resolve_class "$class_name"; then
        return 0
    fi

    echo "ERROR: class '$class_name' remains unresolved after Composer recovery." >&2
    return 1
}

ensure_composer_bootstrap_state() {
    if [ ! -f "vendor/autoload.php" ] || ! composer_autoload_is_valid || composer_manifest_hash_changed; then
        composer_install_with_retry
        record_composer_manifest_hash
    fi
}

if [ "$is_primary_runtime" = true ]; then
    ensure_composer_bootstrap_state

    # Guardrail: ensure critical runtime classes are resolvable before artisan cache operations.
    # This prevents bootstrap crashes caused by stale autoload metadata after deploy updates.
    required_runtime_classes=(
        "Belluga\\Events\\Jobs\\PublishScheduledEventsJob"
        "Belluga\\Invites\\Http\\Api\\v1\\Controllers\\InviteFeedController"
        "App\\Providers\\PackageIntegration\\InvitesIntegrationServiceProvider"
        "Belluga\\Favorites\\Contracts\\FavoritesRegistryContract"
        "App\\Providers\\PackageIntegration\\FavoritesIntegrationServiceProvider"
    )

    for required_runtime_class in "${required_runtime_classes[@]}"; do
        ensure_runtime_class_resolvable "$required_runtime_class"
    done

    if [ ! -f ".env" ]; then
        gosu www-data cp .env.example .env
        gosu www-data php artisan key:generate
    fi

    if [ ! -L "public/storage" ]; then
        echo ">>> Creating storage symlink..."
        gosu www-data php artisan storage:link
    fi

    # Always clear stale bootstrap artifacts before re-caching.
    gosu www-data php artisan optimize:clear

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
else
    wait_for_bootstrap_dependencies
    ensure_composer_bootstrap_state

    # Non-primary runtimes (worker/scheduler) may start independently from an already-running app
    # after a branch switch or deploy update. Clear stale bootstrap artifacts best-effort.
    if [ -f ".env" ]; then
        gosu www-data php artisan optimize:clear >/dev/null 2>&1 || true
    fi
fi

# Execute the main command (php-fpm).
exec "$@"
