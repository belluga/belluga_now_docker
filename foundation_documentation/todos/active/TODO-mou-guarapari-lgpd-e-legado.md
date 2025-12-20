# TODO: MoU Guarapari — LGPD + Legado (Agregados)

**Status:** Active  
**Owners:** Delphi + Time Bóora! (Produto/Jurídico)  
**Goal:** Ajustar a cláusula de LGPD e “legado/histórico” do MoU para deixar explícito que a Prefeitura recebe apenas dados anonimizados e agregados (sem reidentificação), e que qualquer exceção exige instrumento específico.

---

**Note:** Este TODO foi renomeado para refletir o Município de Guarapari.

## References
- `foundation_documentation/mou.md`
- `foundation_documentation/project_mandate.md` (P‑B6: Privacy with Agency)

---

## Scope
- Incluir o tópico 1.1 (“DA SINGULARIDADE TECNOLÓGICA”) para registrar, de forma objetiva, os elementos diferenciadores do Bóora! que fundamentam a análise de adequação do procedimento (inovação/singularidade), sem impor obrigações técnicas adicionais ao Município.
- Incluir uma seção de “Entregas previstas (base)” para materializar as disponibilizações iniciais (apps nas lojas, website integrado, canais institucionais, push/convites) e registrar que o roadmap/acessos serão alinhados após a assinatura do MoU.
- Incluir, na seção de entregáveis, o fluxo institucional de chamamento/credenciamento e a autonomia do Município para descredenciar/bloquear o status de “credenciado” por interesse público, deixando explícito que “não exibição” não significa necessariamente exclusão de histórico.
- Incluir uma seção de “Contrapartidas/Responsabilidades da Prefeitura (pós-contratação)” para explicitar expectativas de adoção institucional (app oficial), promoção, engajamento de empreendedores e governança via grupo de trabalho (GT) ágil com baixa burocracia.
- Ajustar a governança de patrocínios para permitir veto de marcas **e/ou campanhas/peças**, com prazo contado **após o início da veiculação**.
- Incluir cláusulas finais de “natureza do instrumento” (não vinculante, sem exclusividade, sem obrigação de contratar, custos próprios e confidencialidade básica) e “autorização para captação” (patrocinadores/parceiros), com dever de transparência sobre o caráter preliminar e regras de uso de marcas/símbolos oficiais.
- Ajustar a Seção 10 para evitar repetição entre “Validação de Mercado” e “Autorização para captação”, separando “status institucional em análise” do efeito prático de captação.
- Reduzir redundâncias sobre integrações/voucher/feira, mantendo exemplos concentrados na Seção 9 e usando referências cruzadas nas Seções 1.1 e 8.
- Atualizar o MoU para o Município de Guarapari (título, PARTES, local/data e assinatura da Prefeitura) e formalizar a identificação da empresa responsável pelo Bóora! (Belluga Solutions LTDA, CNPJ e representante), citando que é incubada no IFES.
- Ajustar o bloco de assinatura da Belluga para evitar duplicidade, mantendo uma única assinatura do representante legal.
- Atualizar a Seção 4 (“DA PROTEÇÃO DE DADOS (LGPD) E LEGADO”) para:
  - Delimitar que a Prefeitura recebe exclusivamente relatórios/indicadores anonimizados e agregados.
  - Vedar tentativas de reidentificação/correlação para tornar titulares identificáveis.
  - Definir “legado” como histórico desses relatórios agregados.
  - Prever cláusula variável por Município: qualquer acesso que não seja anonimizável/agregado exige aditivo/DPA com papéis e responsabilidades.
- Atualizar a Seção 6 (“DO ESCOPO E SEGURANÇA JURÍDICA”) para explicitar que integrações de interesse público (ex.: saúde, voucher turístico, feira virtual e outros) são viáveis, mas dependem de alinhamento específico e eventual instrumento aditivo.
- Criar a Seção 7 (“DE NOVOS ESTUDOS E POSSIBILIDADES”) e mover para ela o item de estudos jurídicos/viabilidade (incluindo voucher turístico e atividades de risco), renumerando a seção de vigência para 8.
- Remover artefatos editoriais (`[cite_start]`, `[cite: …]`) e corrigir erro ortográfico em assinatura (Guarappari → Guarapari), se presente.

## Out of Scope
- Alterar modelo de negócio, governança de patrocínio, ou termos de IP/rebranding.
- Definir texto jurídico final de DPA; apenas sinalizar a necessidade de instrumento específico.

## Decisions
- A Prefeitura não recebe dados pessoais; apenas informações anonimizadas e agregadas, com vedação de reidentificação.
- Exceções (interesse/possibilidade do Município em assumir responsabilidade LGPD) são tratadas por instrumento específico.

## Definition of Done
- `foundation_documentation/mou.md` contém o tópico 1.1 com bullets claros de singularidade/diferenciais, alinhados às Seções 4 e 6.
- `foundation_documentation/mou.md` contém uma seção “Entregas previstas (base)” com os entregáveis acordados e a cláusula de alinhamento posterior de roadmap/acessos.
- `foundation_documentation/mou.md` explicita o chamamento/credenciamento e o descredenciamento, incluindo a distinção entre “não exibição” e “exclusão” de registros históricos.
- `foundation_documentation/mou.md` contém uma seção de contrapartidas/responsabilidades da Prefeitura (pós-contratação), incluindo GT ágil para decisões de conteúdo/campanhas/prioridades.
- `foundation_documentation/mou.md` contém a redação de veto aplicável a marcas e campanhas/peças e o prazo contado após o início da veiculação.
- `foundation_documentation/mou.md` contém cláusulas de natureza não vinculante + autorização de captação + uso de logos oficiais.
- `foundation_documentation/mou.md` atualizado com a redação-alvo na Seção 4.
- `foundation_documentation/mou.md` atualizado com a redação-alvo sobre integrações (Seção 6).
- `foundation_documentation/mou.md` contém a Seção 7 (“Novos estudos e possibilidades”) e a vigência renumerada para 8.
- Não há mais `[cite_start]` / `[cite: ...]` no arquivo.

## Validation Steps
- `rg -n "\\[cite_start\\]|\\[cite:" foundation_documentation/mou.md` retorna vazio.
- Revisão manual da Seção 4 para consistência com “apenas agregados”.
