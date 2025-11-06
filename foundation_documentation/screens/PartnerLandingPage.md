# Template: Partner Landing Page

**Propósito:** Servir como uma página de aterrissagem padrão e visualmente atraente para qualquer parceiro da plataforma (restaurante, artista, produtor, provedor de experiência, etc.).

---

## 1. Estrutura do Template (Mockup v1)

### 1.1. Cabeçalho / Seção Hero
- **Imagem de Capa:** Imagem de alta qualidade que preenche a parte superior da tela (40-50% da viewport).
- **AppBar Transparente:** Sobrepõe a imagem de capa e contém um botão de "Voltar" com contraste dinâmico para garantir a visibilidade.
- **Logo do Parceiro:** Sobrepõe a imagem de capa.
- **Informações (Abaixo da Imagem):**
    - **Nome do Parceiro:** Fonte grande e proeminente.
    - **Endereço (Tappable):** Abre a localização no mapa.
    - **Botão de Contato (Condicional):** Se aplicável, um botão para contato via WhatsApp.

### 1.2. Botão de Ação Principal (FAB Flutuante)
- **Componente:** Botão de Ação Flutuante (FAB) sempre visível no canto inferior direito.
- **Lógica de Texto (Backend-Driven):**
    - **Estado Inicial:** O texto é definido pela categoria do parceiro (e.g., "Virar Fã", "Favoritar", "Apoiar").
    - **Estado Ativo:** O texto muda para indicar o estado (e.g., "Você é Fã", "Favorito", "Apoiando").

### 1.3. Seções de Conteúdo Dinâmico
*As seções abaixo aparecem apenas se o parceiro tiver o conteúdo correspondente.*

- **"Próximos Eventos":** Carrossel horizontal de cards de evento.
- **"Nossas Experiências" / "Nossos Produtos":** Carrossel horizontal ou grid de itens.
- **"Sobre [Nome do Parceiro]":** Seção com texto descritivo.
- **"Galeria":** Grid de imagens.

---
---

## Funcionalidades para Versões Futuras

- **Integração com Mídias Sociais:** Adicionar links para as redes sociais do parceiro.
- **Avaliações e Comentários:** Uma seção para os usuários deixarem avaliações.
- **Vídeo no Hero:** Permitir o uso de vídeos na seção de capa.
