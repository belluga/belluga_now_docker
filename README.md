#  Boilerplate Flutter & Laravel com Docker

![Laravel](https://img.shields.io/badge/Laravel-FF2D20?style=for-the-badge&logo=laravel&logoColor=white)
![Flutter](https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Nginx](https://img.shields.io/badge/NGINX-009639?style=for-the-badge&logo=nginx&logoColor=white)

Um ambiente de desenvolvimento, staging e produção completo para aplicações com **Laravel** no backend e **Flutter** no frontend. O projeto é totalmente containerizado com **Docker** e utiliza **NGINX** como reverse proxy.

## ✨ Features

* **Ambiente Unificado**: Backend e frontend gerenciados em um único projeto com Git Submodules.
* **Containerizado**: Esqueça a necessidade de instalar PHP, Composer ou Flutter SDK na sua máquina. O Docker cuida de tudo.
* **Perfis de Ambiente**: Alterne facilmente entre `staging` e `production` usando Perfis do Docker Compose.
    * **Staging**: Exponha seu ambiente local na internet com um único comando usando o Cloudflare Tunnel.
    * **Production**: Geração e renovação automática de certificados SSL/TLS com Certbot (Let's Encrypt).
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

### Passo 5: Configure o Túnel para Staging (Opcional)

Para usar o perfil de `staging` e expor seu ambiente local na internet, você precisa de um **Cloudflare Tunnel**.

1.  Siga o **tutorial oficial do Cloudflare** para criar seu túnel:
    * **[Guia de Início Rápido do Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/)**

2.  Após seguir o tutorial, você terá um **token do túnel** e um **domínio público** (ex: `meu-app.meudominio.com`).

3.  Abra seu arquivo `.env` e atualize as seguintes variáveis:
    * `CLOUDFLARE_TUNNEL_TOKEN`: Cole o token do seu túnel aqui.
    * `DOMAIN`: Insira o domínio público que você configurou para o túnel.

### Passo 6: Envie o Código Inicial

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

### Local Dev Without Cloudflare (Recommended)

Use this flow when you want full local development (Docker + Flutter) without tunnel/domain dependencies.

1. Start the local stack without `staging` profile:

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
- This flow does not require Cloudflare.
- Flutter local bootstrap does not use `.env`; it is controlled by compile-time define files.
- Lane files live in `flutter-app/config/defines/{dev,stage,main}.json`.
- `flutter-app/config/defines/local.override.json` is gitignored and machine-specific.
- If `cloudflared` is still running from an older staging session, stop it with `docker compose stop cloudflared`.

O ambiente é controlado pela variável `COMPOSE_PROFILES` no seu arquivo `.env`.

### Ambiente de Staging (Padrão)

Ideal para desenvolvimento e para compartilhar seu progresso. Utiliza o Cloudflare Tunnel para criar um túnel seguro para seu ambiente local.

1.  No arquivo `.env`, garanta que `COMPOSE_PROFILES=staging`.
2.  Confirme que as variáveis `CLOUDFLARE_TUNNEL_TOKEN` e `DOMAIN` foram preenchidas conforme o **Passo 5**.
3.  Suba os contêineres:
    ```bash
    docker compose up -d --build
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
   ./scripts/flutter/build_web.sh            # saída padrão: ./web-app
   ```
   (Dentro de `flutter-app/scripts` há um wrapper que aponta para o mesmo script, caso prefira executar a partir do submódulo.)
2. O script grava os artefatos na pasta `web-app/`, já removendo `favicon.ico`, `manifest.json` e `icons/` (esses assets são servidos pelo backend). Revise o diff do submódulo:
   ```bash
   git status web-app
   ```
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
