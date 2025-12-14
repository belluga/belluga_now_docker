# Módulo: Detalhes do Evento Imersivo (Especificação v1.0)

**Documento Pai:** `prototipo_geral.md` (Seção 2.3. Módulo: Agenda & Crescimento Viral)
**Status:** Validado para Desenvolvimento
**Visual References:** `image_0.png`, `image_2.png`, `image_3.png`

---

## 1. Visão Estratégica

A tela de Detalhes do Evento é o ponto crítico de conversão do Guar[APP]ari. Ela deve equilibrar o apelo visual de uma "landing page" de festival com a utilidade social de uma rede.

**Objetivos Chave:**
1.  **Converter Visitantes em Confirmados:** Utilizar imersão visual e prova social para gerar FOMO (Fear Of Missing Out).
2.  **Transformar Confirmados em Promotores:** Ativar o motor de crescimento viral ("Bora?") imediatamente após a confirmação.
3.  **Navegação Contextual:** Oferecer a ação certa no momento certo através de um rodapé dinâmico baseado no scroll.

---

## 2. Arquitetura de Componentes Base

A tela segue uma estrutura mestra que se adapta aos estados do usuário.

### 2.1. Hero Imersivo (Topo)
Uma área de alto impacto visual que vende a experiência.
* **Imagem Full-Bleed:** Foto de alta qualidade do evento/artista, ocupando 50% da altura inicial.
* **Overlay de Informação:** Título do evento, Data, Hora e Ícone/Nome do Local sobrepostos à imagem com gradiente para legibilidade.
* **Navegação Superior:** Botões "Voltar" (←) e "Compartilhar" (🔗) flutuando sobre a imagem.
* **(Novo) Links de Artistas:** Links sutis e clicáveis no próprio hero para as atrações principais (ex: "🎸 Banda X • 🎧 DJ Y").

### 2.2. Barra de Abas Fixa (Sticky Tabs)
Uma barra de navegação interna que ancora no topo da tela quando o usuário rola para baixo, permitindo navegação rápida entre as seções do evento.
* **Abas Padrão:** `Sua Galera` | `O Rolê` (Info) | `Line-up` | `O Local`

### 2.3. Rodapé Dinâmico (Sticky Footer)
Uma barra de ação flutuante fixa na parte inferior da tela. **Seu conteúdo e ação mudam dinamicamente** dependendo do estado do usuário e da seção da página que está sendo visualizada.

---

## 3. Estados da Tela (Variações de Fluxo)

A tela se comporta de maneira fundamentalmente diferente antes e depois da confirmação do usuário.

### Estado A: Usuário NÃO Confirmado (Foco: Venda)
*Referência Visual:* `image_0.png`

* **Objetivo:** Vender o ingresso e gerar desejo.
* **Widget Principal (Abaixo do Hero):** Prova Social Genérica.
    * *Exemplo:* "+12 amigos seus e outras 350 pessoas já confirmaram."
* **Rodapé Dinâmico (Fixo):** Foco em Compra.
    * *Esquerda:* Preço ("A partir de R$ 60,00").
    * *Direita (Botão de Ação):* "GARANTIR MEU INGRESSO".

### Estado B: Usuário CONFIRMADO (Foco: Viralização & Utilidade)
*Referência Visual:* `image_2.png`

Este estado possui duas sub-variações dependendo se o organizador ativou ou não uma campanha de gamificação.

#### Variação B1: Confirmado Padrão (Social)
* **Objetivo:** Tranquilizar sobre a presença e incentivar convites sociais.
* **Widget Principal:** "Sua Galera" (Rastreamento social).
    * *Mostra:* Quem dos seus amigos vai, quem ainda não respondeu.
* **Rodapé Dinâmico (Aba Inicial):**
    * *Esquerda (Status):* Ícone Check Verde ✅ "Tudo certo! Presença confirmada."
    * *Direita (Ação Viral):* Botão Roxo/Rosa 🚀 "**BORA? Agitar a galera!**" (Dispara o fluxo de convites).

#### Variação B2: Confirmado Gamificado (B2B Mission)
* **Trigger:** O organizador configurou uma recompensa (ex: "Traga 3 amigos, ganhe 1 drink").
* **Objetivo:** Engajar o usuário em uma "missão" para trazer mais gente.
* **Widget Principal:** "Placar da Missão".
    * *Mostra:* A regra do prêmio e o progresso visual (ex: "Falta 1 amigo para o prêmio!").
* **Rodapé Dinâmico (Aba Inicial):**
    * *Esquerda (Incentivo):* Ícone do prêmio (ex: Drink 🍹) piscando + "Busque seu prêmio! Falta pouco."
    * *Direita (Ação Viral):* Botão Dourado/Roxo 🚀 "**BORA? Cumprir a missão!**"

---

## 4. Comportamento Dinâmico (Navegação Contextual)
*Referência Visual:* `image_3.png`

Para oferecer uma experiência premium, o **Rodapé Dinâmico muda sua ação principal** com base na aba que está visível na tela durante o scroll (Scrollspy).

### 4.1. Estado do Topo Colapsado (Sticky Header)
Ao rolar para baixo, o Hero Imersivo desaparece e é substituído por uma barra superior compacta e sólida (cor escura da marca) contendo apenas o botão Voltar, o Título truncado do evento e o botão Compartilhar. A Barra de Abas (Sticky Tabs) se fixa imediatamente abaixo dela.

### 4.2. Mapeamento de Ações do Rodapé

| Aba Ativa (Visível) | Estado do Rodapé Dinâmico (Ação Contextual) | Racional |
| :--- | :--- | :--- |
| **1. Sua Galera** (Início) | **Modo "BORA?" (Social/Missão)**<br>*(Conforme definido no Estado B1 ou B2 acima)* | Momento de engajamento social imediato após a confirmação. |
| **2. O Rolê & Ingresso** | **Modo "Acesso"**<br>Botão: `[🎟️ Ver meu QR Code de Acesso]` | Utilidade rápida ao ler sobre o evento. |
| **3. Line-up** | **Modo "Engajamento Artista"**<br>Botão: `[⭐ Seguir todos os artistas]` | Ação em massa para retenção no ecossistema e valorização dos parceiros B2B. |
| **4. O Local** | **Modo "Mobilidade"**<br>Botão: `[📍 Traçar Rota (Maps/Uber)]` | Utilidade pura de deslocamento ao visualizar o mapa. |

---
**Fim da Especificação do Módulo Detalhes do Evento.**