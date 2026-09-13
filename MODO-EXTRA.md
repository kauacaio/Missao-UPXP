# Modo extra aos 1.000 pontos

Antes de publicar o site atualizado, execute `migracao-modo-bonus.sql` no SQL Editor do mesmo Supabase usado pelo jogo. A migração depende das tabelas `players` e `challenges` e da função `get_challenge_by_code` já usadas pelo jogo.

Publique também `app.js`, `index.html`, `bonus.css` e `share-achievement.js`.

- Aos 1.000 pontos, o participante recebe um modal de parabéns com confetes. A celebração é lembrada por participante neste navegador.
- O botão “Continuar no game” permanece disponível a partir desse marco.
- O sorteio usa apenas perguntas ainda não respondidas na missão e nunca sorteadas antes no modo extra para aquele participante, incluindo tentativas expiradas. Quando o conjunto acaba, o jogo informa que não há mais perguntas.
- Cada tentativa tem 15 segundos, contados pelo servidor desde o sorteio. O tempo de carregamento faz parte desse prazo. Reabrir uma tentativa ainda ativa mantém seu vencimento original.
- Acertos somam os pontos cadastrados na pergunta. Erros e tempo esgotado não somam pontos. A contagem de desafios da missão original permanece separada do modo extra.
- Após o resultado, “Próxima pergunta” inicia outro sorteio. Reenviar uma resposta da mesma rodada não concede pontos novamente.

Validação local: simulações JavaScript cobrem o limite de 999/1.000 pontos, celebração única, prazo de 15 segundos, resposta atrasada, bloqueio de reenvio após conclusão e recuperação de falha de rede. A migração precisa ser validada no Supabase antes da publicação; não foi executada no banco durante esta alteração.

## Imagens da conquista

Aos 1.000 pontos, a área de códigos dá lugar ao botão animado de continuar e ao acesso “Criar meu post”. A animação respeita a preferência de movimento reduzido do aparelho.

São geradas imagens PNG personalizadas com nome e pontuação: post quadrado (1080 × 1080), Story/Status (1080 × 1920) e certificado comemorativo horizontal (1600 × 1132). O certificado não declara carga horária ou validação acadêmica. Os dados são desenhados no aparelho, sem envio para serviços de geração de imagens.

O botão de compartilhar abre o seletor nativo quando o navegador permite compartilhar arquivos. Os aplicativos exibidos dependem do aparelho. Caso o recurso não esteja disponível, a imagem é oferecida para download e publicação manual. Não há postagem automática no Instagram ou WhatsApp.
