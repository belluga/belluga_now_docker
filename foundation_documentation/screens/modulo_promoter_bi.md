# Módulo Consolidado: Dashboards de Business Intelligence (BI) (v1.0)

**Propósito:** Fornecer aos parceiros (promoters, estabelecimentos, produtores, guias) acesso a dados e métricas de desempenho de forma clara e acionável, permitindo que meçam seu impacto e otimizem suas estratégias.

---

## 1. Protótipo: Dashboard do Promoter (Influenciador / Artista)

**Objetivo Central:** Permitir que o promoter meça seu desempenho e demonstre seu impacto para os estabelecimentos parceiros, com foco em comissões e engajamento.

### 1.1. Cabeçalho e Filtros

- **Título da Página:** Meu Desempenho (Promoter)
- **Filtro de Período:** `[Dropdown: Últimos 7 dias, Últimos 30 dias, Este Mês, Mês Anterior, Personalizado]`
- **Filtro de Evento/Produto (Opcional):** `[Dropdown: Todos, Evento X, Produto Y]`

---

### 1.2. Cards de Resumo (KPIs Principais)

- **Card 1: Sua Comissão Total**
    - `[Valor em Destaque: R$ 1.250,50]`
    - `[Variação em % em relação ao período anterior: +15%]`
- **Card 2: Ingressos/Vouchers Vendidos**
    - `[Valor em Destaque: 180]`
    - `[Variação em % em relação ao período anterior: +10%]`
- **Card 3: Cliques no Link de Afiliado**
    - `[Valor em Destaque: 3.600]`
    - `[Variação em % em relação ao período anterior: +20%]`
- **Card 4: Taxa de Conversão**
    - `[Valor em Destaque: 5%]`
    - `[Variação em % em relação ao período anterior: +2%]`

---

### 1.3. Gráficos de Tendência

- **Gráfico de Linha: "Performance ao Longo do Tempo"**
    - **Título:** Comissão e Vendas Diárias
    - **Eixo X:** Dias do Período Selecionado
    - **Eixo Y1:** Valor da Comissão (R$)
    - **Eixo Y2:** Volume de Vendas (Unidades)
    - **Interatividade:** Tooltip ao passar o mouse mostrando detalhes do dia.

- **Gráfico de Barras: "Origem dos Cliques" (Se aplicável)**
    - **Título:** Cliques por Canal (Ex: Instagram, WhatsApp, Facebook)
    - **Eixo X:** Canais
    - **Eixo Y:** Número de Cliques

---

### 1.4. Tabela Detalhada: Performance por Campanha

- **Título:** Desempenho por Evento/Produto Promovido
- **Colunas:**
    - `[Nome da Campanha (Evento/Produto)]`
    - `[Estabelecimento/Produtor]`
    - `[Ingressos/Vouchers Vendidos]`
    - `[Sua Comissão]`
    - `[Cliques no Link]`
    - `[Taxa de Conversão]`
    - `[Ações: Ver Detalhes da Campanha]`
- **Funcionalidade:**
    - Ordenação clicável por qualquer coluna.
    - Paginação para grandes volumes de dados.
    - `[Botão: Exportar para CSV/PDF]`

---

## 2. Protótipo: Dashboard do Dono do Evento (Estabelecimento)

---

## 2. Protótipo: Dashboard do Dono do Evento (Estabelecimento)

**Objetivo Central:** Permitir que o dono do estabelecimento entenda o ROI de seus canais de divulgação e o impacto de cada promoter, com foco na receita e origem das vendas.

### 2.1. Cabeçalho e Filtros

- **Título da Página:** Desempenho do Estabelecimento
- **Filtro de Período:** `[Dropdown: Últimos 7 dias, Últimos 30 dias, Este Mês, Mês Anterior, Personalizado]`
- **Filtro de Evento/Produto (Opcional):** `[Dropdown: Todos, Evento X, Produto Y]`

---

### 2.2. Cards de Resumo (KPIs Principais)

- **Card 1: Receita Bruta Total**
    - `[Valor em Destaque: R$ 25.100,00]`
    - `[Variação em % em relação ao período anterior: +8%]`
- **Card 2: Ingressos/Produtos Vendidos**
    - `[Valor em Destaque: 350 / 500 (Capacidade)]`
    - `[Variação em % em relação ao período anterior: +12%]`
- **Card 3: Ticket Médio**
    - `[Valor em Destaque: R$ 71,71]`
    - `[Variação em % em relação ao período anterior: -3%]`
- **Card 4: Promoters Ativos**
    - `[Valor em Destaque: 5]`

---

### 2.3. Gráficos de Análise

- **Gráfico de Pizza/Donut: "Origem das Vendas"**
    - **Título:** Distribuição de Vendas por Canal/Promoter
    - **Fatias:** `[Influenciador A (30%)]`, `[Banda B (25%)]`, `[Venda Direta App (20%)]`, `[Outros (25%)]`
    - **Interatividade:** Clicar em uma fatia filtra a tabela de promoters abaixo.

- **Gráfico de Barras: "Vendas por Categoria de Produto/Serviço" (Para Produtores/Guias)**
    - **Título:** Vendas por Categoria
    - **Eixo X:** Categorias (Ex: Artesanato, Rural, Ecoturismo)
    - **Eixo Y:** Receita (R$)

---

### 2.4. Tabela Detalhada: Ranking de Performance dos Promoters

- **Título:** Desempenho dos Promoters
- **Colunas:**
    - `[Rank]`
    - `[Nome do Promoter]`
    - `[Ingressos/Produtos Vendidos]`
    - `[Receita Gerada]`
    - `[Comissão Paga]`
    - `[Ações: Ver Detalhes do Promoter]`
- **Funcionalidade:**
    - Ordenação clicável por qualquer coluna.
    - Paginação.
    - `[Botão: Exportar para CSV/PDF]`

---

## 3. Protótipo: Relatórios Exportáveis

**Objetivo Central:** Permitir que os parceiros exportem dados brutos ou relatórios formatados para análise externa ou prestação de contas.

### 3.1. Tela de Geração de Relatórios

- **Título da Página:** Gerar Relatórios
- **Tipo de Relatório:** `[Dropdown: Desempenho de Vendas, Detalhes de Comissão, Lista de Clientes (anonimizada), etc.]`
- **Período:** `[Dropdown: Últimos 7 dias, Últimos 30 dias, Este Mês, Mês Anterior, Personalizado]`
- **Formato:** `[Radio Button: CSV, PDF]`
- **CTA:** `[Botão: Gerar Relatório]`
- **Histórico de Relatórios Gerados:**
    - `[Link: Relatório_Vendas_Outubro_2025.pdf]` `[Data: 28/10/2025]` `[Ícone: Download]`
    - `[Link: Comissoes_Setembro_2025.csv]` `[Data: 20/10/2025]` `[Ícone: Download]`