const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configurações do Express
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Garantir que a pasta de uploads existe
const pastaUploads = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(pastaUploads)) {
    fs.mkdirSync(pastaUploads, { recursive: true });
}

// Configuração do Multer (Armazenamento de Imagens)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});

// 📸 UPGRADE: Limites de Galeria (1 Capa + 6 Galeria)
const upload = multer({ storage: storage });
const uploadConfig = upload.fields([
    { name: 'foto', maxCount: 1 }, 
    { name: 'galeria', maxCount: 6 } 
]);

// Ligação à Base de Dados
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// Função Auxiliar: Criar URLs Amigáveis (Slugs)
const gerarSlug = (texto) => {
    return (texto || '').toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove acentos
        .replace(/ /g, '-')             // Troca espaços por hífens
        .replace(/[^\w-]+/g, '');       // Remove caracteres especiais
};

// ==========================================
// 🌍 ROTAS PÚBLICAS
// ==========================================

// Página Inicial
app.get('/', async (req, res) => {
    try {
        const [categorias] = await db.promise().execute('SELECT * FROM categorias ORDER BY nome ASC');
        const [patrocinados] = await db.promise().execute('SELECT * FROM empresas WHERE status = "ativo" AND plano_id = 3 ORDER BY RAND() LIMIT 3');
        const mostrarSucesso = req.query.sucesso === 'true';
        res.render('index', { title: 'Portal STL', categorias, patrocinados, sucesso: mostrarSucesso });
    } catch (err) { 
        console.error('🚨 Erro na Home:', err);
        res.status(500).send('Erro interno do servidor.'); 
    }
});

// Receção de Contactos / Cadastro Gratuito
app.post('/contato', async (req, res) => {
    try {
        const { nome, categoria_id, whatsapp, endereco, link_maps, site, facebook, instagram } = req.body;
        const slug = gerarSlug(nome);
        // 🚨 UPGRADE COMERCIAL: Mudou de 'inativo' para 'aprovacao'
        const query = `INSERT INTO empresas (categoria_id, plano_id, nome, slug, endereco, link_maps, whatsapp, site, facebook, instagram, status) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'aprovacao')`;
        await db.promise().execute(query, [categoria_id, nome, slug, endereco || null, link_maps || null, whatsapp || null, site || null, facebook || null, instagram || null]);
        res.redirect('/?sucesso=true#anunciar');
    } catch (err) { 
        console.error('🚨 Erro no Cadastro de Contacto:', err);
        res.redirect('/?sucesso=false#anunciar'); 
    }
});

// Página Explorar / Buscas
app.get('/explorar', async (req, res) => {
    try {
        const categoriaFiltro = req.query.categoria; 
        const buscaTexto = req.query.busca;
        let queryEmpresas = 'SELECT e.*, c.nome as categoria_nome FROM empresas e LEFT JOIN categorias c ON e.categoria_id = c.id WHERE e.status = "ativo"';
        let params = [];
        
        if (categoriaFiltro) { 
            queryEmpresas += ' AND e.categoria_id = ?'; 
            params.push(categoriaFiltro); 
        }
        
        if (buscaTexto) { 
            let termoLimpo = buscaTexto.trim();
            if (termoLimpo.toLowerCase().endsWith('s') && termoLimpo.length > 3) termoLimpo = termoLimpo.slice(0, -1);
            const termo = `%${termoLimpo}%`;
            queryEmpresas += ' AND (e.nome LIKE ? OR c.nome LIKE ? OR c.palavras_chave LIKE ? OR e.descricao LIKE ?)'; 
            params.push(termo, termo, termo, termo); 
        }
        
        queryEmpresas += ' ORDER BY e.plano_id DESC, RAND()';
        
        const [locais] = await db.promise().execute(queryEmpresas, params);
        const [categorias] = await db.promise().execute('SELECT * FROM categorias ORDER BY nome ASC');
        res.render('listagem', { locais, categorias, categoriaAtual: categoriaFiltro, buscaAtual: buscaTexto });
    } catch (err) { 
        console.error('🚨 Erro no Explorar:', err);
        res.status(500).send('Erro interno do servidor.'); 
    }
});

// ==========================================
// 🔒 SEGURANÇA E AUTENTICAÇÃO DO ADMIN
// ==========================================
const protegerAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Acesso Restrito ao Painel STL"');
        return res.status(401).send('Acesso Negado. Identifique-se.');
    }
    
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    
    // Procura credenciais no .env, se não existirem usa as padrão de emergência
    const adminUser = process.env.ADMIN_USER || 'daniel';
    const adminPass = process.env.ADMIN_PASS || 'senha123';

    if (auth[0] === adminUser && auth[1] === adminPass) { 
        next();
    } else {
        res.setHeader('WWW-Authenticate', 'Basic realm="Acesso Restrito ao Painel STL"');
        return res.status(401).send('Credenciais inválidas.');
    }
};

app.use('/admin', protegerAdmin);

// ==========================================
// ⚙️ ROTAS DO ADMIN (PAINEL DE CONTROLO)
// ==========================================

// Dashboard Principal
app.get('/admin', async (req, res) => {
    try {
        const [empresas] = await db.promise().execute(`SELECT empresas.*, categorias.nome as categoria_nome FROM empresas LEFT JOIN categorias ON empresas.categoria_id = categorias.id ORDER BY empresas.id DESC`);
        const [categoriasLista] = await db.promise().execute('SELECT * FROM categorias ORDER BY nome ASC');
        res.render('admin', { empresas, categoriasLista });
    } catch (err) { 
        console.error('🚨 Erro no Admin:', err);
        res.status(500).send('Erro interno do servidor.'); 
    }
});

// Excluir Empresa
app.get('/admin/excluir/:id', async (req, res) => {
    try {
        await db.promise().execute('DELETE FROM empresas WHERE id = ?', [req.params.id]);
        res.redirect('/admin');
    } catch (err) { 
        console.error('🚨 Erro ao excluir empresa:', err);
        res.status(500).send('Erro ao excluir empresa.'); 
    }
});

// Excluir Categoria
app.get('/admin/categorias/excluir/:id', async (req, res) => {
    try {
        await db.promise().execute('DELETE FROM categorias WHERE id = ?', [req.params.id]);
        res.redirect('/admin');
    } catch (err) { 
        console.error('🚨 Erro ao excluir categoria:', err);
        res.status(500).send('Erro ao excluir categoria.'); 
    }
});

// Atualizar Categoria (SEO)
app.post('/admin/categorias/atualizar/:id', async (req, res) => {
    try {
        const { nome, palavras_chave } = req.body;
        await db.promise().execute('UPDATE categorias SET nome = ?, palavras_chave = ? WHERE id = ?', [nome, palavras_chave || null, req.params.id]);
        res.redirect('/admin');
    } catch (err) { 
        console.error('🚨 Erro ao atualizar categoria:', err);
        res.status(500).send('Erro ao atualizar categoria'); 
    }
});

// Criar Nova Categoria
app.post('/admin/categorias', async (req, res) => {
    try {
        const { nome_categoria } = req.body;
        const slug = gerarSlug(nome_categoria);
        await db.promise().execute('INSERT IGNORE INTO categorias (nome, slug) VALUES (?, ?)', [nome_categoria, slug]);
        res.redirect('/admin');
    } catch (err) { 
        console.error('🚨 Erro ao criar categoria:', err);
        res.status(500).send('Erro ao criar categoria'); 
    }
});

// Formulário de Nova Empresa
app.get('/admin/nova', async (req, res) => {
    try {
        const [categorias] = await db.promise().execute('SELECT * FROM categorias ORDER BY nome ASC');
        res.render('nova', { categorias });
    } catch (err) { 
        console.error('🚨 Erro a carregar nova empresa:', err);
        res.status(500).send(err); 
    }
});

// Processar Nova Empresa
app.post('/admin/nova', uploadConfig, async (req, res) => {
    try {
        const { nome, categoria_id, descricao, endereco, link_maps, whatsapp, site, facebook, instagram, plano_id, status, video_url } = req.body;
        const slug = gerarSlug(nome);
        
        let imagemUrl = null;
        if (req.files && req.files['foto']) imagemUrl = `/uploads/${req.files['foto'][0].filename}`;
        
        let galeriaJson = null;
        if (req.files && req.files['galeria']) galeriaJson = JSON.stringify(req.files['galeria'].map(f => `/uploads/${f.filename}`));
        
        const query = `INSERT INTO empresas (categoria_id, plano_id, nome, slug, descricao, endereco, link_maps, whatsapp, site, facebook, instagram, imagem, video_url, galeria, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        await db.promise().execute(query, [categoria_id, plano_id, nome, slug, descricao || null, endereco || null, link_maps || null, whatsapp || null, site || null, facebook || null, instagram || null, imagemUrl, video_url || null, galeriaJson, status]);
        
        res.redirect('/admin');
    } catch (err) { 
        console.error('🚨 Erro ao guardar nova empresa:', err);
        res.status(500).send('Erro ao guardar.'); 
    }
});

// Formulário de Editar Empresa
app.get('/admin/editar/:id', async (req, res) => {
    try {
        const [empresa] = await db.promise().execute('SELECT * FROM empresas WHERE id = ?', [req.params.id]);
        const [categorias] = await db.promise().execute('SELECT * FROM categorias ORDER BY nome ASC');
        
        if(empresa.length === 0) return res.status(404).send('Empresa não encontrada.');
        
        res.render('editar', { empresa: empresa[0], categorias });
    } catch (err) { 
        console.error('🚨 Erro a carregar edição:', err);
        res.status(500).send(err); 
    }
});

// Processar Edição de Empresa
app.post('/admin/atualizar/:id', uploadConfig, async (req, res) => {
    try {
        const { nome, categoria_id, descricao, endereco, link_maps, whatsapp, site, facebook, instagram, plano_id, status, video_url } = req.body;
        // Atualiza o slug caso o nome mude
        const slug = gerarSlug(nome);
        
        let query = 'UPDATE empresas SET categoria_id=?, nome=?, slug=?, descricao=?, endereco=?, link_maps=?, whatsapp=?, site=?, facebook=?, instagram=?, plano_id=?, status=?, video_url=?';
        let params = [categoria_id, nome, slug, descricao || null, endereco || null, link_maps || null, whatsapp || null, site || null, facebook || null, instagram || null, plano_id, status, video_url || null];
        
        if (req.files && req.files['foto']) { 
            query += ', imagem=?'; 
            params.push(`/uploads/${req.files['foto'][0].filename}`); 
        }
        
        if (req.files && req.files['galeria'] && req.files['galeria'].length > 0) { 
            query += ', galeria=?'; 
            params.push(JSON.stringify(req.files['galeria'].map(f => `/uploads/${f.filename}`))); 
        }
        
        query += ' WHERE id=?';
        params.push(req.params.id);
        
        await db.promise().execute(query, params);
        res.redirect('/admin');
    } catch (err) { 
        console.error('🚨 Erro ao atualizar empresa:', err);
        res.status(500).send('Erro ao atualizar.'); 
    }
});

// ==========================================
// 🤖 AUTOMAÇÃO: VARREDURA DO GOOGLE PLACES
// ==========================================
app.post('/admin/importar-google', async (req, res) => {
    const { termo_busca, categoria_id } = req.body;
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey || apiKey === 'AIzaSySuaChaveSecretaDoGoogleAqui') {
        return res.status(400).send('<script>alert("Erro: Configure a GOOGLE_PLACES_API_KEY no .env"); window.location.href="/admin";</script>');
    }

    try {
        // Usa a Nova API do Places (Text Search)
        const url = 'https://places.googleapis.com/v1/places:searchText';
        
        const requestBody = { 
            textQuery: `${termo_busca} em São Thomé das Letras, MG` 
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!data.places || data.places.length === 0) {
            return res.send('<script>alert("Nenhum local encontrado no Google com esse termo."); window.location.href="/admin";</script>');
        }

        let inseridos = 0;
        let duplicados = 0;

        for (const place of data.places) {
            const nome = place.displayName?.text;
            const endereco = place.formattedAddress;
            const telefone = place.nationalPhoneNumber ? place.nationalPhoneNumber.replace(/\D/g, '') : null;
            const slug = gerarSlug(nome);

            const [existe] = await db.promise().execute('SELECT id FROM empresas WHERE slug = ?', [slug]);

            if (existe.length === 0) {
                const query = `INSERT INTO empresas (categoria_id, plano_id, nome, slug, endereco, whatsapp, status) VALUES (?, 1, ?, ?, ?, ?, 'inativo')`;
                await db.promise().execute(query, [categoria_id, nome, slug, endereco || null, telefone || null]);
                inseridos++;
            } else {
                duplicados++;
            }
        }

        res.send(`<script>alert("Varredura Concluída!\\n\\n✅ Adicionados: ${inseridos}\\n⚠️ Já existiam: ${duplicados}\\n\\nEles estão no painel como INATIVOS para sua revisão."); window.location.href="/admin";</script>`);

    } catch (err) {
        console.error('🚨 Erro na API do Google:', err);
        res.status(500).send(`<script>alert("Erro na varredura: ${err.message}"); window.location.href="/admin";</script>`);
    }
});

// ==========================================
// 🚨 ROTA DA "URL LIMPA" (DEVE FICAR NO FUNDO!)
// ==========================================
// Como não há '/local/', o servidor testa TUDO aqui. 
// Por isso, deve vir depois de '/admin', '/explorar', etc.
app.get('/:slug', async (req, res) => {
    try {
        const query = `
            SELECT e.*, c.nome as categoria_nome 
            FROM empresas e 
            LEFT JOIN categorias c ON e.categoria_id = c.id 
            WHERE e.slug = ? AND e.status = "ativo"
        `;
        const [empresas] = await db.promise().execute(query, [req.params.slug]);
        
        if (empresas.length === 0) return res.status(404).send('Página não encontrada.');
        res.render('detalhes', { empresa: empresas[0] });
    } catch (erro) { 
        console.error('🚨 Erro na Página de Detalhes:', erro);
        res.status(500).send('Erro interno do servidor.'); 
    }
});

// 🚀 Inicialização do Servidor
app.listen(port, () => {
    console.log(`\n=========================================`);
    console.log(`🚀 Motor Central STL online na porta ${port}`);
    console.log(`=========================================\n`);
});
