# Módulo Consolidado: Guias & Experiências

---
---

## Conteúdo de Página Inicial de Experiências

### 1. Módulo de Busca Inteligente ("Matchmaker")
*O ponto de partida para uma experiência personalizada.*

- **Título:** Encontre o Guia Perfeito para Você
- **Campo de Texto:** `[Escreva ou fale o que você procura...]`
- **Botão de Áudio:** `[Ícone de Microfone]`
- **CTA (Call to Action):** `[Botão: Buscar]`

---

### 2. Seção: "Nossos Guias" (Carrossel)
*Uma vitrine horizontal para dar destaque aos perfis.*

- **Título da Seção:** Conheça os Especialistas
- **Ação no Título:** `[Botão: Ver Todos]` -> *Leva para `guias_lista.md`*
- **Componente: Carrossel de Cards de Perfil**

    * **Card de Guia Humano:** `[Foto, Nome, Título, Avaliação]`
    * **Card de Guia IA:** `[Avatar IA, Nome, Título]`
    * **Card de Guia IA (Parceiro):** `[Avatar IA, Nome, Criado por...]`

---

### 3. Seção: "Experiências em Destaque" (Grid Principal)
*O conteúdo principal da tela, com os cards de experiências mais relevantes ou populares.*

- **Título da Seção:** Experiências Populares
- **Ação no Título:** `[Botão: Ver Todas]` -> *Leva para `experiencias_lista.md`*
- **Componente: Grid de Cards de Experiência (2 colunas)**

    * **Card de Experiência 1:** `[Imagem, Título, Categoria, Custo ($$), Fornecedor]`
    * **Card de Experiência 2:** `[Imagem, Título, Categoria, Custo ($$), Fornecedor]`
    * **Card de Experiência 3:** `[Imagem, Título, Categoria, Custo ($$), Fornecedor]`
    * **Card de Experiência 4:** `[Imagem, Título, Categoria, Custo ($$), Fornecedor]`

---
---

## Conteúdo de Lista de Experiências

### Tela: Lista de Experiências

#### 1. Cabeçalho
- **Título da Página:** Todas as Experiências
- **Botão de Voltar:** `[<]` -> *Retorna para `experiencias_home.md`*

---

#### 2. Ferramentas de Busca e Filtro
*Controles para que o usuário encontre a atividade perfeita.*

- **Barra de Busca:** `[Buscar por palavra-chave...]`
- **Ícone de Filtro:** `[Ícone de Filtro]` -> *Abre o "Drawer de Filtros" à direita*

---

#### 3. Grid Completo de Experiências
*Todo o nosso catálogo de atividades, pronto para ser explorado. A lista é atualizada dinamicamente conforme os filtros do Drawer são aplicados.*

- **Componente: Grid de Cards de Experiência (2 colunas)**
    * **Card de Experiência 1:** `[Imagem, Título, Categoria, Custo ($$), Fornecedor, Avaliação]`
    * **Card de Experiência 2:** `[Imagem, Título, Categoria, Custo ($$), Fornecedor, Avaliação]`
    * ... (a lista continua com todas as experiências)

---
---

#### Componente: Drawer de Filtros (Abre à Direita)

- **Título do Drawer:** Filtros
- **Seção "Ordenar por":**
    - `[Tag Selecionada: Relevância]` `[Tag: Mais Populares]` `[Tag: Preço (Menor)]` `[Tag: Preço (Maior)]`
- **Seção "Categorias":**
    - `[Tag Selecionável: Passeios no Mar]` `[Tag Selecionável: Roteiros Guiados]` `[Tag Selecionável: Aventura]` `[Tag Selecionável: Gastronomia]` `[Tag Selecionável: Cultura]`
- **Seção "Custo por Pessoa":**
    - `[Tag Selecionável: $]` `[Tag Selecionável: $$]` `[Tag Selecionável: $$$]` `[Tag Selecionável: $$$$]`
- **Seção "Duração":**
    - `[Tag Selecionável: Até 2h]` `[Tag Selecionável: 2h - 4h]` `[Tag Selecionável: Dia Inteiro]`
- **Botões de Ação:**
    - `[Botão Principal: Aplicar Filtros]`
    - `[Botão Secundário: Limpar Tudo]`

---
---

## Conteúdo de Lista de Guias:

### Tela: Lista de Guias

#### 1. Cabeçalho
- **Título da Página:** Guias & Especialistas
- **Botão de Voltar:** `[<]` -> *Retorna para `experiencias_home.md`*

---

#### 2. Ferramentas de Busca e Filtro
*Controles para refinar a busca no diretório completo.*

- **Barra de Busca:** `[Buscar por nome ou especialidade...]`
- **Ícone de Filtro:** `[Ícone de Filtro]` -> *Abre o "Drawer de Filtros" à direita*

---

#### 3. Grid Completo de Guias
*Toda a nossa base de guias, humanos e IA, listada para exploração. A lista é atualizada dinamicamente conforme os filtros do Drawer são aplicados.*

- **Componente: Grid de Perfis de Guias (2 colunas)**
    * **Card de Guia Humano:** `[Foto, Nome, Título, Especialidade, Avaliação]`
    * **Card de Guia IA:** `[Avatar IA, Nome, Título, Tags]`
    * ... (a lista continua com todos os guias)

---
---

#### Componente: Drawer de Filtros (Abre à Direita)

- **Título do Drawer:** Filtros
- **Seção "Ordenar por":**
    - `[Tag Selecionada: Popularidade]` `[Tag: Mais Recentes]` `[Tag: Ordem Alfabética]`
- **Seção "Tipo de Guia":**
    - `[Tag Selecionável: Guias Humanos]` `[Tag Selecionável: Guias IA]`
- **Seção "Especialidades":**
    - `[Tag Selecionável: Ecoturismo]` `[Tag Selecionável: Gastronomia]` `[Tag Selecionável: História]` `[Tag Selecionável: Aventura]` `[Tag Selecionável: Família]` `[Tag Selecionável: Vida Noturna]` `[Tag Selecionável: Cultura]`
- **Botões de Ação:**
    - `[Botão Principal: Aplicar Filtros]`
    - `[Botão Secundário: Limpar Tudo]`

---
---

## Conteúdo de Fluxo de Contratação

### Fluxo: Contratação de Experiência

*Este fluxo é iniciado quando o usuário clica em "Contratar", "Reservar" ou "Comprar" em uma página de detalhe de uma experiência ou roteiro.*

---

### Tela 1: Resumo e Agendamento

- **Título:** Detalhes da sua Reserva
- **Resumo da Experiência:**
    - **Nome:** Roteiro Histórico: O Coração de Guarapari
    - **Guia/Fornecedor:** `[Foto] João da Silva`
- **Seleção de Data:**
    - `[Componente de Calendário com dias disponíveis destacados]`
- **Seleção de Horário (se aplicável):**
    - `[Botões de Horários: 09:00, 11:00, 14:00]`
- **Seleção de Participantes:**
    - `[Contador +/-] Adultos: 2`
    - `[Contador +/-] Crianças: 1`
- **Cálculo de Preço:**
    - **Subtotal:** 2x Adultos (R$ 50,00) = R$ 100,00
    - **Subtotal:** 1x Criança (R$ 25,00) = R$ 25,00
    - **Taxa de Serviço Guar[APP]ari:** R$ 12,50 (10%)
    - **Total:** **R$ 137,50**
- **CTA:** `[Botão: Ir para o Pagamento]`

---

### Tela 2: Pagamento (Guar[APP]ari Pay)

- **Título:** Pagamento
- **Resumo do Pedido:** Roteiro Histórico | 3 Pessoas | Total: R$ 137,50
- **Opções de Pagamento:**
    - **Saldo Guar[APP]ari Pay (Padrão):**
        - `Saldo Disponível: R$ 50,00`
        - `[Checkbox] Usar saldo (R$ 50,00)`
        - `Valor Restante: R$ 87,50`
    - **Cartões Cadastrados:**
        - `[Radio Button] Cartão Final 4242`
        - `[Radio Button] Cartão Final 5890`
    - **Adicionar Novo Método:**
        - `[Link: Pagar com Novo Cartão de Crédito]`
        - `[Link: Pagar com PIX (Copia e Cola)]`
- **Opção de Cashback (se aplicável):**
    - `[Ícone de Presente] Você receberá R$ 6,87 de cashback nesta compra!`
- **CTA:** `[Botão: Confirmar Pagamento]`

---

### Tela 3: Confirmação e Próximos Passos

- **Ícone:** `[Ícone de Check Verde]`
- **Título:** Reserva Confirmada!
- **Mensagem:** "Ótimo! Sua experiência com o guia João da Silva está marcada para o dia **28/10/2025 às 09:00**. Enviamos todos os detalhes para o seu e-mail e você pode gerenciar esta reserva na sua área de 'Perfil'."
- **Informações Adicionais:**
    - **Ponto de Encontro:** `[Link para Mapa: Praça do Relógio, Centro]`
    - **Contato do Guia:** `[Botão: Enviar Mensagem para João]` (abre chat interno)
- **Ações:**
    - `[Botão Principal: Ver Meus Ingressos]`
    - `[Botão Secundário: Voltar para Experiências]`