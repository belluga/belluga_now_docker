# Módulo Mestre: Sistema de Perfis Polimórficos (Especificação v1.2 - Final)

**Documento Pai:** `prototipo_geral.md` (Cobre todo o ecossistema B2B e B2C+)
**Status:** Validado para Desenvolvimento (Arquitetura Visual e Regras de Negócio Aprovadas)
**Visual References (B2B Partners):** `image_4.png` a `image_9.png`
**Visual References (B2C+ Users):** `image_10.png` a `image_12.png`

---

## 1. Visão Estratégica: O Framework "Camaleão"

Este módulo resolve o desafio de representar uma vasta gama de entidades (empresas com CNPJ e pessoas com CPF) usando uma **única base de código frontend**.

**Princípio do Polimorfismo:**
A tela de perfil (`UnifiedProfileScreen`) é um container agnóstico. Ela recebe do backend um **Objeto de Perfil** que define a configuração do Hero, das Abas e a lista ordenada de **Sub-Módulos de Conteúdo** para renderizar, baseada no que o usuário/parceiro ativou.

---

## 2. Arquitetura Base (O Esqueleto Fixo)

Toda tela de perfil segue esta estrutura de 4 camadas:

1.  **Camada 1: Hero Imersivo Colapsável (Sticky Header):** Topo focado em identidade e status, com variantes visuais (B2B, Influenciador, Curador, Genérico).
2.  **Camada 2: Barra de Abas Dinâmica (Sticky Tabs):** Navegação interna definida pelo backend, com rótulos customizáveis pelo parceiro.
3.  **Camada 3: Container de Conteúdo (Scroll View):** Pilha vertical onde os Sub-Módulos ativos são injetados.
4.  **Camada 4: Rodapé de Ação Contextual (Dynamic Footer):** Barra flutuante reativa ao scrollspy (muda a ação conforme o conteúdo visível).

---

## 3. Inventário de Sub-Módulos (Os Blocos de Construção)

Componentes de UI reutilizáveis injetados pelo backend.

| ID do Módulo | Descrição Visual/Funcional | Uso Típico |
| :--- | :--- | :--- |
| `MOD_SOCIAL_SCORE` | Widget de destaque: "Convites Feitos" e "Presenças Reais". | Todos Usuários B2C+. |
| `MOD_AGENDA_CAROUSEL` | Carrossel horizontal de cards de eventos. | Músicos, Venues, Influenciadores. |
| `MOD_AGENDA_LIST_VERTICAL` | Lista vertical de cards de eventos (futuros/passados). | Usuários B2C+. |
| `MOD_MUSIC_PLAYER_NATIVE` | Gatilho Spotify SDK + Mini-Player persistente. | Músicos. |
| `MOD_PRODUCT_GRID_VISUAL` | Grid de fotos quadradas (food/artesanato) com preço. | Restaurantes, Artesãos. |
| `MOD_PHOTO_GALLERY_GRID` | Grid de fotos estilo Instagram. | Influenciadores. |
| `MOD_NATIVE_VIDEO_GALLERY` | Grid de thumbnails que abrem player de vídeo nativo. | Curadores. |
| `MOD_EXPERIENCE_CARDS_LARGE` | Lista vertical de cards grandes de serviços. | Guias. |
| `MOD_AFFINITY_CAROUSELS` | Carrosséis de recomendações (com tracking de afiliado para Influenciadores Nível 2). | Usuários B2C+. |
| **`MOD_SUPPORTED_ENTITIES_CAROUSEL`** | **(NOVO!)** Carrossel de perfis apoiados. **Título customizável pelo parceiro** (Default: "Quem Apoiamos", Exemplos: "Nossos Residentes", "Cultura Local"). | **Parceiros B2B (Opcional).** |
| `MOD_RICH_TEXT_BLOCK` | Bloco de texto formatado (Bio, histórias, artigos). | Todos. |
| `MOD_LOCATION_INFO_BLOCK` | Status, mapa, endereço, tags. | Locais Físicos B2B. |
| `MOD_EXTERNAL_LINK_CARDS` | Cards para links de saída (Merch, Cursos, PIX/Apoio). | Músicos, Curadores. |
| `MOD_FAQ_ACCORDION` | Perguntas e respostas expansíveis. | Guias. |
| `MOD_SPONSOR_BANNER` | Banner sutil de "Oferecimento: [Logo Parceiro]" linkável. | Curadores (B2B2C). |

---

## 4. Especificações de Arquétipo (Exemplos de Configuração)

### 4.1. Parceiros B2B (Modularidade Total)
O backend envia apenas os módulos que o parceiro ativou em seu painel.

* **Exemplo: Restaurante "Beach Club" (Configuração Completa):**
    * *Abas (Rótulos Customizados):* `['O Local', 'Agenda', 'Residentes', 'Cardápio']`.
    * *Stack:* `MOD_LOCATION_INFO_BLOCK` (Visual), `MOD_AGENDA_CAROUSEL`, **`MOD_SUPPORTED_ENTITIES_CAROUSEL` (Título: "Nossos DJs Residentes")**, `MOD_PRODUCT_GRID_VISUAL`.
* **Exemplo: Bistrô Pequeno (Configuração Mínima):**
    * *Abas:* `['Cardápio', 'Local']`.
    * *Stack:* `MOD_PRODUCT_GRID_VISUAL`, `MOD_LOCATION_INFO_BLOCK` (Mapa).

### 4.2. Usuários B2C+ (Espectro Gamificado)
Mantêm as estruturas definidas anteriormente (Nível 1 Genérico, Nível 2 Influenciador, Nível 3 Curador) com suas regras de permissão de conteúdo.

---

## 5. Regras de Negócio Críticas

1.  **Gestão de Módulos B2B (CRUCIAL):** Os parceiros B2B têm controle total via painel web para **ativar/desativar** quaisquer módulos opcionais (como Agenda, Apoio, Cardápio) e **customizar os títulos** das seções/abas correspondentes.
2.  **Vínculo Recíproco de Apoio (CRUCIAL):** Se o Parceiro A ativa o `MOD_SUPPORTED_ENTITIES_CAROUSEL` exibindo o Curador B, o Curador B deve exibir automaticamente o `MOD_SPONSOR_BANNER` do Parceiro A. O backend garante isso.
3.  **Permissões e Monetização B2C+:** Nível 1 restrito (sem recomendações comerciais). Nível 2 (Influenciador) com links de afiliado em recomendações. Nível 3 (Curador) e Artistas com apoio direto (PIX) e patrocínio.
4.  **Privacidade do Usuário:** Se `isPrivate = true` (Nível 1), agendas e históricos são ocultados da visão pública.
5.  **Persistência de Mídia:** O Mini-Player deve persistir na navegação.

---
**Fim da Especificação Mestre do Sistema de Perfis (v1.2).**