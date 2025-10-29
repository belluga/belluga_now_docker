# Módulo: Agenda e Crescimento Viral (v5.0)

**Propósito:** Unificar toda a experiência do usuário relacionada à Agenda, desde a descoberta na tela principal, passando pela conversão na página de detalhes do evento, até o compartilhamento e crescimento viral com o fluxo "Bora?".

---
---

## Parte 1: Tela Principal da Agenda

*O ponto de entrada principal, onde o usuário descobre o que está acontecendo.*

### 1.1. Cabeçalho Principal
- **Título da Página:** Agenda
- **Ícone de Notificações:** `[Ícone de Sino]`
- **Ícone de Perfil:** `[Foto do Usuário]`

### 1.2. Alerta de Convites Pendentes (Componente Condicional)
*Aparece no topo da tela APENAS se o usuário tiver convites não visualizados.*

- **Componente de Alerta:** `[Banner sutil: ✉️ Você tem 3 novos convites! [Ver Agora]]` -> *Leva para a Parte 3: Gerenciador de Convites Recebidos.*

### 1.3. Controles de Navegação Rápida
- **Botões de Toggle:**
    - `[Botão Selecionado: Sua Agenda]`
    - `[Botão: Hoje]`
    - `[Botão: Esta Semana]`

### 1.4. Ferramentas de Busca e Filtro
- **Barra de Busca:** `[🔎 Buscar por evento, artista ou local...]`
- **Ícone de Filtro:** `[Ícone de Filtro 📊]`
- **Display de Filtros Ativos:** `Filtros: [Música ao Vivo 🎤] [Grátis 💰] [Praia do Morro 🏖️] [x]`

### 1.5. Seção de Destaque (Carrossel Opcional)
*Um espaço premium para eventos patrocinados ou de grande porte.*

- **Componente: Carrossel de Banners (1 card grande por vez)**
    - **Card Destaque 1:** `[Banner do Evento "Guarapari Music Festival"]` -> *Leva para a Parte 2.*

### 1.6. Lista de Eventos (Feed Principal)
- **Título da Lista:** Próximos Eventos
- **Componente: Card de Evento (Exemplo 1)**
    - **Imagem:** `[Foto da banda "Manimal"]`
    - **Data e Hora:** QUI, 09/OUT, 21:00
    - **Título do Evento:** Show Acústico com Manimal
    - **Local e Artista:** Siribeira Iate Clube
    - **Tags:** `#MúsicaAoVivo` `#Rock`
    - **Indicador Social:** `[🔥 Popular]`
    - **Ações Rápidas:** `[Ícone de Salvar ⭐]` `[Ícone de Compartilhar 🔗]`
    - ***Ação Principal (Clique no Card):*** *Leva para a Parte 2: Detalhes do Evento.*

- **Componente: Card de Evento (Exemplo 2)**
    - **Imagem:** `[Foto de pratos de moqueca]`
    - **Data e Hora:** SÁB, 11/OUT, 12:00 - 16:00
    - **Título do Evento:** Festival Gastronômico da Moqueca Capixaba
    - **Local e Artista:** Orla da Praia do Morro
    - **Tags:** `#Gastronomia` `#Grátis` `#Família`
    - **Indicador Social:** `[✅ 12 amigos confirmaram]`
    - **Ações Rápidas:** `[Ícone de Salvar ⭐]` `[Ícone de Compartilhar 🔗]`
    - ***Ação Principal (Clique no Card):*** *Leva para a Parte 2: Detalhes do Evento.*

- **Componente: Card de Evento (Exemplo 3 - Patrocinado)**
    - **Header "Patrocinado"**
    - **Imagem:** `[Foto do bar "Thale Beach"]`
    - **Data e Hora:** SEX, 10/OUT, 22:00
    - **Título do Evento:** Sunset Sessions com DJ Jovem
    - **Local e Artista:** Thale Beach
    - **Tags:** `#Festa` `#MúsicaEletrônica`
    - **Indicador Social:** `[🎟️ Ingressos a partir de R$ 50]`
    - **Ações Rápidas:** `[Ícone de Salvar ⭐]` `[Ícone de Compartilhar 🔗]`
    - ***Ação Principal (Clique no Card):*** *Leva para a Parte 2: Detalhes do Evento.*

---
---

## Parte 2: Detalhes do Evento (Landing Page)

*O coração do nosso ecossistema de conteúdo. É aqui que o usuário decide se vai ou não e onde o crescimento viral é iniciado.*

### 2.1. Cabeçalho da Página
- **Botão de Voltar:** `[< Voltar]`
- **Ações:** `[Ícone de Salvar ⭐]` `[Ícone de Compartilhar 🔗]`

### 2.2. Módulo Principal (Hero)
- **Imagem de Banner:** `[Banner grande e impactante do evento]`
- **Título do Evento (Sobre a imagem):** Show Acústico com Manimal
- **Data e Hora:** QUI, 09 de Outubro, 21:00
- **Local:** `[Link: Siribeira Iate Clube]` -> *Leva para a Subparte 2.A: Perfil do Estabelecimento*

### 2.3. Seção de Artista
- **Componente de Artista:**
    - `[Foto do Artista]` **Apresentando:** `[Link: Banda Manimal]` -> *Leva para a Subparte 2.B: Perfil do Artista*
    - **Gênero:** Rock / MPB

### 2.4. Descrição do Evento
- **Título da Seção:** Sobre o Evento
- **Texto Descritivo:** "Prepare-se para uma noite inesquecível com o melhor do rock acústico. A Banda Manimal traz um repertório..." (etc.)

### 2.5. Localização
- **Título da Seção:** Como Chegar
- **Componente de Mapa Interativo:** `[Mapa mostrando o pino no Siribeira Iate Clube]`
- **Endereço:** Rua Exemplo, 123, Centro, Guarapari - ES
- **Botão:** `[Abrir no Waze / Google Maps]`

### 2.6. Prova Social
- **Título da Seção:** Quem Vai?
- **Componente Visual:** `[Foto 1][Foto 2][Foto 3][+12]`
- **Texto:** "Maria Clara, João Pedro e outros 12 amigos seus confirmaram presença."

### 2.7. Chamada para Ação (CTA) - O Motor Principal
- **Botão Primário (Se houver venda de ingresso):**
    - `[Botão Grande: Comprar Ingresso - R$ 50,00]` -> *Inicia fluxo de pagamento*
- **Botão Secundário (O gatilho viral):**
    - `[Botão com Ícone de Foguete 🚀: BORA? Chamar sua galera!]` -> *Leva para a Parte 4: Fluxo de Convite para Amigos*

---

### Subparte 2.A: Perfil do Estabelecimento
*Página dedicada ao local, fortalecendo a marca do parceiro.*

- **Imagem de Capa:** `[Foto da fachada ou melhor ângulo do Siribeira Iate Clube]`
- **Logo/Foto de Perfil:** `[Logo do Siribeira]`
- **Nome:** Siribeira Iate Clube
- **Tags:** `#Restaurante` `#MúsicaAoVivo` `#VistaParaOMar`
- **Descrição:** "O ponto de encontro mais charmoso de Guarapari, com gastronomia de ponta e os melhores eventos..."
- **Informações de Contato:** Telefone, site, redes sociais.
- **Próximos Eventos no Local (Lista):**
    - `[Card do Evento 1]`
    - `[Card do Evento 2]`

### Subparte 2.B: Perfil do Artista
*Página dedicada ao artista, criando uma base de fãs dentro do app.*

- **Imagem de Capa:** `[Foto da Banda Manimal no palco]`
- **Foto de Perfil:** `[Foto de close da banda]`
- **Nome:** Banda Manimal
- **Tags:** `#Rock` `#Acústico` `#Autoral`
- **Bio:** "Formada em 2015, a Banda Manimal é conhecida por suas letras poéticas e arranjos..."
- **Links:** Spotify, YouTube, Instagram.
- **Próximos Shows (Lista):**
    - `[Card do Evento 1 no Siribeira]`
    - `[Card do Evento 2 em outro local]`

---
---

## Parte 3: Gerenciador de Convites Recebidos

### Tela: Manejador de Convites ("Bora?")

*A interface gamificada para gerenciar convites recebidos.*

**Contexto de Acesso:**
- O usuário é direcionado para esta tela ao clicar em um push de convite.
- O usuário é direcionado para esta tela ao abrir o app, caso existam convites pendentes que ele ainda não viu.
- O usuário é direcionado para esta tela ao clicar no alerta de novos convites na home.

---

### 3.1. Estrutura da Tela
- **Título:** Você tem convites!
- **Indicador de Fila:** `[Card 1 de 3]`
- **Componente Principal:** Pilha de "Cards de Convite" (estilo Tinder/Stories).

### 3.2. O Card de Convite
- **Imagem de Fundo:** `[Imagem atrativa do evento]`
- **Conteúdo do Card:**
    - **Título do Evento (Grande):** Show Acústico com Manimal
    - **Data e Hora:** QUI, 09/OUT, 21:00
    - **Local:** Siribeira Iate Clube
    - **Quem Convidou:**
        - `[Foto de Perfil de Maria Clara]`
        - **Maria Clara** te convidou!
    - **Prova Social (Quem já vai):**
        - `[Foto 1][Foto 2][Foto 3] +5 amigos já confirmaram`
- **Mecânica de Interação:**
    - **Swipe Direita / Botão ✅:** Aceitar -> *Leva para a Parte 4.*
    - **Swipe Esquerda / Botão ❌:** Recusar
    - **Swipe Cima / Botão 🤔:** Talvez

### 3.3. Estado de "Fila Vazia"
- **Mensagem:** "Você está em dia com seus convites!"
- **CTA:** `[Botão: Explorar a Agenda]` -> *Leva para a Parte 1.*

---
---

## Parte 4: Fluxo de Convite para Amigos

### Tela: Propagar Convite ("Chame sua Galera")

*A etapa final e crucial do nosso motor de crescimento.*

### 4.1. Contexto
- **Acesso:** Imediatamente após aceitar um convite (Parte 3) OU ao clicar no botão "BORA?" (Subparte 2.7).

### 4.2. Estrutura da Tela

*Um header fixo para manter o contexto.*

- **Componente de Resumo:**
    - `[🎉 Presença Confirmada!]`
    - **Evento:** Show Acústico com Manimal
    - **Quando:** QUI, 09/OUT, 21:00
- **Botão Opcional:** `[Pular por agora]`

### 4.3. Seção de Sugestões Inteligentes

*O objetivo é facilitar a seleção, usando dados para sugerir quem convidar.*

- **Título da Seção:** Sugestões para você
- **Componente: Carrossel Horizontal de Contatos**
    - `[Foto Perfil 1]` **(Nome do Amigo 1)** - *"Vocês foram a 3 eventos de Rock juntos"*
    - `[Foto Perfil 2]` **(Nome do Amigo 2)** - *"Também curte a banda Manimal"*
    - `[Foto Perfil 3]` **(Nome do Grupo 1)** - *"Grupo: Galera do FDS"*

---

### 4.4. Ferramenta de Seleção

*O objetivo é facilitar a seleção, usando dados para sugerir quem convidar.*

- **Seção de Sugestões Inteligentes:** Carrossel horizontal com sugestões de amigos.
- **Barra de Busca:** `[🔎 Buscar por nome ou grupo no WhatsApp...]`
- **Lista de Contatos:** Lista rolável com checkboxes.

### 4.5. Mensagem e CTA Final

*A finalização do processo de convite.*

- **Caixa de Texto (Pré-preenchida e editável):**
    - "E aí! Acabei de confirmar que vou no Show Acústico com Manimal, no dia 09/OUT. Bora junto? Dá uma olhada no convite:"
- **Preview do Link:**
    - `[Card do Evento com Link Único do Guar[APP]ari]`
- **Botão de Ação Principal (Fica ativo após selecionar pelo menos 1 contato):**
    - `[Botão com Ícone do WhatsApp: Enviar Convite para (3)]`