# CRM privado da Missão UPXP

## Ativação

1. Execute `migracao-crm-privado.sql` no SQL Editor do Supabase.
2. Em **Authentication > Users**, crie o usuário da coordenação com e-mail e senha forte.
3. No final da migração, adapte e execute o comando comentado que inclui esse usuário em `campaign_admins`.
4. Acesse `admin.html` e faça login.

## Proteções implementadas

- O telefone fica em `campaign_leads`, separado do ranking.
- A tabela usa Row Level Security e não concede leitura ao visitante anônimo.
- Somente usuários presentes em `campaign_admins` podem consultar ou alterar leads.
- A exportação CSV inclui somente os contatos que aceitaram receber campanhas.
- O consentimento para marketing é opcional e registrado com data.

## Decisões necessárias antes do evento

- Definir o prazo de retenção dos contatos.
- Informar um canal para correção, retirada do consentimento e exclusão.
- Definir o procedimento para participantes menores de idade.
- Limitar quais membros da equipe terão acesso administrativo.
- Avaliar proteção contra cadastros automatizados antes de uma divulgação pública ampla.

