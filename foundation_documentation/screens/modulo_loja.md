# Módulo: Mercado Local (v2.0 - Mockup)

**Propósito:** Servir como uma vitrine digital para produtores e artesãos locais, focando na descoberta e contato direto via WhatsApp.

---

## 1. Tela Principal: Mercado (Lista de Produtores)

*O ponto de entrada para o marketplace, focando em quem produz.*

### 1.1. Cabeçalho e Ferramentas
- **Título da Página:** Mercado
- **Barra de Busca:** `[🔎 Buscar por produtor ou categoria...]`
- **Filtros de Categoria (Carrossel Horizontal):** `[Botão: Queijos]`, `[Botão: Café]`, `[Botão: Vinhos]`, `[Botão: Artesanato]`

### 1.2. Lista de Produtores
*Uma lista limpa e organizada dos parceiros.*

- **Layout:** Lista vertical (1 coluna).
- **Componente: Card de Produtor**
    - **Logo/Imagem:** `[Logo do produtor ou imagem representativa]`
    - **Nome do Produtor:** Sítio do Café Feliz
    - **Tagline/Descrição:** Cafés especiais e produtos da roça
    - **Tags de Categoria (Ícones):** `[Ícone Café]`, `[Ícone Queijo]`
    - ***Ação Principal (Clique no Card):*** *Leva para a Tela 2: Página da Loja do Produtor.*

---

## 2. Tela: Página da Loja do Produtor

*A vitrine individual de cada parceiro.*

### 2.1. Cabeçalho do Produtor
- **Componente:** Usará o template `PartnerLandingPage`.
- **Conteúdo:**
    - Imagem de capa, logo, nome do produtor, bio.
    - Botão "Seguir" / "Virar Fã" (conforme definido pela categoria).

### 2.2. Catálogo de Produtos/Kits
- **Layout:** Grid (2 colunas).
- **Componente: Card de Produto/Kit**
    - **Imagem:** `[Imagem do produto/kit]`
    - **Nome:** Kit Degustação de Queijos
    - **Descrição Curta:** Uma seleção dos nossos melhores queijos...
    - ***Ação Principal (Clique no Card):*** *Leva para a Tela 3: Detalhes do Item.*

---

## 3. Tela: Detalhes do Item (Produto/Kit)

*A página final com o call to action.*

### 3.1. Estrutura da Página
- **Componente:** Usará o template `ItemLandingPage`.
- **Conteúdo:**
    - Imagem de capa em tela cheia.
    - Título, descrição detalhada.
    - Link para a página do produtor.
- **Call to Action (CTA):**
    - **Botão Fixo (Sticky):** `[Botão com Ícone WhatsApp: Encomendar via WhatsApp]`

---
---

## Funcionalidades para Versões Futuras

- **Carrinho de Compras e Checkout:** Implementar um fluxo de e-commerce completo com carrinho, cálculo de frete e pagamento via `Guar[APP]ari Pay`.
- **Curadoria por IA:** Sugerir kits e produtos com base nos interesses do usuário na Agenda e Guias.
- **Avaliações de Produtos/Produtores:** Permitir que usuários avaliem os produtos e parceiros.
