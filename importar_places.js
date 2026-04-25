const axios = require('axios');
const mysql = require('mysql2/promise'); 
require('dotenv').config();

// ==========================================
// CONFIGURAÇÕES DO ROBÔ (API NOVA)
// ==========================================
const CHAVE_API_GOOGLE = 'AIzaSyAqMNN8BXKVPZm_OtwvqdX5XwRf5uxiyH8'; // <-- Cole sua chave aqui!
const TERMO_DE_BUSCA = 'Pousadas em São Thomé das Letras';
const CATEGORIA_ID = 1; 
const PLANO_ID = 1;     

function criarSlug(texto) {
    return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
}

async function iniciarRobo() {
    console.log(`🤖 Iniciando varredura na Nova API do Google por: "${TERMO_DE_BUSCA}"...`);

    const db = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    });

    try {
        // Nova URL da API do Google Places (New)
        const url = 'https://places.googleapis.com/v1/places:searchText';
        
        // A nova API exige um POST com cabeçalhos específicos
        const resposta = await axios.post(url, 
            { textQuery: TERMO_DE_BUSCA },
            { 
                headers: {
                    'X-Goog-Api-Key': CHAVE_API_GOOGLE,
                    'X-Goog-FieldMask': 'places.displayName,places.formattedAddress',
                    'Content-Type': 'application/json'
                }
            }
        );
        
        const locais = resposta.data.places || [];

        if (locais.length === 0) {
             console.log('⚠️ O Google não encontrou locais. O termo de busca pode estar muito restrito.');
             return;
        }

        console.log(`📍 Encontrados ${locais.length} locais no Google. Iniciando injeção...`);

        let inseridos = 0;
        for (const local of locais) {
            // A nova API devolve os dados num formato ligeiramente diferente
            const nome = local.displayName ? local.displayName.text : 'Sem Nome';
            const endereco = local.formattedAddress || '';
            const slug = criarSlug(nome);

            const [existente] = await db.execute('SELECT id FROM empresas WHERE slug = ?', [slug]);
            
            if (existente.length === 0) {
                await db.execute(
                    `INSERT INTO empresas (nome, slug, categoria_id, plano_id, endereco, status) 
                     VALUES (?, ?, ?, ?, ?, 'ativo')`,
                    [nome, slug, CATEGORIA_ID, PLANO_ID, endereco]
                );
                console.log(`✅ Adicionado: ${nome}`);
                inseridos++;
            } else {
                console.log(`⏩ Ignorado (já existe): ${nome}`);
            }
        }

        console.log(`\n🎉 Missão Cumprida! ${inseridos} novas empresas adicionadas.`);

    } catch (erro) {
        console.error('\n🚨 Erro durante a extração:');
        // Tratamento de erro detalhado para a API Nova
        if (erro.response && erro.response.data && erro.response.data.error) {
            console.error(`Motivo: ${erro.response.data.error.message}`);
            console.error('Dica: Verifique se a "Places API (New)" está ativada no seu painel do Google Cloud.');
        } else {
            console.error(erro.message);
        }
    } finally {
        await db.end();
    }
}

iniciarRobo();