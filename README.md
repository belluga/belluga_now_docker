#  Boilerplate Flutter & Laravel com Docker

![Laravel](https://img.shields.io/badge/Laravel-FF2D20?style=for-the-badge&logo=laravel&logoColor=white)
![Flutter](https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Nginx](https://img.shields.io/badge/NGINX-009639?style=for-the-badge&logo=nginx&logoColor=white)

Um ambiente de desenvolvimento, staging e produção completo para aplicações com **Laravel** no backend e **Flutter** no frontend. O projeto é totalmente containerizado com **Docker** e utiliza **NGINX** como reverse proxy.

## ✨ Features

* **Ambiente Unificado**: Backend e frontend gerenciados em um único projeto com Git Submodules.
* **Containerizado**: Esqueça a necessidade de instalar PHP, Composer ou Flutter SDK na sua máquina. O Docker cuida de tudo.
* **Perfis de Ambiente**: Use o mesmo stack para desenvolvimento local e produção com Perfis do Docker Compose.
    * **Local Dev**: execução local completa sem túnel.
    * **Production**: geração e renovação automática de certificados SSL/TLS com Certbot (Let's Encrypt).
* **Consistência de Código**: O arquivo `.gitattributes` garante que as terminações de linha sejam consistentes em qualquer sistema operacional, evitando erros no Docker.

***

## ⚙️ Pré-requisitos

Antes de começar, garanta que você tenha o seguinte software instalado:

* [Git](https://git-scm.com/)
* [Docker](https://www.docker.com/products/docker-desktop/)
* [Docker Compose](https://docs.docker.com/compose/install/)

> ⚠️ Você **não precisa** ter PHP, Composer ou o SDK do Flutter instalados em sua máquina local.

***

## 🚀 Setup Inicial

Siga estes passos cuidadosamente para configurar seu projeto pela primeira vez.  
> **Importante:** Antes do passo 1, siga as instruções publicadas no repositório `delphi-ai` (documentação de onboarding) para trazer o Delphi e criar os symlinks necessários (`AGENTS.md`, `foundation_documentation/`, etc.). Execute o script diretamente a partir de lá (`./delphi-ai/scripts/setup_delphi.sh`).

## Submodule Workspace Rules (Pin vs Track)

**CI/deploy always uses the superproject pins** (the gitlink SHAs stored in this repo). Your local submodule checkout can drift if you `git pull` inside a submodule, so follow one of these modes:

* **Pinned (recommended before deploy/debug/CI parity)**: submodules are checked out to the exact SHAs recorded by `belluga_now_docker`.
* **Lane tracking (convenience)**: submodules are switched to lane branches (`dev`/`stage`/`main`) for browsing/work. This does *not* change what CI/deploy uses until you update the pins via PR in this repo.

Safe scripts (non-destructive; refuse to run if any submodule is dirty):

* `tools/submodules/status.sh`
* `tools/submodules/pin_to_superproject.sh`
* `tools/submodules/track_lanes.sh <dev|stage|main>`

### Passo 1: Fork e Clone

1.  **Fork** este repositório para a sua conta do GitHub.
2.  **Clone o seu fork** para a sua máquina local. Use o comando `--recursive` para clonar também os submódulos (`laravel-app` e `flutter-app`).

    ```bash
    git clone --recursive <URL_DO_SEU_FORK>
    cd <nome-do-repositorio>
    ```

### Passo 2: Crie Seus Novos Repositórios

Os submódulos neste boilerplate ainda apontam para os repositórios originais. Você precisa criar **dois novos repositórios vazios** na sua conta do GitHub:

* Um para o seu backend **Laravel**.
* Um para o seu frontend **Flutter**.

### Passo 3: Atualize os Submódulos

Agora, aponte os submódulos para os seus novos repositórios.

1.  **Atualize a URL do backend Laravel:**
    ```bash
    # Substitua pela URL do seu novo repositório backend.
    git submodule set-url -- laravel-app <URL_DO_SEU_NOVO_REPO_LARAVEL>
    ```

2.  **Atualize a URL do frontend Flutter:**
    ```bash
    # Substitua pela URL do seu novo repositório frontend.
    git submodule set-url -- flutter-app <URL_DO_SEU_NOVO_REPO_FLUTTER>
    ```

3.  **Sincronize as alterações:**
    ```bash
    git submodule sync --recursive
    git submodule update --init --recursive
    ```

### Passo 4: Configure o Arquivo de Ambiente

1.  Copie o arquivo de exemplo `.env.example` para um novo arquivo chamado `.env`.
    ```bash
    cp .env.example .env
    ```
2.  **Edite o arquivo `.env`** com as configurações básicas do projeto, como `PROJECT_NAME`. As variáveis específicas de cada ambiente serão preenchidas a seguir.

### Passo 5: Envie o Código Inicial

Finalmente, envie as alterações de configuração e o código inicial para seus novos repositórios.

1.  **Commit das alterações no repositório principal:**
    ```bash
    git add .
    git commit -m "chore: aponta submódulos e configura o projeto"
    git push
    ```

2.  **Envie o código para os repositórios dos submódulos:**
    ```bash
    # Envia o backend
    cd laravel-app && git push -u origin --all && cd ..

    # Envia o frontend
    cd flutter-app && git push -u origin --all && cd ..
    ```

***

## 🐳 Executando com Docker

### Comandos Padronizados por Lane

Para evitar variação entre máquinas da equipe, use os alvos do `Makefile`:

```bash
make up-dev
make up-stage
make up-main
make down
make ps
```

Regras:
- `up-dev`: sobe com `COMPOSE_PROFILES=local-db` (inclui Mongo local do projeto).
- `up-stage`: sobe sem profile extra (sem Mongo local do projeto).
- `up-main`: sobe com `COMPOSE_PROFILES=production`.

Para rodar a suíte completa do Laravel no ambiente local:

```bash
make test-laravel-full
```

### Optional: Local MongoDB (Replica Set) for Dev

Default setup assumes Atlas (configure it in `laravel-app/.env`). For offline/reproducible development you can run a local Mongo replica set:

```bash
COMPOSE_PROFILES=local-db docker compose up -d
```

Then point Laravel to the local Mongo in `laravel-app/.env` (do not commit). Typical values include `mongo:27017` and `replicaSet=rs0`.

Quick sanity checks:

```bash
./scripts/verify_environment.sh
docker compose --profile local-db ps
```

### Local Dev (Recommended)

Use this flow when you want full local development (Docker + Flutter). Tunnel is optional.

1. Start the local stack:

```bash
COMPOSE_PROFILES=local-db docker compose up -d --build
```

If you are using Atlas instead of local Mongo:

```bash
COMPOSE_PROFILES= docker compose up -d --build
```

2. Validate local backend/NGINX is reachable:

```bash
curl -I http://localhost:8081/api/v1/environment
```

3. Run Flutter (mobile/desktop) against local backend.

The Flutter app now uses compile-time lane define files (`--dart-define-from-file`).
Local runs default to the `dev` lane plus an optional local override file.

Create your local override file once:

```bash
cd flutter-app
cp config/defines/local.override.example.json config/defines/local.override.json
```

Edit `config/defines/local.override.json` for your machine (for Android emulator, `10.0.2.2:8081` is typical).

```bash
cd flutter-app
./tool/with_lane_defines.sh dev run --flavor <your_flavor>
```

If you prefer direct command usage (without helper script):

```bash
fvm flutter run --flavor <your_flavor> \
  --dart-define-from-file=config/defines/dev.json \
  --dart-define-from-file=config/defines/local.override.json
```

4. Web local access (served by Laravel/NGINX bundle):

- Open `http://localhost:8081` in your browser.

Notes:
- This flow does not require tunneling.
- Flutter local bootstrap does not use `.env`; it is controlled by compile-time define files.
- Lane files live in `flutter-app/config/defines/{dev,stage,main}.json`.
- `flutter-app/config/defines/local.override.json` is gitignored and machine-specific.

### Optional: Local Cloudflare Tunnel (Local Only)

Use this only if you need a public HTTPS URL for your **local** stack.

1. Create your local tunnel secrets file (not tracked by git):

```bash
cp .env.local.tunnel.example .env.local.tunnel
```

2. Edit `.env.local.tunnel` and set your personal `CLOUDFLARE_TUNNEL_TOKEN`.

3. Start local stack with tunnel profile:

```bash
make up-dev-tunnel
```

Equivalent raw command:

```bash
COMPOSE_PROFILES=local-db,local-tunnel \
docker compose --env-file .env --env-file .env.local.tunnel up -d --build
```

4. Check tunnel logs:

```bash
docker compose logs -f cloudflared
```

Notes:
- This is local-only and does not change stage/main deployment flow.
- Keep `.env.local.tunnel` untracked (already gitignored).
- If token is invalid or missing, only `cloudflared` fails; core local stack remains unchanged.

### Principal-Checkout Reconcile Validation

When Delphi orchestrates parallel work through worker worktrees, the authoritative
local validation surface is **not** a hidden reconcile worktree. The orchestrator
must move the principal checkout(s) onto dedicated `reconcile/*` branches and run
the final validation there so the local environment, Docker bind mounts, and any
browser/tunnel checks all hit the same integrated code.

Use the root wrapper for authoritative local reconcile validation:

```bash
./scripts/delphi/run_reconcile_validation.sh \
  --intent "store-release reconcile validation" \
  --laravel-test tests/Api/v1/Admin/ApiV1BrandingAdminTest.php \
  --laravel-test tests/Api/v1/Tenants/Branding/ApiV1EnvironmentApiTest.php \
  --flutter-test test/infrastructure/dal/dto/app_data_dto_test.dart \
  --flutter-analyze
```

Rules:
- The wrapper only accepts principal checkouts already moved onto `reconcile/*` branches.
- Worker/subagent worktrees remain isolated implementation lanes and are not authoritative delivery evidence.
- Laravel targeted files run **sequentially** through `laravel-app/scripts/delphi/run_laravel_tests_safe.sh` to avoid grouped Mongo drop-race noise during reconcile validation.
- The wrapper normalizes Laravel runtime-writable directories before and after Laravel validation, including `storage/app/public`, so public navigation and browser-side media rendering do not stay broken by permission drift after test execution.
- Flutter validation runs from the principal Flutter checkout on the reconcile branch (`fvm flutter test ...`, `fvm dart analyze --format machine`).
- The wrapper emits a deterministic orchestration status report under `foundation_documentation/artifacts/tmp/`.

If real browser validation is required:
- keep the principal checkout on the reconcile branch,
- start the local tunnel profile with `make up-dev-tunnel`,
- point Playwright/browser automation at the tunnel-exposed local domain so navigation evidence reflects the same integrated reconcile state,
- derive the required browser/device journeys from the touched TODO set instead of guessing a generic smoke target on each run.

O ambiente é controlado pela variável `COMPOSE_PROFILES` no seu arquivo `.env`.

### Ambiente de Stage (Hospedado)

O stage é hospedado em infraestrutura remota (sem túnel local).  
Use este repositório para empacotar e executar o stack no servidor de stage com domínio próprio.

Sugestão de perfil para servidor de stage:

```bash
COMPOSE_PROFILES=production docker compose up -d --build
```

### Ambiente de Produção

Para implantar em um servidor com um domínio real.

1.  No arquivo `.env`, defina `COMPOSE_PROFILES=production`.
2.  Preencha as variáveis `DOMAIN` e `CERTBOT_EMAIL` com os dados do seu domínio de produção.
3.  Aponte o DNS do seu domínio para o IP do servidor.
4.  Suba os contêineres:
    ```bash
    docker compose up -d --build
    ```

***

## 🛠️ Comandos Úteis de Desenvolvimento

Execute todos os comandos de desenvolvimento através do `docker compose exec`.

* **Executar comandos Artisan (Laravel):**
    ```bash
    docker compose exec app php artisan <seu-comando>
    ```

* **Subir o worker de filas (queue):**
    ```bash
    docker compose up -d worker
    ```

* **Ver logs do worker de filas:**
    ```bash
    docker compose logs -f worker
    ```

* **Subir o scheduler (cron do Laravel):**
    ```bash
    docker compose up -d scheduler
    ```

* **Ver logs do scheduler:**
    ```bash
    docker compose logs -f scheduler
    ```

* **Executar o Composer:**
    ```bash
    docker compose exec app composer install
    ```

* **Rodar migrações (Spatie Multitenancy — landlord + tenant):**
    ```bash
    # Landlord (central) migrations
    docker compose exec app php artisan migrate --database=landlord --path=database/migrations/landlord

    # Tenant migrations (all tenants)
    docker compose exec app php artisan tenants:artisan "migrate --database=tenant --path=database/migrations/tenants"
    ```

    > Use `migrate:fresh` apenas em ambientes locais descartáveis.

* **Acessar o shell de um contêiner:**
    ```bash
    docker compose exec app sh
    ```

* **Verificar logs em tempo real:**
    ```bash
    docker compose logs -f <nome-do-servico>
    ```

> ⚠️ **Permissões de arquivos (`.env`, etc.)**  
> Sempre edite os arquivos do repositório (principalmente `.env` e submódulos) a partir do seu usuário host/WSL. Evite alterar esses arquivos dentro dos contêineres ou como `root`, porque isso muda a propriedade (UID 0/1000) e impede que o editor host salve atualizações.

***

## 📦 Publicando Releases do Flutter

O Docker **não** executa o build do Flutter automaticamente. O NGINX serve apenas os arquivos estáticos colocados em `releases/flutter/current`. Isso garante que apenas bundles oficialmente publicados fiquem disponíveis.

1. Gere o bundle localmente (ou em CI) com o script auxiliar:
   ```bash
   ./tools/flutter/build_web_bundle.sh       # saída padrão: ./web-app
   ```
2. O script grava os artefatos na pasta `web-app/`, removendo `favicon.ico`, `manifest.json` e `icons/` (esses assets são servidos pelo backend) e protegendo apenas a governança básica do submódulo (`.github/`, `.gitignore`). Revise o diff do submódulo:
   ```bash
   git status web-app
   ```
   Contrato operacional: `/manifest.json`, `/favicon.ico`, `/icon/*`, `/logo-light.png`, `/logo-dark.png`, `/icon-light.png` e `/icon-dark.png` são rotas tenant-aware backend-owned. O ingress não deve consultar arquivo local antes de encaminhar essas URLs ao Laravel.
   Os testes de navegação web **não** são mais autorados dentro de `web-app/`: a fonte da verdade fica em `tools/flutter/web_app_tests/` e a execução deve ocorrer via:
   ```bash
   # Local (Docker/NGINX): ajuste URLs para suas origens browser-facing.
   NAV_LANDLORD_URL="http://belluga.space" \
   NAV_TENANT_URL="http://guarappari.belluga.space" \
   bash tools/flutter/run_web_navigation_smoke.sh readonly

   # Local/dev/stage/main (URLs injetadas pelo workflow fora do ambiente local):
   bash tools/flutter/run_web_navigation_smoke.sh readonly
   bash tools/flutter/run_web_navigation_smoke.sh mutation
   ```
   > Política canônica: `mutation` pode rodar em `local|dev|stage`, mas é sempre bloqueada em `main`.
   Em ambiente local, o build do Flutter deve usar a origem browser-facing real do fluxo que será validado. Exemplo: se o navegador abre `https://belluga.space` / `https://guarappari.belluga.space` via Cloudflared, use `LANDLORD_DOMAIN=https://belluga.space` (sem porta interna). Só use `host:porta` quando essa for a origem efetivamente aberta no navegador. Não vaze `:8043` para fluxos públicos baseados em domínio.
3. Quando estiver satisfeito, faça commit/push dentro do submódulo e depois atualize o repositório principal:
   ```bash
   cd web-app
   git add .
   git commit -m "release: <versao>"
   git push origin main
   cd ..
   git add web-app
   git commit -m "chore: atualiza submodulo web"
   ```
4. Reinicie o NGINX (ou execute a pipeline de deploy) para servir o novo bundle:
   ```bash
   docker compose restart nginx
   ```

> **Importante:** Como o bundle fica em um repositório dedicado, você pode manter branches/PRs específicos para revisão do conteúdo estático e promover apenas versões estáveis para `main`.
> **Nota sobre Flutter/FVM:** O time utiliza [FVM](https://fvm.app/) para garantir consistência de versão. Sempre execute comandos locais via `fvm flutter ...` (ou configure o VS Code para apontar para o binário do FVM). Caso prefira o modo Docker, basta invocar o script com `docker run --rm -u "$(id -u)":"$(id -g)" -v "$PWD":/workspace -w /workspace ghcr.io/cirruslabs/flutter:3.35.7 ...` para preservar permissões.

## 🔐 Governança de Branches (GitHub)

Para manter promoção de ambientes com bloqueio real de push direto, use **Branch Protection/Rulesets** + **checks de CI**.

Política de promoção:

* `dev -> stage` (somente PR)
* `stage -> main` (somente PR)
* Push direto em `stage/main` deve ficar bloqueado via proteção de branch.

No CI do repositório de orquestração (`.github/workflows/orchestration-ci-cd.yml`):

* O job `Lane Promotion Policy` falha se o PR violar o fluxo acima.
* O job `Preflight Validation` valida os commits promovidos para `dev`, `stage` e `main`.
* O bloqueio real de push direto em `stage/main` é feito por Branch Protection/Rulesets.

Checklist recomendado em **Settings > Branches** para `stage` e `main`:

* `Require a pull request before merging`.
* `Require status checks to pass before merging`.
* Adicionar checks obrigatórios:
  * `Lane Promotion Policy`
  * `Preflight Validation`
* `Require conversation resolution before merging`.
* `Do not allow bypassing the above settings` (se disponível no seu plano/repo).

Observação:

* Em plano pago, configure `stage` e `main` com PR obrigatório e checks obrigatórios para bloquear push direto na origem.

## 🚢 Deploy de Stage e Produção (Fase 2)

O workflow `Orchestration CI/CD` executa deploy automático:

* `stage` quando há push na branch `stage`.
* `main` quando há push na branch `main`.

Em ambos os casos, o `Preflight Validation` precisa passar antes do deploy.

Pré-requisitos no repositório GitHub (`Settings > Secrets and variables > Actions`):

`Secrets`:
* `SUBMODULES_REPO_TOKEN` (acesso de leitura aos submódulos privados).
* `STAGE_SSH_PRIVATE_KEY` (chave privada usada pelo GitHub Actions).
* `STAGE_SSH_KNOWN_HOSTS` (saída do `ssh-keyscan -H <ip-ou-host-stage>`).

`Variables`:
* `STAGE_SSH_HOST` (ex.: IP público da VPS).
* `STAGE_SSH_PORT` (ex.: `22`).
* `STAGE_SSH_USER` (ex.: `ubuntu`).
* `STAGE_DEPLOY_PATH` (ex.: `/srv/belluga_now_docker`).
* `STAGE_NGINX_HOST_PORT_80` (opcional, padrão `80`).
* `STAGE_NGINX_HOST_PORT_443` (opcional, padrão `443`).

Secrets de produção (`main`):
* `MAIN_SSH_PRIVATE_KEY`
* `MAIN_SSH_KNOWN_HOSTS`

Variables de produção (`main`):
* `MAIN_SSH_HOST`
* `MAIN_SSH_PORT`
* `MAIN_SSH_USER`
* `MAIN_DEPLOY_PATH`
* `MAIN_NGINX_HOST_PORT_80` (opcional, padrão `80`)
* `MAIN_NGINX_HOST_PORT_443` (opcional, padrão `443`)

Primeira preparação no servidor de stage:

```bash
sudo mkdir -p /srv/belluga_now_docker
sudo chown -R "$USER":"$USER" /srv/belluga_now_docker
```

Comportamento do deploy:
* Faz checkout da branch do lane (`stage` ou `main`) no servidor.
* Atualiza submódulos para os SHAs pinados no commit do repositório de orquestração.
* Executa limpeza pré-build de espaço (logs Laravel, Docker prune e cache Composer em `laravel-app/.composer/cache`) antes do gate de orçamento de disco.
* Executa `docker compose up -d --build --remove-orphans`.
* Executa migrations (landlord + tenants quando existirem) via `php artisan` dentro do container `app`.
* Executa health check em `http://127.0.0.1:<NGINX_HOST_PORT_80>/api/v1/initialize` (espera HTTP `200` ou `403`).

Rollback automático:
* Se o health check falhar, o workflow tenta rollback para o commit anterior no servidor e recompõe os containers.
* O job termina em falha mesmo após rollback bem-sucedido (para manter visibilidade no CI), mas a versão anterior permanece ativa.

Rollback manual (opcional):
1. Reverta o commit no lane (`stage` ou `main`) no repositório de orquestração.
2. Faça push da reversão para o lane.
3. O workflow reaplica os SHAs anteriores e recompõe os containers.
