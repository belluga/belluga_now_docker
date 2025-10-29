# Módulo Consolidado: Loja Local (v1.0)

**Propósito:** Unificar a venda de Produtos Artesanais e Produtos Rurais de Guarapari em uma única vitrine digital, utilizando Segmentação Inteligente (Tags) e Curadoria por IA para sugerir Kits.

---

## 1. Protótipo da Tela Principal: Loja (`loja.md`)

### 1.1. Cabeçalho e Busca Conversacional
- **Título da Página:** Loja Local
- **Ícones de Ação:** `[Ícone de Carrinho]` -> *Leva para `loja_carrinho.md`* | `[Ícone de Perfil/Histórico]` -> *Leva para `minhas_compras.md`*
- **Campo de Busca Principal (Foco na IA):** `[🔎 O que você gostaria de comprar? (Ex: Café da montanha, Cachaça Artesanal, Pulseira)]`

### 1.2. Segmentação Inteligente (Filtros de Um Toque)
*Carrossel horizontal de tags que filtram o feed imediatamente.*

- **Tags de Filtro Rápido:**
    - `[Botão Selecionado: Todos]`
    - `[Botão: Produtos Rurais]`
    - `[Botão: Artesanato]`
    - `[Botão: Kits Temáticos]`
    - `[Botão: Eletrônicos Locais]` (*Para escalabilidade futura*)

---

## 2. Seções de Conteúdo Dinâmico

### 2.1. Kits Especiais (Curadoria IA)
*Seção projetada para aumentar o Ticket Médio através de sugestões personalizadas e economia.*

- **Título:** Kits Recomendados para a Sua Experiência
- **Subtítulo:** *Combinamos o que há de melhor, baseado nos seus interesses na Agenda e Guias.*
- **Componente: Carrossel Horizontal de Cards de Kits**
    - **Card Exemplo:**
        - **Nome:** Kit Guarapari Gourmet
        - **Descrição:** Café da montanha, cachaça artesanal e doce de leite (3 Itens).
        - **Preço:** R$ 99,90 (Economia de 15% ao comprar o kit)
        - **CTA:** `[Botão: Adicionar ao Carrinho]` | `[Link: Ver Detalhes]`

### 2.2. Vitrine do Produtor (Lojinhas Individuais)
*Destaque estratégico para o parceiro humano, reforçando a narrativa e a credibilidade.*

- **Título:** Nossos Parceiros em Destaque
- **Ação no Título:** `[Botão: Ver Todas as Lojinhas]` -> *Leva para `loja_lista_produtores.md`*
- **Componente: Grid de Cards de Lojinha**
    - **Card Exemplo (Produtor Rural):**
        - `[Foto do Produtor/Fazenda]`
        - **Nome da Lojinha:** Café do Sítio Alegre
        - **Foco:** Produtos Rurais (Café, Mel, Ovos Caipiras)
        - **Avaliação:** `⭐️ 4.9 (88 avaliações)`
        - **CTA:** `[Botão: Visitar Lojinha]` -> *Leva para `loja_produtor.md`*

### 2.3. Feed Unificado de Produtos
*O feed principal da loja, que se adapta aos filtros selecionados.*

- **Título:** Todos os Produtos
- **Componente: Lista Vertical de Cards de Produto**
    - **Card Exemplo:**
        - `[Imagem do Produto]`
        - **Nome:** Sabonete Artesanal de Lavanda
        - **Produtor:** Artesã da Enseada Azul
        - **Preço:** R$ 25,00
        - **CTA:** `[Botão: Adicionar ao Carrinho]` | `[Ícone: Coração (Salvar para Depois)]`

---

## 3. Protótipo: Página do Produtor (`loja_produtor.md`)

- **Cabeçalho:** `[Banner/Foto do Local]` | **Nome:** Café do Sítio Alegre
- **Subtítulo:** Produtor Rural em Destaque | `[Ícone de Compartilhar]`
- **Seção de Contexto:**
    - **História:** *Parágrafo curto sobre o processo de produção, a família e a localização.*
    - **Localização:** `[Mapa Sutil]`. *Exibir se o local permite visita/retirada.*
    - **Avaliação Consolidada:** `⭐️ 4.9 (88 avaliações)`
- **Seção de Produtos:**
    - **Título:** Catálogo Completo
    - `[Lista vertical de todos os produtos do produtor]`

---

## 4. Consolidação: Fluxo de Checkout e Pagamento

*Utiliza a lógica e as telas já estabelecidas no `modulo_guias_e_experiencias.md` para garantir consistência.*

- **Carrinho (`loja_carrinho.md`):** Exibir resumo do pedido, Frete/Retirada, Total e a **Taxa de Serviço Guar[APP]ari** (Monetização).
- **Pagamento (`pagamento.md`):** Reutiliza as telas do **Guar[APP]ari Pay** (saldo, cartões, PIX).