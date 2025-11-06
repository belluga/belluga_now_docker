# Módulo: Guias & Experiências (v2.0 - Mockup)

**Propósito:** Apresentar as experiências turísticas e de lazer de forma visualmente impactante, facilitando o contato direto com os provedores.

---

## 1. Tela Principal: Experiências

*A vitrine principal para descoberta de experiências.*

### 1.1. Cabeçalho e Ferramentas
- **Título da Página:** Experiências
- **Barra de Busca:** `[🔎 Buscar por experiência ou categoria...]`
- **Filtros de Categoria (Carrossel Horizontal):** `[Botão: Aventura]`, `[Botão: Gastronomia]`, `[Botão: Natureza]`

### 1.2. Grid de Experiências
*Um layout dinâmico e visual para engajar o usuário.*

- **Layout:** Staggered Grid (grid com alturas variadas, estilo Pinterest).
- **Componente: Card de Experiência**
    - **Imagem:** `[Imagem de alta qualidade, preferencialmente vertical]`
    - **Título da Experiência:** Passeio de Canoa Havaiana ao Nascer do Sol
    - **Provedor (Link):** `[Link: Aventuras do Mar]` -> *Leva para a Página do Parceiro.*
    - **Tag de Categoria:** `Aventura`
    - ***Ação Principal (Clique no Card):*** *Leva para a Tela 2: Detalhes da Experiência.*

---

## 2. Tela: Detalhes da Experiência

*A página final com o call to action.*

### 2.1. Estrutura da Página
- **Componente:** Usará o template `ItemLandingPage`.
- **Conteúdo:**
    - Imagem de capa em tela cheia.
    - Título, descrição detalhada, o que inclui, etc.
    - Link para a página do provedor.
- **Call to Action (CTA):**
    - **Botão Fixo (Sticky):** `[Botão com Ícone WhatsApp: Consultar via WhatsApp]`

---

## 3. Tela: Página do Provedor da Experiência

*A página dedicada ao parceiro que oferece a experiência.*

### 3.1. Estrutura da Página
- **Componente:** Usará o template `PartnerLandingPage`.
- **Conteúdo:**
    - Imagem de capa, logo, nome do provedor, bio.
    - Seção "Outras Experiências" (se houver).
    - Seção "Loja" com produtos (e.g., camisetas, miniaturas) (se houver).
    - Botão "Seguir" / "Virar Fã" (conforme definido pela categoria).

---
---

## Funcionalidades para Versões Futuras

- **Fluxo de Contratação e Pagamento:** Implementar um sistema completo de agendamento, reserva e pagamento de experiências diretamente no aplicativo, utilizando o `Guar[APP]ari Pay`.
- **Guias IA:** Introduzir guias gerados por IA para roteiros e sugestões personalizadas.
- **Avaliações de Experiências:** Permitir que usuários avaliem as experiências e os provedores.
- **Matchmaker Inteligente:** Um sistema de busca conversacional que sugere a experiência perfeita com base nas preferências do usuário.
