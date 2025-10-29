# Módulo Consolidado: Onboarding e Perfil do Parceiro (v1.0)

**Propósito:** Guiar novos parceiros (estabelecimentos, produtores, guias, promoters) pelo processo de cadastro, configuração inicial e gestão de seu perfil na plataforma Guar[APP]ari Promoter.

---

## 1. Fluxo de Onboarding de Novo Parceiro

### Tela 1.1: Boas-vindas e Tipo de Parceiro

- **Título:** Bem-vindo à Plataforma Guar[APP]ari Promoter!
- **Subtítulo:** Para começar, qual o seu perfil?
- **Opções de Seleção (Radio Buttons ou Cards Clicáveis):**
    - `[Card/Botão: Estabelecimento (Loja, Restaurante, Bar)]`
    - `[Card/Botão: Produtor (Artesão, Rural)]`
    - `[Card/Botão: Guia / Especialista em Experiências]`
    - `[Card/Botão: Promoter / Influenciador]`
- **CTA:** `[Botão: Continuar]`

### Tela 1.2: Cadastro Inicial (Dados Básicos)

- **Título:** Crie sua Conta de Parceiro
- **Campos do Formulário:**
    - **Nome Completo / Razão Social:** `[Campo de Texto]`
    - **E-mail:** `[Campo de Texto]`
    - **Senha:** `[Campo de Senha]`
    - **Confirmar Senha:** `[Campo de Senha]`
    - **Termos de Uso e Política de Privacidade:** `[Checkbox: Li e concordo com os Termos de Uso]` `[Link para Termos]`
- **CTA:** `[Botão: Cadastrar]`
- **Link:** `[Já tenho uma conta. Entrar]`

### Tela 1.3: Configuração do Perfil (Baseado no Tipo de Parceiro)

*Esta tela se adapta dinamicamente ao tipo de parceiro selecionado na Tela 1.1.*

#### Para Estabelecimentos (Loja, Restaurante, Bar):
- **Título:** Configure seu Estabelecimento
- **Campos:**
    - **Nome Fantasia:** `[Campo de Texto]`
    - **CNPJ:** `[Campo de Texto]`
    - **Endereço Completo:** `[Campo de Texto com Autocomplete]`
    - **Telefone de Contato:** `[Campo de Texto]`
    - **Descrição do Estabelecimento:** `[Área de Texto]`
    - **Categorias (Múltipla Escolha):** `[Tags Selecionáveis: Restaurante, Bar, Café, Loja de Roupas, etc.]`
    - **Horário de Funcionamento:** `[Componente de Seleção de Horários por Dia da Semana]`
    - **Upload de Logo:** `[Botão de Upload]`
    - **Upload de Fotos do Local:** `[Botão de Upload (Múltiplas Imagens)]`
- **CTA:** `[Botão: Salvar e Continuar]`

#### Para Produtores (Artesão, Rural):
- **Título:** Configure seu Perfil de Produtor
- **Campos:**
    - **Nome da Lojinha / Marca:** `[Campo de Texto]`
    - **CPF / CNPJ:** `[Campo de Texto]`
    - **Endereço (para retirada/visita, se aplicável):** `[Campo de Texto com Autocomplete]`
    - **Telefone de Contato:** `[Campo de Texto]`
    - **Descrição do seu Trabalho/Produtos:** `[Área de Texto]`
    - **Categorias de Produtos:** `[Tags Selecionáveis: Artesanato, Produtos Rurais, Joias, Decoração, etc.]`
    - **Upload de Foto de Perfil:** `[Botão de Upload]`
    - **Upload de Fotos de Produtos/Processo:** `[Botão de Upload (Múltiplas Imagens)]`
- **CTA:** `[Botão: Salvar e Continuar]`

#### Para Guias / Especialistas em Experiências:
- **Título:** Configure seu Perfil de Guia
- **Campos:**
    - **Nome Completo:** `[Campo de Texto]`
    - **CPF:** `[Campo de Texto]`
    - **Telefone de Contato:** `[Campo de Texto]`
    - **Áreas de Especialidade:** `[Tags Selecionáveis: Ecoturismo, Gastronomia, História, Aventura, etc.]`
    - **Idiomas Falados:** `[Tags Selecionáveis: Português, Inglês, Espanhol, etc.]`
    - **Descrição / Bio:** `[Área de Texto]`
    - **Upload de Foto de Perfil:** `[Botão de Upload]`
    - **Upload de Certificações/Portfólio:** `[Botão de Upload (Múltiplas Imagens)]`
- **CTA:** `[Botão: Salvar e Continuar]`

#### Para Promoters / Influenciadores:
- **Título:** Configure seu Perfil de Promoter
- **Campos:**
    - **Nome Completo:** `[Campo de Texto]`
    - **CPF:** `[Campo de Texto]`
    - **Telefone de Contato:** `[Campo de Texto]`
    - **Redes Sociais (Links):** `[Campo de Texto para Instagram, TikTok, YouTube, etc.]`
    - **Áreas de Interesse/Nicho:** `[Tags Selecionáveis: Música, Festas, Gastronomia, Aventura, etc.]`
    - **Descrição / Bio:** `[Área de Texto]`
    - **Upload de Foto de Perfil:** `[Botão de Upload]`
- **CTA:** `[Botão: Salvar e Continuar]`

### Tela 1.4: Configuração de Pagamento (Para Todos os Parceiros)

- **Título:** Configure seus Dados de Pagamento
- **Subtítulo:** Para receber seus repasses e comissões.
- **Campos:**
    - **Tipo de Conta:** `[Radio Button: Pessoa Física (CPF) | Pessoa Jurídica (CNPJ)]`
    - **Banco:** `[Dropdown de Bancos]`
    - **Agência:** `[Campo de Texto]`
    - **Número da Conta:** `[Campo de Texto]`
    - **Tipo de Conta:** `[Radio Button: Conta Corrente | Conta Poupança]`
    - **Titular da Conta:** `[Campo de Texto]`
    - **CPF/CNPJ do Titular:** `[Campo de Texto]`
- **CTA:** `[Botão: Concluir Onboarding]`

---

## 2. Gestão de Perfil do Parceiro (Após Onboarding)

### Tela 2.1: Dashboard Principal do Parceiro

*A primeira tela que o parceiro vê após o login, oferecendo um resumo e atalhos.*

- **Cabeçalho:** `[Logo Guar[APP]ari Promoter]` | **Olá, [Nome do Parceiro]!** | `[Ícone de Notificações]` | `[Ícone de Ajuda]`
- **Card de Resumo Rápido (KPIs Principais):**
    - **Receita Total (Mês):** `[Valor em Destaque]`
    - **Eventos Ativos / Produtos Cadastrados:** `[Número]`
    - **Próximo Repasse:** `[Data]`
- **Ações Rápidas (CTAs):**
    - `[Botão: Criar Novo Evento]`
    - `[Botão: Cadastrar Novo Produto/Serviço]`
    - `[Botão: Ver Relatórios de BI]`
- **Seção: Notificações e Alertas:**
    - `[Alerta: Seu cadastro está incompleto. Adicione mais fotos!]`
    - `[Notificação: Novo pedido na sua lojinha!]`
- **Menu de Navegação Lateral (Fixo):**
    - `[Ícone: Home]` Dashboard
    - `[Ícone: Eventos]` Meus Eventos
    - `[Ícone: Produtos/Serviços]` Meus Produtos/Serviços (Adapta-se ao tipo de parceiro)
    - `[Ícone: Pedidos]` Gerenciar Pedidos (Para Lojistas/Guias)
    - `[Ícone: Promoters]` Gerenciar Promoters (Para Estabelecimentos/Eventos)
    - `[Ícone: Relatórios]` BI e Desempenho
    - `[Ícone: Perfil]` Configurações do Perfil
    - `[Ícone: Pagamentos]` Dados Financeiros e Extrato

### Tela 2.2: Configurações do Perfil (Edição)

*Acessada via "Configurações do Perfil" no menu lateral.*

- **Título:** Configurações do Perfil
- **Abas de Navegação (Horizontal):** `[Informações Gerais]` `[Endereço]` `[Horários]` `[Mídias]` `[Dados Bancários]` `[Segurança]`
- **Conteúdo da Aba "Informações Gerais":**
    - **Nome Fantasia / Nome da Lojinha:** `[Campo de Texto]`
    - **Descrição:** `[Área de Texto]`
    - **Categorias:** `[Tags Selecionáveis]`
    - **Telefone:** `[Campo de Texto]`
    - **E-mail de Contato:** `[Campo de Texto]`
- **Conteúdo da Aba "Mídias":**
    - **Logo / Foto de Perfil:** `[Upload]`
    - **Galeria de Fotos:** `[Upload Múltiplo]`
- **Conteúdo da Aba "Dados Bancários":**
    - Exibe os dados cadastrados na Tela 1.4 com opção de `[Botão: Editar]`
- **Conteúdo da Aba "Segurança":**
    - `[Campo: Senha Atual]`
    - `[Campo: Nova Senha]`
    - `[Campo: Confirmar Nova Senha]`
    - `[Botão: Alterar Senha]`
- **CTA Global:** `[Botão: Salvar Alterações]`

---