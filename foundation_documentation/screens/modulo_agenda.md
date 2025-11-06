# Módulo: Agenda & Social (v6.0 - Mockup)

**Propósito:** Unificar a descoberta de eventos, o gerenciamento da agenda pessoal do usuário e o motor de crescimento viral através de convites.

---

## 1. Tela Principal: Agenda (Descoberta)

*O ponto de entrada para descobrir o que está acontecendo na cidade.*

### 1.1. Cabeçalho e Ferramentas
- **Título da Página:** Agenda
- **Barra de Busca:** `[🔎 Buscar por evento, artista ou local...]`
- **Filtros de Categoria:** `[Ícone de Filtro 📊]`

### 1.2. Seção "Meus Eventos"
*Um destaque para os eventos do próprio usuário.*

- **Título:** Seus Eventos
- **Componente:** Carrossel horizontal de cards de evento (reutilizando o card padrão).
- **Fonte:** Eventos que o usuário confirmou ou está com convite pendente.
- **Ação:** `[Botão/Seta "Ver Todos"]` -> *Leva para a Tela 2: Minha Agenda.*

### 1.3. Calendário de Eventos da Cidade
*Visão geral dos dias com eventos públicos.*

- **Componente:** Calendário mensal.
- **Indicador:** Um "ponto" nos dias que possuem eventos públicos.

### 1.4. Lista de Próximos Eventos
*Feed principal de descoberta.*

- **Título:** Próximos Eventos
- **Componente:** Lista vertical de cards de evento.
- **Ação no Card:** Leva para a Tela 3: Detalhes do Evento.

---

## 2. Tela: Minha Agenda (Lista Pessoal)

*A lista pessoal e cronológica de eventos do usuário.*

### 2.1. Estrutura
- **Título da Página:** Minha Agenda
- **Layout:** Lista vertical agrupada por data (Hoje, Amanhã, 25 de Dezembro).

### 2.2. Card de Evento Pessoal (Card Padrão Melhorado)
- **Componente:** Reutiliza o card de evento padrão.
- **Melhorias:**
    1.  **Badge de Status:** `[Badge: Confirmado]` ou `[Badge: Pendente]`.
    2.  **Ícone de Convite:** `[Ícone de Convidar Amigos]` -> *Leva para a Tela 5: Convidar Amigos.*
    3.  **Widget de Convidados:** `[Avatar Roll com halos de status]` -> *Abre modal com detalhes dos convites enviados.*

### 2.3. Lógica
- **Conteúdo:** Apenas eventos com status "Confirmado" ou "Pendente". Eventos recusados não aparecem.

---

## 3. Tela: Detalhes do Evento (Landing Page)

*Página de conteúdo para convencer o usuário a participar.*

### 3.1. Estrutura da Página
- **Componente:** Usará o template `ItemLandingPage`.
- **Call to Action (CTA):**
    - **Botão Fixo (Sticky):** `[Botão: Confirmar Presença]`

---

## 4. Tela: Gerenciador de Convites ("Tinder-like")

*Interface gamificada para gerenciar convites recebidos.*

### 4.1. Estrutura
- **Layout:** Pilha de cards (estilo Tinder).
- **Card de Convite:** Mostra imagem do evento, nome, data/hora e quem convidou.
- **Interações:**
    - **Swipe Direita / Botão ✅:** Aceitar -> *Leva para a Tela 5.*
    - **Swipe Esquerda / Botão ❌:** Recusar.
    - **Swipe Cima/Baixo / Botão 🤔:** Pensar Depois (move para o fim da fila).
- **Fim da Fila:** Transição suave para a tela Home.

---

## 5. Tela: Convidar Amigos

*O motor de crescimento viral.*

### 5.1. Acesso
1.  Automaticamente após aceitar um convite.
2.  Manualmente através do ícone de convite no card da "Minha Agenda".

### 5.2. Estrutura
- **Título:** Convidar Amigos para [Nome do Evento]
- **Lista de Amigos no App:** Lista com checkbox (usando dados mockados).
- **Ação Externa:** `[Botão com Ícone WhatsApp: Convidar via WhatsApp]`

---
---

## Funcionalidades para Versões Futuras

- **Venda de Ingressos:** Integrar um fluxo de pagamento para eventos pagos.
- **Prova Social Avançada:** Mostrar "X amigos confirmaram" nos cards e detalhes do evento.
- **Sugestões Inteligentes de Convite:** Usar IA para sugerir quais amigos convidar com base em interesses e histórico em comum.
- **Status de Convite & Privacidade:** Implementar a lógica de backend para rastrear o status dos convites e permitir que os usuários controlem a visibilidade desse status.
