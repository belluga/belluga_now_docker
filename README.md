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

### Passo 4: Configure o Ambiente

1.  Copie o arquivo de exemplo `.env.example` para um novo arquivo chamado `.env`.
    ```bash
    cp .env.example .env
    ```
2.  **Edite o arquivo `.env`** com suas próprias configurações. Preencha as variáveis de acordo com o ambiente que você deseja executar (staging ou production).

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

O ambiente é controlado pela variável `COMPOSE_PROFILES` no seu arquivo `.env`.

### Ambiente de Staging (Padrão)

Ideal para desenvolvimento e para compartilhar seu progresso. Utiliza o Cloudflare Tunnel para criar um túnel seguro para seu ambiente local.

1.  No arquivo `.env`, defina `COMPOSE_PROFILES=staging`.
2.  Preencha a variável `CLOUDFLARE_TUNNEL_TOKEN` com o token do seu túnel.
3.  Suba os contêineres:
    ```bash
    docker compose up -d --build
    ```

### Ambiente de Produção

Para implantar em um servidor com um domínio real.

1.  No arquivo `.env`, defina `COMPOSE_PROFILES=production`.
2.  Preencha as variáveis `DOMAIN` e `CERTBOT_EMAIL`.
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

* **Executar o Composer:**
    ```bash
    docker compose exec app composer install
    ```

* **Acessar o shell de um contêiner:**
    ```bash
    docker compose exec app sh
    ```

* **Verificar logs em tempo real:**
    ```bash
    docker compose logs -f <nome-do-servico>
    ```

***

## 📂 Estrutura do Projeto

├── docker/
│   ├── laravel-app/
│   │   ├── Dockerfile
│   │   └── entrypoint.sh
│   └── nginx/
│       ├── Dockerfile
│       ├── entrypoint.sh
│       ├── local.conf.template
│       └── prod.conf.template
├── flutter-app/        # Submódulo do Frontend Flutter
├── laravel-app/        # Submódulo do Backend Laravel
├── .dockerignore
├── .env.example
├── .gitattributes      # Garante a consistência de terminações de linha
├── .gitignore
├── .gitmodules
├── docker-compose.yml
└── README.md